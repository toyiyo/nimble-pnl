import { describe, it, expect, vi } from 'vitest';
import { sumMonthlyMetrics, fetchNetSales, sumMonthlyFoodCost } from '../../supabase/functions/_shared/financialAggregates';

const row = (over = {}) => ({
  period: '2026-07', gross_revenue: 100, sales_tax: 8, tips: 5,
  other_liabilities: 0, discounts: 3, refunds: 2, ...over,
});

describe('sumMonthlyMetrics', () => {
  it('sums across months and computes net = gross - discounts - refunds', () => {
    const t = sumMonthlyMetrics([row(), row({ period: '2026-06', gross_revenue: 50 })]);
    expect(t.gross).toBe(150);
    expect(t.net).toBe(150 - 6 - 4);
  });
  it('returns zeros for null and for an empty array', () => {
    expect(sumMonthlyMetrics(null).net).toBe(0);
    expect(sumMonthlyMetrics([]).gross).toBe(0);
  });
  it('treats a null numeric field as 0', () => {
    expect(sumMonthlyMetrics([row({ refunds: null as unknown as number })]).net).toBe(97);
  });
});

describe('fetchNetSales', () => {
  it('calls the RPC with the exact arguments and sums the rows', async () => {
    const rpc = vi.fn().mockResolvedValue({ data: [row()], error: null });
    const t = await fetchNetSales({ rpc } as never, 'rid', '2026-07-01', '2026-07-31');
    expect(rpc).toHaveBeenCalledWith('get_monthly_sales_metrics', {
      p_restaurant_id: 'rid', p_date_from: '2026-07-01', p_date_to: '2026-07-31',
    });
    expect(t.net).toBe(95);
  });
  it('throws on an RPC error instead of a silent zero', async () => {
    const rpc = vi.fn().mockResolvedValue({ data: null, error: { message: 'boom' } });
    await expect(fetchNetSales({ rpc } as never, 'rid', 'a', 'b')).rejects.toThrow('boom');
  });
});

describe('sumMonthlyFoodCost', () => {
  it('sums month rows and returns 0 for null', () => {
    expect(sumMonthlyFoodCost([{ period: '2026-07', food_cost: 10.5 }, { period: '2026-06', food_cost: 2 }])).toBe(12.5);
    expect(sumMonthlyFoodCost(null)).toBe(0);
  });
});
