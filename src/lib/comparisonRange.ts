// Prior-period range for the sales comparison.
// All math uses YYYY-MM-DD strings and Date.UTC. No host time zone is used.

import { toDateOnlyString } from '@/lib/dateOnly';

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
    return build(s, monthsBack(s, 3), monthsBack(e, 3), 'quarter');
  }

  // Rule 4: month.
  if (s.d === 1 && sameMonth) {
    return build(s, monthsBack(s, 1), monthsBack(e, 1), 'month');
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

const HINT_BY_PERIOD: Record<string, ComparisonKind | undefined> = {
  today: 'shift',
  last30: 'shift',
  last90: 'shift',
  week: 'week',
  month: 'month',
  quarter: 'quarter',
};

function fromDateOnly(value: string, endOfDay: boolean): Date {
  const [y, m, d] = value.split('-').map(Number);
  return endOfDay ? new Date(y, m - 1, d, 23, 59, 59, 999) : new Date(y, m - 1, d, 0, 0, 0, 0);
}

// Adapter for the dashboard. Convert a Period to the local Date pair of the prior range.
export function periodComparison(period: {
  type: string;
  from: Date;
  to: Date;
}): { from: Date; to: Date; label: string } | null {
  const range = getComparisonRange(
    toDateOnlyString(period.from),
    toDateOnlyString(period.to),
    HINT_BY_PERIOD[period.type],
  );
  if (!range) return null;
  return {
    from: fromDateOnly(range.start, false),
    to: fromDateOnly(range.end, true),
    label: comparisonLabel(range),
  };
}
