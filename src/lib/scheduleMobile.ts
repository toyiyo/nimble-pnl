import { isSameDay } from 'date-fns';

/**
 * Picks which day the mobile day-focused schedule view should default to:
 * today's index within the displayed week, or 0 (first day) when today
 * falls outside the week (e.g. viewing a past/future week) or the week is
 * empty.
 */
export function pickDefaultMobileDay(weekDays: Date[], today: Date): number {
  const index = weekDays.findIndex((day) => isSameDay(day, today));
  return index === -1 ? 0 : index;
}
