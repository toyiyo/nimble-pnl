import { test, expect } from '@playwright/test';
import { RevenueCategory, mergeCategorizedAdjustments } from '../../src/hooks/useRevenueBreakdown';

test.describe('mergeCategorizedAdjustments helper', () => {
  test('merges a single categorized adjustment into categoryMap', () => {
    const categoryMap = new Map<string, RevenueCategory>();
    const adjustments = [
      {
        id: '1',
        adjustment_type: 'tax',
        total_price: 3.96,
        is_categorized: true,
        chart_account: {
          id: 'acct1',
          account_code: '2004',
          account_name: 'Sales Tax Payable',
          account_type: 'liability',
          account_subtype: 'other_liabilities',
        }
      }
    ];

    mergeCategorizedAdjustments(categoryMap, adjustments as any);

    const key = 'acct1-tax';
    expect(categoryMap.has(key)).toBeTruthy();
    const val = categoryMap.get(key)!;
    expect(val.total_amount).toBeCloseTo(3.96);
    expect(val.transaction_count).toBe(1);
  });

  test('accumulates amounts and count when key already exists', () => {
    const categoryMap = new Map<string, RevenueCategory>();
    categoryMap.set('acct1-tax', {
      account_id: 'acct1',
      account_code: '2004',
      account_name: 'Sales Tax Payable',
      account_type: 'liability',
      account_subtype: 'other_liabilities',
      total_amount: 5.00,
      transaction_count: 1,
    });

    const adjustments = [
      {
        id: '2',
        adjustment_type: 'tax',
        total_price: 2.00,
        is_categorized: true,
        chart_account: {
          id: 'acct1',
          account_code: '2004',
          account_name: 'Sales Tax Payable',
          account_type: 'liability',
          account_subtype: 'other_liabilities',
        }
      }
    ];

    mergeCategorizedAdjustments(categoryMap, adjustments as any);

    const val = categoryMap.get('acct1-tax')!;
    expect(val.total_amount).toBeCloseTo(7.00);
    expect(val.transaction_count).toBe(2);
  });
});
