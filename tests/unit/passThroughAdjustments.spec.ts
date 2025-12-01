import { test, expect } from '@playwright/test';
import { normalizeAdjustmentsWithPassThrough, splitPassThroughSales, classifyPassThroughItem } from '../../src/hooks/utils/passThroughAdjustments';

test.describe('pass-through adjustment helpers', () => {
  test('splits pass-through item types out of sales', () => {
    const sales = [
      { id: '1', item_type: 'sale' },
      { id: '2', item_type: 'tax' },
      { id: '3', item_type: 'tip' },
      { id: '4', item_type: 'refund' },
      { id: '5', item_type: 'sale', chart_account: { account_type: 'liability' } },
    ];

    const { revenue, passThrough } = splitPassThroughSales(sales);

    expect(revenue.map(s => s.id)).toEqual(['1', '4']);
    expect(passThrough.map(s => s.id)).toEqual(['2', '3', '5']);
  });

  test('normalizes adjustment_type for pass-through sales rows', () => {
    const adjustments = [
      { id: 'a1', adjustment_type: 'tax', total_price: 5 },
      { id: 'a2', adjustment_type: 'Tax', total_price: 7 },
    ];
    const passThrough = [
      { id: 'p1', item_type: 'tip', total_price: 10 },
      { id: 'p2', item_type: 'service_charge', adjustment_type: null, total_price: 20 },
    ];

    const combined = normalizeAdjustmentsWithPassThrough(adjustments as any, passThrough as any);

    const tipRow = combined.find((c: any) => c.id === 'p1');
    const serviceRow = combined.find((c: any) => c.id === 'p2');
    const taxRowUpper = combined.find((c: any) => c.id === 'a2');

    expect(tipRow?.adjustment_type).toBe('tip');
    expect(serviceRow?.adjustment_type).toBe('service_charge');
    expect(taxRowUpper?.adjustment_type).toBe('tax');
    expect(combined.length).toBe(4);
  });
});

test.describe('classifyPassThroughItem helper', () => {
  test('classifies categorized tax item by account_name containing "tax"', () => {
    // This is the key scenario from the bug report: sales tax items mapped to 
    // "2004 - Sales Tax Payable" with item_type: 'sale' (not 'tax')
    const item = {
      total_price: 3.96,
      is_categorized: true,
      item_type: 'sale', // Note: item_type is 'sale', not 'tax'
      adjustment_type: 'sale', // Normalized from item_type
      chart_account: {
        account_type: 'liability',
        account_subtype: 'other_liabilities',
        account_name: 'Sales Tax Payable',
      }
    };

    expect(classifyPassThroughItem(item)).toBe('tax');
  });

  test('classifies categorized tax item by account_subtype sales_tax', () => {
    const item = {
      total_price: 5.45,
      is_categorized: true,
      item_type: 'sale',
      adjustment_type: 'sale',
      chart_account: {
        account_type: 'liability',
        account_subtype: 'sales_tax',
        account_name: 'State Sales Tax',
      }
    };

    expect(classifyPassThroughItem(item)).toBe('tax');
  });

  test('classifies categorized tip item by account_name containing "tip"', () => {
    const item = {
      total_price: 4.25,
      is_categorized: true,
      item_type: 'sale',
      adjustment_type: 'sale',
      chart_account: {
        account_type: 'liability',
        account_subtype: 'other_liabilities',
        account_name: 'Tips Payable',
      }
    };

    expect(classifyPassThroughItem(item)).toBe('tip');
  });

  test('classifies categorized tip item by account_subtype tips', () => {
    const item = {
      total_price: 10.00,
      is_categorized: true,
      item_type: 'sale',
      adjustment_type: 'sale',
      chart_account: {
        account_type: 'liability',
        account_subtype: 'tips',
        account_name: 'Staff Tips',
      }
    };

    expect(classifyPassThroughItem(item)).toBe('tip');
  });

  test('classifies other liability items as "other"', () => {
    const item = {
      total_price: 50.00,
      is_categorized: true,
      item_type: 'sale',
      adjustment_type: 'sale',
      chart_account: {
        account_type: 'liability',
        account_subtype: 'other_liabilities',
        account_name: 'Service Charges Payable',
      }
    };

    expect(classifyPassThroughItem(item)).toBe('other');
  });

  test('falls back to adjustment_type for uncategorized items', () => {
    const taxItem = {
      total_price: 2.00,
      is_categorized: false,
      adjustment_type: 'tax',
    };

    const tipItem = {
      total_price: 3.00,
      is_categorized: false,
      adjustment_type: 'tip',
    };

    const serviceChargeItem = {
      total_price: 5.00,
      is_categorized: false,
      adjustment_type: 'service_charge',
    };

    const feeItem = {
      total_price: 1.00,
      is_categorized: false,
      adjustment_type: 'fee',
    };

    const discountItem = {
      total_price: -5.00,
      is_categorized: false,
      adjustment_type: 'discount',
    };

    expect(classifyPassThroughItem(taxItem)).toBe('tax');
    expect(classifyPassThroughItem(tipItem)).toBe('tip');
    expect(classifyPassThroughItem(serviceChargeItem)).toBe('service_charge');
    expect(classifyPassThroughItem(feeItem)).toBe('fee');
    expect(classifyPassThroughItem(discountItem)).toBe('discount');
  });

  test('classifies non-liability categorized items by adjustment_type', () => {
    // If a categorized item has a non-liability account type, 
    // it should fall back to adjustment_type
    const item = {
      total_price: 100.00,
      is_categorized: true,
      adjustment_type: 'tax',
      chart_account: {
        account_type: 'revenue', // Not a liability
        account_subtype: 'food_sales',
        account_name: 'Food Sales',
      }
    };

    // Should fall back to adjustment_type since it's not a liability
    expect(classifyPassThroughItem(item)).toBe('tax');
  });

  test('returns "other" for uncategorized items with no adjustment_type', () => {
    const item = {
      total_price: 10.00,
      is_categorized: false,
      adjustment_type: '',
    };

    expect(classifyPassThroughItem(item)).toBe('other');
  });

  test('classifies items by item_name when adjustment_type is not set', () => {
    // This is the key scenario from the bug report: items with item_name like 
    // "MB Sales Tax" or "Sales Tax" that haven't been categorized yet
    const salesTaxItem = {
      total_price: 3.96,
      is_categorized: false,
      item_type: 'sale',
      item_name: 'MB Sales Tax',
    };

    const tipItem = {
      total_price: 2.00,
      is_categorized: false,
      item_type: 'sale',
      item_name: 'Credit Tip',
    };

    const serviceChargeItem = {
      total_price: 0.82,
      is_categorized: false,
      item_type: 'sale',
      item_name: 'Dual Pricing Service Fee',
    };

    expect(classifyPassThroughItem(salesTaxItem)).toBe('tax');
    expect(classifyPassThroughItem(tipItem)).toBe('tip');
    expect(classifyPassThroughItem(serviceChargeItem)).toBe('service_charge');
  });

  test('splitPassThroughSales identifies items by item_name', () => {
    const sales = [
      { id: '1', item_type: 'sale', item_name: "Tito's" },
      { id: '2', item_type: 'sale', item_name: 'MB Sales Tax' },
      { id: '3', item_type: 'sale', item_name: 'Credit Tip' },
      { id: '4', item_type: 'sale', item_name: 'Coors Banq' },
    ];

    const { revenue, passThrough } = splitPassThroughSales(sales);

    expect(revenue.map(s => s.id)).toEqual(['1', '4']);
    expect(passThrough.map(s => s.id)).toEqual(['2', '3']);
  });
});
