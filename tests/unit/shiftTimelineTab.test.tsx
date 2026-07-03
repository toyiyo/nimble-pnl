import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { ShiftTimelineTab } from '@/components/scheduling/ShiftTimeline/ShiftTimelineTab';
import type { Shift, Employee } from '@/types/scheduling';

// ─── Module mocks ──────────────────────────────────────────────────────────────

// useWeekStaffingSuggestions makes network calls; stub it out.
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

// useRestaurantContext used indirectly (via useWeekStaffingSuggestions chain) — safe
// to leave unmocked because the mock above covers the hook that reads it.

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
