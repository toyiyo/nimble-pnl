import { useCallback, useEffect, useMemo, useState } from 'react';
import { useAuth } from '@/hooks/useAuth';
import { useRestaurantContext } from '@/contexts/RestaurantContext';
import { useEmployees } from '@/hooks/useEmployees';
import { useTimePunches } from '@/hooks/useTimePunches';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import { Label } from '@/components/ui/label';
import { Input } from '@/components/ui/input';
import { Checkbox } from '@/components/ui/checkbox';
import { Button } from '@/components/ui/button';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { format } from 'date-fns';
import { formatCurrencyFromCents, calculateTipSplitByHours, calculateTipSplitByRole, filterTipEligible, calculateTipSplitEven } from '@/utils/tipPooling';
import { useToast } from '@/hooks/use-toast';
import { useTipPoolSettings, type TipSource, type ShareMethod, type SplitCadence } from '@/hooks/useTipPoolSettings';
import { useTipSplits, type TipSplitWithItems } from '@/hooks/useTipSplits';
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
import { calculateWorkedHours } from '@/utils/payrollCalculations';
import { Info, Settings, RefreshCw, Clock } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';

const defaultWeights: Record<string, number> = {
  'Server': 1,
  'Bartender': 1,
  'Runner': 1,
  'Host': 1,
};

type ViewMode = 'setup' | 'daily';

export const Tips = () => {
  const { loading } = useAuth();
  const { selectedRestaurant } = useRestaurantContext();
  const restaurantId = selectedRestaurant?.restaurant_id || null;
  const { employees, loading: employeesLoading } = useEmployees(restaurantId, { status: 'active' });
  const { toast } = useToast();

  const { settings, updateSettings, isLoading: settingsLoading } = useTipPoolSettings(restaurantId);

  const [viewMode, setViewMode] = useState<ViewMode>('daily');
  const [selectedDate, setSelectedDate] = useState(new Date());

  const today = format(selectedDate, 'yyyy-MM-dd');
  // Force UTC interpretation to avoid timezone confusion
  // Without 'Z', new Date('2026-01-03T00:00:00') is treated as local time
  const todayStart = new Date(today + 'T00:00:00Z');
  const todayEnd = new Date(today + 'T23:59:59.999Z');
  
  const { punches } = useTimePunches(restaurantId, undefined, todayStart, todayEnd);
  const { saveTipSplit, isSaving, splits } = useTipSplits(restaurantId, today, today);

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
        <header className="space-y-2">
          <Button
            variant="ghost"
            onClick={() => setShowReview(false)}
            className="mb-2"
          >
            ← Back to entry
          </Button>
          <p className="text-sm text-muted-foreground">Dashboard → Tips → Review</p>
          <h1 className="text-2xl font-bold">Review Tip Split</h1>
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
      <header className="space-y-2">
        <p className="text-sm text-muted-foreground">Dashboard → Tips</p>
        <h1 className="text-2xl font-bold">Tips</h1>
        <p className="text-muted-foreground max-w-2xl">
          Simple, trust-building tip splits. One choice at a time, with a live preview.
        </p>
      </header>

      {restaurantId && <DisputeManager restaurantId={restaurantId} />}

      <div className="flex gap-2">
        <Button
          variant={viewMode === 'daily' ? 'default' : 'outline'}
          onClick={() => setViewMode('daily')}
        >
          Daily Entry
        </Button>
        <Button
          variant={viewMode === 'setup' ? 'default' : 'outline'}
          onClick={() => setViewMode('setup')}
          className="gap-2"
        >
          <Settings className="h-4 w-4" />
          Setup
        </Button>
      </div>

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
            <Card>
              <CardHeader>
                <CardTitle>Enter tips</CardTitle>
                <CardDescription>
                  {format(selectedDate, 'EEEE, MMMM d, yyyy')}
                </CardDescription>
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

          <Card>
            <CardContent className="pt-6">
              <div className="grid md:grid-cols-3 gap-4 text-sm">
                <div>
                  <p className="text-muted-foreground">Tip source</p>
                  <p className="font-medium">{tipSource === 'manual' ? 'Manual entry' : 'POS import'}</p>
                </div>
                <div>
                  <p className="text-muted-foreground">Share method</p>
                  <p className="font-medium">
                    {getShareMethodLabel(shareMethod)}
                  </p>
                </div>
                <div>
                  <p className="text-muted-foreground">Split cadence</p>
                  <p className="font-medium">
                    {getSplitCadenceLabel(splitCadence)}
                  </p>
                </div>
              </div>
            </CardContent>
          </Card>
        </>
      )}

      {viewMode === 'setup' && (
        <>
          <Card>
            <CardHeader>
              <CardTitle>1. How were tips collected?</CardTitle>
            </CardHeader>
            <CardContent>
              <RadioGroup value={tipSource} onValueChange={val => setTipSource(val as TipSource)} className="space-y-3">
                <div className="flex items-center space-x-2">
                  <RadioGroupItem value="manual" id="source-manual" />
                  <Label htmlFor="source-manual" className="cursor-pointer">We enter tips ourselves</Label>
                </div>
                <div className="flex items-center space-x-2">
                  <RadioGroupItem value="pos" id="source-pos" />
                  <Label htmlFor="source-pos" className="cursor-pointer">Tips come from the POS</Label>
                </div>
                <p className="text-sm text-muted-foreground">You can change this later.</p>
              </RadioGroup>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>2. Who shares tips?</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              <p className="text-muted-foreground">Active, tip-eligible employees only.</p>
              <div className="grid md:grid-cols-2 gap-3">
                {eligibleEmployees.map(emp => (
                  <label key={emp.id} className="flex items-center space-x-3 rounded-md border p-3 cursor-pointer hover:bg-muted/50">
                    <Checkbox
                      checked={selectedEmployees.has(emp.id)}
                      onCheckedChange={checked => {
                        setSelectedEmployees(prev => {
                          const next = new Set(prev);
                          if (checked) next.add(emp.id);
                          else next.delete(emp.id);
                          return next;
                        });
                      }}
                    />
                    <div>
                      <div className="font-medium">{emp.name}</div>
                      <div className="text-sm text-muted-foreground">{emp.position}</div>
                    </div>
                  </label>
                ))}
              </div>
              <Button onClick={handleSaveSettings} variant="outline" className="w-full">
                Save employee selection
              </Button>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>3. How should tips be shared?</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <RadioGroup value={shareMethod} onValueChange={val => setShareMethod(val as ShareMethod)} className="space-y-3">
                <div className="flex items-center space-x-2">
                  <RadioGroupItem value="hours" id="share-hours" />
                  <Label htmlFor="share-hours" className="cursor-pointer">By hours worked</Label>
                </div>
                <div className="flex items-center space-x-2">
                  <RadioGroupItem value="role" id="share-role" />
                  <Label htmlFor="share-role" className="cursor-pointer">By role</Label>
                </div>
                <div className="flex items-center space-x-2">
                  <RadioGroupItem value="manual" id="share-manual" />
                  <Label htmlFor="share-manual" className="cursor-pointer">I'll decide manually</Label>
                </div>
              </RadioGroup>

              {shareMethod === 'role' && (
                <div className="space-y-3 pt-3 border-t">
                  <p className="text-sm text-muted-foreground">Adjust weights by role.</p>
                  {Array.from(new Set(participants.map(p => p.position))).map(role => (
                    <div key={role} className="flex items-center space-x-3">
                      <Label className="w-32">{role}</Label>
                      <Input
                        type="number"
                        step="0.1"
                        min="0"
                        value={roleWeights[role] ?? 1}
                        onChange={e => {
                          const val = Number.parseFloat(e.target.value || '1');
                          setRoleWeights(prev => ({ ...prev, [role]: Math.max(0, val) }));
                        }}
                        onBlur={handleSaveSettings}
                      />
                      <span className="text-sm text-muted-foreground">×</span>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>4. When should tips be split?</CardTitle>
            </CardHeader>
            <CardContent>
              <RadioGroup value={splitCadence} onValueChange={val => setSplitCadence(val as SplitCadence)} className="space-y-3">
                <div className="flex items-center space-x-2">
                  <RadioGroupItem value="daily" id="cadence-daily" />
                  <Label htmlFor="cadence-daily" className="cursor-pointer">Every day</Label>
                </div>
                <div className="flex items-center space-x-2">
                  <RadioGroupItem value="weekly" id="cadence-weekly" />
                  <Label htmlFor="cadence-weekly" className="cursor-pointer">Every week</Label>
                </div>
                <div className="flex items-center space-x-2">
                  <RadioGroupItem value="shift" id="cadence-shift" />
                  <Label htmlFor="cadence-shift" className="cursor-pointer">Per shift</Label>
                </div>
                <p className="text-sm text-muted-foreground">Daily keeps things simplest.</p>
              </RadioGroup>
            </CardContent>
          </Card>

          <Alert>
            <Info className="h-4 w-4" />
            <AlertDescription>
              Your settings are saved automatically. Switch to "Daily Entry" to start entering tips.
            </AlertDescription>
          </Alert>
        </>
      )}
    </div>
  );
};

export default Tips;
