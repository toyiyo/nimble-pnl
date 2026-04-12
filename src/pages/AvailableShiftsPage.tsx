import { useState, useMemo, useCallback, useRef } from 'react';
import { Link } from 'react-router-dom';
import { useVirtualizer } from '@tanstack/react-virtual';

import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { Badge } from '@/components/ui/badge';
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from '@/components/ui/collapsible';

import {
  Briefcase,
  Calendar,
  Clock,
  MapPin,
  User,
  ChevronDown,
  ChevronUp,
  CheckCircle,
  XCircle,
  ArrowRightLeft,
} from 'lucide-react';

import { useRestaurantContext } from '@/contexts/RestaurantContext';
import { useCurrentEmployee } from '@/hooks/useCurrentEmployee';
import { useAvailableShifts, AvailableShiftItem } from '@/hooks/useAvailableShifts';
import { useOpenShiftClaims, useClaimOpenShift } from '@/hooks/useOpenShiftClaims';
import { useShifts } from '@/hooks/useShifts';
import { useAcceptShiftTrade } from '@/hooks/useShiftTrades';
import { useToast } from '@/hooks/use-toast';
import {
  EmployeePageHeader,
  NoRestaurantState,
  EmployeePageSkeleton,
  EmployeeNotLinkedState,
} from '@/components/employee';
import { OpenShiftCard } from '@/components/scheduling/OpenShiftCard';
import { ClaimConfirmDialog } from '@/components/scheduling/ClaimConfirmDialog';

import type { OpenShift, OpenShiftClaim } from '@/types/scheduling';

import { format, parseISO, startOfWeek, addDays } from 'date-fns';
import { WEEK_STARTS_ON } from '@/lib/dateConfig';
import { cn } from '@/lib/utils';

// ---- Memoized trade card (no hooks) ----

interface TradeCardProps {
  trade: AvailableShiftItem['trade'] & Record<string, unknown>;
  onAccept: (tradeId: string) => void;
  isAccepting: boolean;
  currentEmployeeId: string;
}

function formatTradeTime(startTime: string, endTime: string): string {
  const start = parseISO(startTime);
  const end = parseISO(endTime);
  return `${format(start, 'h:mm a')} - ${format(end, 'h:mm a')}`;
}

import { memo } from 'react';

const TradeCard = memo(function TradeCard({
  trade,
  onAccept,
  isAccepting,
  currentEmployeeId,
}: TradeCardProps) {
  if (!trade?.offered_shift) return null;

  const shiftStart = parseISO(trade.offered_shift.start_time);
  const isPast = shiftStart < new Date();
  const dateLabel = format(shiftStart, 'EEE, MMM d');
  const timeLabel = formatTradeTime(trade.offered_shift.start_time, trade.offered_shift.end_time);

  return (
    <div
      className={cn(
        'group flex items-center justify-between p-4 rounded-xl border border-border/40 bg-background hover:border-border transition-colors',
        isPast && 'opacity-60',
      )}
    >
      <div className="min-w-0 space-y-1.5">
        <span className="text-[11px] px-1.5 py-0.5 rounded-md bg-amber-500/10 text-amber-600 font-medium">
          SHIFT TRADE
        </span>
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[13px] text-muted-foreground">
          <span className="flex items-center gap-1">
            <Calendar className="h-3.5 w-3.5" aria-hidden="true" />
            {dateLabel}
          </span>
          <span className="flex items-center gap-1">
            <Clock className="h-3.5 w-3.5" aria-hidden="true" />
            {timeLabel}
          </span>
          <span className="flex items-center gap-1">
            <MapPin className="h-3.5 w-3.5" aria-hidden="true" />
            {trade.offered_shift.position}
          </span>
        </div>
        <div className="flex items-center gap-1.5 text-[13px] text-muted-foreground">
          <User className="h-3.5 w-3.5" aria-hidden="true" />
          <span>From: {trade.offered_by?.name ?? 'Unknown'}</span>
        </div>
        {trade.reason && (
          <div className="text-[12px] text-muted-foreground italic">{trade.reason}</div>
        )}
      </div>

      <div className="ml-4 flex-shrink-0">
        {trade.status === 'pending_approval' ? (
          <span className="text-[11px] px-1.5 py-0.5 rounded-md bg-amber-500/10 text-amber-600 font-medium">
            Pending Approval
          </span>
        ) : (
          <Button
            onClick={() => onAccept(trade.id)}
            disabled={isPast || isAccepting}
            className="h-9 px-4 rounded-lg bg-foreground text-background hover:bg-foreground/90 text-[13px] font-medium"
            aria-label={`Accept trade from ${trade.offered_by?.name ?? 'teammate'} on ${dateLabel}`}
          >
            {isAccepting ? 'Accepting...' : 'Accept'}
          </Button>
        )}
        {trade.target_employee_id === currentEmployeeId && (
          <div className="text-[11px] text-muted-foreground mt-1">Offered to you</div>
        )}
      </div>
    </div>
  );
}, (prev, next) => {
  return (
    prev.trade?.id === next.trade?.id &&
    prev.trade?.status === next.trade?.status &&
    prev.isAccepting === next.isAccepting &&
    prev.currentEmployeeId === next.currentEmployeeId
  );
});

// ---- Claim status badge ----

function claimStatusBadge(status: OpenShiftClaim['status']) {
  switch (status) {
    case 'approved':
      return (
        <span className="flex items-center gap-1 text-[11px] px-1.5 py-0.5 rounded-md bg-emerald-500/10 text-emerald-600 font-medium">
          <CheckCircle className="h-3 w-3" aria-hidden="true" />
          Approved
        </span>
      );
    case 'rejected':
      return (
        <span className="flex items-center gap-1 text-[11px] px-1.5 py-0.5 rounded-md bg-destructive/10 text-destructive font-medium">
          <XCircle className="h-3 w-3" aria-hidden="true" />
          Rejected
        </span>
      );
    case 'cancelled':
      return (
        <span className="text-[11px] px-1.5 py-0.5 rounded-md bg-muted text-muted-foreground font-medium">
          Cancelled
        </span>
      );
    default:
      return (
        <span className="flex items-center gap-1 text-[11px] px-1.5 py-0.5 rounded-md bg-amber-500/10 text-amber-600 font-medium">
          <Clock className="h-3 w-3" aria-hidden="true" />
          Pending
        </span>
      );
  }
}

// ---- Main page ----

export default function AvailableShiftsPage() {
  const { selectedRestaurant } = useRestaurantContext();
  const restaurantId = selectedRestaurant?.restaurant_id ?? null;
  const { currentEmployee, loading: empLoading } = useCurrentEmployee(restaurantId);
  const { toast } = useToast();

  // Compute 2-week range (current + next)
  const { weekStart, weekEnd } = useMemo(() => {
    const now = new Date();
    const start = startOfWeek(now, { weekStartsOn: WEEK_STARTS_ON as 0 | 1 | 2 | 3 | 4 | 5 | 6 });
    const end = addDays(start, 13); // 2 weeks
    return { weekStart: start, weekEnd: end };
  }, []);

  const { items, loading: feedLoading } = useAvailableShifts(
    restaurantId,
    currentEmployee?.id ?? null,
    weekStart,
    weekEnd,
  );
  const { claims, loading: claimsLoading } = useOpenShiftClaims(restaurantId, currentEmployee?.id);
  const claimMutation = useClaimOpenShift();
  const { mutate: acceptTrade, isPending: isAcceptingTrade } = useAcceptShiftTrade();

  // Employee's existing shifts for conflict detection
  const { shifts: myShifts } = useShifts(restaurantId, weekStart, weekEnd);
  const employeeShifts = useMemo(() => {
    if (!currentEmployee) return [];
    return myShifts.filter((s) => s.employee_id === currentEmployee.id && s.status !== 'cancelled');
  }, [myShifts, currentEmployee]);

  // Conflict map: template_id-date -> boolean
  const conflictMap = useMemo(() => {
    const map = new Map<string, boolean>();
    for (const item of items) {
      if (item.type !== 'open_shift' || !item.openShift) continue;
      const os = item.openShift;
      const shiftDate = os.shift_date; // YYYY-MM-DD
      const [startH, startM] = os.start_time.split(':').map(Number);
      const [endH, endM] = os.end_time.split(':').map(Number);

      const osStart = startH * 60 + startM;
      const osEnd = endH * 60 + endM;

      const hasConflict = employeeShifts.some((s) => {
        const sDate = s.start_time.split('T')[0];
        if (sDate !== shiftDate) return false;
        const sStart = new Date(s.start_time);
        const sEnd = new Date(s.end_time);
        const sStartMin = sStart.getHours() * 60 + sStart.getMinutes();
        const sEndMin = sEnd.getHours() * 60 + sEnd.getMinutes();
        return sStartMin < osEnd && sEndMin > osStart;
      });

      map.set(item.key, hasConflict);
    }
    return map;
  }, [items, employeeShifts]);

  // Claim dialog state (single dialog pattern)
  const [claimTarget, setClaimTarget] = useState<OpenShift | null>(null);

  const handleClaim = useCallback((openShift: OpenShift) => {
    setClaimTarget(openShift);
  }, []);

  const handleConfirmClaim = useCallback(async () => {
    if (!claimTarget || !restaurantId || !currentEmployee) return;
    await claimMutation.mutateAsync({
      restaurantId,
      templateId: claimTarget.template_id,
      shiftDate: claimTarget.shift_date,
      employeeId: currentEmployee.id,
    });
    setClaimTarget(null);
  }, [claimTarget, restaurantId, currentEmployee, claimMutation]);

  const [acceptingTradeId, setAcceptingTradeId] = useState<string | null>(null);

  const handleAcceptTrade = useCallback((tradeId: string) => {
    if (!currentEmployee?.id) return;
    setAcceptingTradeId(tradeId);
    acceptTrade(
      { tradeId, acceptingEmployeeId: currentEmployee.id },
      {
        onSuccess: () => {
          toast({ title: 'Trade accepted', description: 'Your manager will review the trade.' });
          setAcceptingTradeId(null);
        },
        onError: (error) => {
          toast({ title: 'Failed to accept trade', description: error.message, variant: 'destructive' });
          setAcceptingTradeId(null);
        },
      },
    );
  }, [currentEmployee, acceptTrade, toast]);

  // Claims collapsible
  const [claimsOpen, setClaimsOpen] = useState(false);

  // Virtualized list
  const parentRef = useRef<HTMLDivElement>(null);
  const virtualizer = useVirtualizer({
    count: items.length,
    getScrollElement: () => parentRef.current,
    estimateSize: () => 100,
    overscan: 5,
  });

  // Early returns
  if (!selectedRestaurant) return <NoRestaurantState />;
  if (empLoading) return <EmployeePageSkeleton />;
  if (!currentEmployee) return <EmployeeNotLinkedState />;

  const loading = feedLoading;

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row gap-4 justify-between items-start sm:items-center">
        <EmployeePageHeader
          icon={Briefcase}
          title="Available Shifts"
          subtitle="Open shifts and trades you can pick up"
        />
        <Link to="/employee/schedule" className="w-full sm:w-auto">
          <Button variant="outline" className="w-full sm:w-auto border-primary/20 hover:bg-primary/5">
            <Calendar className="h-4 w-4 mr-2" aria-hidden="true" />
            My Schedule
          </Button>
        </Link>
      </div>

      {/* Feed */}
      <div className="space-y-3">
        <div className="flex items-center gap-2">
          <h2 className="text-[17px] font-semibold text-foreground">Shifts Available</h2>
          {!loading && (
            <span className="text-[11px] px-1.5 py-0.5 rounded-md bg-muted font-medium">
              {items.length}
            </span>
          )}
        </div>

        {loading ? (
          <div className="space-y-3">
            <Skeleton className="h-[100px] w-full rounded-xl" />
            <Skeleton className="h-[100px] w-full rounded-xl" />
            <Skeleton className="h-[100px] w-full rounded-xl" />
          </div>
        ) : items.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-16 text-center">
            <Briefcase className="h-12 w-12 text-muted-foreground mb-4" aria-hidden="true" />
            <h3 className="text-[14px] font-medium text-foreground mb-1">No shifts available</h3>
            <p className="text-[13px] text-muted-foreground max-w-sm">
              There are currently no open shifts or trades. Check back later.
            </p>
          </div>
        ) : (
          <div
            ref={parentRef}
            className="max-h-[60vh] overflow-y-auto"
          >
            <div
              style={{
                height: `${virtualizer.getTotalSize()}px`,
                width: '100%',
                position: 'relative',
              }}
            >
              {virtualizer.getVirtualItems().map((virtualRow) => {
                const item = items[virtualRow.index];
                return (
                  <div
                    key={item.key}
                    data-index={virtualRow.index}
                    ref={virtualizer.measureElement}
                    style={{
                      position: 'absolute',
                      top: 0,
                      left: 0,
                      width: '100%',
                      transform: `translateY(${virtualRow.start}px)`,
                    }}
                  >
                    <div className="pb-3">
                      {item.type === 'open_shift' && item.openShift ? (
                        <OpenShiftCard
                          openShift={item.openShift}
                          hasConflict={conflictMap.get(item.key) ?? false}
                          onClaim={handleClaim}
                          isClaiming={claimMutation.isPending && claimTarget?.template_id === item.openShift.template_id}
                        />
                      ) : item.type === 'trade' && item.trade ? (
                        <TradeCard
                          trade={item.trade as TradeCardProps['trade']}
                          onAccept={handleAcceptTrade}
                          isAccepting={isAcceptingTrade && acceptingTradeId === item.trade.id}
                          currentEmployeeId={currentEmployee.id}
                        />
                      ) : null}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}
      </div>

      {/* My Claims section */}
      {!claimsLoading && claims.length > 0 && (
        <Collapsible open={claimsOpen} onOpenChange={setClaimsOpen}>
          <CollapsibleTrigger asChild>
            <button
              className="flex items-center gap-2 w-full text-left"
              aria-label={claimsOpen ? 'Collapse my claims' : 'Expand my claims'}
            >
              <h2 className="text-[17px] font-semibold text-foreground">My Claims</h2>
              <span className="text-[11px] px-1.5 py-0.5 rounded-md bg-muted font-medium">
                {claims.length}
              </span>
              {claimsOpen ? (
                <ChevronUp className="h-4 w-4 text-muted-foreground" aria-hidden="true" />
              ) : (
                <ChevronDown className="h-4 w-4 text-muted-foreground" aria-hidden="true" />
              )}
            </button>
          </CollapsibleTrigger>
          <CollapsibleContent className="mt-3 space-y-2">
            {claims.map((claim) => (
              <div
                key={claim.id}
                className="flex items-center justify-between p-3 rounded-xl border border-border/40 bg-background"
              >
                <div className="min-w-0 space-y-1">
                  <div className="text-[14px] font-medium text-foreground">
                    {(claim as any).shift_template?.name ?? 'Shift'}
                  </div>
                  <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[13px] text-muted-foreground">
                    <span className="flex items-center gap-1">
                      <Calendar className="h-3.5 w-3.5" aria-hidden="true" />
                      {format(parseISO(claim.shift_date), 'EEE, MMM d')}
                    </span>
                    {(claim as any).shift_template && (
                      <span className="flex items-center gap-1">
                        <MapPin className="h-3.5 w-3.5" aria-hidden="true" />
                        {(claim as any).shift_template.position}
                      </span>
                    )}
                  </div>
                </div>
                <div className="ml-4 flex-shrink-0">
                  {claimStatusBadge(claim.status)}
                </div>
              </div>
            ))}
          </CollapsibleContent>
        </Collapsible>
      )}

      {/* Claim confirmation dialog */}
      <ClaimConfirmDialog
        open={!!claimTarget}
        onOpenChange={(open) => { if (!open) setClaimTarget(null); }}
        openShift={claimTarget}
        onConfirm={handleConfirmClaim}
        isPending={claimMutation.isPending}
      />
    </div>
  );
}
