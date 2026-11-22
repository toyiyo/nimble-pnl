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

describe('SalesTrendsPanel — stale POS filter reset', () => {
  it('falls back to All POS when the selected system is no longer present after a data refetch', () => {
    mockUseSalesTrends.mockReturnValue(mockHookReturn());
    const { rerender } = render(<SalesTrendsPanel restaurantId="rest-1" />);

    fireEvent.click(screen.getByRole('button', { name: /^toast$/i }));
    // Toast-only net sales: 300 + 200 = 500
    expect(screen.getByText('$500.00')).toBeInTheDocument();

    // Simulate a page date-range change whose new payload no longer
    // contains 'toast' (only one system, 'square', remains) — the
    // segmented control would also hide itself here since
    // pos_systems.length <= 1.
    const squareOnly: SalesTrendsData = {
      pos_systems: ['square'],
      by_day: [{ sale_date: '2026-08-01', pos_system: 'square', revenue: 90, orders: 3 }],
      by_hour: [],
      by_weekday: [],
      by_product: [],
    };
    mockUseSalesTrends.mockReturnValue(mockHookReturn({ data: squareOnly }));
    rerender(<SalesTrendsPanel restaurantId="rest-1" startDate="2026-08-01" endDate="2026-08-01" />);

    // Must NOT render a bogus empty state or a stale-filtered zero total —
    // falls back to showing the new payload's actual (unfiltered) revenue.
    expect(screen.queryByText(/no sales in this range/i)).not.toBeInTheDocument();
    expect(screen.getByText('$90.00')).toBeInTheDocument();
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

  it('renders a visible narrative caption under the charts', () => {
    mockUseSalesTrends.mockReturnValue(mockHookReturn());
    render(<SalesTrendsPanel restaurantId="rest-1" />);
    // Visible deriveInsights captions (other charts carry the same text only as
    // an aria-label attribute, so these getByText hits are the rendered <p>s).
    expect(screen.getByText(/was your busiest day/i)).toBeInTheDocument();
    expect(screen.getByText(/strongest day/i)).toBeInTheDocument();
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

describe('SalesTrendsPanel — prior period comparison', () => {
  const range = { startDate: '2026-07-01', endDate: '2026-07-02' };

  function mockByRange(prior: Record<string, unknown>) {
    mockUseSalesTrends.mockImplementation((_id: string | null, opts: { startDate?: string }) =>
      opts.startDate === range.startDate ? mockHookReturn() : mockHookReturn(prior),
    );
  }
  function priorCalls() {
    return mockUseSalesTrends.mock.calls.filter(([, o]) => (o as { startDate?: string }).startDate !== range.startDate);
  }

  it('requests the prior range with the comparison dates and enables it by default', () => {
    mockByRange({});
    render(<SalesTrendsPanel restaurantId="rest-1" timeZone="UTC" {...range} />);
    const [restaurantId, last] = priorCalls().at(-1)! as [string, Record<string, unknown>];
    // Jul 1 to Jul 2 starts on the 1st of the month, so the month rule applies.
    expect(restaurantId).toBe('rest-1');
    expect(last).toMatchObject({
      startDate: '2026-06-01',
      endDate: '2026-06-02',
      timeZone: 'UTC',
      enabled: true,
      retry: 1,
    });
  });

  it('sends the full prior month for a full 30-day month', () => {
    const june = { startDate: '2026-06-01', endDate: '2026-06-30' };
    mockUseSalesTrends.mockImplementation(() => mockHookReturn());
    render(<SalesTrendsPanel restaurantId="rest-1" {...june} />);
    const prior = mockUseSalesTrends.mock.calls.filter(([, o]) => (o as { startDate?: string }).startDate !== june.startDate);
    expect(prior.at(-1)![1]).toMatchObject({ startDate: '2026-05-01', endDate: '2026-05-31' });
  });

  it('uses the comparison hint for a preset range', () => {
    const month = { startDate: '2026-11-01', endDate: '2026-11-30' };
    mockUseSalesTrends.mockImplementation(() => mockHookReturn());
    render(<SalesTrendsPanel restaurantId="rest-1" comparisonHint="shift" {...month} />);
    const prior = mockUseSalesTrends.mock.calls.filter(([, o]) => (o as { startDate?: string }).startDate !== month.startDate);
    // 30 days moves back 35 days, the same as the dashboard "Last 30 days".
    expect(prior.at(-1)![1]).toMatchObject({ startDate: '2026-09-27', endDate: '2026-10-26' });
  });

  it('shows the caption one time when the prior data is loaded', () => {
    mockByRange({});
    render(<SalesTrendsPanel restaurantId="rest-1" {...range} />);
    expect(screen.getAllByText(/^vs .+ · .+/)).toHaveLength(1);
  });

  it('turns the prior query off and hides the caption when the switch is off', () => {
    mockByRange({});
    render(<SalesTrendsPanel restaurantId="rest-1" {...range} />);
    const sw = screen.getByRole('switch', { name: /compare to previous period/i });
    expect(sw).toBeChecked();
    fireEvent.click(sw);
    expect(sw).not.toBeChecked();
    expect((priorCalls().at(-1)![1] as { enabled: boolean }).enabled).toBe(false);
    expect(screen.queryByText(/^vs .+ · .+/)).not.toBeInTheDocument();
  });

  it('shows an error status and keeps the current panel when the prior query fails', () => {
    mockByRange({ data: undefined, error: new Error('boom') });
    render(<SalesTrendsPanel restaurantId="rest-1" {...range} />);
    expect(screen.getByRole('status')).toHaveTextContent('Could not load the previous period.');
    expect(screen.getByText('$750.00')).toBeInTheDocument();
  });

  it('shows no caption while the prior data loads', () => {
    mockByRange({ data: undefined, isLoading: true });
    render(<SalesTrendsPanel restaurantId="rest-1" {...range} />);
    expect(screen.queryByText(/^vs .+ · .+/)).not.toBeInTheDocument();
    expect(screen.queryByRole('status')).not.toBeInTheDocument();
  });

  it('shows no switch when there is no date range', () => {
    mockUseSalesTrends.mockReturnValue(mockHookReturn());
    render(<SalesTrendsPanel restaurantId="rest-1" />);
    expect(screen.queryByRole('switch')).not.toBeInTheDocument();
  });
});
