// Pure, fully-testable derivations of plain-language insight copy for the
// Sales vs Break-Even widget. Kept separate from `breakEvenCalculator.ts` so
// each derivation has its own small surface and its own direct tests.

import { parseLocalDate } from '@/lib/parseLocalDate';

export interface BreakEvenHistoryEntry {
  date: string;
  sales: number;
  breakEven: number;
  delta: number;
  status: 'above' | 'at' | 'below';
  isPartial: boolean;
}

// Business-week order (Monday first) so consecutive runs like "Mon–Thu" or
// "Fri–Sun" collapse correctly even though Sunday is `getDay() === 0`.
const WEEK_ORDER = [1, 2, 3, 4, 5, 6, 0] as const;
const WEEKDAY_ABBR: Record<number, string> = {
  0: 'Sun',
  1: 'Mon',
  2: 'Tue',
  3: 'Wed',
  4: 'Thu',
  5: 'Fri',
  6: 'Sat',
};

const MIN_COMPLETE_DAYS = 7;
const MIN_SAMPLES_PER_WEEKDAY = 2;

function formatDollars(amount: number): string {
  return Math.round(amount).toLocaleString('en-US');
}

// Collapses a set of weekday numbers (`Date.getDay()` values) into a
// human-readable label: consecutive business-week runs become a range
// ("Mon–Thu"), non-consecutive weekdays are listed ("Mon, Wed, Fri").
function formatWeekdaySet(weekdays: number[]): string {
  const positions = weekdays
    .map((day) => WEEK_ORDER.indexOf(day as (typeof WEEK_ORDER)[number]))
    .sort((a, b) => a - b);

  const runs: number[][] = [];
  for (const pos of positions) {
    const currentRun = runs[runs.length - 1];
    if (currentRun && pos === currentRun[currentRun.length - 1] + 1) {
      currentRun.push(pos);
    } else {
      runs.push([pos]);
    }
  }

  return runs
    .map((run) => {
      const start = WEEKDAY_ABBR[WEEK_ORDER[run[0]]];
      const end = WEEKDAY_ABBR[WEEK_ORDER[run[run.length - 1]]];
      return run.length === 1 ? start : `${start}–${end}`;
    })
    .join(', ');
}

interface WeekdayStat {
  weekday: number;
  entries: BreakEvenHistoryEntry[];
  avgDelta: number;
  allAbove: boolean;
  allBelow: boolean;
}

function average(entries: BreakEvenHistoryEntry[]): number {
  return entries.reduce((sum, e) => sum + e.delta, 0) / entries.length;
}

/**
 * Derives a plain-language weekday-pattern sentence from complete
 * (non-partial) history rows, or `null` when the data doesn't support a
 * claim. See docs/superpowers/specs/2026-07-22-breakeven-widget-clarity-design.md
 * section B for the rules this implements.
 */
export function deriveWeekdayPattern(history: BreakEvenHistoryEntry[]): string | null {
  const completeDays = history.filter((h) => !h.isPartial);
  if (completeDays.length < MIN_COMPLETE_DAYS) return null;

  const byWeekday = new Map<number, BreakEvenHistoryEntry[]>();
  for (const day of completeDays) {
    const weekday = parseLocalDate(day.date).getDay();
    const bucket = byWeekday.get(weekday);
    if (bucket) {
      bucket.push(day);
    } else {
      byWeekday.set(weekday, [day]);
    }
  }

  const weekdayStats: WeekdayStat[] = Array.from(byWeekday.entries()).map(
    ([weekday, entries]) => ({
      weekday,
      entries,
      avgDelta: average(entries),
      allAbove: entries.every((e) => e.status === 'above'),
      allBelow: entries.every((e) => e.status === 'below'),
    }),
  );

  // Only weekdays with enough samples of their own may back a claim — a
  // weekday backed by a single observation is noise, even when some other
  // weekday in the same window happens to have two or more (the default
  // 14-day window's 13 complete days split as six weekdays x2 + one x1
  // every time, so gating on the busiest weekday alone let that lone-sample
  // weekday ride along into "always"/"never"/"weakest" claims).
  const qualifyingStats = weekdayStats.filter((w) => w.entries.length >= MIN_SAMPLES_PER_WEEKDAY);
  if (qualifyingStats.length === 0) return null;

  const isCleanSplit = qualifyingStats.every((w) => w.allAbove || w.allBelow);
  const aboveWeekdays = qualifyingStats.filter((w) => w.allAbove);
  const belowWeekdays = qualifyingStats.filter((w) => w.allBelow);

  if (isCleanSplit && aboveWeekdays.length > 0 && belowWeekdays.length > 0) {
    const aboveEntries = aboveWeekdays.flatMap((w) => w.entries);
    const belowEntries = belowWeekdays.flatMap((w) => w.entries);
    const gap = average(aboveEntries) - average(belowEntries);
    const belowRange = formatWeekdaySet(belowWeekdays.map((w) => w.weekday));
    const aboveRange = formatWeekdaySet(aboveWeekdays.map((w) => w.weekday));
    return `${belowRange} never break even; ${aboveRange} always do. The gap averages $${formatDollars(gap)}/day.`;
  }

  const meanDelta = average(completeDays);
  // qualifyingStats is non-empty here (guarded above), so seeding the reduce
  // with its first element is safe and keeps the min-by-avgDelta semantics.
  const weakest = qualifyingStats.reduce(
    (worst, w) => (w.avgDelta < worst.avgDelta ? w : worst),
    qualifyingStats[0],
  );

  // Only claim a weakest day when it is actually below break-even on average
  // (not merely the least-good of several profitable days) and materially
  // worse than the overall mean — otherwise there's nothing to act on.
  if (weakest.avgDelta < 0 && weakest.avgDelta < meanDelta) {
    const label = WEEKDAY_ABBR[weakest.weekday];
    return `${label} is your weakest day, averaging $${formatDollars(Math.abs(weakest.avgDelta))} below break-even.`;
  }

  return null;
}
