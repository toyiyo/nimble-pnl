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

const WEEK_DAYS = [
  '2026-07-06', // Mon
  '2026-07-07',
  '2026-07-08',
  '2026-07-09',
  '2026-07-10',
  '2026-07-11',
  '2026-07-12',
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
    // Shift on 2026-07-06 (Mon = weekDays[0], which will be selected by default)
    // 15:00Z = 10:00 America/Chicago (CDT = UTC-5)
    const shifts = [
      makeShift('s1', 'e1', '2026-07-06T15:00:00Z', '2026-07-06T21:00:00Z'),
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
});
