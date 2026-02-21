import { useState, useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { useRestaurantContext } from '@/contexts/RestaurantContext';
import { useCurrentEmployee } from '@/hooks/useCurrentEmployee';
import { useTipSplits } from '@/hooks/useTipSplits';
import { useTipPayouts } from '@/hooks/useTipPayouts';
import { usePeriodNavigation } from '@/hooks/usePeriodNavigation';
import { formatCurrencyFromCents } from '@/utils/tipPooling';
import { format } from 'date-fns';
import {
  EmployeePageHeader,
  NoRestaurantState,
  EmployeePageSkeleton,
  EmployeeNotLinkedState,
  PeriodSelector,
} from '@/components/employee';
import { TipTransparency } from '@/components/tips/TipTransparency';
import { TipDispute } from '@/components/tips/TipDispute';
import { supabase } from '@/integrations/supabase/client';
import { Banknote, Clock } from 'lucide-react';

interface ServerEarningRow {
  tip_split_id: string;
  employee_id: string;
  earned_amount: number;
  retained_amount: number;
  refunded_amount: number;
}

/**
 * EmployeeTips - Part 3 of Apple-style UX
 * Employee-facing tip breakdown and transparency view
 */
function EmployeeTips() {
  const { selectedRestaurant } = useRestaurantContext();
  const restaurantId = selectedRestaurant?.restaurant_id || null;
  const { currentEmployee, loading: employeeLoading } = useCurrentEmployee(restaurantId);

  const {
    periodType,
    setPeriodType,
    startDate,
    endDate,
    handlePreviousWeek,
    handleNextWeek,
    handleToday,
  } = usePeriodNavigation({ includeLast2Weeks: false });

  const [activeTab, setActiveTab] = useState<'breakdown' | 'history'>('breakdown');

  const formattedStart = format(startDate, 'yyyy-MM-dd');
  const formattedEnd = format(endDate, 'yyyy-MM-dd');

  const { splits, isLoading } = useTipSplits(
    restaurantId,
    formattedStart,
    formattedEnd
  );

  const { payouts } = useTipPayouts(restaurantId, formattedStart, formattedEnd);

  // Build a lookup map: "payoutDate" -> amount in cents
  const payoutLookup = useMemo(() => {
    if (!payouts || !currentEmployee) return new Map<string, number>();
    const map = new Map<string, number>();
    for (const p of payouts) {
      if (p.employee_id === currentEmployee.id) {
        const key = p.payout_date;
        map.set(key, (map.get(key) || 0) + p.amount);
      }
    }
    return map;
  }, [payouts, currentEmployee]);

  // Batch fetch server earnings for all approved splits in the period
  // This detects which splits used the percentage_contribution model
  const approvedSplitIds = useMemo(() => {
    if (!splits || !currentEmployee) return [];
    return splits
      .filter(s => s.status === 'approved')
      .map(s => s.id);
  }, [splits, currentEmployee]);

  const { data: serverEarningsData } = useQuery({
    queryKey: ['tip-server-earnings-batch', approvedSplitIds],
    queryFn: async () => {
      if (approvedSplitIds.length === 0) return [];
      const { data, error } = await supabase
        .from('tip_server_earnings')
        .select('tip_split_id, employee_id, earned_amount, retained_amount, refunded_amount')
        .in('tip_split_id', approvedSplitIds);
      if (error) throw error;
      return (data ?? []) as ServerEarningRow[];
    },
    enabled: approvedSplitIds.length > 0,
    staleTime: 30000,
  });

  // Build lookup: splitId -> ServerEarningRow (for the current employee only)
  const myServerEarningsLookup = useMemo(() => {
    const map = new Map<string, ServerEarningRow>();
    if (!serverEarningsData || !currentEmployee) return map;
    for (const row of serverEarningsData) {
      if (row.employee_id === currentEmployee.id) {
        map.set(row.tip_split_id, row);
      }
    }
    return map;
  }, [serverEarningsData, currentEmployee]);

  // Filter splits to only show approved ones with current employee
  const myTips = useMemo(() => {
    if (!splits || !currentEmployee) return [];

    const tips: Array<{
      id: string;
      date: string;
      amount: number;
      hours: number;
      role: string;
      shareMethod: string;
      totalSplit: number;
      totalTeamHours: number;
    }> = [];

    for (const split of splits) {
      if (split.status !== 'approved') continue;
      const myItem = split.items.find(item => item.employee_id === currentEmployee.id);
      if (!myItem) continue;

      tips.push({
        id: split.id,
        date: split.split_date,
        amount: myItem.amount,
        hours: myItem.hours_worked,
        role: myItem.role,
        shareMethod: split.share_method,
        totalSplit: split.total_amount,
        totalTeamHours: split.items.reduce((sum, item) => sum + (item.hours_worked || 0), 0),
      });
    }

    return tips;
  }, [splits, currentEmployee]);

  // Calculate period totals
  const periodTotal = myTips.reduce((sum, tip) => sum + tip.amount, 0);
  const periodHours = myTips.reduce((sum, tip) => sum + tip.hours, 0);

  if (!restaurantId) {
    return <NoRestaurantState />;
  }

  if (employeeLoading) {
    return <EmployeePageSkeleton />;
  }

  if (!currentEmployee) {
    return <EmployeeNotLinkedState />;
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <EmployeePageHeader
        icon={Banknote}
        title="My Tips"
        subtitle={currentEmployee.name}
      />

      {/* Period Summary */}
      <Card className="rounded-xl border-border/40">
        <CardContent className="pt-6">
          <div className="grid md:grid-cols-2 gap-6">
            <div>
              <p className="text-[12px] font-medium text-muted-foreground uppercase tracking-wider mb-1">This period</p>
              <p className="text-[22px] font-semibold text-foreground">
                {formatCurrencyFromCents(periodTotal)}
              </p>
            </div>
            <div>
              <p className="text-[12px] font-medium text-muted-foreground uppercase tracking-wider mb-1">Hours worked</p>
              <div className="flex items-baseline gap-2">
                <p className="text-[22px] font-semibold text-foreground">{periodHours.toFixed(1)}</p>
                <Clock className="h-4 w-4 text-muted-foreground" />
              </div>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Period Selector */}
      <PeriodSelector
        periodType={periodType}
        onPeriodTypeChange={setPeriodType}
        startDate={startDate}
        endDate={endDate}
        onPrevious={handlePreviousWeek}
        onNext={handleNextWeek}
        onToday={handleToday}
        label="View period:"
      />

      {/* Apple Underline Tabs */}
      <div className="flex border-b border-border/40">
        {(['breakdown', 'history'] as const).map((tab) => {
          const labels = { breakdown: 'Breakdown', history: 'History' };
          return (
            <button
              key={tab}
              type="button"
              onClick={() => setActiveTab(tab)}
              className={`relative px-0 py-3 mr-6 text-[14px] font-medium transition-colors ${
                activeTab === tab ? 'text-foreground' : 'text-muted-foreground hover:text-foreground'
              }`}
            >
              {labels[tab]}
              {activeTab === tab && (
                <div className="absolute bottom-0 left-0 right-0 h-[2px] bg-foreground" />
              )}
            </button>
          );
        })}
      </div>

      {/* Breakdown Tab */}
      {activeTab === 'breakdown' && (
        <div className="space-y-3">
          {isLoading && (
            <div className="space-y-3">
              {[1, 2, 3].map(i => (
                <Skeleton key={i} className="h-24" />
              ))}
            </div>
          )}
          {!isLoading && myTips.length === 0 && (
            <Card className="rounded-xl border-border/40">
              <CardContent className="py-12 text-center">
                <div className="h-10 w-10 rounded-xl bg-muted/50 flex items-center justify-center mx-auto">
                  <Banknote className="h-5 w-5 text-foreground" />
                </div>
                <h3 className="text-[14px] font-medium text-foreground mt-4">No tips yet</h3>
                <p className="text-[13px] text-muted-foreground mt-1">
                  Your tips will appear here once they are approved by management.
                </p>
              </CardContent>
            </Card>
          )}
          {!isLoading && myTips.map((tip) => {
            const serverEarning = myServerEarningsLookup.get(tip.id);
            const deductionsCents = serverEarning
              ? serverEarning.earned_amount - serverEarning.retained_amount - serverEarning.refunded_amount
              : 0;

            return (
              <Card key={tip.id} className="rounded-xl border-border/40 hover:border-border transition-colors">
                <div className="p-4">
                  <div className="flex items-center justify-between">
                    <div>
                      <p className="text-[14px] font-medium text-foreground">
                        {format(new Date(tip.date), 'EEEE, MMM d')}
                      </p>
                      <div className="flex items-center gap-3 mt-0.5">
                        {Boolean(tip.hours) && (
                          <span className="flex items-center gap-1 text-[13px] text-muted-foreground">
                            <Clock className="h-3 w-3" />
                            {tip.hours.toFixed(1)} hours
                          </span>
                        )}
                        {tip.role && <span className="text-[13px] text-muted-foreground">{tip.role}</span>}
                      </div>
                    </div>
                    <div className="flex items-center gap-2">
                      {payoutLookup.has(tip.date) && (
                        <Badge
                          variant="outline"
                          className="border-emerald-500/50 text-emerald-700 bg-emerald-500/10 text-[11px]"
                        >
                          Paid {formatCurrencyFromCents(payoutLookup.get(tip.date) ?? 0)} cash
                        </Badge>
                      )}
                      <span className="text-[14px] font-semibold text-foreground">
                        {formatCurrencyFromCents(tip.amount)}
                      </span>
                    </div>
                  </div>

                  {/* Server earnings breakdown for percentage contribution model */}
                  {serverEarning && (
                    <div className="mt-3 pt-3 border-t border-border/40">
                      <div className="grid grid-cols-4 gap-2">
                        <div>
                          <p className="text-[11px] font-medium text-muted-foreground uppercase tracking-wider">Earned</p>
                          <p className="text-[13px] font-medium text-foreground mt-0.5">
                            {formatCurrencyFromCents(serverEarning.earned_amount)}
                          </p>
                        </div>
                        <div>
                          <p className="text-[11px] font-medium text-muted-foreground uppercase tracking-wider">Deductions</p>
                          <p className="text-[13px] font-medium text-destructive mt-0.5">
                            {deductionsCents > 0 ? `-${formatCurrencyFromCents(deductionsCents)}` : '\u2014'}
                          </p>
                        </div>
                        <div>
                          <p className="text-[11px] font-medium text-muted-foreground uppercase tracking-wider">Refunds</p>
                          <p className="text-[13px] font-medium text-green-600 mt-0.5">
                            {serverEarning.refunded_amount > 0 ? `+${formatCurrencyFromCents(serverEarning.refunded_amount)}` : '\u2014'}
                          </p>
                        </div>
                        <div>
                          <p className="text-[11px] font-medium text-muted-foreground uppercase tracking-wider">Final</p>
                          <p className="text-[13px] font-semibold text-foreground mt-0.5">
                            {formatCurrencyFromCents(serverEarning.retained_amount)}
                          </p>
                        </div>
                      </div>
                    </div>
                  )}

                  <div className="flex items-center gap-2 mt-3 pt-3 border-t border-border/40">
                    <TipTransparency
                      employeeTip={tip}
                      totalTeamHours={tip.totalTeamHours}
                      shareMethod={tip.shareMethod || 'manual'}
                    />
                    <TipDispute
                      restaurantId={restaurantId}
                      employeeId={currentEmployee.id}
                      tipSplitId={tip.id}
                      tipDate={tip.date}
                    />
                  </div>
                </div>
              </Card>
            );
          })}
        </div>
      )}

      {/* History Tab */}
      {activeTab === 'history' && (
        <div className="space-y-3">
          {isLoading && <Skeleton className="h-64" />}
          {!isLoading && myTips.length === 0 && (
            <Card className="rounded-xl border-border/40">
              <CardContent className="py-12 text-center">
                <div className="h-10 w-10 rounded-xl bg-muted/50 flex items-center justify-center mx-auto">
                  <Clock className="h-5 w-5 text-foreground" />
                </div>
                <h3 className="text-[14px] font-medium text-foreground mt-4">No tip history</h3>
                <p className="text-[13px] text-muted-foreground mt-1">No tip history available for this period.</p>
              </CardContent>
            </Card>
          )}
          {!isLoading && myTips.length > 0 && (
            <Card className="rounded-xl border-border/40 overflow-hidden">
              <div className="px-4 py-3 border-b border-border/40 bg-muted/50">
                <h3 className="text-[13px] font-semibold text-foreground">Tip History</h3>
                <p className="text-[12px] text-muted-foreground mt-0.5">
                  All approved tips for the selected period
                </p>
              </div>
              <div className="p-3 space-y-1.5">
                {myTips.map((tip) => (
                  <div
                    key={tip.id}
                    className="flex items-center justify-between p-3 rounded-xl border border-border/40 bg-background hover:border-border transition-colors"
                  >
                    <div>
                      <p className="text-[14px] font-medium text-foreground">
                        {format(new Date(tip.date), 'EEE, MMM d, yyyy')}
                      </p>
                      <p className="text-[13px] text-muted-foreground">
                        {tip.hours.toFixed(1)} hours
                      </p>
                    </div>
                    <div className="flex items-center gap-2">
                      {payoutLookup.has(tip.date) && (
                        <Badge
                          variant="outline"
                          className="border-emerald-500/50 text-emerald-700 bg-emerald-500/10 text-[11px]"
                        >
                          Paid
                        </Badge>
                      )}
                      <span className="text-[14px] font-semibold text-foreground">
                        {formatCurrencyFromCents(tip.amount)}
                      </span>
                    </div>
                  </div>
                ))}
              </div>
            </Card>
          )}
        </div>
      )}
    </div>
  );
};

export default EmployeeTips;
