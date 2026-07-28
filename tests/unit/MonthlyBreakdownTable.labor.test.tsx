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
