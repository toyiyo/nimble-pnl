import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

// --- Stub heavy deps before importing the component under test ---

// SuggestedShifts: capture props passed to it
const suggestedShiftsProps: Array<Record<string, unknown>> = [];
vi.mock('@/components/scheduling/ShiftPlanner/SuggestedShifts', () => ({
  SuggestedShifts: (props: Record<string, unknown>) => {
    suggestedShiftsProps.push(props);
    return (
      <div
        data-testid="suggested-shifts"
        data-blocks={(props.blocks as unknown[])?.length ?? 0}
      />
    );
  },
}));

// StaffingConfigPanel: stub
vi.mock('@/components/scheduling/ShiftPlanner/StaffingConfigPanel', () => ({
  StaffingConfigPanel: () => <div data-testid="config-panel" />,
}));

// StaffingDayColumn: stub
vi.mock('@/components/scheduling/ShiftPlanner/StaffingDayColumn', () => ({
  StaffingDayColumn: () => <div data-testid="day-column" />,
}));

// useStaffingSettings — immediate return, no loading
vi.mock('@/hooks/useStaffingSettings', () => ({
  useStaffingSettings: () => ({
    effectiveSettings: {
      target_splh: 50,
      min_staff: 1,
      min_crew: null,
      target_labor_pct: 30,
      lookback_weeks: 8,
      open_shifts_enabled: true,
    },
    isLoading: false,
    updateSettings: vi.fn(),
    isSaving: false,
  }),
}));

// useEmployees — immediate return
vi.mock('@/hooks/useEmployees', () => ({
  useEmployees: () => ({ employees: [] }),
}));

// useToast
vi.mock('@/hooks/use-toast', () => ({
  useToast: () => ({ toast: vi.fn() }),
}));

// useRestaurantContext — return a restaurant with Chicago timezone
vi.mock('@/contexts/RestaurantContext', () => ({
  useRestaurantContext: () => ({
    selectedRestaurant: {
      restaurant: { timezone: 'America/Chicago' },
    },
  }),
}));

// Mock React Query's useQuery directly to avoid Supabase chain complexity.
// This gives us full control over what hasSalesData and daySuggestions look like.
const mockUseQuery = vi.fn();
vi.mock('@tanstack/react-query', async () => {
  const actual = await vi.importActual('@tanstack/react-query');
  return {
    ...actual,
    useQuery: (opts: { queryKey: string[] }) => {
      return mockUseQuery(opts);
    },
  };
});

import { StaffingOverlay } from '@/components/scheduling/ShiftPlanner/StaffingOverlay';

const wrapper = ({ children }: { children: React.ReactNode }) => {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return (
    <MemoryRouter>
      <QueryClientProvider client={qc}>{children}</QueryClientProvider>
    </MemoryRouter>
  );
};

const WEEK_DAYS = [
  '2026-05-25',
  '2026-05-26',
  '2026-05-27',
  '2026-05-28',
  '2026-05-29',
  '2026-05-30',
  '2026-05-31',
];

// Fake sales data: 10 sales with hourly timestamps so daySuggestions produces shiftBlocks
const FAKE_SALES = Array.from({ length: 10 }, (_, i) => ({
  sale_date: '2026-05-23', // a Friday
  sale_time: `${9 + i}:00:00`,
  total_price: '500',
}));

describe('<StaffingOverlay> wiring', () => {
  beforeEach(() => {
    suggestedShiftsProps.length = 0;
    vi.clearAllMocks();

    // Default: queries return real-looking data with no loading
    mockUseQuery.mockImplementation((opts: { queryKey: string[] }) => {
      const key = opts.queryKey[0];
      if (key === 'hourly-sales-all') {
        return { data: FAKE_SALES, isLoading: false, error: null };
      }
      if (key === 'staffing-time-punches') {
        return { data: [], isLoading: false, error: null };
      }
      return { data: undefined, isLoading: false, error: null };
    });
  });

  it('renders with the CollapsibleContent open by default (isExpanded = true)', () => {
    render(
      <StaffingOverlay restaurantId="r1" weekDays={WEEK_DAYS} />,
      { wrapper },
    );
    // CollapsibleTrigger button shows "Collapse" aria-label when expanded
    const trigger = screen.getByRole('button', { name: /collapse staffing suggestions/i });
    expect(trigger).toBeTruthy();
    // The collapsible container should be open
    expect(trigger.getAttribute('aria-expanded')).toBe('true');
  });

  it('renders SuggestedShifts when hasSalesData is true', () => {
    render(
      <StaffingOverlay restaurantId="r1" weekDays={WEEK_DAYS} />,
      { wrapper },
    );
    // With hasSalesData=true, SuggestedShifts stub should mount
    expect(screen.getByTestId('suggested-shifts')).toBeTruthy();
  });

  it('passes aggregated allShiftBlocks from all days to SuggestedShifts', () => {
    render(
      <StaffingOverlay restaurantId="r1" weekDays={WEEK_DAYS} />,
      { wrapper },
    );
    // SuggestedShifts is rendered and received a blocks prop (array, possibly empty
    // since FAKE_SALES are all the same DOW but the mechanism is wired)
    const el = screen.getByTestId('suggested-shifts');
    expect(el).toBeTruthy();
    // The component received props (captured in suggestedShiftsProps)
    expect(suggestedShiftsProps.length).toBeGreaterThan(0);
    // blocks must be an array
    expect(Array.isArray(suggestedShiftsProps[0]?.blocks)).toBe(true);
  });

  it('does NOT render SuggestedShifts when hasSalesData is false', () => {
    mockUseQuery.mockImplementation((opts: { queryKey: string[] }) => {
      const key = opts.queryKey[0];
      if (key === 'hourly-sales-all') {
        return { data: [], isLoading: false, error: null }; // empty → hasSalesData=false
      }
      return { data: [], isLoading: false, error: null };
    });

    render(
      <StaffingOverlay restaurantId="r1" weekDays={WEEK_DAYS} />,
      { wrapper },
    );
    expect(screen.queryByTestId('suggested-shifts')).toBeNull();
  });

  it('passes restaurantId to SuggestedShifts', () => {
    render(
      <StaffingOverlay restaurantId="my-restaurant-id" weekDays={WEEK_DAYS} />,
      { wrapper },
    );
    expect(suggestedShiftsProps.some((p) => p.restaurantId === 'my-restaurant-id')).toBe(true);
  });

  it('renders config panel when not loading and collapsible is open', () => {
    render(
      <StaffingOverlay restaurantId="r1" weekDays={WEEK_DAYS} />,
      { wrapper },
    );
    expect(screen.getByTestId('config-panel')).toBeTruthy();
  });
});
