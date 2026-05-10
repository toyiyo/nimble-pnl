/**
 * Regression: useMonthlyMetrics.fetchMonthRevenueTotals must report
 * `total_collected_at_pos` as the deposit-matching SUM(unified_sales.total_price)
 * over the period — i.e. the value returned by `get_unified_sales_totals`.
 *
 * Russo's Pizzeria May 2026 production numbers:
 *   - SUM(unified_sales.total_price)        = $31,596.36   ← Collected at POS
 *   - gross (positive item rows)            = $26,903.04
 *   - discounts (negative)                  = -$625.04
 *   - tax / tip / service_charge / fee      = $2,101.05 / $3,946.71 / 0 / 0
 *   - implied void/discount offsets in unified_sales = -$1,354.44
 *
 * Old formula `gross + tax + tips + other` produced $32,950.80, which excluded
 * the offsets and disagreed with the POS Sales page. New formula sources
 * `total_collected_at_pos` directly from `get_unified_sales_totals` so the
 * Monthly Performance row matches the deposit.
 */

import { describe, it, expect, vi } from 'vitest';
import { fetchMonthRevenueTotals } from '@/hooks/useMonthlyMetrics';

describe('fetchMonthRevenueTotals — Collected at POS source of truth', () => {
  it('reports posCollectedCents from get_unified_sales_totals.collected_at_pos for Russo May 2026', async () => {
    const supabaseMock = {
      rpc: vi.fn((name: string) => {
        if (name === 'get_revenue_by_account') {
          return Promise.resolve({
            data: [
              {
                account_id: 'food',
                account_code: '4000',
                account_name: 'Food Sales',
                account_type: 'revenue',
                account_subtype: 'food_sales',
                total_amount: 26903.04,
                transaction_count: 362,
                is_categorized: true,
              },
            ],
            error: null,
          });
        }
        if (name === 'get_pass_through_totals') {
          return Promise.resolve({
            data: [
              { adjustment_type: 'tax',      total_amount: 2101.05, transaction_count: 100 },
              { adjustment_type: 'tip',      total_amount: 3946.71, transaction_count: 80 },
              { adjustment_type: 'discount', total_amount: -625.04, transaction_count: 5 },
            ],
            error: null,
          });
        }
        if (name === 'get_unified_sales_totals') {
          return Promise.resolve({
            data: [
              {
                total_count: 800,
                revenue: 26903.04,
                discounts: 625.04,
                pass_through_amount: 6047.76,
                unique_items: 362,
                collected_at_pos: 31596.36,
              },
            ],
            error: null,
          });
        }
        return Promise.resolve({ data: [], error: null });
      }),
    };

    const result = await fetchMonthRevenueTotals(
      supabaseMock as never,
      'adbd9392-928a-4a46-80d7-f7e453aa1956',
      '2026-05-01',
      '2026-05-31'
    );

    expect(result.grossRevenueCents).toBe(2_690_304);     // 26,903.04 * 100
    expect(result.discountsCents).toBe(62_504);           // |−625.04| * 100
    expect(result.netRevenueCents).toBe(2_627_800);       // gross − discounts = $26,278.00
    expect(result.salesTaxCents).toBe(210_105);
    expect(result.tipsCents).toBe(394_671);
    // Critical: posCollectedCents now comes from get_unified_sales_totals,
    // not gross + tax + tips + other_liabilities.
    expect(result.posCollectedCents).toBe(3_159_636);     // $31,596.36 * 100
  });

  it('falls back to legacy gross + tax + tips + other when get_unified_sales_totals errors', async () => {
    const supabaseMock = {
      rpc: vi.fn((name: string) => {
        if (name === 'get_revenue_by_account') {
          return Promise.resolve({
            data: [
              { account_id: 'food', account_code: '4000', account_name: 'Food', account_type: 'revenue', account_subtype: 'food_sales', total_amount: 1000, transaction_count: 10, is_categorized: true },
            ],
            error: null,
          });
        }
        if (name === 'get_pass_through_totals') {
          return Promise.resolve({
            data: [
              { adjustment_type: 'tax', total_amount: 80, transaction_count: 10 },
              { adjustment_type: 'tip', total_amount: 50, transaction_count: 10 },
              { adjustment_type: 'fee', total_amount: 20, transaction_count: 10 },
            ],
            error: null,
          });
        }
        if (name === 'get_unified_sales_totals') {
          return Promise.resolve({ data: null, error: { message: 'rpc unavailable' } });
        }
        return Promise.resolve({ data: [], error: null });
      }),
    };

    const result = await fetchMonthRevenueTotals(
      supabaseMock as never,
      'rest',
      '2026-05-01',
      '2026-05-31'
    );

    // Legacy formula: 1000 + 80 + 50 + 20 = 1150 dollars → 115_000 cents.
    expect(result.posCollectedCents).toBe(115_000);
  });

  it('calls get_unified_sales_totals with the requested period bounds', async () => {
    const rpc = vi.fn((name: string) => {
      if (name === 'get_revenue_by_account') return Promise.resolve({ data: [], error: null });
      if (name === 'get_pass_through_totals') return Promise.resolve({ data: [], error: null });
      if (name === 'get_unified_sales_totals') {
        return Promise.resolve({
          data: [{
            total_count: 0, revenue: 0, discounts: 0,
            pass_through_amount: 0, unique_items: 0, collected_at_pos: 0,
          }],
          error: null,
        });
      }
      return Promise.resolve({ data: [], error: null });
    });

    await fetchMonthRevenueTotals(
      { rpc } as never,
      'rest-uuid',
      '2026-05-01',
      '2026-05-31'
    );

    const call = rpc.mock.calls.find((c) => c[0] === 'get_unified_sales_totals');
    expect(call).toBeDefined();
    expect(call![1]).toMatchObject({
      p_restaurant_id: 'rest-uuid',
      p_start_date: '2026-05-01',
      p_end_date: '2026-05-31',
    });
  });
});
