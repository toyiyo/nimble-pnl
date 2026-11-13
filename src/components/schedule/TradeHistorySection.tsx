import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { useShiftTradeHistory, type ShiftTradeHistoryRow } from '@/hooks/useShiftTradeHistory';
import {
  getTradeHistoryOutcome,
  getTradeHistoryParties,
  type TradeHistoryFilter,
  type TradeHistoryTone,
} from '@/lib/shiftTradeHistory';
import { formatInstant } from '@/lib/restaurantClock';
import { AUTO_EXPIRED_NOTE } from '@/lib/shiftTradeStatus';
import { cn } from '@/lib/utils';

interface TradeHistorySectionProps {
  restaurantId: string;
  timezone: string;
}

const FILTERS: { value: TradeHistoryFilter; label: string }[] = [
  { value: 'all', label: 'All' },
  { value: 'approved', label: 'Approved' },
  { value: 'rejected', label: 'Rejected' },
  { value: 'cancelled', label: 'Cancelled' },
];

const EMPTY_MESSAGES: Record<TradeHistoryFilter, string> = {
  all: 'No closed trades yet.',
  approved: 'No approved trades yet.',
  rejected: 'No rejected trades yet.',
  cancelled: 'No cancelled trades yet.',
};

const TONE_CLASSES: Record<TradeHistoryTone, string> = {
  success: 'bg-success/10 text-success',
  destructive: 'bg-destructive/10 text-destructive',
  muted: 'bg-muted text-muted-foreground',
};

function HistoryRow({
  trade,
  timezone,
}: Readonly<{ trade: ShiftTradeHistoryRow; timezone: string }>) {
  const outcome = getTradeHistoryOutcome(trade, trade.reviewer_name);
  const { giver, taker } = getTradeHistoryParties(trade);
  const shift = trade.offered_shift;

  return (
    <li className="flex flex-col gap-2 rounded-xl border border-border/40 bg-background p-4 sm:flex-row sm:justify-between">
      <div className="min-w-0 space-y-1">
        <p className="break-words text-[14px] font-medium text-foreground">
          <span>{giver}</span>
          <span className="text-muted-foreground"> to </span>
          <span>{taker}</span>
        </p>
        <p className="text-[13px] text-muted-foreground">
          {formatInstant(shift.start_time, timezone, 'EEE, MMM d')} ·{' '}
          {formatInstant(shift.start_time, timezone, 'h:mm a')} -{' '}
          {formatInstant(shift.end_time, timezone, 'h:mm a')}
          {shift.position ? ` · ${shift.position}` : ''}
        </p>
        {trade.manager_note && trade.manager_note !== AUTO_EXPIRED_NOTE && (
          <p className="break-words text-[13px] text-muted-foreground">
            Note: {trade.manager_note}
          </p>
        )}
      </div>
      <div className="shrink-0 space-y-1 sm:text-right">
        <span
          className={cn(
            'inline-block rounded-md px-1.5 py-0.5 text-[11px] font-medium',
            TONE_CLASSES[outcome.tone],
          )}
        >
          {outcome.label}
        </span>
        <p className="text-[13px] text-muted-foreground">{outcome.actorText}</p>
        {outcome.instant && (
          <p className="text-[13px] text-muted-foreground">
            {formatInstant(outcome.instant, timezone, 'MMM d, h:mm a')}
          </p>
        )}
      </div>
    </li>
  );
}

export const TradeHistorySection = ({ restaurantId, timezone }: TradeHistorySectionProps) => {
  const [filter, setFilter] = useState<TradeHistoryFilter>('all');
  const {
    trades,
    isLoading,
    isFetching,
    isFetchingNextPage,
    hasNextPage,
    fetchNextPage,
    refetch,
    error,
  } = useShiftTradeHistory(restaurantId, filter);

  const errorBlock = (
    <div
      role="alert"
      className="flex items-center justify-between gap-3 rounded-lg border border-destructive/20 bg-destructive/10 p-3"
    >
      <span className="text-[13px] text-destructive">Could not load trade history.</span>
      <Button
        variant="ghost"
        className="h-9 px-4 rounded-lg text-[13px] font-medium"
        disabled={isFetching}
        onClick={() => void refetch()}
      >
        Try again
      </Button>
    </div>
  );

  const renderBody = () => {
    if (isLoading) {
      return (
        <div className="space-y-2">
          {[0, 1, 2].map((i) => (
            <Skeleton key={i} data-testid="history-skeleton" className="h-[84px] w-full rounded-xl" />
          ))}
        </div>
      );
    }
    if (error && trades.length === 0) return errorBlock;
    if (trades.length === 0 && !hasNextPage) {
      return (
        <p data-testid="history-empty" className="py-6 text-center text-[13px] text-muted-foreground">
          {EMPTY_MESSAGES[filter]}
        </p>
      );
    }
    return (
      <>
        <ul className="space-y-2">
          {trades.map((trade) => (
            <HistoryRow key={trade.id} trade={trade} timezone={timezone} />
          ))}
        </ul>
        {error && <div className="mt-3">{errorBlock}</div>}
        {hasNextPage && (
          <div className="mt-3 flex justify-center">
            <Button
              variant="ghost"
              className="h-9 px-4 rounded-lg text-[13px] font-medium text-muted-foreground hover:text-foreground"
              disabled={isFetchingNextPage}
              onClick={() => void fetchNextPage()}
            >
              {isFetchingNextPage ? 'Loading...' : 'Load more'}
            </Button>
          </div>
        )}
      </>
    );
  };

  return (
    <section className="border-t border-border/40 px-4 py-4 sm:px-6" aria-label="Trade history">
      <h3 className="mb-3 text-[12px] font-medium uppercase tracking-wider text-muted-foreground">
        Trade history
      </h3>
      <Tabs value={filter} onValueChange={(v) => setFilter(v as TradeHistoryFilter)}>
        <TabsList className="mb-4 h-auto justify-start gap-6 rounded-none border-b border-border/40 bg-transparent p-0">
          {FILTERS.map((f) => (
            <TabsTrigger
              key={f.value}
              value={f.value}
              className="rounded-none border-b-2 border-transparent bg-transparent px-0 py-3 text-[14px] font-medium text-muted-foreground shadow-none focus-visible:ring-2 focus-visible:ring-ring data-[state=active]:border-foreground data-[state=active]:bg-transparent data-[state=active]:text-foreground data-[state=active]:shadow-none"
            >
              {f.label}
            </TabsTrigger>
          ))}
        </TabsList>
        {/* Mount a panel for each tab, so each aria-controls has a target. Hide the inactive panels. */}
        {FILTERS.map((f) => (
          <TabsContent key={f.value} value={f.value} forceMount hidden={f.value !== filter} className="mt-0">
            {f.value === filter ? renderBody() : null}
          </TabsContent>
        ))}
      </Tabs>
    </section>
  );
};
