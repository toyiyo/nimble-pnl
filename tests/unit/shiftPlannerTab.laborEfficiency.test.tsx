/**
 * Tests for LaborEfficiencyPanel wired into ShiftPlannerTab (Plan view), behind
 * a Collapsible that defaults to collapsed — mirrors StaffingOverlay's own
 * default-collapsed pattern (see StaffingOverlay.tsx `useState(false)`).
 */
import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ShiftPlannerTab } from '@/components/scheduling/ShiftPlanner/ShiftPlannerTab';

// ─── Mock all heavy hook / component dependencies ─────────────────────────────

vi.mock('@/hooks/useShiftPlanner', async () => {
  const actual = await vi.importActual('@/hooks/useShiftPlanner') as Record<string, unknown>;
  return {
    ...actual,
    useShiftPlanner: () => ({
      weekStart: new Date('2026-07-06T00:00:00Z'),
      weekEnd: new Date('2026-07-12T23:59:59Z'),
      weekDays: [
        '2026-07-06', '2026-07-07', '2026-07-08', '2026-07-09',
        '2026-07-10', '2026-07-11', '2026-07-12',
      ],
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

vi.mock('@/hooks/useAvailability', () => ({
  useEmployeeAvailability: () => ({ availability: [], loading: false }),
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

// StaffingOverlay — mock the heavy component that crashes without a full store
vi.mock('@/components/scheduling/ShiftPlanner/StaffingOverlay', () => ({
  StaffingOverlay: () => <div data-testid="staffing-overlay" />,
}));

// LaborEfficiencyPanel — mock the heavy component (its own hooks are unit-tested
// separately in tests/unit/LaborEfficiencyPanel.test.tsx); capture props received.
const laborEfficiencyPanelProps: Array<{ restaurantId: string }> = [];
vi.mock('@/components/scheduling/ShiftPlanner/LaborEfficiencyPanel', () => ({
  LaborEfficiencyPanel: (props: { restaurantId: string }) => {
    laborEfficiencyPanelProps.push(props);
    return <div data-testid="labor-efficiency-panel" />;
  },
}));

vi.mock('@/components/scheduling/ShiftPlanner/GenerateScheduleDialog', () => ({
  GenerateScheduleDialog: () => null,
}));

// ─── Fixtures ─────────────────────────────────────────────────────────────────

const DEFAULT_PROPS = {
  restaurantId: 'r1',
  weekStart: new Date('2026-07-06T00:00:00Z'),
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

describe('ShiftPlannerTab — Labor efficiency panel', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    laborEfficiencyPanelProps.length = 0;
  });

  it('renders a "Labor efficiency" collapsible header in Plan view', () => {
    renderTab();
    expect(screen.getByText(/labor efficiency/i)).toBeInTheDocument();
  });

  it('defaults to collapsed — LaborEfficiencyPanel is not mounted, trigger aria-expanded=false', () => {
    renderTab();
    const trigger = screen.getByRole('button', { name: /expand labor efficiency/i });
    expect(trigger.getAttribute('aria-expanded')).toBe('false');
    expect(screen.queryByTestId('labor-efficiency-panel')).not.toBeInTheDocument();
  });

  it('expanding the trigger mounts LaborEfficiencyPanel with restaurantId', () => {
    renderTab();
    const trigger = screen.getByRole('button', { name: /expand labor efficiency/i });
    fireEvent.click(trigger);

    expect(screen.getByTestId('labor-efficiency-panel')).toBeInTheDocument();
    expect(laborEfficiencyPanelProps.at(-1)).toEqual({ restaurantId: 'r1' });

    // Trigger flips to the "Collapse" label once expanded
    expect(screen.getByRole('button', { name: /collapse labor efficiency/i })).toBeInTheDocument();
  });

  it('collapsing again after expanding hides the panel', () => {
    renderTab();
    fireEvent.click(screen.getByRole('button', { name: /expand labor efficiency/i }));
    expect(screen.getByTestId('labor-efficiency-panel')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /collapse labor efficiency/i }));
    expect(screen.queryByTestId('labor-efficiency-panel')).not.toBeInTheDocument();
  });

  it('does not render the panel in Timeline view', () => {
    renderTab();
    fireEvent.click(screen.getByRole('radio', { name: /^timeline$/i }));
    expect(screen.queryByText(/labor efficiency/i)).not.toBeInTheDocument();
  });
});
