import { useMemo, useRef, useState } from 'react';
import { format, parseISO } from 'date-fns';

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';

import { ArrowRightLeft, Loader2, Undo2 } from 'lucide-react';

import { useMyTradeActivity, useCancelShiftTrade } from '@/hooks/useShiftTrades';

import type { ShiftTrade } from '@/hooks/useShiftTrades';

import {
  getPosterTradeProgress,
  getClaimantTradeStatusLine,
  type PosterTradeProgress,
  type TradeStepState,
} from '@/lib/tradeStatusProgress';
import { cn } from '@/lib/utils';

interface MyShiftTradesCardProps {
  restaurantId: string;
  employeeId: string;
  /**
   * Focused after a withdraw empties the "Posted by you" section — the section
   * header (the usual focus-restore target) unmounts along with the last row,
   * so focus needs a stable page-level anchor to land on.
   */
  fallbackFocusRef?: React.RefObject<HTMLElement | null>;
}

const STEP_DOT_CLASS: Record<TradeStepState, string> = {
  done: 'bg-foreground',
  current: 'bg-amber-500',
  upcoming: 'bg-muted-foreground/30',
  rejected: 'bg-destructive',
};

const STEP_LABEL_CLASS: Record<TradeStepState, string> = {
  done: 'text-foreground',
  current: 'text-amber-600',
  upcoming: 'text-muted-foreground',
  rejected: 'text-destructive',
};

/**
 * Visual pipeline for a posted trade. The whole stepper is one accessible
 * unit (role="img" named by the summary); dots/labels are decorative.
 * Step labels are hidden below `sm` — the always-visible summary line under
 * the stepper carries the same information for narrow/zoomed viewports.
 */
const TradeStepper = ({ progress }: { progress: PosterTradeProgress }) => (
  <div role="img" aria-label={progress.summary} className="flex flex-wrap items-center gap-y-1">
    {progress.steps.map((step, i) => (
      <div key={step.key} aria-hidden="true" className="flex items-center">
        {i > 0 && <div className="mx-1.5 h-px w-3 sm:w-5 bg-border" />}
        <span className={cn('h-2 w-2 rounded-full flex-shrink-0', STEP_DOT_CLASS[step.state])} />
        <span className={cn('hidden sm:inline ml-1 text-[11px]', STEP_LABEL_CLASS[step.state])}>
          {step.label}
        </span>
      </div>
    ))}
  </div>
);

const ShiftDateBlock = ({ trade }: { trade: ShiftTrade }) => {
  // The activity hook filters ghost joins upstream, but that guarantee lives
  // in another file — guard locally instead of asserting with `!`.
  const shift = trade.offered_shift;
  if (!shift) return null;
  const start = parseISO(shift.start_time);
  const end = parseISO(shift.end_time);
  return (
    <div className="flex items-center gap-4 min-w-0">
      <div className="text-center flex-shrink-0">
        <div className="text-[13px] font-medium text-muted-foreground">{format(start, 'EEE')}</div>
        <div className="text-2xl font-bold text-foreground">{format(start, 'd')}</div>
        <div className="text-[11px] text-muted-foreground">{format(start, 'MMM')}</div>
      </div>
      <div className="min-w-0">
        <div className="text-[14px] font-medium text-foreground">{shift.position}</div>
        <div className="text-[13px] text-muted-foreground">
          {format(start, 'h:mm a')} - {format(end, 'h:mm a')}
        </div>
      </div>
    </div>
  );
};

const ManagerNote = ({ note }: { note: string }) => (
  <div className="rounded-lg border border-border/40 bg-muted/30 p-2.5 text-[13px] text-muted-foreground">
    <span className="font-medium text-foreground">Manager note:</span> {note}
  </div>
);

/**
 * "My shift trades" — the poster's view of where their posted trades went
 * (with a lifecycle stepper and a Withdraw action while unclaimed) plus the
 * claimant's view of trades they picked up. Resolved trades stay visible for
 * the hook's bounded window so outcomes are seen instead of vanishing.
 */
export const MyShiftTradesCard = ({
  restaurantId,
  employeeId,
  fallbackFocusRef,
}: MyShiftTradesCardProps) => {
  const { trades, loading, isError } = useMyTradeActivity(restaurantId, employeeId);
  const { mutate: cancelTrade, isPending: isWithdrawing } = useCancelShiftTrade();

  const [confirmTarget, setConfirmTarget] = useState<ShiftTrade | null>(null);
  // A successful withdraw unmounts the row (and its Withdraw button), so
  // Radix's default return-to-trigger would focus a removed node. Focus the
  // stable section header instead, on both cancel and success.
  const postedHeaderRef = useRef<HTMLHeadingElement>(null);

  const { postedByMe, claimedByMe } = useMemo(() => {
    const posted: ShiftTrade[] = [];
    const claimed: ShiftTrade[] = [];
    for (const trade of trades) {
      if (trade.offered_by_employee_id === employeeId) {
        posted.push(trade);
      } else if (trade.accepted_by_employee_id === employeeId) {
        claimed.push(trade);
      }
    }
    return { postedByMe: posted, claimedByMe: claimed };
  }, [trades, employeeId]);

  const closeConfirm = (target: 'section' | 'fallback' = 'section') => {
    setConfirmTarget(null);
    requestAnimationFrame(() => {
      const el =
        target === 'fallback'
          ? fallbackFocusRef?.current ?? postedHeaderRef.current
          : postedHeaderRef.current ?? fallbackFocusRef?.current;
      el?.focus();
    });
  };

  const handleConfirmWithdraw = () => {
    if (!confirmTarget) return;
    // Withdrawing the LAST posted trade unmounts the whole section (and its
    // header) once the refetch lands, so the usual focus target disappears —
    // send focus to the page-level fallback instead.
    const focusTarget = postedByMe.length <= 1 ? 'fallback' : 'section';
    cancelTrade(
      { tradeId: confirmTarget.id, employeeId },
      { onSettled: () => closeConfirm(focusTarget) }
    );
  };

  if (loading || isError || (postedByMe.length === 0 && claimedByMe.length === 0)) {
    return null;
  }

  return (
    <Card className="border-border/40">
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-[17px] font-semibold text-foreground">
          <ArrowRightLeft className="h-5 w-5" aria-hidden="true" />
          My shift trades
        </CardTitle>
        <CardDescription className="text-[13px] text-muted-foreground">
          Track shifts you posted for trade and shifts you claimed.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-5">
        {postedByMe.length > 0 && (
          <section className="space-y-2">
            <h3
              ref={postedHeaderRef}
              tabIndex={-1}
              className="text-[12px] font-medium text-muted-foreground uppercase tracking-wider outline-none"
            >
              Posted by you
            </h3>
            {postedByMe.map((trade) => {
              const progress = getPosterTradeProgress(trade);
              return (
                <div
                  key={trade.id}
                  className="p-4 rounded-xl border border-border/40 bg-background space-y-2.5"
                >
                  <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2">
                    <ShiftDateBlock trade={trade} />
                    {trade.status === 'open' && (
                      <Button
                        variant="outline"
                        size="sm"
                        className="h-8 rounded-lg text-[13px] font-medium text-destructive hover:text-destructive/80 border-border/40 self-start sm:self-center"
                        disabled={isWithdrawing}
                        onClick={() => setConfirmTarget(trade)}
                      >
                        <Undo2 className="mr-1.5 h-3.5 w-3.5" aria-hidden="true" />
                        Withdraw post
                      </Button>
                    )}
                  </div>
                  <TradeStepper progress={progress} />
                  <p className="text-[12px] text-muted-foreground">{progress.summary}</p>
                  {trade.status === 'rejected' && trade.manager_note && (
                    <ManagerNote note={trade.manager_note} />
                  )}
                </div>
              );
            })}
          </section>
        )}

        {claimedByMe.length > 0 && (
          <section className="space-y-2">
            <h3 className="text-[12px] font-medium text-muted-foreground uppercase tracking-wider">
              Claimed by you
            </h3>
            {claimedByMe.map((trade) => (
              <div
                key={trade.id}
                className="p-4 rounded-xl border border-border/40 bg-background space-y-2"
              >
                <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2">
                  <ShiftDateBlock trade={trade} />
                  <span className="text-[13px] text-muted-foreground">
                    From {trade.offered_by?.name ?? 'a teammate'}
                  </span>
                </div>
                <p className="text-[12px] text-muted-foreground">
                  {getClaimantTradeStatusLine(trade.status)}
                </p>
                {trade.status === 'rejected' && trade.manager_note && (
                  <ManagerNote note={trade.manager_note} />
                )}
              </div>
            ))}
          </section>
        )}
      </CardContent>

      <Dialog open={confirmTarget !== null} onOpenChange={(open) => !open && closeConfirm()}>
        <DialogContent className="max-w-md p-0 gap-0 border-border/40">
          <DialogHeader className="px-6 pt-6 pb-4 border-b border-border/40">
            <div className="flex items-center gap-3">
              <div className="h-10 w-10 rounded-xl bg-muted/50 flex items-center justify-center">
                <Undo2 className="h-5 w-5 text-foreground" aria-hidden="true" />
              </div>
              <div>
                <DialogTitle className="text-[17px] font-semibold text-foreground">
                  Withdraw this post?
                </DialogTitle>
                <DialogDescription className="text-[13px] text-muted-foreground mt-0.5">
                  Your shift stays on your schedule and leaves the marketplace.
                </DialogDescription>
              </div>
            </div>
          </DialogHeader>
          {confirmTarget?.offered_shift && (
            <div className="px-6 py-5">
              <div className="rounded-xl border border-border/40 bg-muted/30 p-4 text-[13px] text-muted-foreground">
                <span className="font-medium text-foreground">
                  {confirmTarget.offered_shift.position}
                </span>{' '}
                · {format(parseISO(confirmTarget.offered_shift.start_time), 'EEE, MMM d')} ·{' '}
                {format(parseISO(confirmTarget.offered_shift.start_time), 'h:mm a')} -{' '}
                {format(parseISO(confirmTarget.offered_shift.end_time), 'h:mm a')}
              </div>
            </div>
          )}
          <DialogFooter className="px-6 pb-6 gap-2">
            <Button
              variant="outline"
              className="h-9 px-4 rounded-lg text-[13px] font-medium"
              onClick={() => closeConfirm()}
              disabled={isWithdrawing}
            >
              Keep post
            </Button>
            <Button
              variant="destructive"
              className="h-9 px-4 rounded-lg text-[13px] font-medium"
              onClick={handleConfirmWithdraw}
              disabled={isWithdrawing}
            >
              {isWithdrawing ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden="true" />
                  Withdrawing...
                </>
              ) : (
                'Withdraw post'
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Card>
  );
};
