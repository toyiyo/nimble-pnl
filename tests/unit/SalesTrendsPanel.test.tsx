import React from 'react';
import { describe, it, expect, vi, beforeEach, beforeAll } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';

import type { SalesTrendsData } from '@/lib/salesTrends';

/**
 * Design: docs/superpowers/specs/2026-07-20-pos-sales-trends-design.md §4.2
 * Plan: docs/superpowers/plans/2026-07-20-pos-sales-trends-plan.md — Task 6
 *
 * Recharts' <ResponsiveContainer> measures via getBoundingClientRect() and
 * renders nothing when the host reports zero size (jsdom's default). Stub a
 * fixed size so every sub-chart actually mounts its SVG (same technique as
 * LaborEfficiencyCard.test.tsx).
 */
beforeAll(() => {
  Object.defineProperty(HTMLElement.prototype, 'getBoundingClientRect', {
    configurable: true,
    value: () => ({
      width: 400,
      height: 240,
      top: 0,
      left: 0,
      bottom: 240,
      right: 400,
      x: 0,
      y: 0,
      toJSON: () => {},
    }),
  });
});

const mockUseSalesTrends = vi.fn();
vi.mock('@/hooks/useSalesTrends', () => ({
  useSalesTrends: (restaurantId: string | null, options: unknown) => mockUseSalesTrends(restaurantId, options),
}));

import { SalesTrendsPanel } from '@/components/pos-sales/SalesTrendsPanel';

function fixtureData(overrides: Partial<SalesTrendsData> = {}): SalesTrendsData {
  return {
    pos_systems: ['toast', 'square'],
    by_day: [
      { sale_date: '2026-07-01', pos_system: 'toast', revenue: 300, orders: 10 },
      { sale_date: '2026-07-01', pos_system: 'square', revenue: 100, orders: 4 },
      { sale_date: '2026-07-02', pos_system: 'toast', revenue: 200, orders: 8 },
      { sale_date: '2026-07-02', pos_system: 'square', revenue: 150, orders: 5 },
    ],
    by_hour: [
      { hour: 12, pos_system: 'toast', revenue: 200, day_count: 2 },
      { hour: 12, pos_system: 'square', revenue: 80, day_count: 2 },
      { hour: 18, pos_system: 'toast', revenue: 300, day_count: 2 },
      { hour: 18, pos_system: 'square', revenue: 170, day_count: 2 },
    ],
    by_weekday: [
      { dow: 3, pos_system: 'toast', revenue: 300 },
      { dow: 3, pos_system: 'square', revenue: 100 },
      { dow: 4, pos_system: 'toast', revenue: 200 },
      { dow: 4, pos_system: 'square', revenue: 150 },
    ],
    by_product: [
      { item_name: 'Pretzel', pos_system: 'toast', revenue: 400, quantity: 100 },
      { item_name: 'Soda', pos_system: 'square', revenue: 150, quantity: 60 },
    ],
    ...overrides,
  };
}

function singlePosFixture(): SalesTrendsData {
  const data = fixtureData();
  return {
    pos_systems: ['toast'],
    by_day: data.by_day.filter((r) => r.pos_system === 'toast'),
    by_hour: data.by_hour.filter((r) => r.pos_system === 'toast'),
    by_weekday: data.by_weekday.filter((r) => r.pos_system === 'toast'),
    by_product: data.by_product.filter((r) => r.pos_system === 'toast'),
  };
}

function emptyFixture(): SalesTrendsData {
  return { pos_systems: [], by_day: [], by_hour: [], by_weekday: [], by_product: [] };
}

function mockHookReturn(overrides: Record<string, unknown> = {}) {
  return {
    data: fixtureData(),
    isLoading: false,
    error: null,
    ...overrides,
  };
}

beforeEach(() => {
  mockUseSalesTrends.mockReset();
});

describe('SalesTrendsPanel — loading/error/empty states', () => {
  it('renders skeletons while loading, with no charts in the DOM', () => {
    mockUseSalesTrends.mockReturnValue(mockHookReturn({ isLoading: true, data: undefined }));
    const { container } = render(<SalesTrendsPanel restaurantId="rest-1" />);
    expect(container.querySelector('.animate-pulse')).toBeTruthy();
    expect(screen.queryAllByRole('img')).toHaveLength(0);
  });

  it('renders an error message when the query errors', () => {
    mockUseSalesTrends.mockReturnValue(mockHookReturn({ error: new Error('boom'), data: undefined }));
    render(<SalesTrendsPanel restaurantId="rest-1" />);
    expect(screen.getByText(/failed to load sales trends/i)).toBeInTheDocument();
    expect(screen.queryAllByRole('img')).toHaveLength(0);
  });

  it('renders an empty-state message when the range has no sales', () => {
    mockUseSalesTrends.mockReturnValue(mockHookReturn({ data: emptyFixture() }));
    render(<SalesTrendsPanel restaurantId="rest-1" />);
    expect(screen.getByText(/no sales in this range/i)).toBeInTheDocument();
    expect(screen.queryAllByRole('img')).toHaveLength(0);
  });
});

describe('SalesTrendsPanel — POS filter control', () => {
  it('hides the POS control when only one pos_system is present', () => {
    mockUseSalesTrends.mockReturnValue(mockHookReturn({ data: singlePosFixture() }));
    render(<SalesTrendsPanel restaurantId="rest-1" />);
    expect(screen.queryByRole('button', { name: /all pos/i })).not.toBeInTheDocument();
  });

  it('shows the POS control when multiple pos_systems are present and re-scopes KPI totals on toggle', () => {
    mockUseSalesTrends.mockReturnValue(mockHookReturn());
    render(<SalesTrendsPanel restaurantId="rest-1" />);

    // Unfiltered net sales: 300 + 100 + 200 + 150 = 750
    expect(screen.getByText('$750.00')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /^toast$/i }));

    // Toast-only net sales: 300 + 200 = 500
    expect(screen.getByText('$500.00')).toBeInTheDocument();
    expect(screen.queryByText('$750.00')).not.toBeInTheDocument();
  });
});

describe('SalesTrendsPanel — expand/collapse', () => {
  it('defaults to expanded with charts mounted and aria-expanded=true', () => {
    mockUseSalesTrends.mockReturnValue(mockHookReturn());
    render(<SalesTrendsPanel restaurantId="rest-1" />);
    const toggle = screen.getByRole('button', { name: /collapse sales trends/i });
    expect(toggle).toHaveAttribute('aria-expanded', 'true');
    expect(screen.getAllByRole('img').length).toBeGreaterThan(0);
  });

  it('removes charts from the DOM and flips aria-expanded/aria-label when collapsed', () => {
    mockUseSalesTrends.mockReturnValue(mockHookReturn());
    render(<SalesTrendsPanel restaurantId="rest-1" />);
    const toggle = screen.getByRole('button', { name: /collapse sales trends/i });

    fireEvent.click(toggle);

    expect(toggle).toHaveAttribute('aria-expanded', 'false');
    expect(toggle).toHaveAccessibleName(/expand sales trends/i);
    expect(screen.queryAllByRole('img')).toHaveLength(0);
  });

  it('honors defaultExpanded=false (collapsed on mount, e.g. mobile wire-up)', () => {
    mockUseSalesTrends.mockReturnValue(mockHookReturn());
    render(<SalesTrendsPanel restaurantId="rest-1" defaultExpanded={false} />);
    expect(screen.getByRole('button', { name: /expand sales trends/i })).toHaveAttribute('aria-expanded', 'false');
    expect(screen.queryAllByRole('img')).toHaveLength(0);
  });
});
