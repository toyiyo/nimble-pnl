import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';

import { TrendKpiRow } from '@/components/pos-sales/TrendKpiRow';
import type { SalesTrendsKpis } from '@/lib/salesTrends';

const kpis: SalesTrendsKpis = {
  netSales: 1200,
  orders: 50,
  avgOrder: 24,
  busiestDay: null,
  peakHour: null,
  posSplit: [],
};

describe('TrendKpiRow delta line', () => {
  it('shows no delta line content without deltas', () => {
    render(<TrendKpiRow kpis={kpis} />);
    expect(screen.queryByText(/vs prior|No prior sales/i)).toBeNull();
  });

  it('shows a percent increase with sr-only text', () => {
    render(<TrendKpiRow kpis={kpis} deltas={{ netSales: { change: 200, percent: 20 } }} />);
    expect(screen.getByText('+20.0%')).toBeTruthy();
    expect(screen.getByText(/up 20\.0 percent/i)).toBeTruthy();
  });

  it('shows a percent decrease', () => {
    render(<TrendKpiRow kpis={kpis} deltas={{ avgOrder: { change: -2.4, percent: -10 } }} />);
    expect(screen.getByText('-10.0%')).toBeTruthy();
    expect(screen.getByText(/down 10\.0 percent/i)).toBeTruthy();
  });

  it('shows No prior sales when percent is null', () => {
    render(<TrendKpiRow kpis={kpis} deltas={{ netSales: { change: 1200, percent: null } }} />);
    expect(screen.getByText('No prior sales')).toBeTruthy();
  });

  it('shows an orders count change', () => {
    render(<TrendKpiRow kpis={kpis} deltas={{ orders: { change: 5, percent: 11.1 } }} />);
    expect(screen.getByText(/\+5 orders/)).toBeTruthy();
  });

  it('shows a negative orders count change', () => {
    render(<TrendKpiRow kpis={kpis} deltas={{ orders: { change: -4, percent: -9.5 } }} />);
    expect(screen.getByText(/-4 orders/)).toBeTruthy();
  });

  it('shows a zero orders count change as unchanged', () => {
    render(<TrendKpiRow kpis={kpis} deltas={{ orders: { change: 0, percent: 0 } }} />);
    expect(screen.queryByText(/\+0 orders/)).toBeNull();
    expect(screen.getByText(/unchanged/i)).toBeTruthy();
  });

  it('shows a flat delta for a change under 0.05 percent', () => {
    render(<TrendKpiRow kpis={kpis} deltas={{ netSales: { change: 0.01, percent: 0.01 } }} />);
    expect(screen.getByText('0.0%')).toBeTruthy();
    expect(screen.getByText(/unchanged 0\.0 percent/i)).toBeTruthy();
  });

  it('shows a skeleton while loading', () => {
    const { container } = render(<TrendKpiRow kpis={kpis} deltasLoading />);
    expect(container.querySelectorAll('.animate-pulse').length).toBeGreaterThan(0);
  });

  it('shows a small order count change as a count, not as flat', () => {
    render(<TrendKpiRow kpis={kpis} deltas={{ orders: { change: 1, percent: 0.02 } }} />);
    expect(screen.getByText(/\+1 orders/)).toBeTruthy();
  });
});
