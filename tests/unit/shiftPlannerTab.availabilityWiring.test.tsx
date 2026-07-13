/**
 * Tests that ShiftPlannerTab fetches availability exceptions, folds them
 * together with recurring availability via `computeEffectiveAvailability`,
 * and threads the resulting per-employee effective-availability map (plus
 * the restaurant timezone) into EmployeeSidebar and ShiftTimelineTab.
 *
 * EmployeeSidebar and ShiftTimelineTab are mocked to plain spy components so
 * this test only pins ShiftPlannerTab's wiring contract — it does not assert
 * anything about how the sidebar/timeline render the map (that's Tasks 5–7).
 */
import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ShiftPlannerTab } from '@/components/scheduling/ShiftPlanner/ShiftPlannerTab';
import type { EffectiveAvailability } from '@/lib/effectiveAvailability';

// ─── Spies on the props ShiftPlannerTab hands down ─────────────────────────────

const employeeSidebarSpy = vi.fn();
const timelineTabSpy = vi.fn();

vi.mock('@/components/scheduling/ShiftPlanner/EmployeeSidebar', () => ({
  EmployeeSidebar: (props: Record<string, unknown>) => {
    employeeSidebarSpy(props);
    return <div data-testid="employee-sidebar" />;
  },
}));

vi.mock('@/components/scheduling/ShiftTimeline/ShiftTimelineTab', () => ({
  ShiftTimelineTab: (props: Record<string, unknown>) => {
    timelineTabSpy(props);
    return <div data-testid="shift-timeline-tab" />;
  },
}));

// ─── Mock all heavy hook dependencies (pattern from shiftPlannerTab.viewToggle.test.tsx) ──

// 2027-07-12 is a fixed Monday (used elsewhere in this plan's pgTAP fixtures).
// Constructed via local Date components (no "Z") so `.getDay()` is stable
// regardless of the host machine's timezone.
const WEEK_START = new Date(2027, 6, 12);
const WEEK_DAYS = [
  '2027-07-12', '2027-07-13', '2027-07-14', '2027-07-15',
  '2027-07-16', '2027-07-17', '2027-07-18',
];

vi.mock('@/hooks/useShiftPlanner', async () => {
  const actual = await vi.importActual('@/hooks/useShiftPlanner') as Record<string, unknown>;
  return {
    ...actual,
    useShiftPlanner: () => ({
      weekStart: WEEK_START,
      weekEnd: new Date(2027, 6, 18, 23, 59, 59),
      weekDays: WEEK_DAYS,
      goToNextWeek: vi.fn(),
      goToPrevWeek: vi.fn(),
      goToToday: vi.fn(),
      shifts: [],
      employees: [{ id: 'e1', restaurant_id: 'r1', name: 'Ann', position: 'Server', area: 'Front', is_active: true }],
      isLoading: false,
      error: null,
      validateAndCreate: vi.fn(),
      forceCreate: vi.fn(),
      deleteShift: vi.fn(),
      validationResult: null,
      clearValidation: vi.fn(),
      totalHours: 0,
    }),
  };
});

vi.mock('@/hooks/useShiftTemplates', async () => {
  const actual = await vi.importActual('@/hooks/useShiftTemplates') as Record<string, unknown>;
  return {
    ...actual,
    useShiftTemplates: () => ({
      templates: [],
      loading: false,
      createTemplate: vi.fn(),
      updateTemplate: vi.fn(),
      hideTemplate: vi.fn(),
      restoreTemplate: vi.fn(),
    }),
  };
});

// Monday (day_of_week = 1) recurring availability, stored UTC-clock 18:00–02:00.
const FIXTURE_AVAILABILITY = [
  {
    id: 'a1', restaurant_id: 'r1', employee_id: 'e1', day_of_week: 1,
    is_available: true, start_time: '18:00:00', end_time: '02:00:00',
    created_at: '', updated_at: '',
  },
];
// Tuesday 2027-07-13 exception overrides the (absent) Tuesday recurring row.
const FIXTURE_EXCEPTIONS = [
  {
    id: 'x1', restaurant_id: 'r1', employee_id: 'e1', date: '2027-07-13',
    is_available: false, reason: 'Sick', created_at: '', updated_at: '',
  },
];

const useAvailabilityExceptionsSpy = vi.fn(() => ({ exceptions: FIXTURE_EXCEPTIONS, loading: false }));

vi.mock('@/hooks/useAvailability', () => ({
  useEmployeeAvailability: () => ({ availability: FIXTURE_AVAILABILITY, loading: false }),
  useAvailabilityExceptions: (...args: unknown[]) => useAvailabilityExceptionsSpy(...(args as [])),
}));

vi.mock('@/contexts/RestaurantContext', () => ({
  useRestaurantContext: () => ({
    selectedRestaurant: {
      restaurant: { id: 'r1', name: 'Test Restaurant', timezone: 'America/Chicago' },
    },
  }),
}));

vi.mock('@/hooks/usePlannerShiftsIndex', () => ({
  usePlannerShiftsIndex: () => ({
    coverageByDay: new Map(),
    overviewDays: [],
    shiftsByEmployee: new Map(),
  }),
}));

const mockIsMobile = vi.fn(() => false);
vi.mock('@/hooks/use-mobile', () => ({
  useIsMobile: () => mockIsMobile(),
}));

vi.mock('@/hooks/use-toast', () => ({
  useToast: () => ({ toast: vi.fn() }),
}));

vi.mock('@/hooks/useGenerateSchedule', async () => {
  const actual = await vi.importActual('@/hooks/useGenerateSchedule') as Record<string, unknown>;
  return {
    ...actual,
    useGenerateSchedule: () => ({
      mutate: vi.fn(),
      isPending: false,
    }),
  };
});

vi.mock('@/hooks/useWeekStaffingSuggestions', () => ({
  useWeekStaffingSuggestions: () => ({
    daySuggestions: new Map(),
    isLoading: false,
    error: null,
  }),
}));

vi.mock('@/components/scheduling/ShiftPlanner/StaffingOverlay', () => ({
  StaffingOverlay: () => <div data-testid="staffing-overlay" />,
}));

vi.mock('@/components/scheduling/ShiftPlanner/GenerateScheduleDialog', () => ({
  GenerateScheduleDialog: () => null,
}));

// ─── Fixtures ─────────────────────────────────────────────────────────────────

const DEFAULT_PROPS = {
  restaurantId: 'r1',
  weekStart: WEEK_START,
  onWeekStartChange: vi.fn(),
} as const;

function renderTab(props = DEFAULT_PROPS) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <ShiftPlannerTab {...props} />
    </QueryClientProvider>,
  );
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('ShiftPlannerTab — availability wiring', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useAvailabilityExceptionsSpy.mockReturnValue({ exceptions: FIXTURE_EXCEPTIONS, loading: false });
    mockIsMobile.mockReturnValue(false);
  });

  it('fetches exceptions for the restaurant', () => {
    renderTab();
    expect(useAvailabilityExceptionsSpy).toHaveBeenCalledWith('r1');
  });

  it('passes an effective-availability map + restaurant timezone to EmployeeSidebar', () => {
    renderTab();

    expect(employeeSidebarSpy).toHaveBeenCalled();
    const props = employeeSidebarSpy.mock.calls[0][0] as {
      timezone: string;
      availabilityByEmployee: Map<string, Map<number, EffectiveAvailability>>;
    };
    expect(props.timezone).toBe('America/Chicago');
    expect(props.availabilityByEmployee).toBeInstanceOf(Map);

    const empMap = props.availabilityByEmployee.get('e1');
    expect(empMap).toBeInstanceOf(Map);

    // Monday (dow 1): recurring window from FIXTURE_AVAILABILITY.
    const monday = empMap?.get(1);
    expect(monday?.type).toBe('recurring');
    expect(monday?.slots[0]?.isAvailable).toBe(true);

    // Tuesday (dow 2, date 2027-07-13): overridden by FIXTURE_EXCEPTIONS.
    const tuesday = empMap?.get(2);
    expect(tuesday?.type).toBe('exception');
    expect(tuesday?.slots[0]?.isAvailable).toBe(false);
  });

  it('passes the same effective-availability map to ShiftTimelineTab in Timeline view', () => {
    renderTab();
    fireEvent.click(screen.getByRole('radio', { name: /^timeline$/i }));

    expect(timelineTabSpy).toHaveBeenCalled();
    const lastCall = timelineTabSpy.mock.calls[timelineTabSpy.mock.calls.length - 1];
    const props = lastCall[0] as { availabilityByEmployee: Map<string, Map<number, EffectiveAvailability>> };
    expect(props.availabilityByEmployee).toBeInstanceOf(Map);
    expect(props.availabilityByEmployee.get('e1')).toBeInstanceOf(Map);
  });
});
