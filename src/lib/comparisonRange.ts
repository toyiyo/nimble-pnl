// Prior-period range for the sales comparison.
// All math uses YYYY-MM-DD strings and Date.UTC. No host time zone is used.

import type { Period } from '@/components/PeriodSelector';
import { dayTokenEnd, parseDateOnly, toDateOnlyString } from '@/lib/dateOnly';
import type { PresetPeriodType } from '@/lib/periodUrlState';

export type ComparisonKind = 'week' | 'month' | 'quarter' | 'shift';

export interface ComparisonRange {
  start: string; // YYYY-MM-DD
  end: string; // YYYY-MM-DD
  kind: ComparisonKind;
  offsetDays: number; // days between current start and prior start
}

const DAY_MS = 86_400_000;

interface Ymd {
  y: number;
  m: number; // 1-12
  d: number;
}

function parse(value: string): Ymd | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) return null;
  const y = Number(match[1]);
  const m = Number(match[2]);
  const d = Number(match[3]);
  const date = new Date(Date.UTC(y, m - 1, d));
  // Reject dates that roll over, for example 2026-02-31.
  if (date.getUTCFullYear() !== y || date.getUTCMonth() !== m - 1 || date.getUTCDate() !== d) {
    return null;
  }
  return { y, m, d };
}

function toMs({ y, m, d }: Ymd): number {
  return Date.UTC(y, m - 1, d);
}

function format(ms: number): string {
  const date = new Date(ms);
  const y = String(date.getUTCFullYear()).padStart(4, '0');
  const m = String(date.getUTCMonth() + 1).padStart(2, '0');
  const d = String(date.getUTCDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

function daysInMonth(y: number, m: number): number {
  return new Date(Date.UTC(y, m, 0)).getUTCDate();
}

// Move a date back by whole months. Clamp the day to the length of the target month.
function monthsBack(value: Ymd, months: number): Ymd {
  const index = value.y * 12 + (value.m - 1) - months;
  const y = Math.floor(index / 12);
  const m = (index % 12) + 1;
  return { y, m, d: Math.min(value.d, daysInMonth(y, m)) };
}

// Move a range end back by whole months.
// An end on the last day of its month moves to the last day of the target month,
// so Jun 1-30 gives May 1-31. Other days keep the day number, so Jun 1-15 gives May 1-15.
function endMonthsBack(value: Ymd, months: number): Ymd {
  const moved = monthsBack(value, months);
  if (value.d !== daysInMonth(value.y, value.m)) return moved;
  return { ...moved, d: daysInMonth(moved.y, moved.m) };
}

function quarterOf(m: number): number {
  return Math.floor((m - 1) / 3);
}

function build(start: Ymd, priorStart: Ymd, priorEnd: Ymd, kind: ComparisonKind): ComparisonRange {
  return {
    start: format(toMs(priorStart)),
    end: format(toMs(priorEnd)),
    kind,
    offsetDays: Math.round((toMs(start) - toMs(priorStart)) / DAY_MS),
  };
}

// Rules 3 and 4: the calendar quarter and the calendar month. Return null when neither rule applies.
function calendarRange(s: Ymd, e: Ymd, hint?: ComparisonKind): ComparisonRange | null {
  const sameMonth = s.y === e.y && s.m === e.m;

  // Rule 3: quarter.
  const isQuarterStart = s.d === 1 && (s.m - 1) % 3 === 0;
  const sameQuarter = s.y === e.y && quarterOf(s.m) === quarterOf(e.m);
  if (isQuarterStart && sameQuarter && (hint === 'quarter' || !sameMonth)) {
    return build(s, monthsBack(s, 3), endMonthsBack(e, 3), 'quarter');
  }

  // Rule 4: month.
  if (s.d === 1 && sameMonth) {
    return build(s, monthsBack(s, 1), endMonthsBack(e, 1), 'month');
  }
  return null;
}

export function getComparisonRange(
  start: string,
  end: string,
  hint?: ComparisonKind,
): ComparisonRange | null {
  const s = parse(start);
  const e = parse(end);
  if (!s || !e) return null;
  const startMs = toMs(s);
  const endMs = toMs(e);
  if (startMs > endMs) return null;

  const lengthDays = Math.round((endMs - startMs) / DAY_MS) + 1;
  const shiftRange = (kind: ComparisonKind, offsetDays: number): ComparisonRange => ({
    start: format(startMs - offsetDays * DAY_MS),
    end: format(endMs - offsetDays * DAY_MS),
    kind,
    offsetDays,
  });

  if (hint !== 'shift') {
    // Rule 2: week. Monday start and the end is on or before that Sunday.
    // A 'month' or 'quarter' hint skips this rule: "This month" on Mon Jun 1 compares to May.
    const isMonday = new Date(startMs).getUTCDay() === 1;
    const weekAllowed = hint === undefined || hint === 'week';
    if (weekAllowed && isMonday && lengthDays <= 7) return shiftRange('week', 7);

    // The 'week' hint allows rule 2 only, then rule 5.
    if (hint !== 'week') {
      const calendar = calendarRange(s, e, hint);
      if (calendar) return calendar;
    }
  }

  // Rule 5: shift back by the range length, rounded up to whole weeks.
  return shiftRange('shift', Math.ceil(lengthDays / 7) * 7);
}

export function describeComparison(range: ComparisonRange): string {
  switch (range.kind) {
    case 'week':
      return 'same days, last week';
    case 'month':
      return 'same days, last month';
    case 'quarter':
      return 'same days, last quarter';
    default: {
      const weeks = Math.round(range.offsetDays / 7);
      const length = Math.round((Date.parse(range.end) - Date.parse(range.start)) / DAY_MS) + 1;
      if (length === 1) return 'same day, last week';
      return weeks === 1 ? '1 week earlier' : `${weeks} weeks earlier`;
    }
  }
}

export function comparisonLabel(range: ComparisonRange): string {
  return `vs ${describeComparison(range)}`;
}

// Every preset period has a hint. A custom period has none, so the range rules decide.
const HINT_BY_PERIOD: Record<PresetPeriodType, ComparisonKind> = {
  today: 'shift',
  last30: 'shift',
  last90: 'shift',
  week: 'week',
  month: 'month',
  quarter: 'quarter',
};

export function hintForPeriod(type: Period['type']): ComparisonKind | undefined {
  return type === 'custom' ? undefined : HINT_BY_PERIOD[type];
}

// Adapter for the dashboard. Convert a Period to the local Date pair of the prior range.
export function periodComparison(
  period: Pick<Period, 'type' | 'from' | 'to'>,
): { from: Date; to: Date; label: string } | null {
  const range = getComparisonRange(
    toDateOnlyString(period.from),
    toDateOnlyString(period.to),
    hintForPeriod(period.type),
  );
  if (!range) return null;
  return {
    from: parseDateOnly(range.start),
    to: dayTokenEnd(range.end),
    label: comparisonLabel(range),
  };
}

export interface PreviousPeriodQuery {
  /** `null` turns off the prior query. */
  restaurantId: string | null;
  from: Date;
  to: Date;
  label: string;
}

// The dashboard prior query. With no prior range, send a null restaurant id so the query does not run.
// The hook call stays unconditional, so the dates fall back to the current period.
export function previousPeriodQuery(
  period: Pick<Period, 'type' | 'from' | 'to'>,
  restaurantId: string | null,
): PreviousPeriodQuery {
  const comparison = periodComparison(period);
  if (!comparison) {
    return { restaurantId: null, from: period.from, to: period.to, label: 'vs previous period' };
  }
  return { restaurantId, ...comparison };
}
