/**
 * Monthly Metrics Tests
 * 
 * Tests the classifyAdjustmentIntoMonth function that powers the
 * Monthly Performance table on the dashboard.
 * 
 * This is critical because it determines how POS adjustments
 * (tax, tips, fees, discounts) are categorized month-by-month.
 */

import { describe, it, expect } from 'vitest';
import {
  classifyAdjustmentIntoMonth,
  createEmptyMonth,
  type MonthlyMapMonth,
  type AdjustmentInput,
} from '../../supabase/functions/_shared/monthlyMetrics';

// ===== HELPER FACTORIES =====

function createMonth(overrides: Partial<MonthlyMapMonth> = {}): MonthlyMapMonth {
  return {
    ...createEmptyMonth('2024-01'),
    ...overrides,
  };
}

function createAdjustment(overrides: Partial<AdjustmentInput> = {}): AdjustmentInput {
  return {
    total_price: 10,
    adjustment_type: null,
    is_categorized: false,
    chart_account: null,
    ...overrides,
  };
}

// ===== CATEGORIZED ADJUSTMENTS (BY CHART ACCOUNT) =====

describe('classifyAdjustmentIntoMonth - Categorized Adjustments', () => {
  describe('Sales Tax Classification', () => {
    it('classifies by account_subtype containing "sales" and "tax"', () => {
      const month = createMonth();
      const adjustment = createAdjustment({
        total_price: 8.25,
        is_categorized: true,
        chart_account: {
          account_subtype: 'sales_tax_payable',
          account_name: 'Tax Liability',
        },
      });

      classifyAdjustmentIntoMonth(month, adjustment);

      expect(month.sales_tax).toBe(825); // In cents
      expect(month.tips).toBe(0);
      expect(month.other_liabilities).toBe(0);
    });

    it('classifies by account_name containing "tax"', () => {
      const month = createMonth();
      const adjustment = createAdjustment({
        total_price: 5.00,
        is_categorized: true,
        chart_account: {
          account_subtype: 'liability',
          account_name: 'Sales Tax Collected',
        },
      });

      classifyAdjustmentIntoMonth(month, adjustment);

      expect(month.sales_tax).toBe(500);
    });

    it('is case-insensitive for subtype', () => {
      const month = createMonth();
      const adjustment = createAdjustment({
        total_price: 10.00,
        is_categorized: true,
        chart_account: {
          account_subtype: 'SALES_TAX',
          account_name: 'Tax',
        },
      });

      classifyAdjustmentIntoMonth(month, adjustment);

      expect(month.sales_tax).toBe(1000);
    });
  });

  describe('Tips Classification', () => {
    it('classifies by account_subtype containing "tip"', () => {
      const month = createMonth();
      const adjustment = createAdjustment({
        total_price: 15.00,
        is_categorized: true,
        chart_account: {
          account_subtype: 'tips_payable',
          account_name: 'Tips',
        },
      });

      classifyAdjustmentIntoMonth(month, adjustment);

      expect(month.tips).toBe(1500);
      expect(month.sales_tax).toBe(0);
    });

    it('classifies by account_name containing "tip"', () => {
      const month = createMonth();
      const adjustment = createAdjustment({
        total_price: 20.00,
        is_categorized: true,
        chart_account: {
          account_subtype: 'liability',
          account_name: 'Employee Tips Pool',
        },
      });

      classifyAdjustmentIntoMonth(month, adjustment);

      expect(month.tips).toBe(2000);
    });
  });

  describe('Other Liabilities Classification', () => {
    it('classifies unrecognized subtypes as other_liabilities', () => {
      const month = createMonth();
      const adjustment = createAdjustment({
        total_price: 3.99,
        is_categorized: true,
        chart_account: {
          account_subtype: 'delivery_fee',
          account_name: 'DoorDash Fee',
        },
      });

      classifyAdjustmentIntoMonth(month, adjustment);

      expect(month.other_liabilities).toBe(399);
      expect(month.sales_tax).toBe(0);
      expect(month.tips).toBe(0);
    });

    it('classifies service charges as other_liabilities', () => {
      const month = createMonth();
      const adjustment = createAdjustment({
        total_price: 5.00,
        is_categorized: true,
        chart_account: {
          account_subtype: 'service_charge',
          account_name: 'Auto Gratuity',
        },
      });

      classifyAdjustmentIntoMonth(month, adjustment);

      expect(month.other_liabilities).toBe(500);
    });
  });
});

// ===== UNCATEGORIZED ADJUSTMENTS (BY ADJUSTMENT_TYPE) =====

describe('classifyAdjustmentIntoMonth - Uncategorized Adjustments', () => {
  it('classifies tax adjustment_type', () => {
    const month = createMonth();
    const adjustment = createAdjustment({
      total_price: 8.25,
      adjustment_type: 'tax',
      is_categorized: false,
    });

    classifyAdjustmentIntoMonth(month, adjustment);

    expect(month.sales_tax).toBe(825);
  });

  it('classifies tip adjustment_type', () => {
    const month = createMonth();
    const adjustment = createAdjustment({
      total_price: 15.00,
      adjustment_type: 'tip',
      is_categorized: false,
    });

    classifyAdjustmentIntoMonth(month, adjustment);

    expect(month.tips).toBe(1500);
  });

  it('classifies service_charge adjustment_type', () => {
    const month = createMonth();
    const adjustment = createAdjustment({
      total_price: 5.00,
      adjustment_type: 'service_charge',
      is_categorized: false,
    });

    classifyAdjustmentIntoMonth(month, adjustment);

    expect(month.other_liabilities).toBe(500);
  });

  it('classifies fee adjustment_type', () => {
    const month = createMonth();
    const adjustment = createAdjustment({
      total_price: 2.99,
      adjustment_type: 'fee',
      is_categorized: false,
    });

    classifyAdjustmentIntoMonth(month, adjustment);

    expect(month.other_liabilities).toBe(299);
  });

  it('classifies discount adjustment_type', () => {
    const month = createMonth();
    const adjustment = createAdjustment({
      total_price: -10.00, // Discounts are typically negative
      adjustment_type: 'discount',
      is_categorized: false,
    });

    classifyAdjustmentIntoMonth(month, adjustment);

    expect(month.discounts).toBe(1000); // Absolute value
  });

  it('handles positive discount amount', () => {
    const month = createMonth();
    const adjustment = createAdjustment({
      total_price: 10.00, // Sometimes stored positive
      adjustment_type: 'discount',
      is_categorized: false,
    });

    classifyAdjustmentIntoMonth(month, adjustment);

    expect(month.discounts).toBe(1000); // Absolute value
  });
});

// ===== ACCUMULATION TESTS =====

describe('classifyAdjustmentIntoMonth - Accumulation', () => {
  it('accumulates multiple adjustments of same type', () => {
    const month = createMonth();
    
    classifyAdjustmentIntoMonth(month, createAdjustment({
      total_price: 5.00,
      adjustment_type: 'tax',
    }));
    classifyAdjustmentIntoMonth(month, createAdjustment({
      total_price: 3.00,
      adjustment_type: 'tax',
    }));
    classifyAdjustmentIntoMonth(month, createAdjustment({
      total_price: 2.00,
      adjustment_type: 'tax',
    }));

    expect(month.sales_tax).toBe(1000); // 5 + 3 + 2 = 10.00 = 1000 cents
  });

  it('accumulates different adjustment types independently', () => {
    const month = createMonth();
    
    classifyAdjustmentIntoMonth(month, createAdjustment({
      total_price: 8.25,
      adjustment_type: 'tax',
    }));
    classifyAdjustmentIntoMonth(month, createAdjustment({
      total_price: 15.00,
      adjustment_type: 'tip',
    }));
    classifyAdjustmentIntoMonth(month, createAdjustment({
      total_price: 3.00,
      adjustment_type: 'service_charge',
    }));
    classifyAdjustmentIntoMonth(month, createAdjustment({
      total_price: 5.00,
      adjustment_type: 'discount',
    }));

    expect(month.sales_tax).toBe(825);
    expect(month.tips).toBe(1500);
    expect(month.other_liabilities).toBe(300);
    expect(month.discounts).toBe(500);
  });

  it('starts from existing month values', () => {
    const month = createMonth({
      sales_tax: 500, // Existing $5.00
      tips: 1000,     // Existing $10.00
    });
    
    classifyAdjustmentIntoMonth(month, createAdjustment({
      total_price: 3.25,
      adjustment_type: 'tax',
    }));

    expect(month.sales_tax).toBe(825); // 500 + 325 = 825
    expect(month.tips).toBe(1000); // Unchanged
  });
});

// ===== EDGE CASES =====

describe('classifyAdjustmentIntoMonth - Edge Cases', () => {
  it('handles null total_price', () => {
    const month = createMonth();
    const adjustment = createAdjustment({
      total_price: null,
      adjustment_type: 'tax',
    });

    classifyAdjustmentIntoMonth(month, adjustment);

    expect(month.sales_tax).toBe(0);
  });

  it('handles undefined total_price', () => {
    const month = createMonth();
    const adjustment = createAdjustment({
      total_price: undefined,
      adjustment_type: 'tax',
    });

    classifyAdjustmentIntoMonth(month, adjustment);

    expect(month.sales_tax).toBe(0);
  });

  it('handles zero total_price', () => {
    const month = createMonth();
    const adjustment = createAdjustment({
      total_price: 0,
      adjustment_type: 'tax',
    });

    classifyAdjustmentIntoMonth(month, adjustment);

    expect(month.sales_tax).toBe(0);
  });

  it('handles null chart_account subtype', () => {
    const month = createMonth();
    const adjustment = createAdjustment({
      total_price: 10.00,
      is_categorized: true,
      chart_account: {
        account_subtype: null,
        account_name: 'Tax Collected',
      },
    });

    classifyAdjustmentIntoMonth(month, adjustment);

    // Should still classify by account_name
    expect(month.sales_tax).toBe(1000);
  });

  it('handles null chart_account name', () => {
    const month = createMonth();
    const adjustment = createAdjustment({
      total_price: 10.00,
      is_categorized: true,
      chart_account: {
        account_subtype: 'sales_tax',
        account_name: null,
      },
    });

    classifyAdjustmentIntoMonth(month, adjustment);

    // Should classify by subtype
    expect(month.sales_tax).toBe(1000);
  });

  it('handles unrecognized adjustment_type', () => {
    const month = createMonth();
    const adjustment = createAdjustment({
      total_price: 10.00,
      adjustment_type: 'unknown_type',
      is_categorized: false,
    });

    classifyAdjustmentIntoMonth(month, adjustment);

    // Should not affect any category
    expect(month.sales_tax).toBe(0);
    expect(month.tips).toBe(0);
    expect(month.other_liabilities).toBe(0);
    expect(month.discounts).toBe(0);
  });

  it('handles very small amounts (cents precision)', () => {
    const month = createMonth();
    const adjustment = createAdjustment({
      total_price: 0.01,
      adjustment_type: 'tax',
    });

    classifyAdjustmentIntoMonth(month, adjustment);

    expect(month.sales_tax).toBe(1); // 1 cent
  });

  it('handles very large amounts', () => {
    const month = createMonth();
    const adjustment = createAdjustment({
      total_price: 10000.00,
      adjustment_type: 'tax',
    });

    classifyAdjustmentIntoMonth(month, adjustment);

    expect(month.sales_tax).toBe(1000000); // $10,000 = 1,000,000 cents
  });
});

// ===== REAL-WORLD POS SCENARIOS =====

describe('Real-world POS Scenarios', () => {
  describe('Square POS Integration', () => {
    it('classifies Square tax correctly', () => {
      const month = createMonth();
      // Square sends tax as separate line item
      const adjustment = createAdjustment({
        total_price: 4.12,
        adjustment_type: 'tax',
        is_categorized: false,
      });

      classifyAdjustmentIntoMonth(month, adjustment);

      expect(month.sales_tax).toBe(412);
    });

    it('classifies Square tip correctly', () => {
      const month = createMonth();
      const adjustment = createAdjustment({
        total_price: 8.00,
        adjustment_type: 'tip',
        is_categorized: false,
      });

      classifyAdjustmentIntoMonth(month, adjustment);

      expect(month.tips).toBe(800);
    });
  });

  describe('Clover POS Integration', () => {
    it('handles Clover service charges', () => {
      const month = createMonth();
      // Clover often adds auto-gratuity as service_charge
      const adjustment = createAdjustment({
        total_price: 12.00,
        adjustment_type: 'service_charge',
        is_categorized: false,
      });

      classifyAdjustmentIntoMonth(month, adjustment);

      expect(month.other_liabilities).toBe(1200);
    });

    it('handles Clover percentage discounts', () => {
      const month = createMonth();
      // 15% off a $40 order = $6 discount
      const adjustment = createAdjustment({
        total_price: -6.00,
        adjustment_type: 'discount',
        is_categorized: false,
      });

      classifyAdjustmentIntoMonth(month, adjustment);

      expect(month.discounts).toBe(600);
    });
  });

  describe('Categorized by Accounting System', () => {
    it('handles QuickBooks-style categorization', () => {
      const month = createMonth();
      // When synced with accounting, items get proper chart accounts
      const taxAdjustment = createAdjustment({
        total_price: 41.25,
        is_categorized: true,
        chart_account: {
          account_subtype: 'Sales Tax Payable',
          account_name: 'State Sales Tax',
        },
      });
      const tipAdjustment = createAdjustment({
        total_price: 125.00,
        is_categorized: true,
        chart_account: {
          account_subtype: 'Tips Payable',
          account_name: 'Employee Tips',
        },
      });

      classifyAdjustmentIntoMonth(month, taxAdjustment);
      classifyAdjustmentIntoMonth(month, tipAdjustment);

      expect(month.sales_tax).toBe(4125);
      expect(month.tips).toBe(12500);
    });
  });

  describe('Full Day Simulation', () => {
    it('accumulates a full days worth of adjustments', () => {
      const month = createMonth();
      
      // Morning shift - 15 transactions
      for (let i = 0; i < 15; i++) {
        classifyAdjustmentIntoMonth(month, createAdjustment({
          total_price: 0.83, // ~$10 avg order * 8.25% tax
          adjustment_type: 'tax',
        }));
        classifyAdjustmentIntoMonth(month, createAdjustment({
          total_price: 1.50, // ~15% tip on $10
          adjustment_type: 'tip',
        }));
      }

      // Lunch rush - 50 transactions
      for (let i = 0; i < 50; i++) {
        classifyAdjustmentIntoMonth(month, createAdjustment({
          total_price: 1.24, // ~$15 avg * 8.25% tax
          adjustment_type: 'tax',
        }));
        classifyAdjustmentIntoMonth(month, createAdjustment({
          total_price: 2.70, // ~18% tip on $15
          adjustment_type: 'tip',
        }));
      }

      // 5 discounted orders
      for (let i = 0; i < 5; i++) {
        classifyAdjustmentIntoMonth(month, createAdjustment({
          total_price: 2.50,
          adjustment_type: 'discount',
        }));
      }

      // Expected totals:
      // Tax: (15 * 0.83) + (50 * 1.24) = 12.45 + 62 = 74.45 = 7445 cents
      // Tips: (15 * 1.50) + (50 * 2.70) = 22.50 + 135 = 157.50 = 15750 cents
      // Discounts: 5 * 2.50 = 12.50 = 1250 cents

      expect(month.sales_tax).toBe(7445);
      expect(month.tips).toBe(15750);
      expect(month.discounts).toBe(1250);
    });
  });
});
