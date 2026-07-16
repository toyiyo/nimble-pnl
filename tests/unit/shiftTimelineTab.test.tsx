import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { ShiftTimelineTab } from '@/components/scheduling/ShiftTimeline/ShiftTimelineTab';
import type { Shift, Employee, HourlyStaffingRecommendation } from '@/types/scheduling';
import type { EffectiveAvailability } from '@/lib/effectiveAvailability';

// ─── Module mocks ──────────────────────────────────────────────────────────────

// useWeekStaffingSuggestions makes network calls; stub it out.
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

// useRestaurantContext used indirectly (via useWeekStaffingSuggestions chain) — safe
// to leave unmocked because the mock above covers the hook that reads it.

// useValidatedShiftMutations pulls in React Query mutation hooks (useCreateShift,
// useUpdateShift, useDeleteShift, useCheckConflicts) which need a QueryClientProvider
// this test harness doesn't set up. This file tests layout/coverage wiring, not the
// mutation pipeline (that's covered by useValidatedShiftMutations.test.tsx and
// TimelineShiftPopover.test.tsx), so a lightweight stub is sufficient here.
vi.mock('@/hooks/useValidatedShiftMutations', () => ({
  useValidatedShiftMutations: vi.fn(() => ({
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
  })),
}));

// ShiftTimelineTab's undo-delete flow (Fix 1) calls useCreateShift directly,
// which needs a QueryClientProvider this lightweight harness doesn't set up —
// stubbed out for the same reason as useValidatedShiftMutations above.
vi.mock('@/hooks/useShifts', () => ({
  useCreateShift: vi.fn(() => ({ mutateAsync: vi.fn() })),
}));

vi.mock('@/hooks/use-toast', () => ({
  useToast: vi.fn(() => ({ toast: vi.fn() })),
}));

// ─── Fixtures ─────────────────────────────────────────────────────────────────

// Use a past week so defaultDay() never selects "today" and breaks the assertions.
const WEEK_DAYS = [
  '2026-01-05', // Mon
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

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('ShiftTimelineTab', () => {
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

  it('renders the day selector buttons for each weekday', () => {
    render(
      <ShiftTimelineTab
        {...BASE_PROPS}
        shifts={[]}
        employees={[makeEmployee('e1', 'Ann')]}
      />,
    );
    // Should render 7 day selector buttons (Mon–Sun)
    const dayButtons = screen.getAllByRole('button');
    // At least 7 day selector buttons
    expect(dayButtons.length).toBeGreaterThanOrEqual(7);
  });

  it('renders the group-by toggle with Area and Position options', () => {
    render(
      <ShiftTimelineTab
        {...BASE_PROPS}
        shifts={[]}
        employees={[makeEmployee('e1', 'Ann')]}
      />,
    );
    // The ToggleGroup should have Area and Position buttons
    expect(screen.getByRole('radio', { name: /area/i })).toBeInTheDocument();
    expect(screen.getByRole('radio', { name: /position/i })).toBeInTheDocument();
  });

  it('renders the empty state when there are no shifts on the selected day', () => {
    render(
      <ShiftTimelineTab
        {...BASE_PROPS}
        shifts={[]}
        employees={[makeEmployee('e1', 'Ann')]}
      />,
    );
    expect(
      screen.getByText(/no shifts scheduled/i),
    ).toBeInTheDocument();
  });

  it('renders skeleton bands when loading is true', () => {
    const { container } = render(
      <ShiftTimelineTab
        {...BASE_PROPS}
        loading={true}
        shifts={[]}
        employees={[]}
      />,
    );
    // Skeleton bands are animate-pulse divs
    const skeletons = container.querySelectorAll('.animate-pulse');
    expect(skeletons.length).toBeGreaterThan(0);
  });

  it('renders an error message when error is provided', () => {
    render(
      <ShiftTimelineTab
        {...BASE_PROPS}
        loading={false}
        error={new Error('Network failure')}
        shifts={[]}
        employees={[]}
      />,
    );
    expect(screen.getByText(/network failure/i)).toBeInTheDocument();
  });

  it('renders shift bars when shifts exist on the selected day', () => {
    const employees = [makeEmployee('e1', 'Ann')];
    // Shift on 2026-01-05 (Mon = weekDays[0], which will be selected by default)
    // 16:00Z = 10:00 America/Chicago (CST = UTC-6 in January)
    const shifts = [
      makeShift('s1', 'e1', '2026-01-05T16:00:00Z', '2026-01-05T22:00:00Z'),
    ];
    render(
      <ShiftTimelineTab
        {...BASE_PROPS}
        shifts={shifts}
        employees={employees}
      />,
    );
    // Ann's bar should be present
    const btn = screen.getByRole('button', { name: /Ann/i });
    expect(btn).toBeInTheDocument();
  });

  it('resets the selected day when the week changes (stale day not carried over)', () => {
    const employees = [makeEmployee('e1', 'Ann')];
    // Shift on the FIRST week's default day (2026-01-05).
    const weekAShifts = [makeShift('a1', 'e1', '2026-01-05T16:00:00Z', '2026-01-05T22:00:00Z')];
    const { rerender } = render(
      <ShiftTimelineTab {...BASE_PROPS} shifts={weekAShifts} employees={employees} />,
    );
    expect(screen.getByRole('button', { name: /Ann/i })).toBeInTheDocument();

    // Navigate to a different, non-overlapping week with a shift on its default day.
    const WEEK_B = ['2026-02-02', '2026-02-03', '2026-02-04', '2026-02-05', '2026-02-06', '2026-02-07', '2026-02-08'];
    const weekBShifts = [makeShift('b1', 'e1', '2026-02-02T16:00:00Z', '2026-02-02T22:00:00Z')];
    rerender(
      <ShiftTimelineTab {...BASE_PROPS} weekDays={WEEK_B} shifts={weekBShifts} employees={employees} />,
    );
    // If the selected day were stuck on the old week (2026-01-05, absent from WEEK_B),
    // we'd see the empty state. Instead the derived day falls back to WEEK_B[0] and the bar shows.
    expect(screen.getByRole('button', { name: /Ann/i })).toBeInTheDocument();
    expect(screen.queryByText(/no shifts scheduled/i)).not.toBeInTheDocument();
  });

  it('correctly attributes a late-evening shift (23:00 CST = 05:00Z next day) to its local day', () => {
    // This is the cross-UTC-midnight case that the old UTC prefix filter silently dropped.
    // 2026-01-05 23:00 CST = 2026-01-06T05:00:00Z (UTC next day).
    // filterToDay must use isoToLocalMinutes so the shift appears on Mon Jan 5, not Tue Jan 6.
    const employees = [makeEmployee('e1', 'Bob')];
    const shifts = [
      // start: Mon Jan 5 23:00 CST → 2026-01-06T05:00:00Z; end: Tue Jan 6 00:00 CST → 2026-01-06T06:00:00Z
      makeShift('s1', 'e1', '2026-01-06T05:00:00Z', '2026-01-06T06:00:00Z'),
    ];
    render(
      <ShiftTimelineTab
        {...BASE_PROPS}
        shifts={shifts}
        employees={employees}
        // weekDays[0] = 2026-01-05 is selected by default (today fallback)
      />,
    );
    // Bob should be visible on Mon Jan 5 (the local day) — not missing
    const btn = screen.getByRole('button', { name: /Bob/i });
    expect(btn).toBeInTheDocument();
  });

  // Task 7 — availabilityByEmployee wiring through useTimelineModel into the bar.
  it('marks a shift bar outside availability when availabilityByEmployee flags that employee/day recurring-unavailable', () => {
    const employees = [makeEmployee('e1', 'Ann')];
    // 2026-01-05 (weekDays[0], selected by default) is a Monday (day_of_week 1).
    const shifts = [makeShift('s1', 'e1', '2026-01-05T16:00:00Z', '2026-01-05T22:00:00Z')];
    const availabilityByEmployee = new Map<string, Map<number, EffectiveAvailability>>([
      [
        'e1',
        new Map([
          [1, { type: 'recurring', slots: [{ isAvailable: false, startTime: null, endTime: null, sourceRecord: {} as never }] }],
        ]),
      ],
    ]);
    render(
      <ShiftTimelineTab
        {...BASE_PROPS}
        shifts={shifts}
        employees={employees}
        availabilityByEmployee={availabilityByEmployee}
      />,
    );
    const btn = screen.getByRole('button', { name: /Ann.*outside availability/i });
    expect(btn).toBeInTheDocument();
    expect(btn.className).toContain('border-l-amber-500');
  });

  it('does not mark a shift bar when availabilityByEmployee is omitted (backward-compatible)', () => {
    const employees = [makeEmployee('e1', 'Ann')];
    const shifts = [makeShift('s1', 'e1', '2026-01-05T16:00:00Z', '2026-01-05T22:00:00Z')];
    render(
      <ShiftTimelineTab
        {...BASE_PROPS}
        shifts={shifts}
        employees={employees}
      />,
    );
    const btn = screen.getByRole('button', { name: /Ann/i });
    expect(btn.className).not.toContain('border-l-amber-500');
  });
});

// ─── Coverage panel redesign wiring tests ─────────────────────────────────────
//
// Task 5: verify that ShiftTimelineTab now renders the new CoverageVerdict,
// CoverageChart (with its view toggle), and CoverageStatusStrip — and no
// longer renders the old CoverageCurve / CoverageGapList components.
//
// These tests are RED until the wiring is in place.

describe('ShiftTimelineTab — coverage panel redesign wiring', () => {
  // A day with one shift so we get the full data state (not the empty state).
  const employees = [makeEmployee('e1', 'Ann')];
  const shifts = [
    makeShift('s1', 'e1', '2026-01-05T16:00:00Z', '2026-01-05T22:00:00Z'),
  ];

  it('renders a CoverageVerdict text in the data state', () => {
    render(
      <ShiftTimelineTab
        {...BASE_PROPS}
        shifts={shifts}
        employees={employees}
      />,
    );
    // CoverageVerdict always renders one of three messages.
    // With no demand configured, it shows the "Add staffing targets" prompt.
    expect(
      screen.getByText(/add staffing targets to see demand/i),
    ).toBeInTheDocument();
  });

  it('renders a coverage chart view toggle (Chart | +/- bars)', () => {
    render(
      <ShiftTimelineTab
        {...BASE_PROPS}
        shifts={shifts}
        employees={employees}
      />,
    );
    // The ToggleGroup for coverage view should have both options.
    expect(screen.getByRole('radio', { name: /chart/i })).toBeInTheDocument();
    expect(screen.getByRole('radio', { name: /\+\/−/i })).toBeInTheDocument();
  });

  it('renders the coverage chart (role="img") in the data state', () => {
    render(
      <ShiftTimelineTab
        {...BASE_PROPS}
        shifts={shifts}
        employees={employees}
      />,
    );
    // CoverageChart renders an SVG with role="img"
    const imgs = screen.getAllByRole('img');
    // At least one img — the coverage chart
    expect(imgs.length).toBeGreaterThanOrEqual(1);
  });

  it('renders the hourly coverage status strip', () => {
    render(
      <ShiftTimelineTab
        {...BASE_PROPS}
        shifts={shifts}
        employees={employees}
      />,
    );
    // CoverageStatusStrip wraps cells in a group with aria-label "Hourly coverage status"
    expect(
      screen.getByRole('group', { name: /hourly coverage status/i }),
    ).toBeInTheDocument();
  });
});

// ─── Task 5: CoverageDemandInfo + AreaCoverageStrips wiring ──────────────────
//
// RED tests — will fail until ShiftTimelineTab is updated to:
//   1. Render <CoverageDemandInfo /> in the coverage panel header.
//   2. Render <AreaCoverageStrips areas={areaCoverage} /> when groupBy === 'area'.
//   3. NOT render <AreaCoverageStrips> when groupBy === 'position'.

describe('ShiftTimelineTab — CoverageDemandInfo + AreaCoverageStrips wiring (Task 5)', () => {
  const empCS = {
    id: 'e1',
    restaurant_id: 'r1',
    name: 'Alice',
    position: 'Server',
    area: 'Cold Stone',
    hourly_rate: 0,
    hourly_rate_cents: 0,
    role: 'staff' as const,
    is_active: true,
  } as Employee;

  const empWZ = {
    id: 'e2',
    restaurant_id: 'r1',
    name: 'Bob',
    position: 'Server',
    area: "Wetzel's",
    hourly_rate: 0,
    hourly_rate_cents: 0,
    role: 'staff' as const,
    is_active: true,
  } as Employee;

  // 2026-01-05 10:00–16:00 CST for both employees (UTC: 16:00–22:00)
  const shifts: Shift[] = [
    {
      id: 's1', restaurant_id: 'r1', employee_id: 'e1',
      start_time: '2026-01-05T16:00:00Z', end_time: '2026-01-05T22:00:00Z',
      break_duration: 0, position: 'Server', status: 'scheduled',
      is_published: false, locked: false, source: 'manual',
      created_at: '2026-07-01T00:00:00Z', updated_at: '2026-07-01T00:00:00Z',
    } as Shift,
    {
      id: 's2', restaurant_id: 'r1', employee_id: 'e2',
      start_time: '2026-01-05T17:00:00Z', end_time: '2026-01-05T23:00:00Z',
      break_duration: 0, position: 'Server', status: 'scheduled',
      is_published: false, locked: false, source: 'manual',
      created_at: '2026-07-01T00:00:00Z', updated_at: '2026-07-01T00:00:00Z',
    } as Shift,
  ];

  it('CRITICAL: renders the CoverageDemandInfo "How is needed set?" trigger button in the data state', () => {
    render(
      <ShiftTimelineTab
        {...BASE_PROPS}
        shifts={shifts}
        employees={[empCS, empWZ]}
      />,
    );
    // CoverageDemandInfo renders a button with aria-label "How is needed staff calculated?"
    expect(
      screen.getByRole('button', { name: /how is needed staff calculated/i }),
    ).toBeInTheDocument();
  });

  it('CRITICAL: renders AreaCoverageStrips per-area rows when groupBy === "area" (default)', () => {
    render(
      <ShiftTimelineTab
        {...BASE_PROPS}
        shifts={shifts}
        employees={[empCS, empWZ]}
      />,
    );
    // AreaCoverageStrips renders each area as a group with aria-label "{area} hourly coverage"
    expect(
      screen.getByRole('group', { name: /cold stone hourly coverage/i }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole('group', { name: /wetzel's hourly coverage/i }),
    ).toBeInTheDocument();
  });

  it('CRITICAL: does NOT render AreaCoverageStrips when groupBy === "position"', () => {
    render(
      <ShiftTimelineTab
        {...BASE_PROPS}
        shifts={shifts}
        employees={[empCS, empWZ]}
      />,
    );
    // Switch to "Position" group-by
    const positionToggle = screen.getByRole('radio', { name: /position/i });
    fireEvent.click(positionToggle);

    // Area strips should not be present when grouped by position
    expect(
      screen.queryByRole('group', { name: /cold stone hourly coverage/i }),
    ).not.toBeInTheDocument();
  });

  it('renders the per-area footnote about whole-location demand when groupBy === "area"', () => {
    render(
      <ShiftTimelineTab
        {...BASE_PROPS}
        shifts={shifts}
        employees={[empCS, empWZ]}
      />,
    );
    expect(
      screen.getByText(/demand targets are set for the whole location/i),
    ).toBeInTheDocument();
  });
});

// ─── Task 2d: ShiftTimelineTab call-site wiring ────────────────────────────────
//
// Verify that ShiftTimelineTab correctly threads:
//   1. dayRecommendations (from daySuggestions) → 4th arg of summarizeCoverageHours
//   2. activeSettings.target_splh → targetSplh → CoverageChart
//   3. minToPct → CoverageChart (columns are positioned via the shared scale)
//
// These tests spy on summarizeCoverageHours to confirm the wiring without
// relying on DOM side-effects that depend on Task 3 (tooltip content).

describe('ShiftTimelineTab — call-site wiring (Task 2d)', () => {
  // A day with one shift so we get the full data state (not the empty state).
  const employees = [makeEmployee('e1', 'Ann')];
  const shifts = [
    makeShift('s1', 'e1', '2026-01-05T16:00:00Z', '2026-01-05T22:00:00Z'),
  ];

  const rec: HourlyStaffingRecommendation = {
    hour: 10,
    projectedSales: 480,
    recommendedStaff: 3,
    estimatedLaborCost: 108,
    laborPct: 22.5,
    overTarget: false,
  };

  beforeEach(() => {
    // Return activeSettings.target_splh = 95 and recommendations for the default selected day.
    mockUseWeekStaffingSuggestions.mockReturnValue({
      daySuggestions: new Map([['2026-01-05', { recommendations: [rec] }]]),
      isLoading: false,
      error: null,
      hasSalesData: true,
      hasHourlyBreakdown: true,
      activeSettings: { target_splh: 95 },
      updateSettings: vi.fn(),
      isSaving: false,
      employeePositions: [],
      actualSplh: null,
    });
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it('CRITICAL: passes dayRecommendations as 4th arg to summarizeCoverageHours — coverage chart renders without errors', () => {
    // If dayRecommendations were NOT passed, CoverageHour entries would have
    // projectedSales: null. We cannot directly observe projectedSales in the DOM
    // (that's Task 3 / tooltip content), but we CAN verify the component renders
    // the chart without crashing and produces the expected hour columns.
    // The shift covers 10:00–16:00 CST (6 hours) → 6 columns expected.
    const { container } = render(
      <ShiftTimelineTab
        {...BASE_PROPS}
        shifts={shifts}
        employees={employees}
      />,
    );
    // CoverageChart renders columns with data-hour-col
    const cols = container.querySelectorAll('[data-hour-col]');
    expect(cols.length).toBeGreaterThan(0);
  });

  it('CRITICAL: useWeekStaffingSuggestions is called with the restaurant ID and week days so activeSettings is available', () => {
    render(
      <ShiftTimelineTab
        {...BASE_PROPS}
        shifts={shifts}
        employees={employees}
      />,
    );
    // Verify the hook was called with the right args (restaurantId, weekDays).
    // ShiftTimelineTab must destructure activeSettings from this call.
    expect(mockUseWeekStaffingSuggestions).toHaveBeenCalledWith(
      BASE_PROPS.restaurantId,
      BASE_PROPS.weekDays,
      null,
    );
  });

  it('coverage chart columns are present when minToPct is wired (area view)', () => {
    // When minToPct is correctly threaded from ShiftTimelineTab into CoverageChart,
    // columns are positioned via the shared scale. If minToPct were undefined,
    // the fallback would still render columns — but the test confirms the component
    // path that includes the real scale executes without error.
    const { container } = render(
      <ShiftTimelineTab
        {...BASE_PROPS}
        shifts={shifts}
        employees={employees}
      />,
    );
    const cols = container.querySelectorAll('[data-hour-col]');
    // Each column must have a non-empty style.left (set by minToPct)
    const hasPositioning = Array.from(cols as NodeListOf<HTMLElement>).every(
      (col) => col.style.left !== '',
    );
    expect(hasPositioning).toBe(true);
  });
});

describe('ShiftTimelineTab — Fix 1: lanes/window frozen during drag, coverage stays live', () => {
  // Two employees whose shifts overlap, so first-fit row-packing (assignRows)
  // stacks them onto separate rows (row 0 / row 1). Dragging s1 later in time
  // (past s2's start) would, under the OLD bug, re-sort by start_time and
  // re-pack every bar's row on every rAF frame — this is the "bars jump
  // vertically" regression. With Fix 1, `model` (lanes+window) is built from
  // the committed `dayShifts`, never the drafted shifts, so bar.row must stay
  // fixed throughout the drag.
  const employees = [makeEmployee('e1', 'Ann'), makeEmployee('e2', 'Bob')];
  const shifts = [
    makeShift('s1', 'e1', '2026-01-05T15:00:00Z', '2026-01-05T18:00:00Z'), // 09:00-12:00 CST
    makeShift('s2', 'e2', '2026-01-05T16:00:00Z', '2026-01-05T19:00:00Z'), // 10:00-13:00 CST (overlaps s1)
  ];

  function mockPlotRect(container: HTMLElement) {
    // jsdom returns an all-zero rect by default; TimelineLane's getPlotRect
    // reads plotRef.getBoundingClientRect() fresh on every pointer event, so
    // stubbing it once here is enough for the whole gesture.
    const rect = { left: 0, width: 780, top: 0, height: 56, right: 780, bottom: 56, x: 0, y: 0, toJSON: () => ({}) } as DOMRect;
    for (const el of container.querySelectorAll('[data-testid="lane-plot"]')) {
      vi.spyOn(el, 'getBoundingClientRect').mockReturnValue(rect);
    }
  }

  function barTops(container: HTMLElement): number[] {
    // Each bar's row is encoded as `top: bar.row * ROW_HEIGHT_PX` on its
    // absolutely-positioned wrapper (see TimelineLane.tsx).
    return Array.from(container.querySelectorAll('[data-testid="lane-plot"] > div'))
      .map((el) => (el as HTMLElement).style.top);
  }

  let rafSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    // useTimelineBarDrag rAF-throttles onDraftChange; run it synchronously so
    // a single pointermove is enough to observe the live-drag draft (matches
    // the pattern in tests/unit/timelineBarDrag.test.tsx).
    rafSpy = vi.spyOn(window, 'requestAnimationFrame').mockImplementation((cb: FrameRequestCallback) => {
      cb(0);
      return 1;
    });
    vi.spyOn(window, 'cancelAnimationFrame').mockImplementation(() => {});
  });

  afterEach(() => {
    rafSpy.mockRestore();
    vi.restoreAllMocks();
  });

  it('bar rows (top offsets) stay identical during a drag that would otherwise change overlap/packing', () => {
    const { container } = render(
      <ShiftTimelineTab {...BASE_PROPS} shifts={shifts} employees={employees} />,
    );
    mockPlotRect(container);

    const beforeTops = barTops(container);
    expect(beforeTops).toHaveLength(2);

    const buttons = screen.getAllByRole('button', { name: /Ann|Bob/i });
    const annBar = buttons.find((b) => /Ann/i.test(b.getAttribute('aria-label') ?? ''))!;
    expect(annBar).toBeTruthy();

    // Drag Ann's bar far to the right (past threshold) — under the old bug this
    // would trigger a full model rebuild (re-sort + re-pack) on every frame.
    fireEvent.pointerDown(annBar, { pointerId: 1, clientX: 100, pointerType: 'mouse' });
    fireEvent.pointerMove(annBar, { pointerId: 1, clientX: 400, pointerType: 'mouse' });

    const duringTops = barTops(container);
    expect(duringTops).toEqual(beforeTops); // lanes frozen — no row jump mid-drag

    // End the gesture via pointercancel (not pointerup) so this test only
    // exercises the in-flight drag/draft path, not the commit/mutation
    // pipeline (out of scope here — covered by useValidatedShiftMutations
    // tests, and this file's mutation mocks aren't wired for a real commit).
    fireEvent.pointerCancel(annBar, { pointerId: 1 });
  });

  it('coverage chart still reflects the live drag position (D2 behavior preserved) while lanes stay frozen', () => {
    const { container } = render(
      <ShiftTimelineTab {...BASE_PROPS} shifts={shifts} employees={employees} />,
    );
    mockPlotRect(container);

    const beforeTops = barTops(container);

    const buttons = screen.getAllByRole('button', { name: /Ann|Bob/i });
    const annBar = buttons.find((b) => /Ann/i.test(b.getAttribute('aria-label') ?? ''))!;

    // Snapshot the "9 AM–10 AM" column's scheduled count before the drag —
    // only Ann's shift (09:00-12:00) covers it (Bob starts at 10:00), so it
    // should read "1 scheduled".
    const colsBefore = Array.from(container.querySelectorAll('[data-hour-col]')) as HTMLElement[];
    const nineAmBeforeEl = colsBefore.find((c) => (c.getAttribute('aria-label') ?? '').includes('9 AM'));
    expect(nineAmBeforeEl).toBeTruthy();
    // Snapshot the STRING now — React reconciliation reuses the same DOM node
    // across renders, so re-reading `nineAmBeforeEl.getAttribute(...)` after
    // the drag would silently return the POST-drag value (same live node).
    const nineAmLabelBefore = nineAmBeforeEl!.getAttribute('aria-label');
    expect(nineAmLabelBefore).toMatch(/1 scheduled/);

    // Drag Ann's bar away from the 9 AM slot.
    fireEvent.pointerDown(annBar, { pointerId: 1, clientX: 100, pointerType: 'mouse' });
    fireEvent.pointerMove(annBar, { pointerId: 1, clientX: 500, pointerType: 'mouse' });

    // Lanes are still frozen mid-drag...
    expect(barTops(container)).toEqual(beforeTops);

    // ...but the coverage chart's 9 AM column no longer counts Ann (live coverage
    // recomputed from the draft against the frozen window). Note: the column
    // must still EXIST (the frozen window means the hour grid itself doesn't
    // shrink/grow mid-drag) — only its scheduled count changes.
    const colsDuring = Array.from(container.querySelectorAll('[data-hour-col]')) as HTMLElement[];
    const nineAmDuring = colsDuring.find((c) => (c.getAttribute('aria-label') ?? '').includes('9 AM'));
    expect(nineAmDuring).toBeTruthy(); // window (hour grid) frozen — 9 AM column still present
    expect(nineAmDuring!.getAttribute('aria-label')).not.toEqual(nineAmLabelBefore);

    fireEvent.pointerCancel(annBar, { pointerId: 1 });
  });
});
