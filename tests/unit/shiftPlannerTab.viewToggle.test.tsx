/**
 * Tests for the Plan | Timeline view toggle wired into ShiftPlannerTab.
 *
 * The toggle renders in the "loaded" branch (after loading/error/empty-employees
 * early returns). Switching to Timeline unmounts the editing tree and mounts
 * ShiftTimelineTab; switching back shows the plan. The mobile add-shift FAB
 * is hidden while in Timeline mode.
 */
import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ShiftPlannerTab } from '@/components/scheduling/ShiftPlanner/ShiftPlannerTab';

// ─── Mock all heavy hook / component dependencies ─────────────────────────────

// useShiftPlanner — provide minimal stable data
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

// useShiftTemplates — return empty templates
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

// useEmployeeAvailability — stub
vi.mock('@/hooks/useAvailability', () => ({
  useEmployeeAvailability: () => ({ availability: [], loading: false }),
}));

// useRestaurantContext — provide a minimal restaurant
vi.mock('@/contexts/RestaurantContext', () => ({
  useRestaurantContext: () => ({
    selectedRestaurant: {
      restaurant: { id: 'r1', name: 'Test Restaurant', timezone: 'America/Chicago' },
    },
  }),
}));

// usePlannerShiftsIndex — stub
vi.mock('@/hooks/usePlannerShiftsIndex', () => ({
  usePlannerShiftsIndex: () => ({
    coverageByDay: new Map(),
    overviewDays: [],
    shiftsByEmployee: new Map(),
  }),
}));

// useIsMobile — default to non-mobile (desktop); overridden per-test
const mockIsMobile = vi.fn(() => false);
vi.mock('@/hooks/use-mobile', () => ({
  useIsMobile: () => mockIsMobile(),
}));

// use-toast — stub
vi.mock('@/hooks/use-toast', () => ({
  useToast: () => ({ toast: vi.fn() }),
}));

// useGenerateSchedule — stub
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

// useWeekStaffingSuggestions — stub (used inside ShiftTimelineTab)
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

// GenerateScheduleDialog — mock to avoid QueryClient / useMutation dependency
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

describe('ShiftPlannerTab — Plan|Timeline view toggle', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockIsMobile.mockReturnValue(false);
  });

  it('renders the Plan and Timeline toggle options in the header', () => {
    renderTab();
    // Both toggle items should be visible
    expect(screen.getByRole('radio', { name: /^plan$/i })).toBeInTheDocument();
    expect(screen.getByRole('radio', { name: /^timeline$/i })).toBeInTheDocument();
  });

  it('defaults to Plan view — shows no-templates message (plan editing tree)', () => {
    renderTab();
    // In Plan mode with no templates, the "No shift templates yet" empty state renders
    expect(screen.getByText(/no shift templates yet/i)).toBeInTheDocument();
  });

  it('switches to Timeline view when Timeline is clicked — shows timeline content', () => {
    renderTab();

    const timelineToggle = screen.getByRole('radio', { name: /^timeline$/i });
    fireEvent.click(timelineToggle);

    // In Timeline mode with no shifts, ShiftTimelineTab renders its empty state
    expect(screen.getByText(/no shifts scheduled/i)).toBeInTheDocument();
  });

  it('hides the editing tree in Timeline mode — DnD editing content is not rendered', () => {
    renderTab();

    // Verify plan-specific content is in the DOM initially
    expect(screen.getByText(/no shift templates yet/i)).toBeInTheDocument();

    // Switch to Timeline
    fireEvent.click(screen.getByRole('radio', { name: /^timeline$/i }));

    // Plan-specific content should no longer be rendered
    expect(screen.queryByText(/no shift templates yet/i)).not.toBeInTheDocument();
  });

  it('hides the mobile FAB (add-shift) in Timeline mode on mobile', () => {
    mockIsMobile.mockReturnValue(true);
    renderTab();

    // The mobile team button ("Show team members") renders in Plan mode on mobile
    expect(screen.getByRole('button', { name: /show team members/i })).toBeInTheDocument();

    // Switch to Timeline
    fireEvent.click(screen.getByRole('radio', { name: /^timeline$/i }));

    // The mobile team FAB should no longer be rendered in Timeline mode
    expect(screen.queryByRole('button', { name: /show team members/i })).not.toBeInTheDocument();
  });

  it('switching back to Plan restores the plan editing tree', () => {
    renderTab();

    // Switch to Timeline
    fireEvent.click(screen.getByRole('radio', { name: /^timeline$/i }));
    expect(screen.getByText(/no shifts scheduled/i)).toBeInTheDocument();

    // Switch back to Plan
    fireEvent.click(screen.getByRole('radio', { name: /^plan$/i }));
    expect(screen.getByText(/no shift templates yet/i)).toBeInTheDocument();
    expect(screen.queryByText(/no shifts scheduled/i)).not.toBeInTheDocument();
  });
});
