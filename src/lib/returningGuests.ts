export type MatchQuality = 'strong' | 'good' | 'fair' | 'weak' | 'none';
export type GuestSource = 'toast' | 'revel' | 'focus' | 'square' | 'mixed' | 'none';
export type GuestPeriod = 'before' | 'after';

export interface ReturningGuestWeek {
  week_start: string;
  period: GuestPeriod;
  warmup: boolean;
  returning_spend: number;
  new_spend: number;
  returning_visits: number;
  returning_cards: number;
  new_cards: number;
}

export interface ReturningGuestPeriodSummary {
  spend_per_week: number | null;
  visits_per_card: number | null;
  avg_check: number | null;
  returning_cards: number;
  new_cards: number;
}

export interface ReturningGuestTrends {
  source: GuestSource;
  match_quality: MatchQuality;
  history_start: string | null;
  weeks_compared: number;
  weeks: ReturningGuestWeek[];
  summary: {
    before: ReturningGuestPeriodSummary;
    after: ReturningGuestPeriodSummary;
  } | null;
}

export interface ChartRow {
  weekIndex: number;
  weekStart: string;
  period: GuestPeriod;
  returning: number;
  new: number;
}

export const ALLOWED_WEEKS = [4, 8, 12] as const;
export const DEFAULT_WEEKS = 8;

const DAY_MS = 86_400_000;

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

/** Percent change from before to after. Returns null when it has no meaning. */
export function percentChange(
  before: number | null | undefined,
  after: number | null | undefined,
): number | null {
  if (!isFiniteNumber(before) || !isFiniteNumber(after)) return null;
  if (before === 0) return null;
  return ((after - before) / before) * 100;
}

function toUtcMs(date: string): number {
  const [y, m, d] = date.split('-').map(Number);
  return Date.UTC(y, m - 1, d);
}

/** Return true when the value is a real calendar date in YYYY-MM-DD form. */
export function isCalendarDate(value: string | null | undefined): value is string {
  if (!value || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  return new Date(toUtcMs(value)).toISOString().slice(0, 10) === value;
}

/** Parse the `start` URL param. Return null if it is not a real date or is after today. */
export function parseCampaignStart(raw: string | null | undefined, today: string): string | null {
  return isCalendarDate(raw) && raw <= today ? raw : null;
}

/** Parse the `weeks` URL param. Fall back to 8. */
export function parseWeeks(raw: string | null | undefined): number {
  const n = Number(raw);
  return (ALLOWED_WEEKS as readonly number[]).includes(n) ? n : DEFAULT_WEEKS;
}

/** Return true when the role may see the Returning Guests page. */
export function canViewReturningGuests(role: string | null | undefined): boolean {
  return role === 'owner' || role === 'manager';
}

export interface ChangeDescription {
  direction: 'up' | 'down' | 'flat';
  sign: '+' | '-' | '';
  word: 'increased' | 'decreased' | 'did not change';
  rounded: number;
}

/** Describe a percent change. A change that rounds to 0 counts as flat. */
export function describeChange(change: number): ChangeDescription {
  const rounded = Math.round(Math.abs(change));
  if (rounded === 0) return { direction: 'flat', sign: '', word: 'did not change', rounded };
  if (change > 0) return { direction: 'up', sign: '+', word: 'increased', rounded };
  return { direction: 'down', sign: '-', word: 'decreased', rounded };
}

const CASH_NOTE = 'Cash payments are not included.';

/** Return the note text for a match quality, or null when there is no data. */
export function noteForQuality(quality: MatchQuality): string | null {
  switch (quality) {
    case 'strong':
      return `Estimate. We match guests by a card ID from Square. ${CASH_NOTE}`;
    case 'good':
    case 'fair':
      return `Estimate. We match guests by card brand and card digits. Some different cards share these digits, so numbers can be a little high. ${CASH_NOTE}`;
    case 'weak':
      return `Rough estimate. Your POS gives only the last 4 card digits. Many different cards share them, so the returning numbers are high. Use the trend, not the exact number. ${CASH_NOTE}`;
    default:
      return null;
  }
}

export function warmupNote(historyStart: string): string {
  return `Your card history starts on ${historyStart}. Weeks near that date show too many new guests.`;
}

/** Map RPC weeks to chart rows. Week 0 is the week of the campaign start. */
export function toChartRows(weeks: ReturningGuestWeek[], campaignStart: string): ChartRow[] {
  const startMs = toUtcMs(campaignStart);
  return weeks.map((w) => ({
    weekIndex: Math.round((toUtcMs(w.week_start) - startMs) / (7 * DAY_MS)),
    weekStart: w.week_start,
    period: w.period,
    returning: w.returning_spend,
    new: w.new_spend,
  }));
}
