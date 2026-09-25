import { Link } from 'react-router-dom';

import { Button } from '@/components/ui/button';

import { Check, ChevronRight } from 'lucide-react';

import type { ClaimableTrade } from '@/lib/claimableTrades';

import { tradeDateTile, tradeTimeRange, tradeUrgencyLabel } from '@/lib/claimableTrades';
import { formatInstant } from '@/lib/restaurantClock';
import { cn } from '@/lib/utils';

const MAX_ROWS = 3;

interface UpForGrabsCardProps {
  /** Claimable trades, soonest first (from `useClaimableTrades`). */
  trades: ClaimableTrade[];
  loading: boolean;
  error: unknown;
  onRetry: () => void;
  restaurantId: string;
  /** The restaurant time zone. */
  timezone: string;
  now: Date;
  openShiftCount: number;
}

/**
 * "Teammates need cover" on the employee home screen. It shows the soonest
 * trades that the employee can accept. Each row links to the marketplace,
 * which owns the one accept flow (deadline confirm and area warning).
 *
 * Loading and empty render nothing: most employees have no trades most
 * days, and a skeleton that then goes away moves the cards below it.
 */
export function UpForGrabsCard({
  trades,
  loading,
  error,
  onRetry,
  restaurantId,
  timezone,
  now,
  openShiftCount,
}: UpForGrabsCardProps) {
  if (loading) return null;

  if (error) {
    return (
      <div className="flex items-center justify-between gap-3 rounded-xl border border-border/40 bg-background px-4 py-2.5">
        <p className="text-[13px] text-muted-foreground">Could not load shifts that need cover.</p>
        <Button
          variant="ghost"
          onClick={onRetry}
          className="h-9 px-4 rounded-lg text-[13px] font-medium text-muted-foreground hover:text-foreground"
        >
          Try again
        </Button>
      </div>
    );
  }

  const count = trades.length;
  if (count === 0) return null;

  const total = count + openShiftCount;
  // The selector drops every trade that overlaps a shift, so this is true.
  const fitText = count === 1 ? 'It fits around your shifts' : `All ${count} fit around your shifts`;

  return (
    <section
      aria-labelledby="up-for-grabs-title"
      className="rounded-xl border border-border/40 bg-background overflow-hidden"
    >
      <div className="px-4 py-3 border-b border-border/40">
        <h2 id="up-for-grabs-title" className="flex items-center gap-2 text-[17px] font-semibold text-foreground">
          Teammates need cover
          <span className="text-[11px] px-1.5 py-0.5 rounded-md bg-muted">{count}</span>
        </h2>
        <p className="mt-0.5 flex items-center gap-1 text-[12px] text-muted-foreground">
          <Check className="h-3.5 w-3.5 text-success" aria-hidden="true" />
          {fitText}
        </p>
      </div>

      <ul className="divide-y divide-border/40">
        {trades.slice(0, MAX_ROWS).map((row) => (
          <UpForGrabsRow
            key={row.trade.id}
            row={row}
            restaurantId={restaurantId}
            timezone={timezone}
            now={now}
          />
        ))}
      </ul>

      <div className="flex items-center justify-between px-4 py-2.5 border-t border-border/40 text-[13px] text-muted-foreground">
        <span>
          {openShiftCount > 0
            ? `${openShiftCount} open shift${openShiftCount === 1 ? '' : 's'} too`
            : null}
        </span>
        <Link
          to="/employee/shifts"
          // The negative margin keeps the footer low and gives a 44 px target.
          className="-my-2.5 -mr-2 inline-flex min-h-[44px] items-center px-2 font-medium text-foreground hover:underline rounded-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-foreground"
        >
          Browse all {total}
        </Link>
      </div>
    </section>
  );
}

function UpForGrabsRow({
  row,
  restaurantId,
  timezone,
  now,
}: {
  row: ClaimableTrade;
  restaurantId: string;
  timezone: string;
  now: Date;
}) {
  const { trade, startsAt, urgent } = row;
  const shift = trade.offered_shift;
  if (!shift) return null;

  const name = trade.offered_by?.name ?? 'A teammate';
  const tile = tradeDateTile(startsAt, timezone);
  const chip = tradeUrgencyLabel(startsAt, now, timezone);
  const timeRange = tradeTimeRange(shift.start_time, shift.end_time, timezone);
  const spokenDate = formatInstant(startsAt, timezone, 'EEEE, MMMM d');
  const href = `/employee/shifts?trade=${encodeURIComponent(trade.id)}&restaurant=${encodeURIComponent(
    restaurantId
  )}&from=home`;

  return (
    <li>
      <Link
        to={href}
        aria-label={`View ${shift.position} shift on ${spokenDate} from ${name}`}
        className="flex items-center gap-3 px-4 py-3 min-h-[64px] transition-colors hover:bg-muted/30 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-foreground"
      >
        <div className="w-10 text-center flex-shrink-0">
          <div className="text-[13px] font-medium text-muted-foreground">{tile.weekday}</div>
          <div className="text-2xl font-bold text-foreground">{tile.day}</div>
          <div className="text-[11px] text-muted-foreground">{tile.month}</div>
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2 min-w-0">
            <span className="truncate text-[14px] font-medium text-foreground">
              {name} · {shift.position}
            </span>
            {chip && (
              <span
                aria-label={chip.spoken}
                className={cn(
                  'flex-shrink-0 text-[11px] px-1.5 py-0.5 rounded-md',
                  urgent
                    ? 'bg-amber-500/10 text-amber-700 dark:text-amber-400 font-medium'
                    : 'bg-muted text-muted-foreground'
                )}
              >
                {chip.short}
              </span>
            )}
          </div>
          <div className="truncate text-[13px] text-muted-foreground">
            {timeRange}
            {trade.reason ? ` · “${trade.reason}”` : null}
          </div>
        </div>
        <ChevronRight className="h-4 w-4 flex-shrink-0 text-muted-foreground" aria-hidden="true" />
      </Link>
    </li>
  );
}
