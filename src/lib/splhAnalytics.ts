import type { WorkSession } from '@/utils/timePunchProcessing';

export type SplhCellState = 'lean' | 'balanced' | 'slack' | 'no-labor' | 'closed';

export interface HourContribution {
  localDate: string; // YYYY-MM-DD in tz
  dow: number;       // 0=Sun..6=Sat (UTC-derived from localDate)
  hour: number;      // 0..23 local
  hours: number;
}

export interface SplhGridCell {
  dow: number;
  hour: number;
  totalSales: number;
  totalHours: number;
  splh: number | null;
  state: SplhCellState;
}

export interface SplhPoint {
  bucketStart: string; // local YYYY-MM-DD (Monday for week)
  label: string;
  totalSales: number;
  totalHours: number;
  splh: number | null;
}

export interface SplhSummary {
  actualSplh: number | null;
  target: number;
  laborPct: number | null;
  verdict: string;
  verdictTone: 'lean' | 'balanced' | 'slack' | 'none';
  hireHours: { dow: number; hour: number }[];
  trimHours: { dow: number; hour: number }[];
}

export interface SplhSaleRow {
  sale_date: string;
  sale_time: string | null;
  sold_at?: string | null;
  total_price: number;
}

/** ±band around target counts as "balanced". */
export const BALANCED_BAND = 0.15;

/**
 * Default business-hours window used for the daily-spread fallback when no
 * sale in the window carries usable hour-of-day info. Mirrors
 * `useHourlySalesPattern.ts`'s `DEFAULT_OPEN_HOUR`/`DEFAULT_CLOSE_HOUR` (kept
 * as separate constants here — this lib intentionally has no dependency on
 * the hooks layer — but the values must stay identical).
 */
const FALLBACK_OPEN_HOUR = 9;
const FALLBACK_CLOSE_HOUR = 22; // 10pm

const _fmtCache = new Map<string, Intl.DateTimeFormat>();
function partsFormatter(tz: string): Intl.DateTimeFormat {
  let f = _fmtCache.get(tz);
  if (!f) {
    f = new Intl.DateTimeFormat('en-US', {
      timeZone: tz, hourCycle: 'h23',
      year: 'numeric', month: '2-digit', day: '2-digit',
      hour: '2-digit', minute: '2-digit', second: '2-digit',
    });
    _fmtCache.set(tz, f);
  }
  return f;
}

export function validateTimeZone(tz: string | undefined | null): string {
  if (!tz) return 'UTC';
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: tz });
    return tz;
  } catch {
    return 'UTC';
  }
}

interface LocalParts { date: string; dow: number; hour: number; minuteOfHour: number; }

function localParts(ms: number, tz: string): LocalParts {
  const p = partsFormatter(tz).formatToParts(new Date(ms));
  const get = (t: string) => p.find(x => x.type === t)!.value;
  const y = +get('year'), mo = +get('month'), d = +get('day');
  const hour = +get('hour') % 24;
  const minuteOfHour = +get('minute') + +get('second') / 60;
  const date = `${y}-${String(mo).padStart(2,'0')}-${String(d).padStart(2,'0')}`;
  const dow = new Date(Date.UTC(y, mo - 1, d)).getUTCDay();
  return { date, dow, hour, minuteOfHour };
}

/** [start,end) minus complete breaks → contiguous worked sub-intervals (ms pairs). */
function workedIntervals(session: WorkSession): [number, number][] {
  if (!session.clock_out) return [];
  const start = session.clock_in.getTime();
  const end = session.clock_out.getTime();
  if (end <= start) return [];
  const breaks = session.breaks
    .filter(b => b.is_complete && b.break_end)
    .map(b => [b.break_start.getTime(), b.break_end!.getTime()] as [number, number])
    .filter(([bs, be]) => be > bs)
    .sort((a, b) => a[0] - b[0]);
  const out: [number, number][] = [];
  let cursor = start;
  for (const [bs, be] of breaks) {
    const s = Math.max(cursor, bs);
    if (s > cursor) out.push([cursor, Math.min(s, end)]);
    cursor = Math.max(cursor, Math.min(be, end));
    if (cursor >= end) break;
  }
  if (cursor < end) out.push([cursor, end]);
  return out.filter(([a, b]) => b > a);
}

/**
 * Per-session memoization keyed by session object identity, then `tz`.
 * `buildSplhGrid` and `buildSplhTimeseries` (called for both 'day' and
 * 'week' granularities) each independently re-derive every session's hourly
 * buckets from the same `sessions`/`tz` inputs on every SPLH data load —
 * without this cache that's 3x the `Intl.DateTimeFormat.formatToParts` calls
 * over the same data. `WorkSession` objects are recreated only when the
 * underlying punches change (see `useSplhCore`'s `sessions` memo), so the
 * `WeakMap` naturally scopes to one data load and never leaks across it.
 */
const _hourContribCache = new WeakMap<WorkSession, Map<string, HourContribution[]>>();

export function distributeWorkedHours(session: WorkSession, tz: string): HourContribution[] {
  let byTz = _hourContribCache.get(session);
  const cached = byTz?.get(tz);
  if (cached) return cached;

  const out: HourContribution[] = [];
  for (const [start, end] of workedIntervals(session)) {
    let cursor = start;
    while (cursor < end) {
      const { date, dow, hour, minuteOfHour } = localParts(cursor, tz);
      const minsLeft = 60 - minuteOfHour;
      const chunkMs = Math.min(end - cursor, minsLeft * 60000);
      out.push({ localDate: date, dow, hour, hours: chunkMs / 3600000 });
      cursor += chunkMs;
    }
  }

  if (!byTz) {
    byTz = new Map();
    _hourContribCache.set(session, byTz);
  }
  byTz.set(tz, out);
  return out;
}

export function classifySplh(splh: number, target: number): 'lean' | 'balanced' | 'slack' {
  if (target <= 0) return 'balanced';
  if (splh > target * (1 + BALANCED_BAND)) return 'lean';
  if (splh < target * (1 - BALANCED_BAND)) return 'slack';
  return 'balanced';
}

function hourOfSale(sale: SplhSaleRow, tz: string): number | null {
  if (sale.sold_at) {
    // `Intl.DateTimeFormat.formatToParts` throws a RangeError on an Invalid
    // Date rather than returning parts, so the NaN-ms check must happen
    // *before* calling `localParts` — otherwise a malformed `sold_at` string
    // crashes `buildSplhGrid` instead of falling through to `sale_time`/the
    // "no derivable hour" fallback this function is designed to support.
    const ms = new Date(sale.sold_at).getTime();
    if (Number.isNaN(ms)) return null;
    return localParts(ms, tz).hour;
  }
  if (sale.sale_time) {
    const h = parseInt(sale.sale_time.split(':')[0], 10);
    return Number.isNaN(h) ? null : h;
  }
  return null;
}

function dowOfDate(dateStr: string): number {
  const [y, m, d] = dateStr.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d)).getUTCDay();
}

export function buildSplhGrid(
  sales: SplhSaleRow[], sessions: WorkSession[], tz: string, target: number,
): SplhGridCell[] {
  const key = (dow: number, hour: number) => dow * 24 + hour;
  const salesMap = new Map<number, number>();
  const hoursMap = new Map<number, number>();

  // Derive each sale's hour once. Mirrors `aggregateHourlySales`'s contract
  // (§4.2 of the design doc): when at least one sale in the window carries a
  // usable hour, real per-sale (dow,hour) buckets are used (sales without an
  // hour are skipped, same as before). Only when NONE of the sales have a
  // derivable hour (e.g. CSV-imported sales lacking both `sold_at` and
  // `sale_time`) do we fall back to spreading each date's total evenly
  // across business hours — otherwise every cell would silently read
  // totalSales=0 while the "Estimated" badge falsely claims a spread was
  // performed (design §6).
  const salesWithHour = sales.map((sale) => ({ sale, hour: hourOfSale(sale, tz) }));
  const hasAnyHour = salesWithHour.some(({ hour }) => hour !== null);

  if (hasAnyHour) {
    for (const { sale, hour } of salesWithHour) {
      if (hour === null) continue;
      const dow = dowOfDate(sale.sale_date);
      salesMap.set(key(dow, hour), (salesMap.get(key(dow, hour)) ?? 0) + Number(sale.total_price));
    }
  } else {
    const dailyTotals = new Map<string, number>();
    for (const sale of sales) {
      dailyTotals.set(sale.sale_date, (dailyTotals.get(sale.sale_date) ?? 0) + Number(sale.total_price));
    }
    const businessHours = FALLBACK_CLOSE_HOUR - FALLBACK_OPEN_HOUR;
    for (const [dateStr, total] of dailyTotals) {
      const dow = dowOfDate(dateStr);
      const perHour = total / businessHours;
      for (let hour = FALLBACK_OPEN_HOUR; hour < FALLBACK_CLOSE_HOUR; hour++) {
        salesMap.set(key(dow, hour), (salesMap.get(key(dow, hour)) ?? 0) + perHour);
      }
    }
  }
  for (const s of sessions) {
    for (const c of distributeWorkedHours(s, tz)) {
      hoursMap.set(key(c.dow, c.hour), (hoursMap.get(key(c.dow, c.hour)) ?? 0) + c.hours);
    }
  }

  const cells: SplhGridCell[] = [];
  for (let dow = 0; dow < 7; dow++) {
    for (let hour = 0; hour < 24; hour++) {
      const totalSales = salesMap.get(key(dow, hour)) ?? 0;
      const totalHours = hoursMap.get(key(dow, hour)) ?? 0;
      let splh: number | null = null;
      let state: SplhCellState;
      if (totalSales === 0 && totalHours < 0.01) { state = 'closed'; }
      else if (totalHours < 0.01) { state = 'no-labor'; }
      else { splh = Math.round(totalSales / totalHours); state = classifySplh(splh, target); }
      cells.push({ dow, hour, totalSales: Math.round(totalSales * 100) / 100, totalHours: Math.round(totalHours * 100) / 100, splh, state });
    }
  }
  return cells;
}

function mondayOf(dateStr: string): string {
  const [y, m, d] = dateStr.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  const dow = dt.getUTCDay(); // 0=Sun
  const diff = (dow + 6) % 7; // days since Monday
  dt.setUTCDate(dt.getUTCDate() - diff);
  return dt.toISOString().slice(0, 10);
}

export function buildSplhTimeseries(
  sales: SplhSaleRow[], sessions: WorkSession[], tz: string, granularity: 'day' | 'week',
): SplhPoint[] {
  const bucketOf = (localDate: string) => granularity === 'week' ? mondayOf(localDate) : localDate;
  const salesMap = new Map<string, number>();
  const hoursMap = new Map<string, number>();

  for (const sale of sales) {
    const bucket = bucketOf(sale.sale_date);
    salesMap.set(bucket, (salesMap.get(bucket) ?? 0) + Number(sale.total_price));
  }
  for (const s of sessions) {
    for (const c of distributeWorkedHours(s, tz)) {
      const bucket = bucketOf(c.localDate);
      hoursMap.set(bucket, (hoursMap.get(bucket) ?? 0) + c.hours);
    }
  }

  const buckets = Array.from(new Set([...salesMap.keys(), ...hoursMap.keys()])).sort((a, b) =>
    a.localeCompare(b),
  );
  return buckets.map((bucketStart) => {
    const totalSales = salesMap.get(bucketStart) ?? 0;
    const totalHours = hoursMap.get(bucketStart) ?? 0;
    const splh = totalHours >= 0.01 ? Math.round(totalSales / totalHours) : null;
    return { bucketStart, label: bucketStart, totalSales: Math.round(totalSales * 100) / 100, totalHours: Math.round(totalHours * 100) / 100, splh };
  });
}

function buildSummary(
  totalSales: number, totalHours: number, target: number, avgHourlyRateCents: number | null,
  hireHours: { dow: number; hour: number }[], trimHours: { dow: number; hour: number }[],
): SplhSummary {
  const actualSplh = totalHours >= 0.01 ? Math.round(totalSales / totalHours) : null;
  const laborPct = avgHourlyRateCents && totalSales > 0
    ? Math.round(((totalHours * (avgHourlyRateCents / 100)) / totalSales) * 10000) / 100
    : null;

  let verdictTone: SplhSummary['verdictTone'] = 'none';
  let verdict = 'Not enough data to assess staffing yet.';
  if (actualSplh !== null) {
    const tone = classifySplh(actualSplh, target);
    verdictTone = tone;
    const pct = Math.round(Math.abs(actualSplh - target) / target * 100);
    if (tone === 'lean') verdict = `Running lean — ${pct}% above your $${target} target. You may be understaffed at peak.`;
    else if (tone === 'slack') verdict = `Running slack — ${pct}% below your $${target} target. You may be overstaffed.`;
    else verdict = `On target — right around your $${target} SPLH goal.`;
  }
  return { actualSplh, target, laborPct, verdict, verdictTone, hireHours, trimHours };
}

export function summarizeSplh(
  grid: SplhGridCell[], target: number, avgHourlyRateCents: number | null,
): SplhSummary {
  let totalSales = 0, totalHours = 0;
  const hireHours: { dow: number; hour: number }[] = [];
  const trimHours: { dow: number; hour: number }[] = [];
  for (const c of grid) {
    totalSales += c.totalSales;
    totalHours += c.totalHours;
    if (c.state === 'lean') hireHours.push({ dow: c.dow, hour: c.hour });
    else if (c.state === 'slack') trimHours.push({ dow: c.dow, hour: c.hour });
  }
  return buildSummary(totalSales, totalHours, target, avgHourlyRateCents, hireHours, trimHours);
}

/**
 * Lighter alternative to `summarizeSplh` for callers that only need the
 * headline totals (e.g. the Dashboard card) and never render the per-hour
 * hire/trim callout. Sums sales/worked-hours directly instead of building
 * the full 7x24 grid — skips `hourOfSale`'s and `distributeWorkedHours`'s
 * `Intl.DateTimeFormat` bucketing entirely (design §4: "the grid and the
 * weekly bucket are never built for the card"). `hireHours`/`trimHours` are
 * always empty since no per-hour classification is computed.
 */
export function summarizeSplhTotals(
  sales: SplhSaleRow[], sessions: WorkSession[], target: number, avgHourlyRateCents: number | null,
): SplhSummary {
  const totalSales = sales.reduce((sum, s) => sum + Number(s.total_price), 0);
  let totalHours = 0;
  for (const s of sessions) {
    for (const [start, end] of workedIntervals(s)) totalHours += (end - start) / 3600000;
  }
  return buildSummary(totalSales, totalHours, target, avgHourlyRateCents, [], []);
}

// --- Shared day-of-week + verdict display helpers -------------------------
// Single source of truth for the two UI modules (`SplhHeatmap`,
// `LaborEfficiencyPanel`) that both render a Mon-first day-of-week axis, so
// the display order and the dow->label lookup can never drift apart.

/** `SplhGridCell.dow` codes (0=Sun..6=Sat) in Mon-first display order. */
export const MON_FIRST_DOWS = [1, 2, 3, 4, 5, 6, 0];

/** Day labels indexed by raw `dow` (0=Sun..6=Sat) — index directly with a
 * `dow` value, or with `MON_FIRST_DOWS[i]` for Mon-first display order. */
export const DOW_LABELS_BY_DOW = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

/**
 * Pure: verdict tone -> inline text color. Returns `undefined` for `'none'`
 * so callers' default `text-muted-foreground` className applies instead of
 * forcing a color. Shared by the Dashboard card and the Scheduling panel so
 * their verdict lines always agree on tone->color mapping.
 */
export function verdictToneColor(tone: SplhSummary['verdictTone']): string | undefined {
  if (tone === 'lean') return 'hsl(var(--splh-lean))';
  if (tone === 'slack') return 'hsl(var(--splh-slack))';
  if (tone === 'balanced') return 'hsl(var(--splh-balanced))';
  return undefined;
}
