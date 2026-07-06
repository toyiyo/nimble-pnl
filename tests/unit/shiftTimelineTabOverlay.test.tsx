/**
 * Unit tests: ShiftTimelineTab's activeOverlay wiring (design doc: docs/superpowers/specs/
 * 2026-07-05-timeline-edit-create-design.md, plan task B3).
 *
 * Verifies:
 *  1. `useValidatedShiftMutations(restaurantId, dayShifts)` is mounted once, and its full
 *     return (validateAndCreate/forceCreate included, not just the update/delete slice B2
 *     needed) is available at the ShiftTimelineTab level.
 *  2. Clicking a shift bar opens the single `TimelineShiftPopover` instance with a non-null
 *     `anchorRect` (a real DOMRect from the clicked bar element) — not just `activeShift`.
 *  3. Closing the popover clears both the active shift AND the anchor rect (no stale rect
 *     surviving into the next open).
 *  4. Only one `TimelineShiftPopover` is ever mounted (single-dialog pattern) regardless of
 *     which bar was clicked.
 *
 * `TimelineShiftPopover` is mocked here so we can assert on the exact props ShiftTimelineTab
 * threads through, independent of Radix Popover internals (already covered by
 * TimelineShiftPopover.test.tsx).
 */
import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { ShiftTimelineTab } from '@/components/scheduling/ShiftTimeline/ShiftTimelineTab';
import type { Shift, Employee, HourlyStaffingRecommendation } from '@/types/scheduling';

// ─── Module mocks ──────────────────────────────────────────────────────────────

const mockUseWeekStaffingSuggestions = vi.fn(() => ({
  daySuggestions: new Map<string, { recommendations: HourlyStaffingRecommendation[] }>(),
  isLoading: false,
  error: null,
  hasSalesData: false,
  hasHourlyBreakdown: false,
  activeSettings: null,
  updateSettings: vi.fn(),
  isSaving: false,
  employeePositions: [],
  actualSplh: null,
}));

vi.mock('@/hooks/useWeekStaffingSuggestions', () => ({
  useWeekStaffingSuggestions: (...args: unknown[]) => mockUseWeekStaffingSuggestions(...args),
}));

const mockUseValidatedShiftMutations = vi.fn(() => ({
  validateAndCreate: vi.fn(),
  forceCreate: vi.fn(),
  validateAndCreateAtTime: vi.fn(),
  forceCreateAtTime: vi.fn(),
  validateAndUpdateTime: vi.fn(),
  forceUpdateTime: vi.fn(),
  validateAndReassign: vi.fn(),
  forceReassign: vi.fn(),
  deleteShift: vi.fn(),
  validationResult: null,
  clearValidation: vi.fn(),
}));

vi.mock('@/hooks/useValidatedShiftMutations', () => ({
  useValidatedShiftMutations: (...args: unknown[]) => mockUseValidatedShiftMutations(...args),
}));

// Mock the popover so we can inspect the exact props ShiftTimelineTab passes down,
// without depending on Radix Popover/PopoverAnchor internals.
interface PopoverStubProps {
  activeShift: Shift | null;
  anchorRect?: DOMRect | null;
  onClose: () => void;
  createDraft?: {
    values: { employeeId: string; startTime: string; endTime: string; breakDuration: string; notes: string };
    laneContext: { position?: string | null; area?: string | null };
    businessDate: string;
  } | null;
}

const mockTimelineShiftPopover = vi.fn((props: PopoverStubProps) => (
  <div data-testid="popover-stub">
    <span data-testid="popover-active-shift-id">{props.activeShift?.id ?? ''}</span>
    <span data-testid="popover-anchor-present">{props.anchorRect ? 'yes' : 'no'}</span>
    <span data-testid="popover-create-draft">
      {props.createDraft ? JSON.stringify(props.createDraft) : ''}
    </span>
    <button type="button" onClick={props.onClose}>
      close-popover
    </button>
  </div>
));

vi.mock('@/components/scheduling/ShiftTimeline/TimelineShiftPopover', () => ({
  TimelineShiftPopover: (props: unknown) => mockTimelineShiftPopover(props as PopoverStubProps),
}));

// ─── Fixtures ─────────────────────────────────────────────────────────────────

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

describe('ShiftTimelineTab — activeOverlay wiring (B3)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockUseWeekStaffingSuggestions.mockReturnValue({
      daySuggestions: new Map(),
      isLoading: false,
      error: null,
      hasSalesData: false,
      hasHourlyBreakdown: false,
      activeSettings: null,
      updateSettings: vi.fn(),
      isSaving: false,
      employeePositions: [],
      actualSplh: null,
    });
  });

  it('mounts useValidatedShiftMutations once with (restaurantId, dayShifts)', () => {
    const employees = [makeEmployee('e1', 'Ann')];
    const shifts = [makeShift('s1', 'e1', '2026-01-05T16:00:00Z', '2026-01-05T22:00:00Z')];

    render(<ShiftTimelineTab {...BASE_PROPS} shifts={shifts} employees={employees} />);

    expect(mockUseValidatedShiftMutations).toHaveBeenCalledOnce();
    const [restaurantIdArg, shiftsArg] = mockUseValidatedShiftMutations.mock.calls[0];
    expect(restaurantIdArg).toBe('r1');
    expect(Array.isArray(shiftsArg)).toBe(true);
    expect((shiftsArg as Shift[])[0]?.id).toBe('s1');
  });

  it('renders exactly one TimelineShiftPopover instance with activeShift null before any bar click', () => {
    const employees = [makeEmployee('e1', 'Ann')];
    const shifts = [makeShift('s1', 'e1', '2026-01-05T16:00:00Z', '2026-01-05T22:00:00Z')];

    render(<ShiftTimelineTab {...BASE_PROPS} shifts={shifts} employees={employees} />);

    expect(mockTimelineShiftPopover).toHaveBeenCalledOnce();
    expect(screen.getByTestId('popover-active-shift-id').textContent).toBe('');
    expect(screen.getByTestId('popover-anchor-present').textContent).toBe('no');
  });

  it('clicking a shift bar opens the popover with the matching shift AND a real anchorRect', () => {
    const employees = [makeEmployee('e1', 'Ann')];
    const shifts = [makeShift('s1', 'e1', '2026-01-05T16:00:00Z', '2026-01-05T22:00:00Z')];

    render(<ShiftTimelineTab {...BASE_PROPS} shifts={shifts} employees={employees} />);

    const bar = screen.getByRole('button', { name: /Ann/i });
    fireEvent.click(bar);

    expect(screen.getByTestId('popover-active-shift-id').textContent).toBe('s1');
    // anchorRect must be populated from the clicked bar's own bounding rect —
    // not left as the pre-B3 `undefined`/`null` fallback.
    expect(screen.getByTestId('popover-anchor-present').textContent).toBe('yes');

    // Still exactly one popover instance mounted (single-dialog pattern).
    expect(mockTimelineShiftPopover).toHaveBeenCalled();
    expect(screen.getAllByTestId('popover-stub')).toHaveLength(1);
  });

  it('closing the popover clears both activeShift and anchorRect', () => {
    const employees = [makeEmployee('e1', 'Ann')];
    const shifts = [makeShift('s1', 'e1', '2026-01-05T16:00:00Z', '2026-01-05T22:00:00Z')];

    render(<ShiftTimelineTab {...BASE_PROPS} shifts={shifts} employees={employees} />);

    fireEvent.click(screen.getByRole('button', { name: /Ann/i }));
    expect(screen.getByTestId('popover-active-shift-id').textContent).toBe('s1');
    expect(screen.getByTestId('popover-anchor-present').textContent).toBe('yes');

    fireEvent.click(screen.getByText('close-popover'));

    expect(screen.getByTestId('popover-active-shift-id').textContent).toBe('');
    expect(screen.getByTestId('popover-anchor-present').textContent).toBe('no');
  });

  describe('paint-to-create -> createDraft mapping (C3)', () => {
    it('maps the lane key to laneContext.position when grouped by position', () => {
      const employees = [makeEmployee('e1', 'Ann')];
      const shifts = [makeShift('s1', 'e1', '2026-01-05T16:00:00Z', '2026-01-05T22:00:00Z')];

      render(<ShiftTimelineTab {...BASE_PROPS} shifts={shifts} employees={employees} />);

      // Default groupBy is 'area'; switch to 'position' via the ToggleGroup.
      fireEvent.click(screen.getByRole('radio', { name: /^position$/i }));

      const addShiftButton = screen.getAllByText(/add shift to .* lane/i)[0];
      fireEvent.click(addShiftButton);

      const draftJson = screen.getByTestId('popover-create-draft').textContent;
      expect(draftJson).not.toBe('');
      const draft = JSON.parse(draftJson as string);
      expect(draft.businessDate).toBe('2026-01-05');
      expect(draft.laneContext.position).toBeTruthy();
      expect(draft.laneContext.area ?? null).toBeNull();
      expect(draft.values.startTime).toBeTruthy();
      expect(draft.values.endTime).toBeTruthy();
    });

    it('maps the lane key to laneContext.area when grouped by area', () => {
      const employees = [makeEmployee('e1', 'Ann')];
      const shifts = [makeShift('s1', 'e1', '2026-01-05T16:00:00Z', '2026-01-05T22:00:00Z')];

      render(<ShiftTimelineTab {...BASE_PROPS} shifts={shifts} employees={employees} />);

      // Default groupBy is 'area' already.
      const addShiftButton = screen.getAllByText(/add shift to .* lane/i)[0];
      fireEvent.click(addShiftButton);

      const draftJson = screen.getByTestId('popover-create-draft').textContent;
      expect(draftJson).not.toBe('');
      const draft = JSON.parse(draftJson as string);
      expect(draft.laneContext.area).toBeTruthy();
      expect(draft.laneContext.position ?? null).toBeNull();
    });

    it('clears createDraft when the popover closes', () => {
      const employees = [makeEmployee('e1', 'Ann')];
      const shifts = [makeShift('s1', 'e1', '2026-01-05T16:00:00Z', '2026-01-05T22:00:00Z')];

      render(<ShiftTimelineTab {...BASE_PROPS} shifts={shifts} employees={employees} />);

      const addShiftButton = screen.getAllByText(/add shift to .* lane/i)[0];
      fireEvent.click(addShiftButton);
      expect(screen.getByTestId('popover-create-draft').textContent).not.toBe('');

      fireEvent.click(screen.getByText('close-popover'));
      expect(screen.getByTestId('popover-create-draft').textContent).toBe('');
    });
  });
});
