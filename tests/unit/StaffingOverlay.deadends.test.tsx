/**
 * Task 8: Dead-end fixes in StaffingOverlay
 * Tests: empty state, always-on explainer, retry button, mobile legend
 */
import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

// --- Stub heavy deps before importing the component under test ---

vi.mock('@/components/scheduling/ShiftPlanner/SuggestedShifts', () => ({
  SuggestedShifts: () => <div data-testid="suggested-shifts" />,
}));

vi.mock('@/components/scheduling/ShiftPlanner/StaffingConfigPanel', () => ({
  StaffingConfigPanel: () => <div data-testid="config-panel" />,
}));

vi.mock('@/components/scheduling/ShiftPlanner/StaffingDayColumn', () => ({
  StaffingDayColumn: () => <div data-testid="day-column" />,
}));

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

vi.mock('@/hooks/useEmployees', () => ({
  useEmployees: () => ({ employees: [] }),
}));

vi.mock('@/hooks/use-toast', () => ({
  useToast: () => ({ toast: vi.fn() }),
}));

vi.mock('@/contexts/RestaurantContext', () => ({
  useRestaurantContext: () => ({
    selectedRestaurant: {
      restaurant: { timezone: 'America/Chicago' },
    },
  }),
}));

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

const WEEK_DAYS = [
  '2026-05-25',
  '2026-05-26',
  '2026-05-27',
  '2026-05-28',
  '2026-05-29',
  '2026-05-30',
  '2026-05-31',
];

const FAKE_SALES = Array.from({ length: 10 }, (_, i) => ({
  sale_date: '2026-05-23',
  sale_time: `${9 + i}:00:00`,
  total_price: '500',
}));

const wrapper = ({ children }: { children: React.ReactNode }) => {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return (
    <MemoryRouter>
      <QueryClientProvider client={qc}>{children}</QueryClientProvider>
    </MemoryRouter>
  );
};

describe('<StaffingOverlay> dead-end fixes', () => {
  beforeEach(() => {
    vi.clearAllMocks();

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

  // ── Test 1: Empty state visible when no sales data ──────────────────────────
  it('shows no-data empty state message when hasSalesData is false', () => {
    mockUseQuery.mockImplementation((opts: { queryKey: string[] }) => {
      if (opts.queryKey[0] === 'hourly-sales-all') {
        return { data: [], isLoading: false, error: null };
      }
      return { data: [], isLoading: false, error: null };
    });

    render(<StaffingOverlay restaurantId="r1" weekDays={WEEK_DAYS} />, { wrapper });

    expect(
      screen.getByText(/staffing suggestions need sales history/i),
    ).toBeTruthy();
  });

  // ── Test 2: Connect your POS link present in empty state ─────────────────────
  it('shows "Connect your POS" link in empty state', () => {
    mockUseQuery.mockImplementation((opts: { queryKey: string[] }) => {
      if (opts.queryKey[0] === 'hourly-sales-all') {
        return { data: [], isLoading: false, error: null };
      }
      return { data: [], isLoading: false, error: null };
    });

    render(<StaffingOverlay restaurantId="r1" weekDays={WEEK_DAYS} />, { wrapper });

    const link = screen.getByRole('link', { name: /connect your pos/i });
    expect(link).toBeTruthy();
    expect(link.getAttribute('href')).toBe('/integrations');
  });

  // ── Test 3: "How it works" explainer renders without sales data ──────────────
  it('renders the "How it works" explainer even when hasSalesData is false', () => {
    mockUseQuery.mockImplementation((opts: { queryKey: string[] }) => {
      if (opts.queryKey[0] === 'hourly-sales-all') {
        return { data: [], isLoading: false, error: null };
      }
      return { data: [], isLoading: false, error: null };
    });

    render(<StaffingOverlay restaurantId="r1" weekDays={WEEK_DAYS} />, { wrapper });

    expect(screen.getByText(/how this works/i)).toBeTruthy();
  });

  // ── Test 4: "How it works" explainer also renders with sales data ────────────
  it('renders the "How it works" explainer when hasSalesData is true', () => {
    render(<StaffingOverlay restaurantId="r1" weekDays={WEEK_DAYS} />, { wrapper });

    expect(screen.getByText(/how this works/i)).toBeTruthy();
  });

  // ── Test 5: Retry button shown in error state ────────────────────────────────
  it('shows a Retry button when the sales query returns an error', () => {
    mockUseQuery.mockImplementation((opts: { queryKey: string[] }) => {
      if (opts.queryKey[0] === 'hourly-sales-all') {
        return {
          data: undefined,
          isLoading: false,
          error: new Error('network error'),
          refetch: vi.fn(),
        };
      }
      return { data: undefined, isLoading: false, error: null, refetch: vi.fn() };
    });

    render(<StaffingOverlay restaurantId="r1" weekDays={WEEK_DAYS} />, { wrapper });

    expect(screen.getByRole('button', { name: /retry/i })).toBeTruthy();
  });

  // ── Test 6: Retry button calls refetch ──────────────────────────────────────
  it('calls refetch when Retry button is clicked', () => {
    const refetchMock = vi.fn();
    mockUseQuery.mockImplementation((opts: { queryKey: string[] }) => {
      if (opts.queryKey[0] === 'hourly-sales-all') {
        return {
          data: undefined,
          isLoading: false,
          error: new Error('network error'),
          refetch: refetchMock,
        };
      }
      return { data: undefined, isLoading: false, error: null, refetch: vi.fn() };
    });

    render(<StaffingOverlay restaurantId="r1" weekDays={WEEK_DAYS} />, { wrapper });

    fireEvent.click(screen.getByRole('button', { name: /retry/i }));
    expect(refetchMock).toHaveBeenCalledOnce();
  });

  // ── Test 7: Legend renders on mobile (no hidden md:flex class) ───────────────
  it('renders the On-target/Over-budget legend without hiding it on mobile', () => {
    render(<StaffingOverlay restaurantId="r1" weekDays={WEEK_DAYS} />, { wrapper });

    // The legend container should NOT have "hidden" in its className
    const onTargetText = screen.getByText('On target');
    const legendContainer = onTargetText.closest('div[class*="flex"]');
    expect(legendContainer).toBeTruthy();
    expect(legendContainer?.className).not.toContain('hidden');
  });
});
