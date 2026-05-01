/**
 * MonthlyBreakdownTable regression tests
 *
 * Pins the rendering contract introduced by the monthly-performance hardening:
 * - The "Actual" net-profit cell shows netRevenue - actualExpenses (not the
 *   actual + pending mash-up that was previously labeled "Net Profit").
 * - The "Projected (incl. pending labor)" sub-block only renders when
 *   pending_labor_cost > 0.
 */

import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MonthlyBreakdownTable } from '@/components/MonthlyBreakdownTable';

// Stub the React Query hooks the component uses so render is deterministic.
vi.mock('@/hooks/useMonthlyExpenses', () => ({
  useMonthlyExpenses: () => ({
    data: [
      {
        period: '2026-04',
        totalExpenses: 111220,
        foodCost: 25562,
        laborCost: 32959,
        categories: [],
      },
    ],
    isLoading: false,
    error: null,
  }),
}));

vi.mock('@/hooks/useRevenueBreakdown', () => ({
  useRevenueBreakdown: () => ({
    data: null,
    isLoading: false,
    error: null,
  }),
}));

vi.mock('@/contexts/RestaurantContext', () => ({
  useRestaurantContext: () => ({
    selectedRestaurant: { restaurant_id: 'test-restaurant' },
  }),
}));

vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual<typeof import('react-router-dom')>('react-router-dom');
  return {
    ...actual,
    useNavigate: () => vi.fn(),
  };
});

function renderWithClient(ui: React.ReactElement) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={client}>{ui}</QueryClientProvider>);
}

const aprilFixture = {
  period: '2026-04',
  gross_revenue: 74458,
  total_collected_at_pos: 74458,
  net_revenue: 73019,
  discounts: 1439,
  refunds: 0,
  sales_tax: 0,
  tips: 0,
  other_liabilities: 0,
  food_cost: 25562,
  labor_cost: 49487,
  pending_labor_cost: 16528,
  actual_labor_cost: 32959,
  has_data: true,
};

describe('MonthlyBreakdownTable — single source of truth', () => {
  it('renders an Actual net-profit value matching netRevenue - actualExpenses', () => {
    renderWithClient(<MonthlyBreakdownTable monthlyData={[aprilFixture]} />);
    // Actual net profit = 73019 - 111220 = -$38,201 (formatted with no decimals).
    expect(screen.getByText('-$38,201')).toBeDefined();
    expect(screen.getAllByText(/Actual/i).length).toBeGreaterThan(0);
  });

  it('renders a Projected label and value when pending labor > 0', () => {
    renderWithClient(<MonthlyBreakdownTable monthlyData={[aprilFixture]} />);
    expect(screen.getAllByText(/Projected/i).length).toBeGreaterThan(0);
    // Projected = 73019 - 111220 - 16528 = -$54,729.
    expect(screen.getByText('-$54,729')).toBeDefined();
  });

  it('omits the Projected line when pending labor is 0', () => {
    const noPending = { ...aprilFixture, pending_labor_cost: 0, labor_cost: 32959 };
    renderWithClient(<MonthlyBreakdownTable monthlyData={[noPending]} />);
    expect(screen.queryByText(/Projected/i)).toBeNull();
  });
});
