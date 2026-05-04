import { describe, it, expect, vi } from 'vitest';
import { fetchMonthRevenueTotals } from '@/hooks/useMonthlyMetrics';

describe('fetchMonthRevenueTotals', () => {
  it('returns gross = categorized + uncategorized, net = gross − discounts, POS = gross + tax + tips + otherLiabilities', async () => {
    const supabaseMock = {
      rpc: vi.fn((name: string) => {
        if (name === 'get_revenue_by_account') {
          return Promise.resolve({
            data: [
              { account_id: 'a1', account_code: '4000', account_name: 'Food',    account_type: 'revenue', account_subtype: 'food_sales',     total_amount: 5000, transaction_count: 10, is_categorized: true },
              { account_id: null, account_code: null, account_name: 'Uncategorized', account_type: 'revenue', account_subtype: null,             total_amount: 1000, transaction_count: 3,  is_categorized: false },
            ],
            error: null,
          });
        }
        if (name === 'get_pass_through_totals') {
          return Promise.resolve({
            data: [
              { adjustment_type: 'tax',            total_amount: 300,  transaction_count: 5 },
              { adjustment_type: 'tip',            total_amount: 200,  transaction_count: 5 },
              { adjustment_type: 'service_charge', total_amount: 50,   transaction_count: 1 },
              { adjustment_type: 'discount',       total_amount: -100, transaction_count: 2 },
              { adjustment_type: 'fee',            total_amount: 25,   transaction_count: 1 },
            ],
            error: null,
          });
        }
        return Promise.resolve({ data: [], error: null });
      }),
    };

    const result = await fetchMonthRevenueTotals(
      supabaseMock as any,
      'r1',
      '2026-04-01',
      '2026-04-30'
    );

    expect(result.grossRevenueCents).toBe(600_000); // (5000 + 1000) dollars * 100
    expect(result.discountsCents).toBe(10_000);     // |−100| dollars * 100
    expect(result.netRevenueCents).toBe(590_000);   // gross − discounts
    expect(result.salesTaxCents).toBe(30_000);
    expect(result.tipsCents).toBe(20_000);
    expect(result.otherLiabilitiesCents).toBe(7_500);   // service_charge 50 + fee 25
    expect(result.posCollectedCents).toBe(657_500); // gross + tax + tips + otherL
  });
});
