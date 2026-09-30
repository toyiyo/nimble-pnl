import type { BreakEvenData } from '@/types/operatingCosts';
import { formatWholeDollarAmount } from '@/lib/formatWholeDollarAmount';

type BreakEvenHistoryRow = BreakEvenData['history'][number];

export interface DayGridCell {
  date: string;
  dayNumber: number;
  status: BreakEvenHistoryRow['status'];
  isPartial: boolean;
  fillClass: string;
  ariaLabel: string;
}

const MONTH_LABELS = [
  'Jan',
  'Feb',
  'Mar',
  'Apr',
  'May',
  'Jun',
  'Jul',
  'Aug',
  'Sep',
  'Oct',
  'Nov',
  'Dec',
];

const PARTIAL_FILL_CLASS = 'bg-muted-foreground/30';
const ABOVE_FILL_CLASS = 'bg-foreground/80';
const BELOW_FILL_CLASS = 'bg-destructive/60';
const AT_FILL_CLASS = 'bg-muted-foreground/50';

/**
 * Read the day number and the month label from an ISO date string
 * ("2026-09-28"), without a Date object. A Date object can shift the day
 * across a timezone boundary.
 */
function readDateParts(isoDate: string): { dayNumber: number; monthLabel: string } {
  const [, monthText, dayText] = isoDate.split('-');
  const monthIndex = Number.parseInt(monthText, 10) - 1;
  const dayNumber = Number.parseInt(dayText, 10);
  return { dayNumber, monthLabel: MONTH_LABELS[monthIndex] };
}

function buildFillClass(row: BreakEvenHistoryRow): string {
  if (row.isPartial) {
    return PARTIAL_FILL_CLASS;
  }
  if (row.status === 'above') {
    return ABOVE_FILL_CLASS;
  }
  if (row.status === 'below') {
    return BELOW_FILL_CLASS;
  }
  return AT_FILL_CLASS;
}

function buildAriaLabel(row: BreakEvenHistoryRow, monthLabel: string, dayNumber: number): string {
  const dateLabel = `${monthLabel} ${dayNumber}`;
  const salesAmount = formatWholeDollarAmount(row.sales);

  if (row.isPartial) {
    return `${dateLabel}: ${salesAmount} sales so far`;
  }
  if (row.status === 'above') {
    const deltaAmount = formatWholeDollarAmount(Math.abs(row.delta));
    return `${dateLabel}: ${salesAmount} sales, ${deltaAmount} above break-even`;
  }
  if (row.status === 'below') {
    const deltaAmount = formatWholeDollarAmount(Math.abs(row.delta));
    return `${dateLabel}: ${salesAmount} sales, ${deltaAmount} below break-even`;
  }
  return `${dateLabel}: ${salesAmount} sales, at break-even`;
}

/**
 * Map break-even history rows to day grid cell view models.
 * The order of the output matches the order of the input.
 */
export function buildDayGridCells(history: BreakEvenHistoryRow[]): DayGridCell[] {
  return history.map((row) => {
    const { dayNumber, monthLabel } = readDateParts(row.date);
    return {
      date: row.date,
      dayNumber,
      status: row.status,
      isPartial: row.isPartial,
      fillClass: buildFillClass(row),
      ariaLabel: buildAriaLabel(row, monthLabel, dayNumber),
    };
  });
}
