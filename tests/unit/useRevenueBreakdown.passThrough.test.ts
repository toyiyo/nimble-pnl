import { describe, it, expect } from 'vitest';
import { reduceRevenueBreakdownPassThrough } from '@/hooks/useRevenueBreakdown';

describe('reduceRevenueBreakdownPassThrough', () => {
  it('ignores unknown adjustment types instead of bucketing them as otherLiabilities', () => {
    const result = reduceRevenueBreakdownPassThrough([
      { adjustment_type: 'tax',            total_amount: 100, transaction_count: 1 },
      { adjustment_type: 'tip',            total_amount: 50,  transaction_count: 1 },
      { adjustment_type: 'service_charge', total_amount: 25,  transaction_count: 1 },
      { adjustment_type: 'fee',            total_amount: 10,  transaction_count: 1 },
      { adjustment_type: 'discount',       total_amount: -5,  transaction_count: 1 },
      { adjustment_type: 'void',           total_amount: -200, transaction_count: 1 },
      { adjustment_type: 'mystery',        total_amount: 999,  transaction_count: 1 },
    ]);
    expect(result.taxCents).toBe(10_000);
    expect(result.tipsCents).toBe(5_000);
    expect(result.discountsCents).toBe(500);
    expect(result.otherLiabilitiesCents).toBe(3_500); // 25 + 10
  });

  it('returns zeros for an empty input', () => {
    const r = reduceRevenueBreakdownPassThrough([]);
    expect(r).toEqual({ taxCents: 0, tipsCents: 0, discountsCents: 0, otherLiabilitiesCents: 0 });
  });

  it('handles nullish/missing total_amount gracefully', () => {
    const r = reduceRevenueBreakdownPassThrough([
      { adjustment_type: 'tax', total_amount: null as unknown as number, transaction_count: 1 },
      { adjustment_type: 'tip', transaction_count: 0 } as any,
    ]);
    expect(r.taxCents).toBe(0);
    expect(r.tipsCents).toBe(0);
  });
});
