/**
 * Unit tests: ShiftTimelineTab's activeOverlay wiring (design doc: docs/superpowers/specs/
 * 2026-07-05-timeline-edit-create-design.md, plan task B3).
 *
 * Verifies:
 *  1. `useValidatedShiftMutations(restaurantId, shifts)` is mounted once with the full-week
 *     `shifts` array (not the day-scoped `dayShifts`) — so overlap/rest-gap validation also
 *     sees adjacent-day shifts (e.g. an overnight shift from the previous day) — and its full
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
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react';
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

const mockDeleteShift = vi.fn();
const mockDeleteShiftAsync = vi.fn();
const mockUseValidatedShiftMutations = vi.fn(() => ({
  validateAndCreate: vi.fn(),
  forceCreate: vi.fn(),
  validateAndCreateAtTime: vi.fn(),
  forceCreateAtTime: vi.fn(),
  validateAndUpdateTime: vi.fn(),
  forceUpdateTime: vi.fn(),
  validateAndUpdateShift: vi.fn(),
  forceUpdateShift: vi.fn(),
  validateAndReassign: vi.fn(),
  forceReassign: vi.fn(),
  deleteShift: mockDeleteShift,
  deleteShiftAsync: mockDeleteShiftAsync,
  validationResult: null,
  clearValidation: vi.fn(),
}));

vi.mock('@/hooks/useValidatedShiftMutations', () => ({
  useValidatedShiftMutations: (...args: unknown[]) => mockUseValidatedShiftMutations(...args),
}));

// ShiftTimelineTab's undo-delete flow (Fix 1) creates the restored shift via
// useCreateShift directly (not the validated pipeline — the shift existed
// moments ago, no re-validation needed). Mocked here so no QueryClientProvider
// is required in this lightweight test harness.
const mockCreateShiftMutateAsync = vi.fn();
vi.mock('@/hooks/useShifts', () => ({
  useCreateShift: () => ({ mutateAsync: mockCreateShiftMutateAsync }),
}));

// useToast — captured so undo-toast assertions don't depend on the real
// shadcn toast dispatcher/state machine.
const mockToast = vi.fn();
vi.mock('@/hooks/use-toast', () => ({
  useToast: () => ({ toast: mockToast }),
}));

// Mock the popover so we can inspect the exact props ShiftTimelineTab passes down,
// without depending on Radix Popover/PopoverAnchor internals.
interface PopoverStubProps {
  activeShift: Shift | null;
  anchorRect?: DOMRect | null;
  onClose: () => void;
  onDelete: (shift: Shift) => void;
  onSaved?: (shift: Shift) => void;
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
    {props.activeShift && (
      <button type="button" onClick={() => props.onDelete(props.activeShift as Shift)}>
        stub-delete
      </button>
    )}
    {props.activeShift && props.onSaved && (
      <button type="button" onClick={() => props.onSaved?.(props.activeShift as Shift)}>
        stub-save
      </button>
    )}
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
    mockDeleteShiftAsync.mockResolvedValue(undefined);
    // Matches the real useToast()'s toast() return shape ({id, dismiss, update})
    // so deleteShiftWithUndo's `const { dismiss } = toast(...)` destructure
    // doesn't throw in tests that don't need to assert on dismiss directly.
    mockToast.mockReturnValue({ id: 'toast-1', dismiss: vi.fn(), update: vi.fn() });
  });

  it('mounts useValidatedShiftMutations once with (restaurantId, shifts)', () => {
    const employees = [makeEmployee('e1', 'Ann')];
    const shifts = [makeShift('s1', 'e1', '2026-01-05T16:00:00Z', '2026-01-05T22:00:00Z')];

    render(<ShiftTimelineTab {...BASE_PROPS} shifts={shifts} employees={employees} />);

    expect(mockUseValidatedShiftMutations).toHaveBeenCalledOnce();
    const [restaurantIdArg, shiftsArg] = mockUseValidatedShiftMutations.mock.calls[0];
    expect(restaurantIdArg).toBe('r1');
    expect(Array.isArray(shiftsArg)).toBe(true);
    expect((shiftsArg as Shift[])[0]?.id).toBe('s1');
  });

  it('mounts useValidatedShiftMutations with the full-week shifts array, not filtered to the selected day (regression: adjacent-day overnight shifts must still be validated)', () => {
    const employees = [makeEmployee('e1', 'Ann')];
    // Selected day defaults to weekDays[0] = '2026-01-05' (today isn't in WEEK_DAYS).
    // `s-overnight` starts the PREVIOUS day (2026-01-04, in America/Chicago) and is
    // therefore excluded by the day-scoped `dayShifts` filter, but must still reach
    // useValidatedShiftMutations so overlap/rest-gap checks against it aren't silently
    // dropped when editing/creating a shift that starts on 2026-01-05.
    const overnightShift = makeShift(
      's-overnight',
      'e1',
      '2026-01-05T04:00:00Z', // 2026-01-04 22:00 America/Chicago (CST, UTC-6)
      '2026-01-05T12:00:00Z', // 2026-01-05 06:00 America/Chicago
    );
    const sameDayShift = makeShift('s1', 'e1', '2026-01-05T16:00:00Z', '2026-01-05T22:00:00Z');
    const shifts = [overnightShift, sameDayShift];

    render(<ShiftTimelineTab {...BASE_PROPS} shifts={shifts} employees={employees} />);

    expect(mockUseValidatedShiftMutations).toHaveBeenCalledOnce();
    const [, shiftsArg] = mockUseValidatedShiftMutations.mock.calls[0];
    const ids = (shiftsArg as Shift[]).map((s) => s.id);
    expect(ids).toContain('s-overnight');
    expect(ids).toContain('s1');
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

  describe('gap-click -> createDraft mapping (E)', () => {
    it('CRITICAL: clicking a short coverage-strip cell opens the create overlay with a null lane context', () => {
      const employees = [makeEmployee('e1', 'Ann')];
      // 1 employee scheduled 10:00-16:00 America/Chicago (16:00Z-22:00Z).
      const shifts = [makeShift('s1', 'e1', '2026-01-05T16:00:00Z', '2026-01-05T22:00:00Z')];

      // Recommend 2 staff for the 10 AM hour — only 1 is scheduled, so that
      // hour renders as a short (delta < 0) coverage-strip cell.
      mockUseWeekStaffingSuggestions.mockReturnValue({
        daySuggestions: new Map([
          [
            '2026-01-05',
            {
              recommendations: [
                {
                  hour: 10,
                  projectedSales: 500,
                  recommendedStaff: 2,
                  estimatedLaborCost: 0,
                  laborPct: 20,
                  overTarget: false,
                },
              ],
            },
          ],
        ]),
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

      render(<ShiftTimelineTab {...BASE_PROPS} shifts={shifts} employees={employees} />);

      const gapCell = screen.getByRole('button', { name: /short 1/i });
      fireEvent.click(gapCell);

      const draftJson = screen.getByTestId('popover-create-draft').textContent;
      expect(draftJson).not.toBe('');
      const draft = JSON.parse(draftJson as string);

      // No lane context: both position and area resolve to null/blank.
      expect(draft.laneContext.position ?? null).toBeNull();
      expect(draft.laneContext.area ?? null).toBeNull();
      expect(draft.values.position).toBe('');
      // The merged range covers the clicked (only-short) 10 AM hour: 10:00-11:00.
      expect(draft.values.startTime).toBe('10:00');
      expect(draft.values.endTime).toBe('11:00');
      expect(draft.businessDate).toBe('2026-01-05');
    });
  });

  describe('visible "Add shift" button (Fix 2)', () => {
    it('opens the create overlay for the selected day with a default range clamped to the window and no lane context', () => {
      const employees = [makeEmployee('e1', 'Ann')];
      // A wide shift (07:00-19:00 local) so the derived window comfortably
      // contains the 10:00-18:00 default range unchanged — this test covers
      // the "no clamping needed" case. The "clamping actually shrinks the
      // range" case is covered by the narrower-window test below.
      const shifts = [makeShift('s1', 'e1', '2026-01-05T13:00:00Z', '2026-01-06T01:00:00Z')];

      render(<ShiftTimelineTab {...BASE_PROPS} shifts={shifts} employees={employees} />);

      fireEvent.click(screen.getByRole('button', { name: 'Add shift' }));

      const draftJson = screen.getByTestId('popover-create-draft').textContent;
      expect(draftJson).toBeTruthy();
      const draft = JSON.parse(draftJson as string);

      // No lane context: laneContext resolves to {position: null, area: null}.
      expect(draft.laneContext).toEqual({ position: null, area: null });
      expect(draft.businessDate).toBe('2026-01-05');

      // Default range is 10:00-18:00, expressed as HH:MM in the built editor values
      // (Fix E — shifted from 09:00-17:00 so it survives unclamped on an empty day,
      // whose fallback window starts at 10:00).
      expect(draft.values.startTime).toBe('10:00');
      expect(draft.values.endTime).toBe('18:00');

      // No anchor rect: the create form renders as a centered Dialog, not an
      // anchored popover, so it's never pinned to the triggering button's rect
      // (anchoring the tall form to a top-row button pushed its submit button
      // below the viewport fold on short screens).
      expect(screen.getByTestId('popover-anchor-present').textContent).toBe('no');
    });

    it('clamps the default range into a narrower window when the day has a short shift', () => {
      const employees = [makeEmployee('e1', 'Ann')];
      // 16:00Z-22:00Z on 2026-01-05 in America/Chicago (UTC-6 in January) is
      // 10:00-16:00 local, so deriveWindow yields {startMin: 600, endMin: 960}
      // — narrower than the 10:00-18:00 (600-1080) default range on the end.
      const shifts = [makeShift('s1', 'e1', '2026-01-05T16:00:00Z', '2026-01-05T22:00:00Z')];

      render(<ShiftTimelineTab {...BASE_PROPS} shifts={shifts} employees={employees} />);

      fireEvent.click(screen.getByRole('button', { name: 'Add shift' }));

      const draftJson = screen.getByTestId('popover-create-draft').textContent;
      expect(draftJson).toBeTruthy();
      const draft = JSON.parse(draftJson as string);

      expect(draft.laneContext).toEqual({ position: null, area: null });
      expect(draft.businessDate).toBe('2026-01-05');

      // Clamped into the 10:00-16:00 window (duration preserved: 6 hours).
      expect(draft.values.startTime).toBe('10:00');
      expect(draft.values.endTime).toBe('16:00');
    });

    it('opens the create overlay with the full default range on a day with zero shifts (Fix E)', () => {
      const employees = [makeEmployee('e1', 'Ann')];
      // No shifts anywhere: deriveWindow has nothing to derive from, so it
      // falls back to a fixed {startMin: 600, endMin: 1380} (10:00-23:00)
      // window. Fix E moved DEFAULT_ADD_RANGE to start at 10:00 (600) instead
      // of 09:00 (540) specifically so it lands fully inside that fallback
      // window and survives unclamped — before the fix, the 09:00 start was
      // before the window's 10:00 start, so clampRangeToWindow silently
      // shifted the whole range later while preserving only its duration,
      // landing on 10:00-18:00 instead of the intended 09:00-17:00.
      render(<ShiftTimelineTab {...BASE_PROPS} shifts={[]} employees={employees} />);

      fireEvent.click(screen.getByRole('button', { name: 'Add shift' }));

      const draftJson = screen.getByTestId('popover-create-draft').textContent;
      expect(draftJson).toBeTruthy();
      const draft = JSON.parse(draftJson as string);

      expect(draft.laneContext).toEqual({ position: null, area: null });
      expect(draft.businessDate).toBe('2026-01-05');

      // Unclamped default range: 10:00-18:00, fully within the 10:00-23:00
      // fallback window, preserving the intended 8-hour default duration.
      expect(draft.values.startTime).toBe('10:00');
      expect(draft.values.endTime).toBe('18:00');
    });
  });

  describe('deleteShiftWithUndo (Fix 1 — await delete before offering undo)', () => {
    it('awaits deleteShiftAsync and shows exactly one toast with an Undo action only after a confirmed successful delete', async () => {
      const employees = [makeEmployee('e1', 'Ann')];
      const shift = makeShift('s1', 'e1', '2026-01-05T16:00:00Z', '2026-01-05T22:00:00Z');
      let resolveDelete: () => void = () => {};
      mockDeleteShiftAsync.mockReturnValue(
        new Promise<void>((resolve) => {
          resolveDelete = resolve;
        }),
      );

      render(<ShiftTimelineTab {...BASE_PROPS} shifts={[shift]} employees={employees} />);

      fireEvent.click(screen.getByRole('button', { name: /Ann/i }));
      fireEvent.click(screen.getByText('stub-delete'));

      expect(mockDeleteShiftAsync).toHaveBeenCalledWith('s1');
      // No toast yet — the delete hasn't resolved.
      expect(mockToast).not.toHaveBeenCalled();

      resolveDelete();
      await waitFor(() => expect(mockToast).toHaveBeenCalledTimes(1));
      const call = mockToast.mock.calls[0][0];
      expect(call.title).toMatch(/shift deleted/i);
      expect(call.action).toBeTruthy();
    });

    it('CRITICAL: a failed delete shows NO undo toast and never calls createShift', async () => {
      const employees = [makeEmployee('e1', 'Ann')];
      const shift = makeShift('s1', 'e1', '2026-01-05T16:00:00Z', '2026-01-05T22:00:00Z');
      mockDeleteShiftAsync.mockRejectedValue(new Error('delete failed'));

      render(<ShiftTimelineTab {...BASE_PROPS} shifts={[shift]} employees={employees} />);

      fireEvent.click(screen.getByRole('button', { name: /Ann/i }));
      fireEvent.click(screen.getByText('stub-delete'));

      await waitFor(() => expect(mockDeleteShiftAsync).toHaveBeenCalledWith('s1'));

      // Give the rejected promise's .catch a tick to run.
      await waitFor(() => {
        // no-op assertion to flush microtasks
        expect(mockDeleteShiftAsync).toHaveBeenCalledTimes(1);
      });

      // The delete mutation's own onError toast is expected to fire elsewhere
      // (useDeleteShift's mutation) — deleteShiftWithUndo itself must NOT show
      // its own "Shift deleted" + Undo toast on failure.
      expect(mockToast).not.toHaveBeenCalled();
      expect(mockCreateShiftMutateAsync).not.toHaveBeenCalled();
    });

    it('Undo re-creates the shift with the exact captured payload, then toasts "Shift restored"', async () => {
      const employees = [makeEmployee('e1', 'Ann')];
      const shift: Shift = {
        ...makeShift('s1', 'e1', '2026-01-05T16:00:00Z', '2026-01-05T22:00:00Z'),
        break_duration: 30,
        notes: 'Cover the rush',
        status: 'scheduled',
        is_published: false,
        source: 'manual',
        shift_template_id: null,
      };
      mockCreateShiftMutateAsync.mockResolvedValue({ ...shift, id: 's1-restored' });

      render(<ShiftTimelineTab {...BASE_PROPS} shifts={[shift]} employees={employees} />);

      fireEvent.click(screen.getByRole('button', { name: /Ann/i }));
      fireEvent.click(screen.getByText('stub-delete'));

      await waitFor(() => expect(mockToast).toHaveBeenCalledTimes(1));
      const { action } = mockToast.mock.calls[0][0];

      // Render the toast action (a ToastAction element) and click it.
      const { getByText } = render(action);
      fireEvent.click(getByText(/undo/i));

      await waitFor(() => expect(mockCreateShiftMutateAsync).toHaveBeenCalledTimes(1));
      const input = mockCreateShiftMutateAsync.mock.calls[0][0];
      expect(input.restaurant_id).toBe('r1');
      expect(input.employee_id).toBe('e1');
      expect(input.start_time).toBe('2026-01-05T16:00:00Z');
      expect(input.end_time).toBe('2026-01-05T22:00:00Z');
      expect(input.position).toBe('Server');
      expect(input.break_duration).toBe(30);
      expect(input.notes).toBe('Cover the rush');
      expect(input.status).toBe('scheduled');
      expect(input.is_published).toBe(false);
      expect(input.source).toBe('manual');
      expect(input.shift_template_id).toBeNull();

      await waitFor(() => expect(mockToast).toHaveBeenCalledTimes(2));
      const restoredCall = mockToast.mock.calls[1][0];
      expect(restoredCall.title).toMatch(/shift restored/i);
    });

    it('published-shift delete still confirms via the popover, then routes through the same undo-toast path', async () => {
      const employees = [makeEmployee('e1', 'Ann')];
      const shift = {
        ...makeShift('s1', 'e1', '2026-01-05T16:00:00Z', '2026-01-05T22:00:00Z'),
        is_published: true,
      };

      render(<ShiftTimelineTab {...BASE_PROPS} shifts={[shift]} employees={employees} />);

      fireEvent.click(screen.getByRole('button', { name: /Ann/i }));
      // The stub popover doesn't re-implement the AlertDialog confirm gate
      // (that's TimelineShiftPopover.test.tsx's job) — it always calls onDelete
      // directly. This test only pins that ShiftTimelineTab wires the SAME
      // onDelete (deleteShiftWithUndo) regardless of published state.
      fireEvent.click(screen.getByText('stub-delete'));

      expect(mockDeleteShiftAsync).toHaveBeenCalledWith('s1');
      await waitFor(() => expect(mockToast).toHaveBeenCalledTimes(1));
    });
  });

  describe('deleteShiftWithUndo — one-shot Undo guard (Fix B)', () => {
    it('CRITICAL: invoking the Undo action twice results in createShift.mutateAsync being called exactly once', async () => {
      const employees = [makeEmployee('e1', 'Ann')];
      const shift = makeShift('s1', 'e1', '2026-01-05T16:00:00Z', '2026-01-05T22:00:00Z');
      mockCreateShiftMutateAsync.mockResolvedValue({ ...shift, id: 's1-restored' });

      render(<ShiftTimelineTab {...BASE_PROPS} shifts={[shift]} employees={employees} />);

      fireEvent.click(screen.getByRole('button', { name: /Ann/i }));
      fireEvent.click(screen.getByText('stub-delete'));

      await waitFor(() => expect(mockToast).toHaveBeenCalledTimes(1));
      const { action } = mockToast.mock.calls[0][0];

      const { getByText } = render(action);
      const undoButton = getByText(/undo/i);
      fireEvent.click(undoButton);
      fireEvent.click(undoButton);

      await waitFor(() => expect(mockCreateShiftMutateAsync).toHaveBeenCalledTimes(1));
      // Give any in-flight microtasks a chance to resolve, then assert it's
      // still exactly one call (no delayed second invocation).
      await new Promise((resolve) => setTimeout(resolve, 0));
      expect(mockCreateShiftMutateAsync).toHaveBeenCalledTimes(1);
    });

    it('dismisses the toast on the first Undo click', async () => {
      const employees = [makeEmployee('e1', 'Ann')];
      const shift = makeShift('s1', 'e1', '2026-01-05T16:00:00Z', '2026-01-05T22:00:00Z');
      mockCreateShiftMutateAsync.mockResolvedValue({ ...shift, id: 's1-restored' });
      const mockDismiss = vi.fn();
      mockToast.mockReturnValue({ dismiss: mockDismiss });

      render(<ShiftTimelineTab {...BASE_PROPS} shifts={[shift]} employees={employees} />);

      fireEvent.click(screen.getByRole('button', { name: /Ann/i }));
      fireEvent.click(screen.getByText('stub-delete'));

      await waitFor(() => expect(mockToast).toHaveBeenCalledTimes(1));
      const { action } = mockToast.mock.calls[0][0];

      const { getByText } = render(action);
      fireEvent.click(getByText(/undo/i));

      expect(mockDismiss).toHaveBeenCalledTimes(1);
    });
  });

  describe('deleteShiftWithUndo — recurrence linkage on Undo (Fix C)', () => {
    it('re-creates ONE shift carrying is_recurring/recurrence_parent_id, without regenerating a series', async () => {
      const employees = [makeEmployee('e1', 'Ann')];
      const shift: Shift = {
        ...makeShift('s1', 'e1', '2026-01-05T16:00:00Z', '2026-01-05T22:00:00Z'),
        is_recurring: true,
        recurrence_parent_id: 'series-parent-1',
        recurrence_pattern: { frequency: 'weekly', daysOfWeek: [1], endDate: '2026-06-01' },
      };
      mockCreateShiftMutateAsync.mockResolvedValue({ ...shift, id: 's1-restored' });

      render(<ShiftTimelineTab {...BASE_PROPS} shifts={[shift]} employees={employees} />);

      fireEvent.click(screen.getByRole('button', { name: /Ann/i }));
      fireEvent.click(screen.getByText('stub-delete'));

      await waitFor(() => expect(mockToast).toHaveBeenCalledTimes(1));
      const { action } = mockToast.mock.calls[0][0];
      const { getByText } = render(action);
      fireEvent.click(getByText(/undo/i));

      await waitFor(() => expect(mockCreateShiftMutateAsync).toHaveBeenCalledTimes(1));
      const input = mockCreateShiftMutateAsync.mock.calls[0][0];

      // Series linkage preserved...
      expect(input.is_recurring).toBe(true);
      expect(input.recurrence_parent_id).toBe('series-parent-1');
      // ...but recurrence_pattern must be OMITTED so useCreateShift's
      // `shift.recurrence_pattern && shift.is_recurring` branch takes the
      // single-insert path (createSingleShift), not createRecurringShifts.
      expect(input.recurrence_pattern).toBeFalsy();
    });
  });

  describe('transient change highlight (Fix 3)', () => {
    afterEach(() => {
      vi.useRealTimers();
    });

    it('highlights the bar after a successful edit-mode save, then clears the highlight after ~2s', () => {
      vi.useFakeTimers();

      const employees = [makeEmployee('e1', 'Ann')];
      const shift = makeShift('s1', 'e1', '2026-01-05T16:00:00Z', '2026-01-05T22:00:00Z');

      render(<ShiftTimelineTab {...BASE_PROPS} shifts={[shift]} employees={employees} />);

      const bar = screen.getByRole('button', { name: /Ann/i });
      expect(bar.className).not.toMatch(/(^| )ring-2( |$)/);

      fireEvent.click(bar);
      fireEvent.click(screen.getByText('stub-save'));

      // Highlight applied immediately after the save commits.
      expect(bar.className).toContain('ring-2');
      expect(bar.className).toContain('ring-ring');

      // Still highlighted just before the 2s window elapses.
      act(() => {
        vi.advanceTimersByTime(1999);
      });
      expect(bar.className).toContain('ring-ring');

      // Cleared once the full 2s has elapsed.
      act(() => {
        vi.advanceTimersByTime(1);
      });
      expect(bar.className).not.toMatch(/(^| )ring-2( |$)/);
    });
  });
});
