import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { MonthlyBreakdownTable } from '@/components/MonthlyBreakdownTable';

vi.mock('@/contexts/RestaurantContext', () => ({
  useRestaurantContext: () => ({ selectedRestaurant: { restaurant_id: 'r1' } }),
}));
vi.mock('@/hooks/useMonthlyExpenses', () => ({ useMonthlyExpenses: () => ({ data: [] }) }));
vi.mock('@/hooks/useRevenueBreakdown', () => ({ useRevenueBreakdown: () => ({ data: null }) }));

const monthlyData = [{
  period: '2026-04', gross_revenue: 100000, total_collected_at_pos: 100000,
  net_revenue: 100000, discounts: 0, refunds: 0, sales_tax: 0, tips: 0,
  other_liabilities: 0, food_cost: 25000, labor_cost: 20000,
  pending_labor_cost: 20000, actual_labor_cost: 18000, has_data: true,
  labor_cost_hidden: false,
}];

describe('MonthlyBreakdownTable labor cell', () => {
  it('shows the accrued basis labor as the headline, not accrued + paid', () => {
    render(
      <MemoryRouter>
        <MonthlyBreakdownTable monthlyData={monthlyData} />
      </MemoryRouter>
    );
    // basis is accrued ($20,000); the double-count would render $38,000.
    expect(screen.getByText('$20,000')).toBeInTheDocument();
    expect(screen.queryByText('$38,000')).not.toBeInTheDocument();
  });
});

// labor_cost_hidden means the hook could not compute a real labor number for
// this month (a masked employee row) — the table must say so, not print a
// number that reads as real. See src/hooks/useMonthlyMetrics.tsx.
describe('MonthlyBreakdownTable labor_cost_hidden', () => {
  const hiddenMonthlyData = [{
    ...monthlyData[0],
    // These would render as real $0 costs and a real net profit if the
    // hidden flag were ignored — the assertions below prove that never happens.
    labor_cost: 0,
    pending_labor_cost: 0,
    actual_labor_cost: 0,
    labor_cost_hidden: true,
  }];

  it('shows Unavailable for labor cost instead of a $0 figure', () => {
    render(
      <MemoryRouter>
        <MonthlyBreakdownTable monthlyData={hiddenMonthlyData} />
      </MemoryRouter>
    );
    expect(screen.getAllByText('Unavailable').length).toBeGreaterThan(0);
    // The masked-out Pending/Actual sub-lines must not render at all — not
    // even as a $0 figure that reads as a real, computed number.
    expect(screen.queryByText(/Pending:/)).not.toBeInTheDocument();
    expect(screen.queryByText(/Actual:/)).not.toBeInTheDocument();
  });

  it('shows Unavailable for net profit too, since it depends on labor cost', () => {
    render(
      <MemoryRouter>
        <MonthlyBreakdownTable monthlyData={hiddenMonthlyData} />
      </MemoryRouter>
    );
    // One "Unavailable" for the Labor cell, one for the Net Profit cell.
    expect(screen.getAllByText('Unavailable')).toHaveLength(2);
  });
});
