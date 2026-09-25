/**
 * Open shift trades that the current employee can accept now.
 *
 * The rules mirror `accept_shift_trade`: the RPC refuses an overlap with a
 * scheduled or confirmed shift, and in block mode it refuses an accept
 * inside `trade_deadline_hours` unless the caller holds `edit:scheduling`.
 * A trade that the RPC would refuse must not show as claimable.
 */
import type { ShiftTrade } from '@/hooks/useShiftTrades';
import type { ShiftProtectionSettings } from '@/lib/shiftProtection';
import { addDaysToDateStr, formatInstant, toBusinessDay } from '@/lib/restaurantClock';

export type MarketplaceTrade = ShiftTrade & { hasConflict?: boolean };

export interface ClaimableTrade {
  trade: MarketplaceTrade;
  startsAt: Date;
  /** The shift starts in 24 h or less. */
  urgent: boolean;
}

export interface ClaimableOptions {
  employeeId: string;
  now: Date;
  protection: ShiftProtectionSettings;
  /** `hasCapability('edit:scheduling')`. */
  isExemptFromBlock: boolean;
}

const MINUTE_MS = 60 * 1000;
const HOUR_MS = 60 * MINUTE_MS;
const URGENT_MS = 24 * HOUR_MS;

export function selectClaimableTrades(
  trades: readonly MarketplaceTrade[],
  opts: ClaimableOptions,
): ClaimableTrade[] {
  const nowMs = opts.now.getTime();
  const { trade_deadline_mode, trade_deadline_hours } = opts.protection;
  const blockWindowMs = trade_deadline_hours * HOUR_MS;
  const blocks = trade_deadline_mode === 'block' && !opts.isExemptFromBlock;

  const rows: ClaimableTrade[] = [];
  for (const trade of trades) {
    const startIso = trade.offered_shift?.start_time;
    if (!startIso) continue;
    if (trade.offered_by_employee_id === opts.employeeId) continue;
    if (trade.hasConflict === true) continue;

    const startsAt = new Date(startIso);
    const msUntil = startsAt.getTime() - nowMs;
    if (!(msUntil > 0)) continue;
    if (blocks && msUntil <= blockWindowMs) continue;

    rows.push({ trade, startsAt, urgent: msUntil <= URGENT_MS });
  }

  rows.sort((a, b) => a.startsAt.getTime() - b.startsAt.getTime());
  return rows;
}

function plural(n: number, word: string): string {
  return `${n} ${word}${n === 1 ? '' : 's'}`;
}

/** Screen reader text for a count badge: "2 shifts up for grabs". */
export function shiftsUpForGrabsText(count: number): string {
  return `${plural(count, 'shift')} up for grabs`;
}

/**
 * Urgency chip text, or null when no chip shows. The row already shows the
 * date tile and the time, so the chip never repeats the date.
 */
export function tradeUrgencyLabel(
  startsAt: Date,
  now: Date,
  tz: string,
): { short: string; spoken: string } | null {
  const msUntil = startsAt.getTime() - now.getTime();
  if (!(msUntil > 0)) return null;

  if (msUntil < HOUR_MS) {
    // Round down, but never show "0 min" in the last minute.
    const minutes = Math.max(1, Math.floor(msUntil / MINUTE_MS));
    return { short: `Starts in ${minutes} min`, spoken: `Starts in ${plural(minutes, 'minute')}` };
  }

  if (msUntil < 12 * HOUR_MS) {
    const hours = Math.floor(msUntil / HOUR_MS);
    return { short: `Starts in ${hours} h`, spoken: `Starts in ${plural(hours, 'hour')}` };
  }

  const today = toBusinessDay(now, tz);
  const startDay = toBusinessDay(startsAt, tz);
  if (startDay === today) return { short: 'Today', spoken: 'Today' };
  if (startDay === addDaysToDateStr(today, 1)) return { short: 'Tomorrow', spoken: 'Tomorrow' };
  return null;
}

/** Date tile parts in the restaurant time zone: `{ weekday: 'Fri', day: '26', month: 'Sep' }`. */
export function tradeDateTile(
  startsAt: Date,
  tz: string,
): { weekday: string; day: string; month: string } {
  return {
    weekday: formatInstant(startsAt, tz, 'EEE'),
    day: formatInstant(startsAt, tz, 'd'),
    month: formatInstant(startsAt, tz, 'MMM'),
  };
}

/** Trade day in the restaurant time zone: "Fri, Sep 26". */
export function tradeDateLabel(start: string | Date, tz: string): string {
  return formatInstant(start, tz, 'EEE, MMM d');
}

/**
 * Trade clock range in the restaurant time zone: "4:00 PM – 10:00 PM".
 * The home card and the marketplace both use it, so one trade shows one time.
 */
export function tradeTimeRange(start: string | Date, end: string | Date, tz: string): string {
  return `${formatInstant(start, tz, 'h:mm a')} – ${formatInstant(end, tz, 'h:mm a')}`;
}
