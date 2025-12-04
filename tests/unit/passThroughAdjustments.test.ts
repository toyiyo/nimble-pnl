/**
 * Pass-Through Adjustments Tests
 * 
 * Tests the classification logic for POS pass-through items:
 * - Tax (sales tax, VAT, GST)
 * - Tips (credit tips, cash tips, gratuity)
 * - Service charges
 * - Discounts
 * - Fees (delivery, platform)
 * 
 * This is critical for correctly separating revenue from liabilities
 * in the dashboard and P&L calculations.
 */

import { describe, it, expect } from 'vitest';
import {
  classifyPassThroughItem,
  splitPassThroughSales,
  normalizeAdjustmentsWithPassThrough,
  type PassThroughRow,
  type PassThroughType,
} from '@/hooks/utils/passThroughAdjustments';

// ===== HELPER FACTORIES =====

function createRow(overrides: Partial<PassThroughRow> = {}): PassThroughRow {
  return {
    item_type: 'sale',
    item_name: null,
    adjustment_type: null,
    is_categorized: false,
    chart_account: null,
    ...overrides,
  };
}

// ===== CLASSIFY PASS-THROUGH ITEM TESTS =====

describe('classifyPassThroughItem', () => {
  describe('chart_account based classification', () => {
    it('classifies sales tax from liability account', () => {
      const item = createRow({
        is_categorized: true,
        chart_account: {
          account_type: 'liability',
          account_subtype: 'sales_tax',
          account_name: 'Sales Tax Payable',
        },
      });

      expect(classifyPassThroughItem(item)).toBe('tax');
    });

    it('classifies tips from liability account', () => {
      const item = createRow({
        is_categorized: true,
        chart_account: {
          account_type: 'liability',
          account_subtype: 'tips_payable',
          account_name: 'Tips Payable',
        },
      });

      expect(classifyPassThroughItem(item)).toBe('tip');
    });

    it('classifies other liability accounts as other', () => {
      const item = createRow({
        is_categorized: true,
        chart_account: {
          account_type: 'liability',
          account_subtype: 'service_charge',
          account_name: 'Service Charges',
        },
      });

      expect(classifyPassThroughItem(item)).toBe('other');
    });

    it('does not classify revenue accounts as pass-through', () => {
      const item = createRow({
        is_categorized: true,
        chart_account: {
          account_type: 'revenue',
          account_subtype: 'food_sales',
          account_name: 'Food Sales',
        },
      });

      // Falls through to 'other' since no adjustment_type or item_name match
      expect(classifyPassThroughItem(item)).toBe('other');
    });
  });

  describe('adjustment_type based classification', () => {
    it('classifies tax adjustment_type', () => {
      const item = createRow({ adjustment_type: 'tax' });
      expect(classifyPassThroughItem(item)).toBe('tax');
    });

    it('classifies tip adjustment_type', () => {
      const item = createRow({ adjustment_type: 'tip' });
      expect(classifyPassThroughItem(item)).toBe('tip');
    });

    it('classifies service_charge adjustment_type', () => {
      const item = createRow({ adjustment_type: 'service_charge' });
      expect(classifyPassThroughItem(item)).toBe('service_charge');
    });

    it('classifies fee adjustment_type', () => {
      const item = createRow({ adjustment_type: 'fee' });
      expect(classifyPassThroughItem(item)).toBe('fee');
    });

    it('classifies discount adjustment_type', () => {
      const item = createRow({ adjustment_type: 'discount' });
      expect(classifyPassThroughItem(item)).toBe('discount');
    });
  });

  describe('item_name based classification (fallback)', () => {
    it('classifies "Sales Tax" item name as tax', () => {
      const item = createRow({ item_name: 'Sales Tax' });
      expect(classifyPassThroughItem(item)).toBe('tax');
    });

    it('classifies "MB Sales Tax" item name as tax', () => {
      const item = createRow({ item_name: 'MB Sales Tax' });
      expect(classifyPassThroughItem(item)).toBe('tax');
    });

    it('classifies "Credit Tip" item name as tip', () => {
      const item = createRow({ item_name: 'Credit Tip' });
      expect(classifyPassThroughItem(item)).toBe('tip');
    });

    it('classifies "Gratuity" item name as tip', () => {
      const item = createRow({ item_name: 'Gratuity' });
      expect(classifyPassThroughItem(item)).toBe('tip');
    });

    it('classifies "Service Charge" item name as service_charge', () => {
      const item = createRow({ item_name: 'Service Charge' });
      expect(classifyPassThroughItem(item)).toBe('service_charge');
    });

    it('classifies "Dual Pricing" item name as service_charge', () => {
      const item = createRow({ item_name: 'Dual Pricing Fee' });
      expect(classifyPassThroughItem(item)).toBe('service_charge');
    });

    it('classifies "Discount" item name as discount', () => {
      const item = createRow({ item_name: 'Manager Discount' });
      expect(classifyPassThroughItem(item)).toBe('discount');
    });

    it('classifies "Comp" item name as discount', () => {
      const item = createRow({ item_name: 'Comp - Manager' });
      expect(classifyPassThroughItem(item)).toBe('discount');
    });

    it('classifies "Delivery Fee" item name as fee', () => {
      const item = createRow({ item_name: 'Delivery Fee' });
      expect(classifyPassThroughItem(item)).toBe('fee');
    });

    it('does not match partial words (e.g., "taxation" should not match "tax")', () => {
      const item = createRow({ item_name: 'Taxation Discussion' });
      // Should fall through to 'other' since "taxation" doesn't match "tax" as a whole word
      expect(classifyPassThroughItem(item)).toBe('other');
    });
  });

  describe('priority order', () => {
    it('prefers chart_account over adjustment_type', () => {
      const item = createRow({
        is_categorized: true,
        adjustment_type: 'tip',
        chart_account: {
          account_type: 'liability',
          account_subtype: 'sales_tax',
          account_name: 'Sales Tax',
        },
      });

      expect(classifyPassThroughItem(item)).toBe('tax');
    });

    it('prefers adjustment_type over item_name', () => {
      const item = createRow({
        adjustment_type: 'service_charge',
        item_name: 'Credit Tip',
      });

      expect(classifyPassThroughItem(item)).toBe('service_charge');
    });
  });
});

// ===== SPLIT PASS-THROUGH SALES TESTS =====

describe('splitPassThroughSales', () => {
  it('separates revenue from pass-through items', () => {
    const sales = [
      createRow({ item_type: 'sale', item_name: 'Burger' }),
      createRow({ item_type: 'sale', item_name: 'Fries' }),
      createRow({ item_type: 'tax', item_name: 'Sales Tax' }),
      createRow({ item_type: 'tip', item_name: 'Credit Tip' }),
    ];

    const result = splitPassThroughSales(sales);

    expect(result.revenue).toHaveLength(2);
    expect(result.passThrough).toHaveLength(2);
  });

  it('treats liability-mapped items as pass-through', () => {
    const sales = [
      createRow({ item_type: 'sale', item_name: 'Food Item' }),
      createRow({
        item_type: 'sale',
        item_name: 'Tax Item',
        is_categorized: true,
        chart_account: {
          account_type: 'liability',
          account_subtype: 'sales_tax',
        },
      }),
    ];

    const result = splitPassThroughSales(sales);

    expect(result.revenue).toHaveLength(1);
    expect(result.passThrough).toHaveLength(1);
    expect(result.passThrough[0].item_name).toBe('Tax Item');
  });

  it('detects pass-through from item_name keywords', () => {
    const sales = [
      createRow({ item_type: 'sale', item_name: 'Regular Food Item' }),
      createRow({ item_type: 'sale', item_name: 'Sales Tax' }),
      createRow({ item_type: 'sale', item_name: 'Credit Tip' }),
    ];

    const result = splitPassThroughSales(sales);

    expect(result.revenue).toHaveLength(1);
    expect(result.passThrough).toHaveLength(2);
  });

  it('handles null and empty arrays', () => {
    expect(splitPassThroughSales(null)).toEqual({ revenue: [], passThrough: [] });
    expect(splitPassThroughSales(undefined)).toEqual({ revenue: [], passThrough: [] });
    expect(splitPassThroughSales([])).toEqual({ revenue: [], passThrough: [] });
  });

  it('identifies discount, service_charge, fee item types', () => {
    const sales = [
      createRow({ item_type: 'sale', item_name: 'Food' }),
      createRow({ item_type: 'discount', item_name: 'Manager Discount' }),
      createRow({ item_type: 'service_charge', item_name: 'Service Fee' }),
      createRow({ item_type: 'fee', item_name: 'Delivery Fee' }),
    ];

    const result = splitPassThroughSales(sales);

    expect(result.revenue).toHaveLength(1);
    expect(result.passThrough).toHaveLength(3);
  });
});

// ===== NORMALIZE ADJUSTMENTS TESTS =====

describe('normalizeAdjustmentsWithPassThrough', () => {
  it('combines adjustments and pass-through rows', () => {
    const adjustments = [
      createRow({ adjustment_type: 'tax', item_name: 'Tax 1' }),
    ];
    const passThrough = [
      createRow({ item_type: 'tip', item_name: 'Tip 1' }),
    ];

    const result = normalizeAdjustmentsWithPassThrough(adjustments, passThrough);

    expect(result).toHaveLength(2);
  });

  it('normalizes adjustment_type from item_type', () => {
    const adjustments: PassThroughRow[] = [];
    const passThrough = [
      createRow({ item_type: 'TAX', adjustment_type: null }),
    ];

    const result = normalizeAdjustmentsWithPassThrough(adjustments, passThrough);

    expect(result[0].adjustment_type).toBe('tax');
  });

  it('handles null inputs', () => {
    expect(normalizeAdjustmentsWithPassThrough(null, null)).toEqual([]);
    expect(normalizeAdjustmentsWithPassThrough(undefined, undefined)).toEqual([]);
  });

  it('preserves original properties while adding normalized adjustment_type', () => {
    const passThrough = [
      createRow({
        item_type: 'TAX',
        item_name: 'Sales Tax',
        is_categorized: true,
      }),
    ];

    const result = normalizeAdjustmentsWithPassThrough([], passThrough);

    expect(result[0].item_name).toBe('Sales Tax');
    expect(result[0].is_categorized).toBe(true);
    expect(result[0].adjustment_type).toBe('tax');
  });
});

// ===== REAL-WORLD SCENARIOS =====

describe('Real-world POS scenarios', () => {
  it('handles Square POS data format', () => {
    // Square often uses adjustment_type for pass-through items
    const sales = [
      createRow({ item_type: 'sale', item_name: 'Margherita Pizza', adjustment_type: null }),
      createRow({ item_type: 'sale', item_name: 'Caesar Salad', adjustment_type: null }),
    ];
    const adjustments = [
      createRow({ adjustment_type: 'tax', item_name: null }),
      createRow({ adjustment_type: 'tip', item_name: null }),
    ];

    const splitResult = splitPassThroughSales(sales);
    expect(splitResult.revenue).toHaveLength(2);
    
    adjustments.forEach(adj => {
      const type = classifyPassThroughItem(adj);
      expect(['tax', 'tip']).toContain(type);
    });
  });

  it('handles Clover POS data format with item_name-based tax', () => {
    // Clover sometimes has item_type: 'sale' but item_name: 'Sales Tax'
    const sales = [
      createRow({ item_type: 'sale', item_name: 'Steak Dinner' }),
      createRow({ item_type: 'sale', item_name: 'MB Sales Tax' }),
      createRow({ item_type: 'sale', item_name: 'Credit Tip' }),
    ];

    const result = splitPassThroughSales(sales);

    expect(result.revenue).toHaveLength(1);
    expect(result.revenue[0].item_name).toBe('Steak Dinner');
    expect(result.passThrough).toHaveLength(2);
  });

  it('handles mixed categorized and uncategorized data', () => {
    const sales = [
      // Categorized revenue
      createRow({
        item_type: 'sale',
        item_name: 'Food Item',
        is_categorized: true,
        chart_account: { account_type: 'revenue', account_subtype: 'food_sales' },
      }),
      // Uncategorized revenue
      createRow({
        item_type: 'sale',
        item_name: 'Unknown Item',
        is_categorized: false,
      }),
      // Categorized liability (tax)
      createRow({
        item_type: 'sale',
        item_name: 'Tax',
        is_categorized: true,
        chart_account: { account_type: 'liability', account_subtype: 'sales_tax' },
      }),
    ];

    const result = splitPassThroughSales(sales);

    expect(result.revenue).toHaveLength(2); // Both food items
    expect(result.passThrough).toHaveLength(1); // Just the tax
  });
});
