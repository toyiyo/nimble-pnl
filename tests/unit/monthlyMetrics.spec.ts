import { test, expect } from '@playwright/test';
import { classifyAdjustmentIntoMonth } from '../../src/hooks/useMonthlyMetrics';

test.describe('classifyAdjustmentIntoMonth', () => {
  test('categorizes a categorized tax adjustment into sales_tax', () => {
    const month: any = {
      period: '2025-11',
      gross_revenue: 0,
      total_collected_at_pos: 0,
      net_revenue: 0,
      discounts: 0,
      refunds: 0,
      sales_tax: 0,
      tips: 0,
      other_liabilities: 0,
      food_cost: 0,
      labor_cost: 0,
      pending_labor_cost: 0,
      actual_labor_cost: 0,
      has_data: false,
    };

    const adjustment = {
      total_price: 10,
      is_categorized: true,
      chart_account: { account_name: 'Sales Tax Payable', account_subtype: 'other_liabilities', account_type: 'liability' },
      adjustment_type: 'tax',
    };

    classifyAdjustmentIntoMonth(month, adjustment);
    expect(month.sales_tax).toBe(1000); // $10 -> 1000 cents
  });

  test('categorizes an uncategorized tax adjustment using adjustment_type', () => {
    const month: any = Object.assign({}, {
      period: '2025-11',
      gross_revenue: 0,
      total_collected_at_pos: 0,
      net_revenue: 0,
      discounts: 0,
      refunds: 0,
      sales_tax: 0,
      tips: 0,
      other_liabilities: 0,
      food_cost: 0,
      labor_cost: 0,
      pending_labor_cost: 0,
      actual_labor_cost: 0,
      has_data: false,
    });

    const adjustment = {
      total_price: 5,
      is_categorized: false,
      adjustment_type: 'tax',
    };

    classifyAdjustmentIntoMonth(month, adjustment);
    expect(month.sales_tax).toBe(500);
  });

  test('categorizes categorized tip adjustment into tips', () => {
    const month: any = {
      period: '2025-11',
      gross_revenue: 0,
      total_collected_at_pos: 0,
      net_revenue: 0,
      discounts: 0,
      refunds: 0,
      sales_tax: 0,
      tips: 0,
      other_liabilities: 0,
      food_cost: 0,
      labor_cost: 0,
      pending_labor_cost: 0,
      actual_labor_cost: 0,
      has_data: false,
    };

    const adjustment = {
      total_price: 4.25,
      is_categorized: true,
      chart_account: { account_name: 'Tips Payable', account_subtype: 'tips', account_type: 'liability' },
      adjustment_type: 'tip',
    };

    classifyAdjustmentIntoMonth(month, adjustment);
    expect(month.tips).toBe(425);
  });
});
