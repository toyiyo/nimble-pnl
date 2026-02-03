import { Shift } from '@/types/scheduling';

/**
 * Scope options for recurring shift operations (Google Calendar pattern)
 */
export type RecurringActionScope = 'this' | 'following' | 'all';

/**
 * Check if a shift is part of a recurring series
 */
export function isRecurringShift(shift: Shift): boolean {
  return shift.is_recurring === true;
}

/**
 * Get the parent ID of a shift (either its own ID if it's the parent, or recurrence_parent_id)
 */
export function getSeriesParentId(shift: Shift): string {
  return shift.recurrence_parent_id || shift.id;
}

/**
 * Check if a shift is the parent of a series
 */
export function isSeriesParent(shift: Shift): boolean {
  return shift.is_recurring === true && !shift.recurrence_parent_id;
}

/**
 * Get all shifts belonging to the same series as the given shift
 */
export function getSeriesShifts(shift: Shift, allShifts: Shift[]): Shift[] {
  if (!isRecurringShift(shift)) return [shift];

  const parentId = getSeriesParentId(shift);

  return allShifts
    .filter(s => s.id === parentId || s.recurrence_parent_id === parentId)
    .sort((a, b) => new Date(a.start_time).getTime() - new Date(b.start_time).getTime());
}

/**
 * Get shifts in the series that are on or after the given shift's date
 * Used for "This and following shifts" operations
 */
export function getFollowingShifts(shift: Shift, allShifts: Shift[]): Shift[] {
  const seriesShifts = getSeriesShifts(shift, allShifts);
  const shiftStart = new Date(shift.start_time).getTime();

  return seriesShifts.filter(s => new Date(s.start_time).getTime() >= shiftStart);
}

/**
 * Get shifts in the series that are before the given shift's date
 * Used for preserving past shifts in "This and following" operations
 */
export function getPastShifts(shift: Shift, allShifts: Shift[]): Shift[] {
  const seriesShifts = getSeriesShifts(shift, allShifts);
  const shiftStart = new Date(shift.start_time).getTime();

  return seriesShifts.filter(s => new Date(s.start_time).getTime() < shiftStart);
}

/**
 * Count locked shifts in an array
 */
export function countLockedShifts(shifts: Shift[]): number {
  return shifts.filter(s => s.locked).length;
}

/**
 * Filter to only unlocked shifts
 */
export function getUnlockedShifts(shifts: Shift[]): Shift[] {
  return shifts.filter(s => !s.locked);
}

/**
 * Get shifts to operate on based on scope, excluding locked shifts
 */
export function getShiftsForScope(
  shift: Shift,
  allShifts: Shift[],
  scope: RecurringActionScope
): { toOperate: Shift[]; lockedCount: number } {
  let targetShifts: Shift[];

  switch (scope) {
    case 'this':
      targetShifts = [shift];
      break;
    case 'following':
      targetShifts = getFollowingShifts(shift, allShifts);
      break;
    case 'all':
      targetShifts = getSeriesShifts(shift, allShifts);
      break;
    default:
      targetShifts = [shift];
  }

  const lockedCount = countLockedShifts(targetShifts);
  const toOperate = getUnlockedShifts(targetShifts);

  return { toOperate, lockedCount };
}

/**
 * Get a human-readable description for the scope option
 */
export function getScopeDescription(
  scope: RecurringActionScope,
  shift: Shift,
  totalCount: number
): string {
  const shiftDate = new Date(shift.start_time).toLocaleDateString('en-US', {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
  });

  switch (scope) {
    case 'this':
      return `Only this shift on ${shiftDate}`;
    case 'following':
      return `This and all future shifts`;
    case 'all':
      return `All ${totalCount} shifts in the series`;
    default:
      return '';
  }
}
