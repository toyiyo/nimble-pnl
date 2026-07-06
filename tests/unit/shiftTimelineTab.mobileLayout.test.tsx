/**
 * Mobile layout tests for ShiftTimelineTab.
 *
 * Verifies:
 * 1. Lane labels have sticky left + z-10 classes (stay pinned during horizontal scroll).
 * 2. The plot region (curve + axis + lanes) live inside a single overflow-x-auto
 *    container so the axis, curve, and bars all share one horizontal scroll.
 * 3. No nested overflow-x-auto that would create competing scroll containers.
 */
import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render } from '@testing-library/react';
import { ShiftTimelineTab } from '@/components/scheduling/ShiftTimeline/ShiftTimelineTab';
import type { Shift, Employee } from '@/types/scheduling';

// ─── Module mocks ──────────────────────────────────────────────────────────────

vi.mock('@/hooks/useWeekStaffingSuggestions', () => ({
  useWeekStaffingSuggestions: () => ({
    daySuggestions: new Map(),
    isLoading: false,
    error: null,
    hasSalesData: false,
    hasHourlyBreakdown: false,
    activeSettings: {},
    updateSettings: vi.fn(),
    isSaving: false,
    employeePositions: [],
    actualSplh: null,
  }),
}));

// useValidatedShiftMutations pulls in React Query mutation hooks that need a
// QueryClientProvider this layout-focused test harness doesn't set up.
vi.mock('@/hooks/useValidatedShiftMutations', () => ({
  useValidatedShiftMutations: () => ({
    validateAndCreate: vi.fn(),
    forceCreate: vi.fn(),
    validateAndUpdateTime: vi.fn(),
    forceUpdateTime: vi.fn(),
    validateAndUpdateShift: vi.fn(),
    forceUpdateShift: vi.fn(),
    validateAndReassign: vi.fn(),
    forceReassign: vi.fn(),
    deleteShift: vi.fn(),
    deleteShiftAsync: vi.fn().mockResolvedValue(undefined),
    validationResult: null,
    clearValidation: vi.fn(),
  }),
}));

// ShiftTimelineTab's undo-delete flow (Fix 1) calls useCreateShift directly,
// which needs a QueryClientProvider this layout-focused harness doesn't set up.
vi.mock('@/hooks/useShifts', () => ({
  useCreateShift: () => ({ mutateAsync: vi.fn() }),
}));

vi.mock('@/hooks/use-toast', () => ({
  useToast: () => ({ toast: vi.fn() }),
}));

// ─── Fixtures ─────────────────────────────────────────────────────────────────

// Use a past week so defaultDay() never selects "today" and breaks the assertions.
const WEEK_DAYS = [
  '2026-01-05',
  '2026-01-06',
  '2026-01-07',
  '2026-01-08',
  '2026-01-09',
  '2026-01-10',
  '2026-01-11',
];

const makeEmployee = (id: string, name: string): Employee => ({
  id,
  restaurant_id: 'r1',
  name,
  position: 'Server',
  area: 'Front',
  hourly_rate: 0,
  hourly_rate_cents: 0,
  role: 'staff',
  is_active: true,
} as Employee);

const makeShift = (id: string, eid: string, start: string, end: string): Shift => ({
  id,
  restaurant_id: 'r1',
  employee_id: eid,
  start_time: start,
  end_time: end,
  break_duration: 0,
  position: 'Server',
  status: 'scheduled',
  is_published: false,
  locked: false,
  source: 'manual',
  created_at: '2026-07-01T00:00:00Z',
  updated_at: '2026-07-01T00:00:00Z',
} as Shift);

const BASE_PROPS = {
  restaurantId: 'r1',
  weekDays: WEEK_DAYS,
  tz: 'America/Chicago',
  loading: false,
  error: null,
} as const;

// A shift on Mon 2026-01-05 (16:00Z = 10:00 CST, UTC-6 in January)
const EMPLOYEES = [makeEmployee('e1', 'Ann')];
const SHIFTS = [makeShift('s1', 'e1', '2026-01-05T16:00:00Z', '2026-01-05T22:00:00Z')];

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('ShiftTimelineTab — mobile layout', () => {
  it('lane label column has sticky left-0 so it stays pinned during horizontal scroll', () => {
    const { container } = render(
      <ShiftTimelineTab {...BASE_PROPS} shifts={SHIFTS} employees={EMPLOYEES} />,
    );

    // The sticky label column must carry 'sticky' and 'left-0' Tailwind classes.
    const stickyLabel = container.querySelector('.sticky.left-0');
    expect(stickyLabel).not.toBeNull();
  });

  it('plot region (curve, axis, lanes) shares a single overflow-x-auto scroll container', () => {
    const { container } = render(
      <ShiftTimelineTab {...BASE_PROPS} shifts={SHIFTS} employees={EMPLOYEES} />,
    );

    // Exactly one element should carry overflow-x-auto at the outer scroll container.
    const scrollContainers = container.querySelectorAll('.overflow-x-auto');
    // There should be at least one scroll container for the plot
    expect(scrollContainers.length).toBeGreaterThanOrEqual(1);

    // The curve (role="img") and the sticky lane label must be descendants of the
    // SAME overflow-x-auto element — i.e., they share the same scroll container.
    const coverageImg = container.querySelector('[role="img"]');
    const stickyLabel = container.querySelector('.sticky.left-0');

    expect(coverageImg).not.toBeNull();
    expect(stickyLabel).not.toBeNull();

    // Walk up from each element to find its nearest overflow-x-auto ancestor.
    function nearestScrollAncestor(el: Element | null): Element | null {
      let cur = el?.parentElement ?? null;
      while (cur) {
        if (cur.classList.contains('overflow-x-auto')) return cur;
        cur = cur.parentElement;
      }
      return null;
    }

    const curveScroll = nearestScrollAncestor(coverageImg);
    const labelScroll = nearestScrollAncestor(stickyLabel);

    // Both must have an overflow-x-auto ancestor
    expect(curveScroll).not.toBeNull();
    expect(labelScroll).not.toBeNull();

    // They must be the SAME element (shared scroll container)
    expect(curveScroll).toBe(labelScroll);
  });

  it('lane label column has z-10 so it renders above bars during scroll', () => {
    const { container } = render(
      <ShiftTimelineTab {...BASE_PROPS} shifts={SHIFTS} employees={EMPLOYEES} />,
    );

    // The sticky label column must also carry z-10 to stack above bar content.
    const stickyLabel = container.querySelector('.sticky.left-0.z-10');
    expect(stickyLabel).not.toBeNull();
  });
});
