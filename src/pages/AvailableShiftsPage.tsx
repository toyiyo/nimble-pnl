import { useState, useMemo, useCallback, useRef, useEffect, memo } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { useVirtualizer } from '@tanstack/react-virtual';

import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from '@/components/ui/collapsible';

import {
  AlertTriangle,
  Bell,
  Briefcase,
  Calendar,
  Clock,
  MapPin,
  User,
  ChevronDown,
  ChevronUp,
  CheckCircle,
  Home,
  XCircle,
} from 'lucide-react';

import { useRestaurantContext } from '@/contexts/RestaurantContext';
import { useRestaurantClock } from '@/hooks/useRestaurantClock';
import { useCurrentEmployee } from '@/hooks/useCurrentEmployee';
import { useAvailableShifts, AvailableShiftItem } from '@/hooks/useAvailableShifts';
import { useOpenShiftClaims, useClaimOpenShift } from '@/hooks/useOpenShiftClaims';
import { useMyShifts } from '@/hooks/useShifts';
import { useAcceptShiftTrade } from '@/hooks/useShiftTrades';
import { useToast } from '@/hooks/use-toast';
import { getAreaMismatch, type AreaMismatch } from '@/lib/shiftTradeArea';
import { hasScheduleConflict } from '@/lib/openShiftHelpers';
import { tradeDateLabel, tradeTimeRange } from '@/lib/claimableTrades';
import {
  EmployeePageHeader,
  NoRestaurantState,
  EmployeePageSkeleton,
  EmployeeNotLinkedState,
} from '@/components/employee';
import { OpenShiftCard } from '@/components/scheduling/OpenShiftCard';
import { ClaimConfirmDialog } from '@/components/scheduling/ClaimConfirmDialog';
import { ShiftProtectionWarning } from '@/components/scheduling/ShiftProtectionWarning';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { useShiftProtection } from '@/hooks/useShiftProtection';
import { usePermissions } from '@/hooks/usePermissions';
import { tradeDeadlineFinding, type PolicyFinding } from '@/lib/shiftProtection';
import { TentativeDraftBadge } from '@/components/schedule/TentativeDraftBadge';
import {
  TRADE_LINK_PARAMS,
  decideTradeDeepLink,
  readTradeLink,
  type TradeLink,
  type TradeLinkSource,
} from '@/lib/tradeDeepLink';

import type { OpenShift, OpenShiftClaim } from '@/types/scheduling';

import { format, parseISO, startOfWeek, addDays } from 'date-fns';
import { parseDateLocal } from '@/lib/dateUtils';
import { WEEK_STARTS_ON } from '@/lib/dateConfig';
import { cn } from '@/lib/utils';

// ---- Memoized trade card (no hooks) ----

interface TradeCardProps {
  trade: AvailableShiftItem['trade'] & Record<string, unknown>;
  onAccept: (tradeId: string) => void;
  isAccepting: boolean;
  currentEmployeeId: string;
  areaMismatch?: AreaMismatch | null;
  /** Shift day in the restaurant zone, from `tradeDateLabel`. */
  dateLabel: string;
  /** Shift clock range in the restaurant zone, from `tradeTimeRange`. */
  timeLabel: string;
  /** The deep link points at this trade. */
  highlighted: boolean;
  highlightSource: TradeLinkSource | null;
}

/** How long the deep link highlight stays, unless the user scrolls first. */
const HIGHLIGHT_MS = 4000;

const TradeCard = memo(function TradeCard({
  trade,
  onAccept,
  isAccepting,
  currentEmployeeId,
  areaMismatch,
  dateLabel,
  timeLabel,
  highlighted,
  highlightSource,
}: TradeCardProps) {
  if (!trade?.offered_shift) return null;

  const isPast = parseISO(trade.offered_shift.start_time) < new Date();
  const name = trade.offered_by?.name ?? 'teammate';

  const mismatchId = `area-mismatch-${trade.id}`;

  return (
    <div
      data-trade-id={trade.id}
      // The deep link focuses this root. `ring-inset` stops the scroll
      // container from clipping the ring.
      tabIndex={highlighted ? -1 : undefined}
      aria-current={highlighted ? 'true' : undefined}
      className={cn(
        'group flex flex-col gap-2 p-4 rounded-xl border border-border/40 bg-background hover:border-border transition-colors',
        isPast && 'opacity-60',
        highlighted && 'outline-none ring-2 ring-inset ring-foreground',
      )}
    >
      {/* Row 1: shift info + action button */}
      <div className="flex items-center justify-between">
        <div className="min-w-0 space-y-1.5">
          {highlighted && highlightSource === 'reminder' && (
            <div className="flex items-center gap-1.5 text-[12px] text-muted-foreground">
              <Bell className="h-3.5 w-3.5" aria-hidden="true" />
              From your reminder
            </div>
          )}
          {highlighted && highlightSource === 'home' && (
            <div className="flex items-center gap-1.5 text-[12px] text-muted-foreground">
              <Home className="h-3.5 w-3.5" aria-hidden="true" />
              From your home screen
            </div>
          )}
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
            {trade.offered_shift.is_published === false && <TentativeDraftBadge />}
          </div>
          <div className="flex items-center gap-1.5 text-[13px] text-muted-foreground">
            <User className="h-3.5 w-3.5" aria-hidden="true" />
            <span>From: {name}</span>
          </div>
          {trade.reason && (
            <div className="text-[12px] text-muted-foreground italic">{trade.reason}</div>
          )}
        </div>

        <div className="ml-4 flex-shrink-0">
          {(() => {
            if (trade.status === 'pending_approval') {
              return (
                <span className="text-[11px] px-1.5 py-0.5 rounded-md bg-amber-500/10 text-amber-600 font-medium">
                  Pending Approval
                </span>
              );
            }
            if (areaMismatch) {
              return (
                <Button
                  onClick={() => onAccept(trade.id)}
                  disabled={isPast || isAccepting}
                  className="h-9 px-4 rounded-lg bg-foreground text-background hover:bg-foreground/90 text-[13px] font-medium"
                  aria-label={`Claim anyway — trade from ${name} on ${dateLabel}`}
                  aria-describedby={mismatchId}
                >
                  {isAccepting ? 'Claiming...' : 'Claim anyway'}
                </Button>
              );
            }
            return (
              <Button
                onClick={() => onAccept(trade.id)}
                disabled={isPast || isAccepting}
                className="h-9 px-4 rounded-lg bg-foreground text-background hover:bg-foreground/90 text-[13px] font-medium"
                aria-label={`Accept trade from ${name} on ${dateLabel}`}
              >
                {isAccepting ? 'Accepting...' : 'Accept'}
              </Button>
            );
          })()}
          {trade.target_employee_id === currentEmployeeId && (
            <div className="text-[11px] text-muted-foreground mt-1">Offered to you</div>
          )}
        </div>
      </div>

      {/* Row 2: area-mismatch warning panel (full-width, only when mismatch) */}
      {areaMismatch && (
        <div
          id={mismatchId}
          className="flex items-start gap-2 p-2.5 rounded-lg bg-amber-500/10 border border-amber-500/20"
        >
          <AlertTriangle
            className="h-4 w-4 text-amber-600 mt-0.5 flex-shrink-0"
            aria-hidden="true"
          />
          <span className="text-[13px] text-amber-600">
            This is a {areaMismatch.offeredArea} shift — you work {areaMismatch.claimerArea}.
          </span>
        </div>
      )}
    </div>
  );
}, (prev, next) => {
  return (
    prev.trade?.id === next.trade?.id &&
    prev.trade?.status === next.trade?.status &&
    prev.trade?.offered_shift?.is_published === next.trade?.offered_shift?.is_published &&
    prev.trade?.offered_shift?.start_time === next.trade?.offered_shift?.start_time &&
    prev.trade?.offered_shift?.end_time === next.trade?.offered_shift?.end_time &&
    prev.trade?.offered_shift?.position === next.trade?.offered_shift?.position &&
    prev.trade?.offered_by?.name === next.trade?.offered_by?.name &&
    prev.isAccepting === next.isAccepting &&
    prev.currentEmployeeId === next.currentEmployeeId &&
    prev.areaMismatch?.offeredArea === next.areaMismatch?.offeredArea &&
    prev.areaMismatch?.claimerArea === next.areaMismatch?.claimerArea &&
    prev.dateLabel === next.dateLabel &&
    prev.timeLabel === next.timeLabel &&
    prev.highlighted === next.highlighted &&
    prev.highlightSource === next.highlightSource
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

type HighlightState = TradeLink & { handled: boolean };

export default function AvailableShiftsPage() {
  const {
    selectedRestaurant,
    setSelectedRestaurant,
    restaurants,
    loading: restaurantsLoading,
  } = useRestaurantContext();
  const restaurantId = selectedRestaurant?.restaurant_id ?? null;
  const { tz } = useRestaurantClock();
  const { currentEmployee, loading: empLoading } = useCurrentEmployee(restaurantId);
  const { toast } = useToast();

  // Compute 2-week range (current + next)
  const { weekStart, weekEnd } = useMemo(() => {
    const now = new Date();
    const start = startOfWeek(now, { weekStartsOn: WEEK_STARTS_ON as 0 | 1 | 2 | 3 | 4 | 5 | 6 });
    const end = addDays(start, 13); // 2 weeks
    return { weekStart: start, weekEnd: end };
  }, []);

  const {
    items,
    loading: feedLoading,
    error: feedError,
    refetch: refetchFeed,
  } = useAvailableShifts(
    restaurantId,
    currentEmployee?.id ?? null,
    weekStart,
    weekEnd,
    tz,
  );
  const { claims, loading: claimsLoading } = useOpenShiftClaims(restaurantId, currentEmployee?.id);
  const claimMutation = useClaimOpenShift();
  const { mutate: acceptTrade, isPending: isAcceptingTrade } = useAcceptShiftTrade();

  // Employee's existing shifts for conflict detection
  const { shifts: myShifts, loading: myShiftsLoading } = useMyShifts(
    restaurantId,
    currentEmployee?.id ?? null,
    weekStart,
    weekEnd,
  );
  const employeeShifts = useMemo(() => {
    return myShifts.filter((s) => s.status !== 'cancelled');
  }, [myShifts]);

  // Conflict map: template_id-date -> boolean
  const conflictMap = useMemo(() => {
    const map = new Map<string, boolean>();
    for (const item of items) {
      if (item.type !== 'open_shift' || !item.openShift) continue;
      const os = item.openShift;
      const shiftDate = os.shift_date; // YYYY-MM-DD

      map.set(
        item.key,
        hasScheduleConflict(shiftDate, os.start_time, os.end_time, employeeShifts, tz),
      );
    }
    return map;
  }, [items, employeeShifts, tz]);

  // Trade labels in the restaurant zone, so the marketplace and the home
  // card show one time for one trade on any device.
  const tradeLabels = useMemo(() => {
    const map = new Map<string, { dateLabel: string; timeLabel: string }>();
    for (const item of items) {
      const shift = item.trade?.offered_shift;
      if (item.type !== 'trade' || !item.trade || !shift) continue;
      map.set(item.trade.id, {
        dateLabel: tradeDateLabel(shift.start_time, tz),
        timeLabel: tradeTimeRange(shift.start_time, shift.end_time, tz),
      });
    }
    return map;
  }, [items, tz]);

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

  // Shift Protection: show the deadline rule BEFORE the accept commits.
  // A capability holder is exempt from block, matching the server.
  const { protection } = useShiftProtection(restaurantId);
  const { hasCapability, isResolved } = usePermissions();
  const isExemptFromBlock = isResolved && hasCapability('edit:scheduling');
  const [tradeConfirm, setTradeConfirm] = useState<{
    tradeId: string;
    finding: PolicyFinding;
    blocked: boolean;
  } | null>(null);

  const performAcceptTrade = useCallback((tradeId: string) => {
    if (!currentEmployee?.id) return;
    setAcceptingTradeId(tradeId);
    acceptTrade(
      { tradeId, acceptingEmployeeId: currentEmployee.id },
      {
        onSuccess: () => {
          toast({ title: 'Trade accepted', description: 'Your manager will review the trade.' });
          setAcceptingTradeId(null);
          setTradeConfirm(null);
        },
        onError: (error) => {
          toast({ title: 'Failed to accept trade', description: error.message, variant: 'destructive' });
          setAcceptingTradeId(null);
          setTradeConfirm(null);
        },
      },
    );
  }, [currentEmployee, acceptTrade, toast]);

  const handleAcceptTrade = useCallback((tradeId: string) => {
    const tradeItem = items.find((i) => i.type === 'trade' && i.trade?.id === tradeId);
    const finding = tradeDeadlineFinding(
      protection,
      tradeItem?.trade?.offered_shift?.start_time,
      new Date()
    );
    if (finding) {
      setTradeConfirm({
        tradeId,
        finding,
        blocked: finding.mode === 'block' && !isExemptFromBlock,
      });
      return;
    }
    performAcceptTrade(tradeId);
  }, [items, protection, isExemptFromBlock, performAcceptTrade]);

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

  const loading = feedLoading || myShiftsLoading;

  // ---- Deep link: ?trade=<id>&restaurant=<id>&from=reminder|home ----
  // All hooks stay above the early returns below.
  const [searchParams, setSearchParams] = useSearchParams();
  const [highlight, setHighlight] = useState<HighlightState | null>(() => {
    const link = readTradeLink(searchParams);
    return link ? { ...link, handled: false } : null;
  });

  // Copy the link into state, then delete its params from the URL. A reload
  // or a back navigation must not replay the highlight or the toast.
  useEffect(() => {
    if (!TRADE_LINK_PARAMS.some((key) => searchParams.has(key))) return;
    const link = readTradeLink(searchParams);
    if (link) {
      setHighlight((prev) =>
        prev && !prev.handled && prev.tradeId === link.tradeId && prev.restaurantId === link.restaurantId
          ? prev
          : { ...link, handled: false }
      );
    }
    const next = new URLSearchParams(searchParams);
    TRADE_LINK_PARAMS.forEach((key) => next.delete(key));
    setSearchParams(next, { replace: true });
  }, [searchParams, setSearchParams]);

  const memberRestaurantIds = useMemo(
    () => (restaurants ?? []).map((r) => r.restaurant_id),
    [restaurants]
  );

  const decision = decideTradeDeepLink({
    tradeId: highlight && !highlight.handled ? highlight.tradeId : null,
    linkRestaurantId: highlight?.restaurantId ?? null,
    selectedRestaurantId: restaurantId,
    memberRestaurantIds,
    restaurantsLoading: !!restaurantsLoading,
    // A directed trade shows only once the employee is known.
    loading: empLoading || !currentEmployee || loading,
    error: !!feedError,
    items,
  });
  const decisionKind = decision.kind;
  const scrollIndex = decision.kind === 'scroll' ? decision.index : -1;
  const switchRestaurantId = decision.kind === 'switch-restaurant' ? decision.restaurantId : null;

  useEffect(() => {
    switch (decisionKind) {
      case 'switch-restaurant': {
        const match = (restaurants ?? []).find((r) => r.restaurant_id === switchRestaurantId);
        if (match) setSelectedRestaurant(match);
        return;
      }
      case 'foreign-restaurant':
        toast({ title: 'This shift is at a restaurant you cannot open.' });
        setHighlight(null);
        return;
      case 'gone':
        // RLS hides a trade from other employees once it leaves `open`, so
        // the copy does not name who took it.
        toast({
          title: 'That shift is no longer open',
          description: 'A teammate took it, or it was withdrawn. The shifts below are still open.',
        });
        setHighlight(null);
        return;
      case 'scroll': {
        const container = parentRef.current;
        if (!container) return;
        // No smooth scroll: rows have dynamic height.
        container.scrollIntoView({ block: 'nearest' });
        virtualizer.scrollToIndex(scrollIndex, { align: 'center' });
        setHighlight((prev) => (prev ? { ...prev, handled: true } : prev));
        return;
      }
      default:
        return;
    }
  }, [decisionKind, scrollIndex, switchRestaurantId, restaurants, setSelectedRestaurant, toast, virtualizer]);

  // Focus the card root once, after the next frame, so the virtualizer can
  // render the row first.
  const focusTradeId = highlight?.handled ? highlight.tradeId : null;
  useEffect(() => {
    if (!focusTradeId) return;
    const frame = window.requestAnimationFrame(() => {
      const cards = parentRef.current?.querySelectorAll<HTMLElement>('[data-trade-id]') ?? [];
      const target = Array.from(cards).find((el) => el.dataset.tradeId === focusTradeId);
      target?.focus({ preventScroll: true });
    });
    return () => window.cancelAnimationFrame(frame);
  }, [focusTradeId]);

  // The highlight clears after 4 s, or on the first user scroll of the list.
  // Only wheel and touch count: the scroll to the trade also fires `scroll`.
  useEffect(() => {
    if (!focusTradeId) return;
    const clear = () => setHighlight(null);
    const timer = window.setTimeout(clear, HIGHLIGHT_MS);
    const container = parentRef.current;
    container?.addEventListener('wheel', clear, { passive: true });
    container?.addEventListener('touchmove', clear, { passive: true });
    return () => {
      window.clearTimeout(timer);
      container?.removeEventListener('wheel', clear);
      container?.removeEventListener('touchmove', clear);
    };
  }, [focusTradeId]);

  const highlightedTradeId = highlight?.tradeId ?? null;
  const highlightSource = highlight?.source ?? null;

  // Early returns
  if (!selectedRestaurant) return <NoRestaurantState />;
  if (empLoading) return <EmployeePageSkeleton />;
  if (!currentEmployee) return <EmployeeNotLinkedState />;

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
          {!loading && !feedError && (
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
        ) : feedError ? (
          // Without this state, a failed load reads as "No shifts available".
          <div className="flex flex-col items-center justify-center gap-3 py-16 text-center">
            <AlertTriangle className="h-6 w-6 text-destructive" aria-hidden="true" />
            <h3 className="text-[14px] font-medium text-foreground">Could not load shifts.</h3>
            <Button
              variant="outline"
              onClick={() => refetchFeed()}
              className="h-9 px-4 rounded-lg text-[13px] font-medium"
            >
              Try again
            </Button>
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
                const tradeLabel = item.trade ? tradeLabels.get(item.trade.id) : undefined;
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
                          isClaiming={claimMutation.isPending && claimTarget?.template_id === item.openShift.template_id && claimTarget?.shift_date === item.openShift.shift_date}
                        />
                      ) : item.type === 'trade' && item.trade && tradeLabel ? (
                        <TradeCard
                          trade={item.trade as TradeCardProps['trade']}
                          onAccept={handleAcceptTrade}
                          isAccepting={isAcceptingTrade && acceptingTradeId === item.trade.id}
                          currentEmployeeId={currentEmployee.id}
                          areaMismatch={getAreaMismatch(item.trade.offered_by?.area, currentEmployee.area)}
                          dateLabel={tradeLabel.dateLabel}
                          timeLabel={tradeLabel.timeLabel}
                          highlighted={highlightedTradeId === item.trade.id}
                          highlightSource={highlightedTradeId === item.trade.id ? highlightSource : null}
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
                      {format(parseDateLocal(claim.shift_date), 'EEE, MMM d')}
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

      {/* Shift Protection: late-trade confirmation */}
      <AlertDialog open={!!tradeConfirm} onOpenChange={(open) => { if (!open) setTradeConfirm(null); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Accept this late trade?</AlertDialogTitle>
            <AlertDialogDescription>
              A shift protection rule applies to this trade.
            </AlertDialogDescription>
          </AlertDialogHeader>
          {tradeConfirm && (
            <ShiftProtectionWarning
              id="accept-trade-policy-warning"
              messages={[tradeConfirm.finding.message]}
              footnote={
                tradeConfirm.blocked
                  ? 'A shift protection rule closed this trade for accepts.'
                  : 'A manager must still approve this late trade.'
              }
            />
          )}
          <AlertDialogFooter>
            <AlertDialogCancel disabled={isAcceptingTrade}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={(e) => {
                e.preventDefault();
                if (tradeConfirm) performAcceptTrade(tradeConfirm.tradeId);
              }}
              disabled={isAcceptingTrade || tradeConfirm?.blocked}
              aria-describedby={tradeConfirm?.blocked ? 'accept-trade-policy-warning' : undefined}
            >
              {isAcceptingTrade ? 'Accepting…' : 'Accept anyway'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

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
