/**
 * Tests that ShiftPlannerTab builds the shift-conflict index (time-off +
 * availability) and threads it into TemplateGrid and PlannerHeader, with
 * the load and error rules from the design:
 * - query loads  -> empty map, no count (no partial indicator);
 * - query errors -> conflictsUnavailable, empty map (no false all-clear).
 *
 * TemplateGrid and PlannerHeader are mocked to spy components — this test
 * pins the tab's wiring contract only; the render of the badge/pill is
 * covered by the component tests.
 */
import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { TooltipProvider } from '@/components/ui/tooltip';
import { ShiftPlannerTab } from '@/components/scheduling/ShiftPlanner/ShiftPlannerTab';

// ─── Spies on the props ShiftPlannerTab hands down ────────────────────────────

const templateGridSpy = vi.fn();
const plannerHeaderSpy = vi.fn();

vi.mock('@/components/scheduling/ShiftPlanner/TemplateGrid', () => ({
  TemplateGrid: (props: Record<string, unknown>) => {
    templateGridSpy(props);
    return <div data-testid="template-grid" />;
  },
}));

vi.mock('@/components/scheduling/ShiftPlanner/PlannerHeader', () => ({
  PlannerHeader: (props: Record<string, unknown>) => {
    plannerHeaderSpy(props);
    return <div data-testid="planner-header" />;
  },
}));

vi.mock('@/components/scheduling/ShiftPlanner/EmployeeSidebar', () => ({
  EmployeeSidebar: () => <div data-testid="employee-sidebar" />,
}));

vi.mock('@/components/scheduling/ShiftTimeline/ShiftTimelineTab', () => ({
  ShiftTimelineTab: () => <div data-testid="shift-timeline-tab" />,
}));

// ─── Fixed week (Monday 2027-07-12), restaurant tz America/Chicago ───────────

const WEEK_START = new Date(2027, 6, 12);
const WEEK_DAYS = [
  '2027-07-12', '2027-07-13', '2027-07-14', '2027-07-15',
  '2027-07-16', '2027-07-17', '2027-07-18',
];

// Tuesday noon-8pm CDT as UTC instants (CDT = UTC-5 in July).
const SHIFT = {
  id: 'shift-tue',
  restaurant_id: 'r1',
  employee_id: 'e1',
  start_time: '2027-07-13T17:00:00Z',
  end_time: '2027-07-14T01:00:00Z',
  break_duration: 0,
  position: 'Server',
  status: 'scheduled',
  is_published: false,
  locked: false,
  source: 'manual',
  created_at: '',
  updated_at: '',
  employee: { id: 'e1', name: 'Ann', restaurant_id: 'r1' },
};

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
      shifts: [SHIFT],
      employees: [{ id: 'e1', restaurant_id: 'r1', name: 'Ann', position: 'Server', area: 'Front', is_active: true }],
      isLoading: false,
      error: null,
      validateAndCreate: vi.fn(),
      forceCreate: vi.fn(),
      deleteShift: vi.fn(),
      validationResult: null,
      clearValidation: vi.fn(),
      totalHours: 8,
    }),
  };
});

// One active template so the tab renders TemplateGrid, not the
// "No shift templates yet" empty state.
const FIXTURE_TEMPLATE = {
  id: 't1', restaurant_id: 'r1', name: 'Lunch', days: [1, 2, 3, 4, 5],
  start_time: '12:00:00', end_time: '20:00:00', break_duration: 0,
  position: 'Server', capacity: 1, area: 'Front', is_active: true,
  created_at: '', updated_at: '',
};

vi.mock('@/hooks/useShiftTemplates', async () => {
  const actual = await vi.importActual('@/hooks/useShiftTemplates') as Record<string, unknown>;
  return {
    ...actual,
    useShiftTemplates: () => ({
      templates: [FIXTURE_TEMPLATE],
      loading: false,
      createTemplate: vi.fn(),
      updateTemplate: vi.fn(),
      hideTemplate: vi.fn(),
      restoreTemplate: vi.fn(),
    }),
  };
});

const useEmployeeAvailabilitySpy = vi.fn(
  (): SpyQueryState<'availability', never> => ({
    availability: [],
    loading: false,
    error: null,
  }),
);
const useAvailabilityExceptionsSpy = vi.fn(
  (): SpyQueryState<'exceptions', never> => ({
    exceptions: [],
    loading: false,
    error: null,
  }),
);

vi.mock('@/hooks/useAvailability', () => ({
  useEmployeeAvailability: () => useEmployeeAvailabilitySpy(),
  useAvailabilityExceptions: () => useAvailabilityExceptionsSpy(),
}));

// Approved time-off covering the shift's Tuesday.
const FIXTURE_TIME_OFF = [
  {
    id: 'to1', restaurant_id: 'r1', employee_id: 'e1',
    start_date: '2027-07-13', end_date: '2027-07-14',
    status: 'approved', requested_at: '', created_at: '', updated_at: '',
  },
];

type SpyQueryState<K extends string, T> = { [P in K]: T[] } & {
  loading: boolean;
  error: Error | null;
};

const useTimeOffRequestsSpy = vi.fn(
  (): SpyQueryState<'timeOffRequests', (typeof FIXTURE_TIME_OFF)[number]> => ({
    timeOffRequests: FIXTURE_TIME_OFF,
    loading: false,
    error: null,
  }),
);

vi.mock('@/hooks/useTimeOffRequests', async () => {
  const actual = await vi.importActual('@/hooks/useTimeOffRequests') as Record<string, unknown>;
  return {
    ...actual,
    useTimeOffRequests: (...args: unknown[]) => useTimeOffRequestsSpy(...(args as [])),
  };
});

vi.mock('@/contexts/RestaurantContext', () => ({
  useRestaurantContext: () => ({
    selectedRestaurant: {
      restaurant: { id: 'r1', name: 'Test Restaurant', timezone: 'America/Chicago' },
    },
  }),
}));

vi.mock('@/hooks/use-mobile', () => ({
  useIsMobile: () => false,
}));

vi.mock('@/hooks/use-toast', () => ({
  useToast: () => ({ toast: vi.fn() }),
}));

vi.mock('@/hooks/useGenerateSchedule', async () => {
  const actual = await vi.importActual('@/hooks/useGenerateSchedule') as Record<string, unknown>;
  return {
    ...actual,
    useGenerateSchedule: () => ({ mutate: vi.fn(), isPending: false }),
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

// ─── Render helper ────────────────────────────────────────────────────────────

const DEFAULT_PROPS = {
  restaurantId: 'r1',
  weekStart: WEEK_START,
  onWeekStartChange: vi.fn(),
  guardShiftChange: vi.fn(async ({ run }: { run: (options: { allowPublished: boolean }) => void | Promise<void> }) => {
    await run({ allowPublished: false });
  }),
  notifyAfterDeferredCommit: vi.fn(),
} as const;

function renderTab() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <TooltipProvider>
        <ShiftPlannerTab {...DEFAULT_PROPS} />
      </TooltipProvider>
    </QueryClientProvider>,
  );
}

function lastGridProps() {
  return templateGridSpy.mock.calls.at(-1)?.[0] as {
    conflictsByShiftId?: Map<string, string[]>;
  };
}

function lastHeaderProps() {
  return plannerHeaderSpy.mock.calls.at(-1)?.[0] as {
    conflictedShiftCount?: number;
    conflictsUnavailable?: boolean;
  };
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('ShiftPlannerTab — conflict wiring', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useTimeOffRequestsSpy.mockReturnValue({
      timeOffRequests: FIXTURE_TIME_OFF,
      loading: false,
      error: null,
    });
    useEmployeeAvailabilitySpy.mockReturnValue({ availability: [], loading: false, error: null });
    useAvailabilityExceptionsSpy.mockReturnValue({ exceptions: [], loading: false, error: null });
  });

  it('fetches time-off requests for the restaurant', () => {
    renderTab();
    expect(useTimeOffRequestsSpy).toHaveBeenCalledWith('r1');
  });

  it('passes the conflict entry for the covered shift to TemplateGrid', () => {
    renderTab();
    const lines = lastGridProps().conflictsByShiftId?.get('shift-tue');
    expect(lines).toBeDefined();
    expect(lines?.[0]).toBe('Employee has approved time-off from 2027-07-13 to 2027-07-14');
  });

  it('passes the conflict count to PlannerHeader', () => {
    renderTab();
    expect(lastHeaderProps().conflictedShiftCount).toBe(1);
    expect(lastHeaderProps().conflictsUnavailable).toBeFalsy();
  });

  it('passes an empty map and no count while the time-off query loads', () => {
    useTimeOffRequestsSpy.mockReturnValue({ timeOffRequests: [], loading: true, error: null });
    renderTab();
    expect(lastGridProps().conflictsByShiftId?.size ?? 0).toBe(0);
    expect(lastHeaderProps().conflictedShiftCount ?? 0).toBe(0);
  });

  it('passes conflictsUnavailable and an empty map when the query errors', () => {
    useTimeOffRequestsSpy.mockReturnValue({
      timeOffRequests: [],
      loading: false,
      error: new Error('boom'),
    });
    renderTab();
    expect(lastHeaderProps().conflictsUnavailable).toBe(true);
    expect(lastGridProps().conflictsByShiftId?.size ?? 0).toBe(0);
  });

  it('passes conflictsUnavailable when an availability query errors (no silent zero)', () => {
    useEmployeeAvailabilitySpy.mockReturnValue({
      availability: [],
      loading: false,
      error: new Error('rls refusal'),
    });
    renderTab();
    expect(lastHeaderProps().conflictsUnavailable).toBe(true);
    expect(lastGridProps().conflictsByShiftId?.size ?? 0).toBe(0);
  });

  it('passes an empty map while an availability query loads (no partial index)', () => {
    useAvailabilityExceptionsSpy.mockReturnValue({ exceptions: [], loading: true, error: null });
    renderTab();
    expect(lastGridProps().conflictsByShiftId?.size ?? 0).toBe(0);
    expect(lastHeaderProps().conflictedShiftCount ?? 0).toBe(0);
    expect(lastHeaderProps().conflictsUnavailable).toBeFalsy();
  });
});
