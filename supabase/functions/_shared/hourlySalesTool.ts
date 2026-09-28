// Pure parts of the `get_hourly_sales` connector tool.
//
// Design: docs/superpowers/specs/2026-09-27-connector-hourly-sales-design.md §4.3
// Plan:   docs/superpowers/plans/2026-09-27-connector-hourly-sales-plan.md
//
// No Deno imports here, so Vitest can import this file directly. The Deno
// handler (ai-execute-tool/index.ts) calls these functions and does the I/O
// (the RPC call, the staffing_settings read).

const VIEWS = ['weekday', 'by_date'] as const;
const INTERVALS = [15, 30, 60] as const;
const YMD_RE = /^\d{4}-\d{2}-\d{2}$/;
const DAY_NAMES = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

export type HourlySalesView = (typeof VIEWS)[number];
export type IntervalMinutes = (typeof INTERVALS)[number];

export interface ArgError {
  code: 'INVALID_ARGUMENTS';
  message: string;
}

export interface HourlySalesArgs {
  view: HourlySalesView;
  interval_minutes: IntervalMinutes;
  lookback_weeks?: number;
  start_date?: string;
  end_date?: string;
  day_of_week?: number;
}

export type ParseArgsResult =
  | { ok: true; value: HourlySalesArgs }
  | { ok: false; error: ArgError };

function argError(message: string): { ok: false; error: ArgError } {
  return { ok: false, error: { code: 'INVALID_ARGUMENTS', message } };
}

/**
 * Check and default the raw tool arguments. Returns in-band
 * INVALID_ARGUMENTS for a bad enum, a bad date, or end_date before
 * start_date -- the same pattern as list_categories (ced3eac8).
 */
export function parseHourlySalesArgs(args: unknown): ParseArgsResult {
  const a = (args ?? {}) as Record<string, unknown>;

  const view = (a.view ?? 'weekday') as HourlySalesView;
  if (!VIEWS.includes(view)) {
    return argError(`view must be one of: ${VIEWS.join(', ')}.`);
  }

  const interval_minutes = (a.interval_minutes ?? 60) as IntervalMinutes;
  if (!INTERVALS.includes(interval_minutes)) {
    return argError(`interval_minutes must be one of: ${INTERVALS.join(', ')}.`);
  }

  let lookback_weeks: number | undefined;
  if (a.lookback_weeks !== undefined && a.lookback_weeks !== null) {
    const n = Number(a.lookback_weeks);
    if (!Number.isInteger(n) || n < 1 || n > 12) {
      return argError('lookback_weeks must be an integer from 1 to 12.');
    }
    lookback_weeks = n;
  }

  let day_of_week: number | undefined;
  if (a.day_of_week !== undefined && a.day_of_week !== null) {
    const n = Number(a.day_of_week);
    if (!Number.isInteger(n) || n < 0 || n > 6) {
      return argError('day_of_week must be an integer from 0 to 6.');
    }
    day_of_week = n;
  }

  let start_date: string | undefined;
  if (a.start_date !== undefined && a.start_date !== null) {
    start_date = String(a.start_date);
    if (!YMD_RE.test(start_date)) {
      return argError('start_date must be a YYYY-MM-DD date.');
    }
  }

  let end_date: string | undefined;
  if (a.end_date !== undefined && a.end_date !== null) {
    end_date = String(a.end_date);
    if (!YMD_RE.test(end_date)) {
      return argError('end_date must be a YYYY-MM-DD date.');
    }
  }

  if (start_date !== undefined && end_date !== undefined && end_date < start_date) {
    return argError('end_date must not be before start_date.');
  }

  return {
    ok: true,
    value: { view, interval_minutes, lookback_weeks, start_date, end_date, day_of_week },
  };
}

/**
 * Byte budget (design §4.3): a worst-case row ["23:45",99999.99,99,999],
 * has 32 characters. At 15 minutes, 7 days x 96 rows x 32 = 21,504. At 30
 * minutes, 15 x 48 x 32 = 23,040. At 60 minutes, 31 x 24 x 32 = 23,808. Day
 * headers and notes add less than 4,000, so every limit stays under the
 * 40,000-character tool-text cap.
 */
export function maxByDateDays(intervalMinutes: IntervalMinutes): number {
  if (intervalMinutes === 15) return 7;
  if (intervalMinutes === 30) return 15;
  return 31;
}

function addDaysToYmd(ymd: string, days: number): string {
  const [y, m, d] = ymd.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  dt.setUTCDate(dt.getUTCDate() + days);
  const yy = dt.getUTCFullYear();
  const mm = String(dt.getUTCMonth() + 1).padStart(2, '0');
  const dd = String(dt.getUTCDate()).padStart(2, '0');
  return `${yy}-${mm}-${dd}`;
}

function daysBetweenYmdInclusive(startYmd: string, endYmd: string): number {
  const [sy, sm, sd] = startYmd.split('-').map(Number);
  const [ey, em, ed] = endYmd.split('-').map(Number);
  const start = Date.UTC(sy, sm - 1, sd);
  const end = Date.UTC(ey, em - 1, ed);
  return Math.round((end - start) / 86_400_000) + 1;
}

export interface ResolvedWindow {
  start_date: string;
  end_date: string;
  lookback_weeks?: number;
}

export type ResolveWindowResult =
  | { ok: true; value: ResolvedWindow }
  | { ok: false; error: ArgError };

/**
 * The RPC window for the two views (design §4.3 steps 2-3).
 * weekday: end = restaurant-local today, start = end - lookback_weeks x 7.
 * by_date: default last 7 days, checked against the by_date span limit for
 * the chosen interval_minutes.
 */
export function resolveWindow(
  args: HourlySalesArgs,
  todayYmd: string,
  defaultLookbackWeeks: number,
): ResolveWindowResult {
  if (args.view === 'weekday') {
    const lookback_weeks = args.lookback_weeks ?? defaultLookbackWeeks;
    const end_date = todayYmd;
    const start_date = addDaysToYmd(todayYmd, -(lookback_weeks * 7));
    return { ok: true, value: { start_date, end_date, lookback_weeks } };
  }

  const end_date = args.end_date ?? todayYmd;
  const start_date = args.start_date ?? addDaysToYmd(end_date, -6);
  if (end_date < start_date) {
    return argError('end_date must not be before start_date.');
  }

  const maxDays = maxByDateDays(args.interval_minutes);
  const spanDays = daysBetweenYmdInclusive(start_date, end_date);
  if (spanDays > maxDays) {
    return argError(
      `by_date span is limited to ${maxDays} days at ${args.interval_minutes}-minute intervals (got ${spanDays} days).`,
    );
  }

  return { ok: true, value: { start_date, end_date } };
}

function minutesToHHMM(startMinute: number): string {
  const h = Math.floor(startMinute / 60);
  const m = startMinute % 60;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}

export interface RpcSlot {
  start_minute: number;
  sales: number;
  sample_count: number;
}

export interface RpcDay {
  day_of_week: number | null;
  date: string | null;
  sample_days: number | null;
  day_total: number | null;
  has_hourly_breakdown: boolean;
  slots: RpcSlot[];
}

export interface RpcResult {
  time_zone: string;
  view: HourlySalesView;
  interval_minutes: IntervalMinutes;
  start_date: string;
  end_date: string;
  total_sales: number;
  days: RpcDay[];
}

export interface FormattedSettings {
  target_splh: number;
  min_staff: number;
}

/**
 * A day's key, stable across a weekday day-of-week or a by_date calendar
 * date. Used to look up the hourly sales for a sub-hour recommendation.
 */
export function dayKeyFor(day: RpcDay, view: HourlySalesView): string {
  return view === 'weekday' ? String(day.day_of_week) : String(day.date);
}

/**
 * Recommended staff for one slot, given the day key and the slot's start
 * minute and averaged sales. Callers pass a function so the sub-hour case
 * (design §4.3 decision 4) can look up the hour's own 60-minute sales
 * instead of the sub-hour sales for that slot.
 */
export type RecommendStaffFn = (dayKey: string, startMinute: number, sales: number) => number;

const FALLBACK_NOTE =
  'A fallback day has no hourly data; the day total is spread evenly from 09:00 to 22:00.';
const AVERAGING_NOTE = 'Sales are averages over the dates that had a sale in each slot.';

/**
 * Compact-column output (design §4.3): one row per slot as
 * [start, sales, samples, recommended_staff], to stay under the 40k cap.
 */
export function formatHourlySales(
  rpc: RpcResult,
  settings: FormattedSettings,
  recommendStaff: RecommendStaffFn,
): Record<string, unknown> {
  let hasFallback = false;

  const days = rpc.days.map((day) => {
    const dayKey = dayKeyFor(day, rpc.view);
    if (!day.has_hourly_breakdown) hasFallback = true;

    const rows = day.slots.map((slot) => [
      minutesToHHMM(slot.start_minute),
      slot.sales,
      slot.sample_count,
      recommendStaff(dayKey, slot.start_minute, slot.sales),
    ]);

    const base: Record<string, unknown> =
      rpc.view === 'weekday'
        ? { day: DAY_NAMES[day.day_of_week as number], sample_days: day.sample_days }
        : { date: day.date, day_total: day.day_total };

    return { ...base, hourly: day.has_hourly_breakdown, rows };
  });

  const notes = [AVERAGING_NOTE];
  if (hasFallback) notes.push(FALLBACK_NOTE);

  const window: Record<string, unknown> = { start_date: rpc.start_date, end_date: rpc.end_date };

  return {
    restaurant_time_zone: rpc.time_zone,
    view: rpc.view,
    interval_minutes: rpc.interval_minutes,
    window,
    settings,
    columns: ['start', 'sales', 'samples', 'recommended_staff'],
    days,
    notes,
  };
}
