import { startOfDay, endOfDay, subDays } from 'date-fns';
import type { CriticalAlert } from '@/types/dashboard';

/** The size of the cash runway window, in days. */
export const RUNWAY_WINDOW_DAYS = 30;

/**
 * Return the last RUNWAY_WINDOW_DAYS calendar days, today included.
 * differenceInDays(end, start) + 1 equals RUNWAY_WINDOW_DAYS.
 */
export function getRunwayWindow(now: Date): { start: Date; end: Date } {
  return {
    start: startOfDay(subDays(now, RUNWAY_WINDOW_DAYS - 1)),
    end: endOfDay(now),
  };
}

/**
 * Build the cash runway critical alert from days of cash on hand.
 * Return null when daysOfCash is null, not finite, or outside (0, 30).
 */
export function buildCashRunwayAlert(
  daysOfCash: number | null
): CriticalAlert | null {
  if (
    daysOfCash === null ||
    !Number.isFinite(daysOfCash) ||
    daysOfCash <= 0 ||
    daysOfCash >= RUNWAY_WINDOW_DAYS
  ) {
    return null;
  }

  return {
    id: 'cash-runway',
    type: 'cash',
    severity: daysOfCash < 14 ? 'critical' : 'warning',
    title: `${Math.floor(daysOfCash)} days of cash runway`,
    description: 'Monitor cash flow closely',
    action: { label: 'View Banking', path: '/banking' },
  };
}
