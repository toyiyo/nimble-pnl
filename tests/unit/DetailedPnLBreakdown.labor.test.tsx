import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import { DetailedPnLBreakdown } from '@/components/DetailedPnLBreakdown';
import { usePeriodMetrics } from '@/hooks/usePeriodMetrics';
import { useRevenueBreakdown } from '@/hooks/useRevenueBreakdown';
import { useCostsFromSource } from '@/hooks/useCostsFromSource';

vi.mock('@/hooks/usePeriodMetrics', () => ({ usePeriodMetrics: vi.fn() }));
vi.mock('@/hooks/useRevenueBreakdown', () => ({ useRevenueBreakdown: vi.fn() }));
vi.mock('@/hooks/useCostsFromSource', () => ({ useCostsFromSource: vi.fn() }));

const NET_REVENUE = 100000;
const FOOD_COST = 30000;

function mockRevenueBreakdown() {
  vi.mocked(useRevenueBreakdown).mockReturnValue({
    data: {
      revenue_categories: [],
      discount_categories: [],
      refund_categories: [],
      tax_categories: [],
      tip_categories: [],
      other_liability_categories: [],
      adjustments: [],
      uncategorized_revenue: 0,
      totals: {
        total_collected_at_pos: NET_REVENUE,
        gross_revenue: NET_REVENUE,
        categorized_revenue: 0,
        uncategorized_revenue: NET_REVENUE,
        total_discounts: 0,
        total_refunds: 0,
        net_revenue: NET_REVENUE,
        sales_tax: 0,
        tips: 0,
        other_liabilities: 0,
      },
      // false => the sales section renders no children, keeping the
      // labor-children assertions below unambiguous.
      has_categorization_data: false,
      categorization_rate: 0,
    },
    isLoading: false,
    error: null,
    refetch: vi.fn(),
    // The mock sets only the fields this test reads, not the hook's full
    // return type. The `any` cast skips the missing-field type error.
  } as any);
}

function mockPeriodMetrics(laborCost: number) {
  const laborCostPct = (laborCost / NET_REVENUE) * 100;
  const primeCost = FOOD_COST + laborCost;
  vi.mocked(usePeriodMetrics).mockReturnValue({
    data: {
      collectedAtPOS: NET_REVENUE,
      grossRevenue: NET_REVENUE,
      discounts: 0,
      refunds: 0,
      netRevenue: NET_REVENUE,
      categorizedRevenue: 0,
      uncategorizedRevenue: NET_REVENUE,
      foodCost: FOOD_COST,
      laborCost,
      pendingLaborCost: 0,
      actualLaborCost: 0,
      laborBasis: 'accrued',
      primeCost,
      foodCostPercentage: (FOOD_COST / NET_REVENUE) * 100,
      laborCostPercentage: laborCostPct,
      pendingLaborCostPercentage: 0,
      actualLaborCostPercentage: 0,
      primeCostPercentage: (primeCost / NET_REVENUE) * 100,
      grossProfit: NET_REVENUE - primeCost,
      profitMargin: ((NET_REVENUE - primeCost) / NET_REVENUE) * 100,
      salesTax: 0,
      tips: 0,
      otherLiabilities: 0,
      periodStart: new Date('2026-07-01'),
      periodEnd: new Date('2026-07-30'),
      daysInPeriod: 30,
      hasRevenueData: true,
      hasCostData: laborCost > 0,
    },
    isLoading: false,
    error: null,
    refetch: vi.fn(),
    // The mock sets only the fields this test reads, not the hook's full
    // return type. The `any` cast skips the missing-field type error.
  } as any);
}

function mockCostsFromSource(pendingTotal: number, actualTotal: number) {
  vi.mocked(useCostsFromSource).mockReturnValue({
    dailyCosts: [
      {
        date: '2026-07-01',
        food_cost: FOOD_COST,
        labor_cost: pendingTotal > 0 ? pendingTotal : actualTotal,
        pending_labor_cost: pendingTotal,
        actual_labor_cost: actualTotal,
        total_cost: FOOD_COST + (pendingTotal > 0 ? pendingTotal : actualTotal),
      },
    ],
    totalFoodCost: FOOD_COST,
    totalLaborCost: pendingTotal > 0 ? pendingTotal : actualTotal,
    pendingLaborCost: pendingTotal,
    actualLaborCost: actualTotal,
    laborBasis: pendingTotal > 0 ? 'accrued' : 'paid',
    totalCost: FOOD_COST + (pendingTotal > 0 ? pendingTotal : actualTotal),
    isLoading: false,
    error: null,
    refetch: vi.fn(),
    // The mock sets only the fields this test reads, not the hook's full
    // return type. The `any` cast skips the missing-field type error.
  } as any);
}

/** Find the rendered row (desktop table view) whose label text matches. */
function getRow(label: string): HTMLElement {
  const el = screen.getByText(label);
  const row = el.closest('.grid');
  if (!row) throw new Error(`Could not find row container for "${label}"`);
  return row as HTMLElement;
}

/**
 * Overtime/tips divergence: the hook's period totals carry OT banding and
 * tips; the dailyCosts series stays straight-time. The two differ whenever
 * the period holds overtime. The labor children must read the hook totals,
 * not a re-sum of dailyCosts.
 */
function mockCostsFromSourceDiverged(opts: {
  pendingTotal: number;
  actualTotal: number;
  dailyPendingSum: number;
  dailyActualSum: number;
  laborBasis: 'accrued' | 'paid';
}) {
  const dailyLabor =
    opts.laborBasis === 'accrued' ? opts.dailyPendingSum : opts.dailyActualSum;
  const hookLabor =
    opts.laborBasis === 'accrued' ? opts.pendingTotal : opts.actualTotal;
  vi.mocked(useCostsFromSource).mockReturnValue({
    dailyCosts: [
      {
        date: '2026-07-01',
        food_cost: FOOD_COST,
        labor_cost: dailyLabor,
        pending_labor_cost: opts.dailyPendingSum,
        actual_labor_cost: opts.dailyActualSum,
        total_cost: FOOD_COST + dailyLabor,
      },
    ],
    totalFoodCost: FOOD_COST,
    totalLaborCost: hookLabor,
    pendingLaborCost: opts.pendingTotal,
    actualLaborCost: opts.actualTotal,
    laborBasis: opts.laborBasis,
    totalCost: FOOD_COST + hookLabor,
    capped: false,
    isLoading: false,
    error: null,
    refetch: vi.fn(),
  });
}

describe('DetailedPnLBreakdown labor children (de-dup basis)', () => {
  it('accrued basis: counts the pending/accrued total at % of net revenue, actual is not counted', () => {
    const pendingTotal = 20000; // 20% of net revenue
    const actualTotal = 38000;
    mockRevenueBreakdown();
    mockPeriodMetrics(pendingTotal);
    mockCostsFromSource(pendingTotal, actualTotal);

    render(<DetailedPnLBreakdown restaurantId="r1" />);

    const counted = getRow('Pending Payroll (Scheduled) — counted');
    expect(within(counted).getByText('$20,000.00')).toBeInTheDocument();
    expect(within(counted).getByText('20.0%')).toBeInTheDocument();

    const notCounted = getRow('Actual Payroll (Paid) — not counted this period');
    expect(within(notCounted).getByText('$38,000.00')).toBeInTheDocument();
    expect(within(notCounted).getByText('0.0%')).toBeInTheDocument();

    // The old bug summed pending + actual toward Labor Cost (~183% of a
    // benchmark-comparable total). Confirm that never happens: the two
    // labor children's percentages must not both be nonzero.
    expect(screen.queryByText('58.0%')).not.toBeInTheDocument();
  });

  it('paid basis: counts the actual/paid total at % of net revenue, accrued line is omitted (not just zeroed)', () => {
    const pendingTotal = 0;
    const actualTotal = 38000; // 38% of net revenue
    mockRevenueBreakdown();
    mockPeriodMetrics(actualTotal);
    mockCostsFromSource(pendingTotal, actualTotal);

    render(<DetailedPnLBreakdown restaurantId="r1" />);

    const counted = getRow('Actual Payroll (Paid) — counted');
    expect(within(counted).getByText('$38,000.00')).toBeInTheDocument();
    expect(within(counted).getByText('38.0%')).toBeInTheDocument();

    // pending is 0 this period, so the component omits the "not counted"
    // line entirely rather than rendering it at $0.00 / 0.0%.
    expect(
      screen.queryByText('Pending Payroll (Scheduled) — not counted this period')
    ).not.toBeInTheDocument();
  });

  it('guard: counted + not-counted percentages never sum to more than the counted share of net revenue', () => {
    const pendingTotal = 20000;
    const actualTotal = 38000;
    mockRevenueBreakdown();
    mockPeriodMetrics(pendingTotal);
    mockCostsFromSource(pendingTotal, actualTotal);

    render(<DetailedPnLBreakdown restaurantId="r1" />);

    const counted = getRow('Pending Payroll (Scheduled) — counted');
    const countedPctText = within(counted).getByText('20.0%').textContent;
    const countedPct = parseFloat(countedPctText!.replace('%', ''));

    const notCounted = getRow('Actual Payroll (Paid) — not counted this period');
    const notCountedPctText = within(notCounted).getByText('0.0%').textContent;
    const notCountedPct = parseFloat(notCountedPctText!.replace('%', ''));

    expect(countedPct).toBe((pendingTotal / NET_REVENUE) * 100); // 20
    expect(notCountedPct).toBe(0);
    // Sum is exactly the counted share (20%), never pending% + actual% (58%)
    // and nowhere near the ~183% the original double-count bug produced.
    expect(countedPct + notCountedPct).toBe(20);
  });

  it('overtime divergence: the labor children show the hook totals, not a re-sum of the straight-time dailyCosts', () => {
    // Hook totals carry OT + tips; the daily series stays straight-time.
    const pendingTotal = 22000; // includes 2,000 of overtime premium
    const actualTotal = 38000;
    mockRevenueBreakdown();
    mockPeriodMetrics(pendingTotal);
    mockCostsFromSourceDiverged({
      pendingTotal,
      actualTotal,
      dailyPendingSum: 20000, // straight-time only
      dailyActualSum: 36000,
      laborBasis: 'accrued',
    });

    render(<DetailedPnLBreakdown restaurantId="r1" />);

    // The counted row equals the hook total (22,000), so it matches the
    // Labor Cost header line. The old re-sum showed 20,000 here.
    const counted = getRow('Pending Payroll (Scheduled) — counted');
    expect(within(counted).getByText('$22,000.00')).toBeInTheDocument();
    expect(within(counted).getByText('22.0%')).toBeInTheDocument();
    expect(screen.queryByText('$20,000.00')).not.toBeInTheDocument();

    const notCounted = getRow('Actual Payroll (Paid) — not counted this period');
    expect(within(notCounted).getByText('$38,000.00')).toBeInTheDocument();
    expect(screen.queryByText('$36,000.00')).not.toBeInTheDocument();
  });
});
