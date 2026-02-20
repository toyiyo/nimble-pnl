import { useCallback, useEffect, useMemo, useState } from 'react';
import { useAuth } from '@/hooks/useAuth';
import { useRestaurantContext } from '@/contexts/RestaurantContext';
import { useEmployees } from '@/hooks/useEmployees';
import { useTimePunches } from '@/hooks/useTimePunches';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Label } from '@/components/ui/label';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { format, startOfDay, endOfDay } from 'date-fns';
import { formatCurrencyFromCents, calculateTipSplitByHours, calculateTipSplitByRole, filterTipEligible, calculateTipSplitEven } from '@/utils/tipPooling';
import { useToast } from '@/hooks/use-toast';
import { useTipPoolSettings, type TipSource, type ShareMethod, type SplitCadence } from '@/hooks/useTipPoolSettings';
import { useTipSplits, type TipSplitWithItems } from '@/hooks/useTipSplits';
import { useTipPayouts, type CreatePayoutsInput } from '@/hooks/useTipPayouts';
import { usePOSTipsForDate } from '@/hooks/usePOSTips';
import { useAutoSaveTipSettings } from '@/hooks/useAutoSaveTipSettings';
import { TipReviewScreen } from '@/components/tips/TipReviewScreen';
import { TipEntryDialog } from '@/components/tips/TipEntryDialog';
import { POSTipImporter } from '@/components/tips/POSTipImporter';
import { EmployeeDeclaredTips } from '@/components/tips/EmployeeDeclaredTips';
import { DisputeManager } from '@/components/tips/DisputeManager';
import { RecentTipSplits } from '@/components/tips/RecentTipSplits';
import { TipHistoricalEntry } from '@/components/tips/TipHistoricalEntry';
import { TipDraftsList } from '@/components/tips/TipDraftsList';
import { TipPeriodTimeline } from '@/components/tips/TipPeriodTimeline';
import { TipPeriodSummary } from '@/components/tips/TipPeriodSummary';
import { TipPayoutSheet } from '@/components/tips/TipPayoutSheet';
import { LockPeriodDialog } from '@/components/tips/LockPeriodDialog';
import { TipPoolSettingsDialog } from '@/components/tips/TipPoolSettingsDialog';
import { calculateWorkedHours } from '@/utils/payrollCalculations';
import { Info, Settings, RefreshCw, Clock, DollarSign, Lock } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';

const defaultWeights: Record<string, number> = {
  'Server': 1,
  'Bartender': 1,
  'Runner': 1,
  'Host': 1,
};

type ViewMode = 'overview' | 'daily' | 'history';

export const Tips = () => {
  // ============ Context Hooks ============
  const { loading } = useAuth();
  const { selectedRestaurant } = useRestaurantContext();
  const restaurantId = selectedRestaurant?.restaurant_id || null;
  const { toast } = useToast();

  // ============ State Hooks ============
  const [showSetup, setShowSetup] = useState(false);
  const [lockDialogOpen, setLockDialogOpen] = useState(false);
  const [viewMode, setViewMode] = useState<ViewMode>('overview');
  const [selectedDate, setSelectedDate] = useState(new Date());
  const [periodOffset, setPeriodOffset] = useState(0); // 0 = current week, -1 = previous, +1 = next
  const [payoutSheetSplit, setPayoutSheetSplit] = useState<TipSplitWithItems | null>(null);

  // ============ Memoized Date Calculations ============
  // Period dates for Overview mode (weekly view, Monday start to align with payroll)
  const { periodStart, periodEnd, periodStartStr, periodEndStr } = useMemo(() => {
    const now = new Date();
    const day = now.getDay();
    // Calculate days since Monday (Monday = 0, Tuesday = 1, ..., Sunday = 6)
    const daysSinceMonday = day === 0 ? 6 : day - 1;
    const baseStart = new Date(now);
    baseStart.setDate(now.getDate() - daysSinceMonday); // Monday as start
    baseStart.setHours(0, 0, 0, 0);

    const start = new Date(baseStart);
    start.setDate(baseStart.getDate() + periodOffset * 7);

    const end = new Date(start);
    end.setDate(start.getDate() + 6);
    end.setHours(23, 59, 59, 999);

    return {
      periodStart: start,
      periodEnd: end,
      periodStartStr: format(start, 'yyyy-MM-dd'),
      periodEndStr: format(end, 'yyyy-MM-dd'),
    };
  }, [periodOffset]);

  // Selected date for Daily Entry mode
  const today = format(selectedDate, 'yyyy-MM-dd');
  // Use local timezone-aware boundaries to match TimePunchesManager behavior
  const todayStart = useMemo(() => startOfDay(selectedDate), [selectedDate]);
  const todayEnd = useMemo(() => endOfDay(selectedDate), [selectedDate]);

  // ============ Data Fetching Hooks ============
  const { employees, loading: employeesLoading } = useEmployees(restaurantId, { status: 'active' });
  const { settings, updateSettings, isLoading: settingsLoading } = useTipPoolSettings(restaurantId);
  const { punches } = useTimePunches(restaurantId, undefined, todayStart, todayEnd);

  // Query for Daily Entry mode - single day
  const { saveTipSplit, isSaving, splits: dailySplits } = useTipSplits(restaurantId, today, today);

  // Query for Overview mode - full period range
  const { splits: periodSplits, isLoading: periodSplitsLoading } = useTipSplits(
    restaurantId,
    periodStartStr,
    periodEndStr
  );

  // Payouts for the current period
  const {
    payouts,
    createPayouts,
    isCreating: isCreatingPayouts,
    deletePayout,
  } = useTipPayouts(restaurantId, periodStartStr, periodEndStr);

  // Use appropriate splits based on view mode
  const splits = viewMode === 'overview' ? periodSplits : dailySplits;

  // ============ Computed Values ============
  // Period validation stats for lock button
  const periodValidation = useMemo(() => {
    if (!periodSplits) {
      return { canLock: false, approved: 0, drafts: 0, withShares: 0, total: 0 };
    }

    const relevantSplits = periodSplits.filter(s => {
      const d = new Date(s.split_date + 'T00:00:00');
      return d >= periodStart && d <= periodEnd && s.status !== 'archived';
    });

    const approved = relevantSplits.filter(s => s.status === 'approved');
    const drafts = relevantSplits.filter(s => s.status === 'draft');
    const withShares = approved.filter(s => s.items && s.items.length > 0);

    return {
      canLock: approved.length > 0 && drafts.length === 0 && withShares.length === approved.length,
      approved: approved.length,
      drafts: drafts.length,
      withShares: withShares.length,
      total: relevantSplits.length,
    };
  }, [periodSplits, periodStart, periodEnd]);

  // ============ Handlers ============
  // Navigate to Daily Entry for a specific day (from Overview timeline click)
  const handleDayClick = (date: Date) => {
    setSelectedDate(date);
    setViewMode('daily');
  };

  // Open payout sheet for a specific split
  const handleRecordPayout = (split: TipSplitWithItems) => {
    setPayoutSheetSplit(split);
  };

  // Confirm payout creation
  const handleConfirmPayout = async (input: CreatePayoutsInput) => {
    try {
      await createPayouts(input);
      setPayoutSheetSplit(null);
    } catch {
      // Error already surfaced via mutation's onError toast; keep sheet open for retry
    }
  };

  // Lock all approved splits in the period (creates payroll snapshot)
  const handleLockPeriod = async () => {
    if (!restaurantId || !periodSplits) return;

    // Only lock approved splits that have employee shares
    const splitsToLock = periodSplits.filter(s => {
      const d = new Date(s.split_date + 'T00:00:00');
      return d >= periodStart && d <= periodEnd &&
        s.status === 'approved' &&
        s.items && s.items.length > 0;
    });

    if (splitsToLock.length === 0) {
      toast({
        title: 'Cannot lock period',
        description: 'No approved tips with employee allocations found.',
        variant: 'destructive',
      });
      return;
    }

    for (const split of splitsToLock) {
      await supabase
        .from('tip_splits')
        .update({ status: 'archived' })
        .eq('id', split.id);
    }

    setLockDialogOpen(false);
    toast({
      title: 'Period locked for payroll',
      description: `${splitsToLock.length} day(s) locked. Tips are now included in payroll.`,
    });
  };

  const { tipData: posTipData, hasTips: hasPOSTips } = usePOSTipsForDate(restaurantId, today);

  const [tipSource, setTipSource] = useState<TipSource>(settings?.tip_source || 'manual');
  const [shareMethod, setShareMethod] = useState<ShareMethod>(settings?.share_method || 'hours');
  const [splitCadence, setSplitCadence] = useState<SplitCadence>(settings?.split_cadence || 'daily');
  const [tipAmount, setTipAmount] = useState<number | null>(null);
  const [hoursByEmployee, setHoursByEmployee] = useState<Record<string, string>>({});
  const [isResumingDraft, setIsResumingDraft] = useState(false);
  const [autoCalculatedHours, setAutoCalculatedHours] = useState<Record<string, boolean>>({}); // Track which hours are auto-calculated
  const [roleWeights, setRoleWeights] = useState<Record<string, number>>(settings?.role_weights || defaultWeights);
  const [selectedEmployees, setSelectedEmployees] = useState<Set<string>>(new Set());
  const [showReview, setShowReview] = useState(false);

  const eligibleEmployees = useMemo(() => filterTipEligible(employees), [employees]);

  useEffect(() => {
    if (settings) {
      setTipSource(settings.tip_source || 'manual');
      setShareMethod(settings.share_method || 'hours');
      setSplitCadence(settings.split_cadence || 'daily');
      setRoleWeights(settings.role_weights || defaultWeights);
      if (settings.enabled_employee_ids?.length) {
        setSelectedEmployees(new Set(settings.enabled_employee_ids));
      }
    }
  }, [settings]);

  // Auto-calculate hours from time punches when share method is 'hours'
  useEffect(() => {
    if (shareMethod !== 'hours' || !punches?.length) return;

    const calculatedHours: Record<string, string> = {};
    const autoFlags: Record<string, boolean> = {};

    eligibleEmployees.forEach(emp => {
      // Get punches for this employee on the selected date
      const employeePunches = punches.filter(p => p.employee_id === emp.id);
      
      if (employeePunches.length > 0) {
        const hours = calculateWorkedHours(employeePunches);
        const roundedHours = Math.round(hours * 10) / 10; // Round to 1 decimal
        
        calculatedHours[emp.id] = roundedHours.toString();
        autoFlags[emp.id] = true;
      }
    });

    if (Object.keys(calculatedHours).length > 0) {
      setHoursByEmployee(prev => {
        const updated = { ...prev };
        // Only update values that haven't been manually edited
        Object.keys(calculatedHours).forEach(empId => {
          if (!prev[empId] || prev[empId] === '0') {
            updated[empId] = calculatedHours[empId];
          }
        });
        return updated;
      });
      setAutoCalculatedHours(prev => ({ ...prev, ...autoFlags }));
    }
  }, [punches, shareMethod, selectedDate, eligibleEmployees]);

  useEffect(() => {
    if (eligibleEmployees.length && !settings?.enabled_employee_ids?.length) {
      setSelectedEmployees(new Set(eligibleEmployees.map(e => e.id)));
    }
    
    // Skip recalculation if resuming a draft - preserve saved hours
    if (isResumingDraft) {
      return;
    }
    
    // Calculate actual hours from time punches
    const hoursFromPunches: Record<string, string> = {};
    eligibleEmployees.forEach(emp => {
      const employeePunches = punches.filter(p => p.employee_id === emp.id);
      let totalMinutes = 0;
      
      // Match clock-in with clock-out pairs
      for (let i = 0; i < employeePunches.length; i++) {
        const punch = employeePunches[i];
        if (punch.punch_type === 'clock_in') {
          // Find corresponding clock_out
          const clockOut = employeePunches.find((p, idx) => 
            idx > i && p.punch_type === 'clock_out' && 
            new Date(p.punch_time) > new Date(punch.punch_time)
          );
          
          if (clockOut) {
            const start = new Date(punch.punch_time);
            const end = new Date(clockOut.punch_time);
            totalMinutes += (end.getTime() - start.getTime()) / (1000 * 60);
          }
        }
      }
      
      hoursFromPunches[emp.id] = (totalMinutes / 60).toFixed(2);
    });
    
    setHoursByEmployee(hoursFromPunches);
  }, [eligibleEmployees, settings, punches, isResumingDraft]);

  // Helper functions for display text
  const getShareMethodLabel = (method: ShareMethod): string => {
    if (method === 'hours') return 'By hours worked';
    if (method === 'role') return 'By role';
    return 'Manual';
  };

  const getSplitCadenceLabel = (cadence: SplitCadence): string => {
    if (cadence === 'daily') return 'Every day';
    if (cadence === 'weekly') return 'Every week';
    return 'Per shift';
  };

  const participants = useMemo(() => {
    return eligibleEmployees.filter(e => selectedEmployees.has(e.id));
  }, [eligibleEmployees, selectedEmployees]);

  const totalTipsCents = tipAmount || 0;

  const hoursAllocations = useMemo(() => {
    return participants.map(e => ({
      id: e.id,
      name: e.name,
      hours: Number.parseFloat(hoursByEmployee[e.id] || '0') || 0,
    }));
  }, [participants, hoursByEmployee]);

  const previewShares = useMemo(() => {
    if (shareMethod === 'hours') {
      return calculateTipSplitByHours(totalTipsCents, hoursAllocations);
    }
    if (shareMethod === 'role') {
      // Map participants to include role and weight
      const participantsWithRoles = participants.map(p => ({
        id: p.id,
        name: p.name,
        role: p.position,
        weight: roleWeights[p.position] || 1,
      }));
      return calculateTipSplitByRole(totalTipsCents, participantsWithRoles);
    }
    return calculateTipSplitEven(totalTipsCents, participants);
  }, [totalTipsCents, shareMethod, hoursAllocations, participants, roleWeights]);

  const handleContinueToReview = (amountCents: number) => {
    setTipAmount(amountCents);
    setShowReview(true);
  };

  const handleResumeDraft = async (splitId: string) => {
    // First try to find in current splits
    let split = splits?.find(s => s.id === splitId);
    
    // If not found (historical split), fetch it directly
    if (!split && restaurantId) {
      const { data } = await supabase
        .from('tip_splits')
        .select(`
          *,
          items:tip_split_items(
            *,
            employee:employees(name, position)
          )
        `)
        .eq('id', splitId)
        .single();
      
      if (data) {
        split = data as TipSplitWithItems;
      }
    }
    
    if (!split) {
      toast({
        title: 'Error',
        description: 'Could not load split data',
        variant: 'destructive',
      });
      return;
    }

    // For drafts: populate form for editing
    // For approved: populate form in read-only preview (can view but not re-approve)
    setTipAmount(split.total_amount);
    // Parse date as local noon to avoid timezone shifting the day
    setSelectedDate(new Date(split.split_date + 'T12:00:00'));
    setShareMethod(split.share_method || 'hours');
    
    // Populate hours from items
    const hours: Record<string, string> = {};
    split.items?.forEach(item => {
      if (item.hours_worked) {
        hours[item.employee_id] = item.hours_worked.toString();
      }
    });
    
    // Set flag to prevent hours recalculation from overwriting saved hours
    setIsResumingDraft(true);
    setHoursByEmployee(hours);
    
    setShowReview(true);
  };

  const handleApprove = (shares: Array<{ employeeId: string; name: string; amountCents: number }>) => {
    if (!restaurantId) return;

    saveTipSplit({
      split_date: today,
      total_amount: totalTipsCents,
      share_method: shareMethod,
      tip_source: tipSource,
      shares,
      status: 'approved',
    }, {
      onSuccess: () => {
        toast({
          title: 'Tips approved',
          description: `Successfully distributed ${formatCurrencyFromCents(totalTipsCents)} to ${shares.length} employees.`,
        });
        setTipAmount(null);
        setShowReview(false);
        setIsResumingDraft(false);
      },
      onError: (error) => {
        console.error('Error approving tips:', error);
        toast({
          title: 'Error',
          description: 'Failed to save tip split. Please try again.',
          variant: 'destructive',
        });
      },
    });
  };

  const handleSaveDraft = (shares: Array<{ employeeId: string; name: string; amountCents: number }>) => {
    if (!restaurantId) return;

    saveTipSplit({
      split_date: today,
      total_amount: totalTipsCents,
      share_method: shareMethod,
      tip_source: tipSource,
      shares,
      status: 'draft',
    }, {
      onSuccess: () => {
        toast({
          title: 'Draft saved',
          description: 'You can review and approve this later.',
        });
        setShowReview(false);
        setIsResumingDraft(false);
      },
      onError: (error) => {
        console.error('Error saving draft:', error);
        toast({
          title: 'Error',
          description: 'Failed to save draft. Please try again.',
          variant: 'destructive',
        });
      },
    });
  };

  const handleSaveSettings = useCallback(() => {
    if (!restaurantId) return;

    updateSettings({
      tip_source: tipSource,
      share_method: shareMethod,
      split_cadence: splitCadence,
      role_weights: roleWeights,
      enabled_employee_ids: Array.from(selectedEmployees),
    });
  }, [restaurantId, selectedEmployees, shareMethod, splitCadence, tipSource, roleWeights, updateSettings]);

  useAutoSaveTipSettings({
    settings,
    tipSource,
    shareMethod,
    splitCadence,
    roleWeights,
    selectedEmployees,
    onSave: handleSaveSettings,
  });

  if (loading || employeesLoading || settingsLoading) {
    return null;
  }

  if (showReview && totalTipsCents > 0) {
    return (
      <div className="space-y-6">
        <header className="space-y-1">
          <Button
            variant="ghost"
            onClick={() => setShowReview(false)}
            className="mb-2 h-9 rounded-lg text-[13px] font-medium text-muted-foreground hover:text-foreground"
          >
            ← Back to entry
          </Button>
          <p className="text-[13px] text-muted-foreground">Dashboard → Tips → Review</p>
          <h1 className="text-[17px] font-semibold text-foreground">Review Tip Split</h1>
        </header>

        <Card className="max-w-md">
          <CardHeader>
            <CardTitle>Tip amount</CardTitle>
            <CardDescription>Adjust before approving.</CardDescription>
          </CardHeader>
          <CardContent>
            <Label htmlFor="tipAmount" className="sr-only">Tip amount</Label>
            <Input
              id="tipAmount"
              type="number"
              step="0.01"
              min="0"
              value={(totalTipsCents / 100).toString()}
              onChange={e => {
                const cents = Math.round(Number.parseFloat(e.target.value || '0') * 100);
                setTipAmount(cents);
              }}
            />
          </CardContent>
        </Card>

        {shareMethod === 'hours' && (
          <Card>
            <CardHeader>
              <div className="flex items-center justify-between">
                <div>
                  <CardTitle>Hours worked</CardTitle>
                  <CardDescription>
                    Hours auto-calculated from time punches. You can manually override any value.
                  </CardDescription>
                </div>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => {
                    const calculatedHours: Record<string, string> = {};
                    const autoFlags: Record<string, boolean> = {};

                    participants.forEach(emp => {
                      const employeePunches = punches?.filter(p => p.employee_id === emp.id) || [];
                      if (employeePunches.length > 0) {
                        const hours = calculateWorkedHours(employeePunches);
                        const roundedHours = Math.round(hours * 10) / 10;
                        calculatedHours[emp.id] = roundedHours.toString();
                        autoFlags[emp.id] = true;
                      } else {
                        calculatedHours[emp.id] = '0';
                        autoFlags[emp.id] = false;
                      }
                    });

                    setHoursByEmployee(calculatedHours);
                    setAutoCalculatedHours(autoFlags);
                    toast({
                      title: 'Hours recalculated',
                      description: 'All hours have been recalculated from time punches.',
                    });
                  }}
                >
                  <RefreshCw className="h-4 w-4 mr-2" />
                  Recalculate from punches
                </Button>
              </div>
            </CardHeader>
            <CardContent>
              <div className="grid md:grid-cols-2 gap-3">
                {participants.map(emp => {
                  const isAutoCalculated = autoCalculatedHours[emp.id];
                  const employeePunches = punches?.filter(p => p.employee_id === emp.id) || [];
                  const hasPunches = employeePunches.length > 0;

                  return (
                    <div key={emp.id} className="space-y-1">
                      <div className="flex items-center justify-between">
                        <Label htmlFor={`hours-${emp.id}`} className="flex items-center gap-1">
                          {emp.name}
                          {isAutoCalculated && hasPunches && (
                            <Clock className="h-3 w-3 text-muted-foreground" aria-label="Auto-calculated from time punches" />
                          )}
                        </Label>
                        {!hasPunches && (
                          <span className="text-xs text-muted-foreground">No punches</span>
                        )}
                      </div>
                      <Input
                        id={`hours-${emp.id}`}
                        type="number"
                        step="0.1"
                        min="0"
                        value={hoursByEmployee[emp.id] ?? '0'}
                        onChange={e => {
                          setHoursByEmployee(prev => ({
                            ...prev,
                            [emp.id]: e.target.value,
                          }));
                          // Mark as manually edited
                          setAutoCalculatedHours(prev => ({
                            ...prev,
                            [emp.id]: false,
                          }));
                        }}
                        className={isAutoCalculated && hasPunches ? 'border-primary/50' : ''}
                      />
                    </div>
                  );
                })}
              </div>
              {punches && punches.length > 0 && (
                <Alert className="mt-4">
                  <Info className="h-4 w-4" />
                  <AlertDescription>
                    Found {punches.length} time punch{punches.length === 1 ? '' : 'es'} for {format(selectedDate, 'MMM d, yyyy')}.
                    Hours are automatically calculated and can be manually adjusted if needed.
                  </AlertDescription>
                </Alert>
              )}
            </CardContent>
          </Card>
        )}

        <TipReviewScreen
          totalTipsCents={totalTipsCents}
          initialShares={previewShares}
          shareMethod={shareMethod}
          onApprove={handleApprove}
          onSaveDraft={handleSaveDraft}
          isLoading={isSaving}
        />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <header className="flex items-center justify-between">
        <div className="space-y-1">
          <p className="text-[13px] text-muted-foreground">Dashboard → Tips</p>
          <h1 className="text-[17px] font-semibold text-foreground">Tips</h1>
          <p className="text-[13px] text-muted-foreground max-w-2xl">
            Simple, trust-building tip splits. One choice at a time, with a live preview.
          </p>
        </div>
        <Button
          variant="ghost"
          aria-label="Setup"
          className="h-9 rounded-lg gap-2"
          onClick={() => setShowSetup(true)}
          onKeyDown={e => e.key === 'Enter' && setShowSetup(true)}
        >
          <Settings className="h-5 w-5" />
        </Button>
      </header>

      {/* Setup/Settings Dialog */}
      <TipPoolSettingsDialog
        open={showSetup}
        onClose={() => setShowSetup(false)}
        tipSource={tipSource}
        shareMethod={shareMethod}
        splitCadence={splitCadence}
        roleWeights={roleWeights}
        selectedEmployees={selectedEmployees}
        eligibleEmployees={eligibleEmployees}
        isLoading={settingsLoading}
        onTipSourceChange={setTipSource}
        onShareMethodChange={setShareMethod}
        onSplitCadenceChange={setSplitCadence}
        onRoleWeightsChange={setRoleWeights}
        onSelectedEmployeesChange={setSelectedEmployees}
      />

      {restaurantId && <DisputeManager restaurantId={restaurantId} />}

      {/* Apple-style underline tabs */}
      <div className="flex border-b border-border/40">
        {(['overview', 'daily', 'history'] as const).map((mode) => {
          const labels: Record<ViewMode, string> = { overview: 'Overview', daily: 'Daily Entry', history: 'History' };
          return (
            <button
              key={mode}
              type="button"
              onClick={() => setViewMode(mode)}
              className={`relative px-0 py-3 mr-6 text-[14px] font-medium transition-colors ${
                viewMode === mode ? 'text-foreground' : 'text-muted-foreground hover:text-foreground'
              }`}
            >
              {labels[mode]}
              {viewMode === mode && (
                <div className="absolute bottom-0 left-0 right-0 h-[2px] bg-foreground" />
              )}
            </button>
          );
        })}
      </div>

      {viewMode === 'overview' && (
        <div className="space-y-6">
          {/* Period navigation controls */}
          <div className="flex items-center justify-between pb-2">
            <Button variant="ghost" aria-label="Previous period" onClick={() => setPeriodOffset(o => o - 1)} className="h-9 rounded-lg text-[13px] font-medium">
              ← Previous
            </Button>
            <span className="text-[14px] font-semibold text-foreground">
              {`Week of ${periodStart.toLocaleDateString()} - ${periodEnd.toLocaleDateString()}`}
            </span>
            <Button variant="ghost" aria-label="Next period" onClick={() => setPeriodOffset(o => o + 1)} disabled={periodOffset >= 0} className="h-9 rounded-lg text-[13px] font-medium">
              Next →
            </Button>
          </div>

          {/* Payroll integration guidance */}
          <Alert>
            <Info className="h-4 w-4" />
            <AlertDescription>
              <strong>How tips flow to payroll:</strong> Click a day to enter tips → Review employee allocations → Approve → Lock period when ready for payroll.
              Only <strong>approved</strong> tips with employee allocations appear in payroll reports.
            </AlertDescription>
          </Alert>

          {/* Period summary card */}
          <TipPeriodSummary
            splits={periodSplits}
            startDate={periodStart}
            endDate={periodEnd}
            isLoading={periodSplitsLoading}
            shareMethod={shareMethod}
          />

          {/* Timeline visualization - clicking navigates to Daily Entry */}
          <TipPeriodTimeline
            startDate={periodStart}
            endDate={periodEnd}
            splits={periodSplits}
            onDayClick={handleDayClick}
            isLoading={periodSplitsLoading}
            payouts={payouts}
            onRecordPayout={handleRecordPayout}
          />

          {/* Lock period section with validation feedback */}
          <Card className="rounded-xl border-border/40">
            <CardContent className="pt-6">
              <div className="flex items-center justify-between">
                <div className="space-y-1">
                  <p className="text-[14px] font-medium text-foreground">Ready for payroll?</p>
                  <p className="text-[13px] text-muted-foreground">
                    {periodValidation.approved} approved, {periodValidation.drafts} drafts
                    {periodValidation.drafts > 0 && (
                      <span className="text-yellow-600"> — approve all drafts first</span>
                    )}
                    {periodValidation.approved > 0 && periodValidation.withShares < periodValidation.approved && (
                      <span className="text-destructive"> — some approved tips have no employee allocations</span>
                    )}
                  </p>
                </div>
                <Button
                  onClick={() => setLockDialogOpen(true)}
                  aria-label="Lock tips for this period"
                  disabled={!periodValidation.canLock}
                  className="h-9 px-4 rounded-lg bg-foreground text-background hover:bg-foreground/90 text-[13px] font-medium"
                >
                  Lock for payroll
                </Button>
              </div>
            </CardContent>
          </Card>

          {/* Lock period dialog */}
          <LockPeriodDialog
            open={lockDialogOpen}
            periodLabel={`Week of ${periodStart.toLocaleDateString()}`}
            onConfirm={handleLockPeriod}
            onCancel={() => setLockDialogOpen(false)}
            loading={isSaving}
          />
        </div>
      )}

      {viewMode === 'daily' && (
        <>
          <TipHistoricalEntry 
            currentDate={selectedDate} 
            onDateSelected={setSelectedDate} 
          />

          {/* Saved drafts section */}
          {restaurantId && (
            <TipDraftsList
              restaurantId={restaurantId}
              onResumeDraft={handleResumeDraft}
            />
          )}

          {/* Employee-declared tips section */}
          {restaurantId && (
            <EmployeeDeclaredTips
              restaurantId={restaurantId}
              date={today}
              onImport={(totalCents) => {
                setTipAmount(totalCents);
                handleContinueToReview(totalCents);
              }}
            />
          )}

          {tipSource === 'pos' && hasPOSTips && posTipData ? (
            <POSTipImporter
              tipData={posTipData}
              onImport={handleContinueToReview}
              onEdit={() => setTipSource('manual')}
            />
          ) : (
            <Card className="rounded-xl border-border/40">
              <CardHeader className="pb-3">
                <div className="flex items-center gap-3">
                  <div className="h-10 w-10 rounded-xl bg-muted/50 flex items-center justify-center">
                    <DollarSign className="h-5 w-5 text-foreground" />
                  </div>
                  <div>
                    <CardTitle className="text-[17px] font-semibold text-foreground">Enter tips</CardTitle>
                    <CardDescription className="text-[13px]">
                      {format(selectedDate, 'EEEE, MMMM d, yyyy')}
                    </CardDescription>
                  </div>
                </div>
              </CardHeader>
              <CardContent>
                <TipEntryDialog onContinue={handleContinueToReview} />
                {tipSource === 'pos' && !hasPOSTips && (
                  <Alert className="mt-4">
                    <Info className="h-4 w-4" />
                    <AlertDescription>
                      No POS tips found for today. You can enter them manually or wait for POS sync.
                    </AlertDescription>
                  </Alert>
                )}
              </CardContent>
            </Card>
          )}

          {restaurantId && (
            <RecentTipSplits 
              restaurantId={restaurantId} 
              onEditSplit={handleResumeDraft}
              currentDate={today}
            />
          )}

          <Card className="rounded-xl border-border/40">
            <CardContent className="pt-6">
              <div className="grid md:grid-cols-3 gap-4">
                <div>
                  <p className="text-[12px] font-medium text-muted-foreground uppercase tracking-wider">Tip source</p>
                  <p className="text-[14px] font-medium text-foreground mt-1">{tipSource === 'manual' ? 'Manual entry' : 'POS import'}</p>
                </div>
                <div>
                  <p className="text-[12px] font-medium text-muted-foreground uppercase tracking-wider">Share method</p>
                  <p className="text-[14px] font-medium text-foreground mt-1">
                    {getShareMethodLabel(shareMethod)}
                  </p>
                </div>
                <div>
                  <p className="text-[12px] font-medium text-muted-foreground uppercase tracking-wider">Split cadence</p>
                  <p className="text-[14px] font-medium text-foreground mt-1">
                    {getSplitCadenceLabel(splitCadence)}
                  </p>
                </div>
              </div>
            </CardContent>
          </Card>
        </>
      )}

      {viewMode === 'history' && (
        <div className="space-y-6">
          <Card className="rounded-xl border-border/40">
            <CardHeader className="pb-3">
              <div className="flex items-center gap-3">
                <div className="h-10 w-10 rounded-xl bg-muted/50 flex items-center justify-center">
                  <Lock className="h-5 w-5 text-foreground" />
                </div>
                <div>
                  <CardTitle className="text-[17px] font-semibold text-foreground">Tip History</CardTitle>
                  <CardDescription className="text-[13px]">Locked periods and payroll reference</CardDescription>
                </div>
              </div>
            </CardHeader>
            <CardContent>
              {splits?.filter(s => s.status === 'archived').length ? (
                <div className="space-y-2">
                  {splits.filter(s => s.status === 'archived').map(s => (
                    <div key={s.id} className="flex items-center justify-between p-4 rounded-xl border border-border/40 bg-background hover:border-border transition-colors">
                      <div className="space-y-0.5">
                        <span className="text-[14px] font-medium text-foreground">{format(new Date(s.split_date + 'T00:00:00'), 'MMM d, yyyy')}</span>
                        <p className="text-[13px] text-muted-foreground">
                          Payroll snapshot: {s.approved_at ? format(new Date(s.approved_at), 'MMM d, yyyy, h:mm a') : 'N/A'}
                        </p>
                      </div>
                      <span className="text-[14px] font-semibold text-foreground">${(s.total_amount / 100).toFixed(2)}</span>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="py-12 text-center">
                  <div className="h-10 w-10 rounded-xl bg-muted/50 flex items-center justify-center mx-auto">
                    <Lock className="h-5 w-5 text-muted-foreground/50" />
                  </div>
                  <p className="text-[14px] font-medium text-foreground mt-4">No locked periods yet</p>
                  <p className="text-[13px] text-muted-foreground mt-1">Locked periods will appear here after you lock tips for payroll.</p>
                </div>
              )}
            </CardContent>
          </Card>
        </div>
      )}

      {/* Tip Payout Sheet */}
      {payoutSheetSplit && (
        <TipPayoutSheet
          key={payoutSheetSplit.id}
          open
          onClose={() => setPayoutSheetSplit(null)}
          split={payoutSheetSplit}
          existingPayouts={payouts.filter(p => p.tip_split_id === payoutSheetSplit.id)}
          onConfirm={handleConfirmPayout}
          onDeletePayout={deletePayout}
          isSubmitting={isCreatingPayouts}
        />
      )}
    </div>
  );
};

export default Tips;
