import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';

import { useTemplateHoursLedger } from '@/hooks/useTemplateHoursLedger';
import { useTemplateLinkedShifts } from '@/hooks/useTemplateLinkedShifts';

import type { ShiftTemplate } from '@/types/scheduling';
import type { LinkedShift } from '@/lib/scheduling/templateHoursBuckets';

vi.mock('@/hooks/useTemplateLinkedShifts', () => ({
  useTemplateLinkedShifts: vi.fn(),
}));

// Fixed so bucketTemplateShifts' internal `new Date()` "now" is deterministic
// across every test — fake timers plus a pinned system time.
const NOW = new Date('2026-03-10T12:00:00.000Z');
const TZ = 'UTC';

function template(overrides: Partial<ShiftTemplate> = {}): ShiftTemplate {
  return {
    id: 'tpl-1',
    restaurant_id: 'r1',
    name: 'Morning',
    days: [1, 2, 3, 4, 5],
    start_time: '09:00:00',
    end_time: '17:00:00',
    break_duration: 30,
    position: 'Server',
    capacity: 1,
    area: null,
    is_active: true,
    created_at: '2026-01-01T00:00:00Z',
    updated_at: '2026-01-01T00:00:00Z',
    ...overrides,
  };
}

function shift(overrides: Partial<LinkedShift> & { id: string }): LinkedShift {
  return {
    // Future relative to NOW, and matches the template's stored 09:00-17:00
    // in TZ='UTC' — the "moving" case by default.
    start_time: '2026-03-11T09:00:00Z',
    end_time: '2026-03-11T17:00:00Z',
    is_published: false,
    locked: false,
    employee_id: 'e1',
    employeeName: 'Casey',
    ...overrides,
  };
}

function mockImpact(overrides: Partial<{
  shifts: LinkedShift[];
  pastCount: number;
  isLoading: boolean;
  error: Error | null;
}> = {}) {
  vi.mocked(useTemplateLinkedShifts).mockReturnValue({
    shifts: [],
    pastCount: 0,
    isLoading: false,
    error: null,
    refetch: vi.fn(),
    ...overrides,
  });
}

describe('useTemplateHoursLedger', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(NOW);
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.clearAllMocks();
  });

  describe('debounced preview', () => {
    it('lags the raw input by 300ms', () => {
      mockImpact();
      const { result, rerender } = renderHook(
        (props: { startTime: string; endTime: string }) =>
          useTemplateHoursLedger('r1', undefined, props.startTime, props.endTime, TZ, new Set()),
        { initialProps: { startTime: '09:00', endTime: '17:00' } },
      );

      rerender({ startTime: '10:00', endTime: '18:00' });
      expect(result.current.debouncedStart).toBe('09:00');
      expect(result.current.debouncedEnd).toBe('17:00');

      act(() => { vi.advanceTimersByTime(299); });
      expect(result.current.debouncedStart).toBe('09:00');

      act(() => { vi.advanceTimersByTime(1); });
      expect(result.current.debouncedStart).toBe('10:00');
      expect(result.current.debouncedEnd).toBe('18:00');
    });

    it('settles to the latest value when updates arrive faster than the delay', () => {
      mockImpact();
      const { result, rerender } = renderHook(
        (props: { startTime: string }) =>
          useTemplateHoursLedger('r1', undefined, props.startTime, '17:00', TZ, new Set()),
        { initialProps: { startTime: '09:00' } },
      );

      rerender({ startTime: '09:30' });
      act(() => { vi.advanceTimersByTime(150); });
      rerender({ startTime: '10:00' });
      act(() => { vi.advanceTimersByTime(299); });
      // Neither intermediate value ('09:30') nor the pre-rerender value ever
      // committed — only the latest one does, once its own 300ms elapse.
      expect(result.current.debouncedStart).toBe('09:00');

      act(() => { vi.advanceTimersByTime(1); });
      expect(result.current.debouncedStart).toBe('10:00');
    });
  });

  describe('publishedCount composition', () => {
    // moving bucket: mv1 (unpublished), mv2 (published) — both keep the
    // template's stored 09:00-17:00. drifted bucket: dr1 (unpublished),
    // dr2 (published) — both hand-edited away from 09:00-17:00.
    function fixtureShifts(): LinkedShift[] {
      return [
        shift({ id: 'mv1', start_time: '2026-03-11T09:00:00Z', end_time: '2026-03-11T17:00:00Z', is_published: false }),
        shift({ id: 'mv2', start_time: '2026-03-11T09:00:00Z', end_time: '2026-03-11T17:00:00Z', is_published: true }),
        shift({ id: 'dr1', start_time: '2026-03-11T10:00:00Z', end_time: '2026-03-11T18:00:00Z', is_published: false }),
        shift({ id: 'dr2', start_time: '2026-03-11T11:00:00Z', end_time: '2026-03-11T19:00:00Z', is_published: true }),
      ];
    }

    it('counts only the moving bucket\'s published ids when nothing is opted in', () => {
      mockImpact({ shifts: fixtureShifts() });
      const { result } = renderHook(() =>
        useTemplateHoursLedger('r1', template(), '10:00', '18:00', TZ, new Set()));

      expect(result.current.publishedCount).toBe(1);
    });

    it('raises the count once a published drifted row is opted in — the bug this line fixes', () => {
      mockImpact({ shifts: fixtureShifts() });
      const { result } = renderHook(() =>
        useTemplateHoursLedger('r1', template(), '10:00', '18:00', TZ, new Set(['dr2'])));

      // buckets.publishedMovingIds alone (1) would miss dr2 (also published).
      expect(result.current.publishedCount).toBe(2);
    });

    it('does not raise the count for an opted-in drifted row that is unpublished', () => {
      mockImpact({ shifts: fixtureShifts() });
      const { result } = renderHook(() =>
        useTemplateHoursLedger('r1', template(), '10:00', '18:00', TZ, new Set(['dr1'])));

      expect(result.current.publishedCount).toBe(1);
    });
  });

  describe('selectedDrift filtering', () => {
    it('ignores a selected id absent from buckets.drifted and drops unselected drift rows', () => {
      const shifts = [
        shift({ id: 'mv1', start_time: '2026-03-11T09:00:00Z', end_time: '2026-03-11T17:00:00Z' }),
        shift({ id: 'dr1', start_time: '2026-03-11T10:00:00Z', end_time: '2026-03-11T18:00:00Z', is_published: false }),
        shift({ id: 'dr2', start_time: '2026-03-11T11:00:00Z', end_time: '2026-03-11T19:00:00Z', is_published: true }),
      ];
      mockImpact({ shifts });

      // 'dr1' is a real drifted id; 'not-a-real-id' is not in buckets.drifted
      // at all (e.g. it dropped out on a refetch); 'dr2' is left unselected.
      const { result } = renderHook(() =>
        useTemplateHoursLedger('r1', template(), '10:00', '18:00', TZ, new Set(['dr1', 'not-a-real-id'])));

      // moving (mv1) + selectedDrift (dr1 only — the phantom id contributes
      // nothing, and unselected dr2 contributes nothing).
      expect(result.current.affectedCount).toBe(2);
      // dr1 is unpublished and dr2 (published) was never selected, so no
      // published shift is among the ones actually moving.
      expect(result.current.publishedCount).toBe(0);
    });
  });

  describe('pastCount composition', () => {
    it('sums buckets.past.length and impact.pastCount rather than double-counting', () => {
      const shifts = [
        // Before NOW: bucketed client-side as "past" by bucketTemplateShifts.
        shift({ id: 'p1', start_time: '2026-03-09T09:00:00Z', end_time: '2026-03-09T17:00:00Z' }),
        shift({ id: 'p2', start_time: '2026-03-09T09:00:00Z', end_time: '2026-03-09T17:00:00Z' }),
        shift({ id: 'mv1', start_time: '2026-03-11T09:00:00Z', end_time: '2026-03-11T17:00:00Z' }),
      ];
      // Excluded up front by useTemplateLinkedShifts' server-side cutoff —
      // never fetched as rows, so it cannot appear in buckets.past.
      mockImpact({ shifts, pastCount: 5 });

      const { result } = renderHook(() =>
        useTemplateHoursLedger('r1', template(), '10:00', '18:00', TZ, new Set()));

      const pastLine = result.current.ledger?.untouched.find((l) => l.key === 'past');
      expect(pastLine?.text).toBe('7 past shifts stay as scheduled — payroll has seen them');
    });
  });

  describe('showCascadeChoice', () => {
    const movingShift = [shift({ id: 'mv1', start_time: '2026-03-11T09:00:00Z', end_time: '2026-03-11T17:00:00Z' })];

    it('is false while the impact query is loading', () => {
      mockImpact({ shifts: movingShift, isLoading: true });
      const { result } = renderHook(() =>
        useTemplateHoursLedger('r1', template(), '10:00', '18:00', TZ, new Set()));

      expect(result.current.showCascadeChoice).toBe(false);
    });

    it('is false when the impact query errored', () => {
      mockImpact({ shifts: movingShift, error: new Error('boom') });
      const { result } = renderHook(() =>
        useTemplateHoursLedger('r1', template(), '10:00', '18:00', TZ, new Set()));

      expect(result.current.showCascadeChoice).toBe(false);
    });

    it('is false when nothing is affected', () => {
      mockImpact({ shifts: [] });
      const { result } = renderHook(() =>
        useTemplateHoursLedger('r1', template(), '10:00', '18:00', TZ, new Set()));

      expect(result.current.affectedCount).toBe(0);
      expect(result.current.showCascadeChoice).toBe(false);
    });

    it('is false when the hours did not change', () => {
      mockImpact({ shifts: movingShift });
      const { result } = renderHook(() =>
        useTemplateHoursLedger('r1', template(), '09:00', '17:00', TZ, new Set()));

      expect(result.current.showCascadeChoice).toBe(false);
    });

    it('is true once hours changed, something is affected, and the query has settled', () => {
      mockImpact({ shifts: movingShift });
      const { result } = renderHook(() =>
        useTemplateHoursLedger('r1', template(), '10:00', '18:00', TZ, new Set()));

      expect(result.current.showCascadeChoice).toBe(true);
    });
  });

  describe('create mode (template undefined)', () => {
    it('degenerates to null buckets/ledger, zero counts, and no cascade choice', () => {
      mockImpact({ shifts: [shift({ id: 'mv1' })], pastCount: 3 });
      const { result } = renderHook(() =>
        useTemplateHoursLedger('r1', undefined, '10:00', '18:00', TZ, new Set(['mv1'])));

      expect(result.current.buckets).toBeNull();
      expect(result.current.ledger).toBeNull();
      expect(result.current.affectedCount).toBe(0);
      expect(result.current.publishedCount).toBe(0);
      expect(result.current.hoursChanged).toBe(false);
      expect(result.current.showCascadeChoice).toBe(false);
    });
  });
});
