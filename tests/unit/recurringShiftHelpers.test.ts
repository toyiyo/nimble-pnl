/**
 * Unit Tests: Recurring Shift Helpers
 *
 * Tests all helper functions in recurringShiftHelpers.ts:
 * - isRecurringShift
 * - getSeriesParentId
 * - isSeriesParent
 * - getSeriesShifts
 * - getFollowingShifts
 * - getPastShifts
 * - countLockedShifts
 * - getUnlockedShifts
 * - getShiftsForScope
 * - getScopeDescription
 */

import { describe, it, expect } from 'vitest';
import {
  isRecurringShift,
  getSeriesParentId,
  isSeriesParent,
  getSeriesShifts,
  getFollowingShifts,
  getPastShifts,
  countLockedShifts,
  getUnlockedShifts,
  getShiftsForScope,
  getScopeDescription,
  RecurringActionScope,
} from '@/utils/recurringShiftHelpers';
import { Shift } from '@/types/scheduling';

// Helper to create mock shifts
const createMockShift = (overrides: Partial<Shift> = {}): Shift => ({
  id: 'shift-1',
  restaurant_id: 'rest-123',
  employee_id: 'emp-1',
  start_time: '2026-01-10T09:00:00Z',
  end_time: '2026-01-10T17:00:00Z',
  break_duration: 30,
  position: 'Server',
  status: 'scheduled',
  is_recurring: false,
  is_published: false,
  locked: false,
  created_at: '2026-01-01T00:00:00Z',
  updated_at: '2026-01-01T00:00:00Z',
  ...overrides,
});

describe('recurringShiftHelpers', () => {
  describe('isRecurringShift', () => {
    it('should return true for recurring shift', () => {
      const shift = createMockShift({ is_recurring: true });
      expect(isRecurringShift(shift)).toBe(true);
    });

    it('should return false for non-recurring shift', () => {
      const shift = createMockShift({ is_recurring: false });
      expect(isRecurringShift(shift)).toBe(false);
    });

    it('should return false when is_recurring is undefined', () => {
      const shift = createMockShift({ is_recurring: undefined });
      expect(isRecurringShift(shift)).toBe(false);
    });
  });

  describe('getSeriesParentId', () => {
    it('should return recurrence_parent_id if present (child shift)', () => {
      const shift = createMockShift({
        id: 'child-shift',
        recurrence_parent_id: 'parent-shift',
      });
      expect(getSeriesParentId(shift)).toBe('parent-shift');
    });

    it('should return shift id if no recurrence_parent_id (parent shift)', () => {
      const shift = createMockShift({
        id: 'parent-shift',
        recurrence_parent_id: null,
      });
      expect(getSeriesParentId(shift)).toBe('parent-shift');
    });

    it('should return shift id when recurrence_parent_id is undefined', () => {
      const shift = createMockShift({
        id: 'standalone-shift',
        recurrence_parent_id: undefined,
      });
      expect(getSeriesParentId(shift)).toBe('standalone-shift');
    });
  });

  describe('isSeriesParent', () => {
    it('should return true for parent of recurring series', () => {
      const shift = createMockShift({
        is_recurring: true,
        recurrence_parent_id: null,
      });
      expect(isSeriesParent(shift)).toBe(true);
    });

    it('should return false for child of recurring series', () => {
      const shift = createMockShift({
        is_recurring: true,
        recurrence_parent_id: 'parent-id',
      });
      expect(isSeriesParent(shift)).toBe(false);
    });

    it('should return false for non-recurring shift', () => {
      const shift = createMockShift({
        is_recurring: false,
        recurrence_parent_id: null,
      });
      expect(isSeriesParent(shift)).toBe(false);
    });
  });

  describe('getSeriesShifts', () => {
    const parentShift = createMockShift({
      id: 'parent-1',
      is_recurring: true,
      recurrence_parent_id: null,
      start_time: '2026-01-06T09:00:00Z', // Monday
    });

    const childShift1 = createMockShift({
      id: 'child-1',
      is_recurring: true,
      recurrence_parent_id: 'parent-1',
      start_time: '2026-01-13T09:00:00Z', // Next Monday
    });

    const childShift2 = createMockShift({
      id: 'child-2',
      is_recurring: true,
      recurrence_parent_id: 'parent-1',
      start_time: '2026-01-20T09:00:00Z', // Following Monday
    });

    const unrelatedShift = createMockShift({
      id: 'unrelated-1',
      is_recurring: false,
      recurrence_parent_id: null,
      start_time: '2026-01-07T09:00:00Z',
    });

    const allShifts = [parentShift, childShift1, childShift2, unrelatedShift];

    it('should return all shifts in series for parent shift', () => {
      const result = getSeriesShifts(parentShift, allShifts);
      expect(result).toHaveLength(3);
      expect(result.map((s) => s.id)).toEqual(['parent-1', 'child-1', 'child-2']);
    });

    it('should return all shifts in series for child shift', () => {
      const result = getSeriesShifts(childShift1, allShifts);
      expect(result).toHaveLength(3);
      expect(result.map((s) => s.id)).toEqual(['parent-1', 'child-1', 'child-2']);
    });

    it('should return only the shift for non-recurring shift', () => {
      const result = getSeriesShifts(unrelatedShift, allShifts);
      expect(result).toHaveLength(1);
      expect(result[0].id).toBe('unrelated-1');
    });

    it('should sort shifts by start_time', () => {
      const unorderedShifts = [childShift2, unrelatedShift, parentShift, childShift1];
      const result = getSeriesShifts(parentShift, unorderedShifts);
      expect(result.map((s) => s.id)).toEqual(['parent-1', 'child-1', 'child-2']);
    });

    it('should handle empty shifts array', () => {
      const shift = createMockShift({ is_recurring: true });
      const result = getSeriesShifts(shift, []);
      expect(result).toHaveLength(0);
    });
  });

  describe('getFollowingShifts', () => {
    const parentShift = createMockShift({
      id: 'parent-1',
      is_recurring: true,
      recurrence_parent_id: null,
      start_time: '2026-01-06T09:00:00Z',
    });

    const childShift1 = createMockShift({
      id: 'child-1',
      is_recurring: true,
      recurrence_parent_id: 'parent-1',
      start_time: '2026-01-13T09:00:00Z',
    });

    const childShift2 = createMockShift({
      id: 'child-2',
      is_recurring: true,
      recurrence_parent_id: 'parent-1',
      start_time: '2026-01-20T09:00:00Z',
    });

    const allShifts = [parentShift, childShift1, childShift2];

    it('should return all shifts from parent onwards', () => {
      const result = getFollowingShifts(parentShift, allShifts);
      expect(result).toHaveLength(3);
    });

    it('should return shifts from middle of series onwards', () => {
      const result = getFollowingShifts(childShift1, allShifts);
      expect(result).toHaveLength(2);
      expect(result.map((s) => s.id)).toEqual(['child-1', 'child-2']);
    });

    it('should return only last shift when called on last shift', () => {
      const result = getFollowingShifts(childShift2, allShifts);
      expect(result).toHaveLength(1);
      expect(result[0].id).toBe('child-2');
    });
  });

  describe('getPastShifts', () => {
    const parentShift = createMockShift({
      id: 'parent-1',
      is_recurring: true,
      recurrence_parent_id: null,
      start_time: '2026-01-06T09:00:00Z',
    });

    const childShift1 = createMockShift({
      id: 'child-1',
      is_recurring: true,
      recurrence_parent_id: 'parent-1',
      start_time: '2026-01-13T09:00:00Z',
    });

    const childShift2 = createMockShift({
      id: 'child-2',
      is_recurring: true,
      recurrence_parent_id: 'parent-1',
      start_time: '2026-01-20T09:00:00Z',
    });

    const allShifts = [parentShift, childShift1, childShift2];

    it('should return empty array for first shift in series', () => {
      const result = getPastShifts(parentShift, allShifts);
      expect(result).toHaveLength(0);
    });

    it('should return past shifts for middle shift', () => {
      const result = getPastShifts(childShift1, allShifts);
      expect(result).toHaveLength(1);
      expect(result[0].id).toBe('parent-1');
    });

    it('should return all previous shifts for last shift', () => {
      const result = getPastShifts(childShift2, allShifts);
      expect(result).toHaveLength(2);
      expect(result.map((s) => s.id)).toEqual(['parent-1', 'child-1']);
    });
  });

  describe('countLockedShifts', () => {
    it('should count locked shifts correctly', () => {
      const shifts = [
        createMockShift({ id: 's1', locked: true }),
        createMockShift({ id: 's2', locked: false }),
        createMockShift({ id: 's3', locked: true }),
        createMockShift({ id: 's4', locked: false }),
      ];
      expect(countLockedShifts(shifts)).toBe(2);
    });

    it('should return 0 for empty array', () => {
      expect(countLockedShifts([])).toBe(0);
    });

    it('should return 0 when no shifts are locked', () => {
      const shifts = [
        createMockShift({ id: 's1', locked: false }),
        createMockShift({ id: 's2', locked: false }),
      ];
      expect(countLockedShifts(shifts)).toBe(0);
    });

    it('should count all shifts when all are locked', () => {
      const shifts = [
        createMockShift({ id: 's1', locked: true }),
        createMockShift({ id: 's2', locked: true }),
      ];
      expect(countLockedShifts(shifts)).toBe(2);
    });
  });

  describe('getUnlockedShifts', () => {
    it('should filter to only unlocked shifts', () => {
      const shifts = [
        createMockShift({ id: 's1', locked: true }),
        createMockShift({ id: 's2', locked: false }),
        createMockShift({ id: 's3', locked: true }),
        createMockShift({ id: 's4', locked: false }),
      ];
      const result = getUnlockedShifts(shifts);
      expect(result).toHaveLength(2);
      expect(result.map((s) => s.id)).toEqual(['s2', 's4']);
    });

    it('should return empty array when all shifts are locked', () => {
      const shifts = [
        createMockShift({ id: 's1', locked: true }),
        createMockShift({ id: 's2', locked: true }),
      ];
      expect(getUnlockedShifts(shifts)).toHaveLength(0);
    });

    it('should return all shifts when none are locked', () => {
      const shifts = [
        createMockShift({ id: 's1', locked: false }),
        createMockShift({ id: 's2', locked: false }),
      ];
      const result = getUnlockedShifts(shifts);
      expect(result).toHaveLength(2);
    });
  });

  describe('getShiftsForScope', () => {
    const parentShift = createMockShift({
      id: 'parent-1',
      is_recurring: true,
      recurrence_parent_id: null,
      start_time: '2026-01-06T09:00:00Z',
      locked: false,
    });

    const childShift1 = createMockShift({
      id: 'child-1',
      is_recurring: true,
      recurrence_parent_id: 'parent-1',
      start_time: '2026-01-13T09:00:00Z',
      locked: true, // Locked!
    });

    const childShift2 = createMockShift({
      id: 'child-2',
      is_recurring: true,
      recurrence_parent_id: 'parent-1',
      start_time: '2026-01-20T09:00:00Z',
      locked: false,
    });

    const allShifts = [parentShift, childShift1, childShift2];

    it('should return only the target shift for scope "this"', () => {
      const result = getShiftsForScope(childShift2, allShifts, 'this');
      expect(result.toOperate).toHaveLength(1);
      expect(result.toOperate[0].id).toBe('child-2');
      expect(result.lockedCount).toBe(0);
    });

    it('should return locked count for scope "this" on locked shift', () => {
      const result = getShiftsForScope(childShift1, allShifts, 'this');
      expect(result.toOperate).toHaveLength(0);
      expect(result.lockedCount).toBe(1);
    });

    it('should return following unlocked shifts for scope "following"', () => {
      const result = getShiftsForScope(parentShift, allShifts, 'following');
      expect(result.toOperate).toHaveLength(2);
      expect(result.toOperate.map((s) => s.id)).toEqual(['parent-1', 'child-2']);
      expect(result.lockedCount).toBe(1); // child-1 is locked
    });

    it('should return all unlocked shifts for scope "all"', () => {
      const result = getShiftsForScope(parentShift, allShifts, 'all');
      expect(result.toOperate).toHaveLength(2);
      expect(result.toOperate.map((s) => s.id)).toEqual(['parent-1', 'child-2']);
      expect(result.lockedCount).toBe(1);
    });

    it('should handle unknown scope as "this"', () => {
      const result = getShiftsForScope(childShift2, allShifts, 'unknown' as RecurringActionScope);
      expect(result.toOperate).toHaveLength(1);
      expect(result.toOperate[0].id).toBe('child-2');
    });
  });

  describe('getScopeDescription', () => {
    const shift = createMockShift({
      start_time: '2026-01-10T09:00:00Z', // Saturday, Jan 10
    });

    it('should return description for scope "this"', () => {
      const result = getScopeDescription('this', shift, 5);
      expect(result).toContain('Only this shift');
      expect(result).toContain('Jan');
      expect(result).toContain('10');
    });

    it('should return description for scope "following"', () => {
      const result = getScopeDescription('following', shift, 5);
      expect(result).toBe('This and all future shifts');
    });

    it('should return description for scope "all" with count', () => {
      const result = getScopeDescription('all', shift, 5);
      expect(result).toBe('All 5 shifts in the series');
    });

    it('should return empty string for unknown scope', () => {
      const result = getScopeDescription('unknown' as RecurringActionScope, shift, 5);
      expect(result).toBe('');
    });
  });

  describe('Edge Cases', () => {
    it('should handle shifts with same start time', () => {
      const shift1 = createMockShift({
        id: 's1',
        is_recurring: true,
        recurrence_parent_id: null,
        start_time: '2026-01-10T09:00:00Z',
      });
      const shift2 = createMockShift({
        id: 's2',
        is_recurring: true,
        recurrence_parent_id: 's1',
        start_time: '2026-01-10T09:00:00Z', // Same start time
      });
      const allShifts = [shift1, shift2];

      const result = getSeriesShifts(shift1, allShifts);
      expect(result).toHaveLength(2);
    });

    it('should handle series with all shifts locked', () => {
      const shifts = [
        createMockShift({
          id: 'p1',
          is_recurring: true,
          recurrence_parent_id: null,
          locked: true,
        }),
        createMockShift({
          id: 'c1',
          is_recurring: true,
          recurrence_parent_id: 'p1',
          locked: true,
        }),
      ];

      const result = getShiftsForScope(shifts[0], shifts, 'all');
      expect(result.toOperate).toHaveLength(0);
      expect(result.lockedCount).toBe(2);
    });

    it('should handle non-recurring shift in getShiftsForScope', () => {
      const nonRecurring = createMockShift({
        id: 'standalone',
        is_recurring: false,
        locked: false,
      });

      const result = getShiftsForScope(nonRecurring, [nonRecurring], 'all');
      expect(result.toOperate).toHaveLength(1);
      expect(result.lockedCount).toBe(0);
    });
  });
});
