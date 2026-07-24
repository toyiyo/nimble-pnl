import { cn } from '@/lib/utils';

interface FreshnessStampProps {
  /**
   * `connected_banks.data_current_through` — a timestamptz marking the most
   * recent transaction we actually hold for this bank, or `null` when we've
   * never proven freshness (a brand-new connection that hasn't synced yet).
   *
   * Deliberately never `last_sync_at` — a sync can "succeed" with zero rows
   * fetched (a Stripe subscription still warming up, a failed refresh that
   * still stamps a sync time) without the data actually advancing. This is
   * the one field that reflects what data we're actually holding.
   */
  dataCurrentThrough: string | null;
  className?: string;
}

const STALE_THRESHOLD_DAYS = 3;

/** Midnight UTC of the calendar day `date` falls on, as epoch milliseconds. */
function floorToUtcDay(date: Date): number {
  return Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate());
}

/**
 * Whole UTC calendar days between `dataCurrentThrough` and now. Both
 * endpoints are floored to UTC midnight before subtracting, so the result
 * doesn't tick over just because the viewer's clock crossed into a new UTC
 * day mid-session — only an actual change in the data does that.
 */
function daysBehind(dataCurrentThrough: Date, now: Date): number {
  const msPerDay = 24 * 60 * 60 * 1000;
  return Math.round((floorToUtcDay(now) - floorToUtcDay(dataCurrentThrough)) / msPerDay);
}

function formatUtcDate(date: Date): string {
  return date.toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    timeZone: 'UTC',
  });
}

export function FreshnessStamp({ dataCurrentThrough, className }: FreshnessStampProps) {
  if (!dataCurrentThrough) {
    return (
      <span className={cn('text-[13px] text-muted-foreground', className)}>
        Not yet verified
      </span>
    );
  }

  const dataDate = new Date(dataCurrentThrough);
  const gap = daysBehind(dataDate, new Date());
  const isStale = gap >= STALE_THRESHOLD_DAYS;

  return (
    <span
      className={cn(
        'text-[13px]',
        isStale ? 'text-amber-700 dark:text-amber-400' : 'text-muted-foreground',
        className
      )}
      title={dataCurrentThrough}
    >
      Data through <span className="tabular-nums">{formatUtcDate(dataDate)}</span>
      {isStale && ` · ${gap} days behind`}
    </span>
  );
}
