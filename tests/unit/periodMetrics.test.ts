/**
 * Period Metrics Tests
 * 
 * Tests the core dashboard calculation engine used for:
 * - Revenue breakdown (gross, net, discounts, refunds)
 * - Cost breakdown (food cost, labor cost, prime cost)
 * - Profitability metrics (gross profit, profit margin)
 * - Benchmark status (industry standard comparisons)
 * 
 * These calculations are critical - mistakes here show incorrect
 * financial data on the dashboard.
 */

import { describe, it, expect } from 'vitest';
import {
  filterSplitSales,
  calculateRevenueBreakdown,
  calculateCostBreakdown,
  calculateProfitability,
  calculateBenchmarks,
  calculatePeriodMetrics,
  type SaleRecord,
  type AdjustmentRecord,
  type InventoryTransactionRecord,
  type LaborCostRecord,
} from '../../supabase/functions/_shared/periodMetrics';

// ===== HELPER FACTORIES =====

function createSale(overrides: Partial<SaleRecord> = {}): SaleRecord {
  return {
    id: `sale-${Math.random().toString(36).substring(7)}`,
    total_price: 100,
    item_type: 'sale',
    parent_sale_id: null,
    is_categorized: true,
    chart_account: {
      account_type: 'revenue',
      account_subtype: 'sales',
    },
    ...overrides,
  };
}

function createAdjustment(overrides: Partial<AdjustmentRecord> = {}): AdjustmentRecord {
  return {
    adjustment_type: 'tax',
    total_price: 10,
    ...overrides,
  };
}

// ===== FILTER SPLIT SALES TESTS =====

describe('filterSplitSales', () => {
  it('returns all sales when none are split', () => {
    const sales = [
      createSale({ id: '1' }),
      createSale({ id: '2' }),
      createSale({ id: '3' }),
    ];

    const result = filterSplitSales(sales);
    
    expect(result).toHaveLength(3);
    expect(result.map(s => s.id)).toEqual(['1', '2', '3']);
  });

  it('excludes parent sales that have children', () => {
    const sales = [
      createSale({ id: 'parent-1' }),
      createSale({ id: 'child-1', parent_sale_id: 'parent-1' }),
      createSale({ id: 'child-2', parent_sale_id: 'parent-1' }),
      createSale({ id: 'standalone' }),
    ];

    const result = filterSplitSales(sales);
    
    // Should include children and standalone, but not parent
    expect(result).toHaveLength(3);
    expect(result.map(s => s.id)).toContain('child-1');
    expect(result.map(s => s.id)).toContain('child-2');
    expect(result.map(s => s.id)).toContain('standalone');
    expect(result.map(s => s.id)).not.toContain('parent-1');
  });

  it('handles empty array', () => {
    const result = filterSplitSales([]);
    expect(result).toHaveLength(0);
  });
});

// ===== REVENUE BREAKDOWN TESTS =====

describe('calculateRevenueBreakdown', () => {
  describe('basic revenue calculations', () => {
    it('calculates gross revenue from categorized sales', () => {
      const sales = [
        createSale({ total_price: 100 }),
        createSale({ total_price: 50 }),
        createSale({ total_price: 25.50 }),
      ];

      const result = calculateRevenueBreakdown(sales, []);

      expect(result.gross_revenue).toBe(175.50);
      expect(result.net_revenue).toBe(175.50);
      expect(result.sales_count).toBe(3);
    });

    it('treats uncategorized sales as revenue', () => {
      const sales = [
        createSale({ total_price: 100, is_categorized: false, chart_account: null }),
        createSale({ total_price: 50, is_categorized: true }),
      ];

      const result = calculateRevenueBreakdown(sales, []);

      expect(result.gross_revenue).toBe(150);
    });
  });

  describe('discount and refund handling', () => {
    it('subtracts discounts from net revenue', () => {
      const sales = [
        createSale({ total_price: 100 }),
        createSale({ total_price: -10, item_type: 'discount' }),
      ];

      const result = calculateRevenueBreakdown(sales, []);

      expect(result.gross_revenue).toBe(100);
      expect(result.discounts).toBe(10); // Absolute value
      expect(result.net_revenue).toBe(90);
    });

    it('subtracts refunds from net revenue', () => {
      const sales = [
        createSale({ total_price: 100 }),
        createSale({ total_price: -25, item_type: 'refund' }),
      ];

      const result = calculateRevenueBreakdown(sales, []);

      expect(result.gross_revenue).toBe(100);
      expect(result.refunds).toBe(25);
      expect(result.net_revenue).toBe(75);
    });

    it('handles combined discounts and refunds', () => {
      const sales = [
        createSale({ total_price: 1000 }),
        createSale({ total_price: -50, item_type: 'discount' }),
        createSale({ total_price: -100, item_type: 'refund' }),
      ];

      const result = calculateRevenueBreakdown(sales, []);

      expect(result.gross_revenue).toBe(1000);
      expect(result.discounts).toBe(50);
      expect(result.refunds).toBe(100);
      expect(result.net_revenue).toBe(850);
    });
  });

  describe('liability handling (pass-through items)', () => {
    it('identifies sales tax from categorized liability', () => {
      const sales = [
        createSale({ total_price: 100 }),
        createSale({
          total_price: 8.25,
          item_type: 'sale',
          chart_account: {
            account_type: 'liability',
            account_subtype: 'sales_tax',
          },
        }),
      ];

      const result = calculateRevenueBreakdown(sales, []);

      expect(result.gross_revenue).toBe(100);
      expect(result.sales_tax).toBe(8.25);
      expect(result.total_collected_at_pos).toBe(108.25);
    });

    it('identifies tips from categorized liability', () => {
      const sales = [
        createSale({ total_price: 100 }),
        createSale({
          total_price: 20,
          item_type: 'sale',
          chart_account: {
            account_type: 'liability',
            account_subtype: 'tips_payable',
          },
        }),
      ];

      const result = calculateRevenueBreakdown(sales, []);

      expect(result.gross_revenue).toBe(100);
      expect(result.tips).toBe(20);
    });

    it('classifies other liabilities correctly', () => {
      const sales = [
        createSale({ total_price: 100 }),
        createSale({
          total_price: 5,
          item_type: 'sale',
          chart_account: {
            account_type: 'liability',
            account_subtype: 'service_charge',
          },
        }),
      ];

      const result = calculateRevenueBreakdown(sales, []);

      expect(result.gross_revenue).toBe(100);
      expect(result.other_liabilities).toBe(5);
    });
  });

  describe('adjustment processing', () => {
    it('processes tax adjustments from POS', () => {
      const sales = [createSale({ total_price: 100 })];
      const adjustments = [createAdjustment({ adjustment_type: 'tax', total_price: 8 })];

      const result = calculateRevenueBreakdown(sales, adjustments);

      expect(result.sales_tax).toBe(8);
    });

    it('processes tip adjustments from POS', () => {
      const sales = [createSale({ total_price: 100 })];
      const adjustments = [createAdjustment({ adjustment_type: 'tip', total_price: 15 })];

      const result = calculateRevenueBreakdown(sales, adjustments);

      expect(result.tips).toBe(15);
    });

    it('processes service charge adjustments', () => {
      const sales = [createSale({ total_price: 100 })];
      const adjustments = [createAdjustment({ adjustment_type: 'service_charge', total_price: 5 })];

      const result = calculateRevenueBreakdown(sales, adjustments);

      expect(result.other_liabilities).toBe(5);
    });

    it('processes discount adjustments', () => {
      const sales = [createSale({ total_price: 100 })];
      const adjustments = [createAdjustment({ adjustment_type: 'discount', total_price: 10 })];

      const result = calculateRevenueBreakdown(sales, adjustments);

      expect(result.discounts).toBe(10);
      expect(result.net_revenue).toBe(90);
    });
  });

  describe('total collected at POS', () => {
    it('calculates total collected correctly', () => {
      const sales = [
        createSale({ total_price: 100 }), // Revenue
      ];
      const adjustments = [
        createAdjustment({ adjustment_type: 'tax', total_price: 8 }),
        createAdjustment({ adjustment_type: 'tip', total_price: 15 }),
        createAdjustment({ adjustment_type: 'service_charge', total_price: 3 }),
      ];

      const result = calculateRevenueBreakdown(sales, adjustments);

      // Total = gross_revenue + sales_tax + tips + other_liabilities
      expect(result.total_collected_at_pos).toBe(126);
    });
  });
});

// ===== COST BREAKDOWN TESTS =====

describe('calculateCostBreakdown', () => {
  it('calculates food cost from inventory transactions', () => {
    const foodCosts: InventoryTransactionRecord[] = [
      { total_cost: -500 }, // Negative because it's an expense
      { total_cost: -300 },
    ];
    const laborCosts: LaborCostRecord[] = [];

    const result = calculateCostBreakdown(foodCosts, laborCosts, 10000);

    expect(result.food_cost).toBe(800); // Absolute value
    expect(result.food_cost_percentage).toBe(8); // 800/10000 * 100
  });

  it('calculates labor cost from labor records', () => {
    const foodCosts: InventoryTransactionRecord[] = [];
    const laborCosts: LaborCostRecord[] = [
      { total_labor_cost: 2000 },
      { total_labor_cost: 1500 },
    ];

    const result = calculateCostBreakdown(foodCosts, laborCosts, 10000);

    expect(result.labor_cost).toBe(3500);
    expect(result.labor_cost_percentage).toBe(35);
  });

  it('calculates prime cost as sum of food and labor', () => {
    const foodCosts: InventoryTransactionRecord[] = [{ total_cost: -2500 }];
    const laborCosts: LaborCostRecord[] = [{ total_labor_cost: 3000 }];

    const result = calculateCostBreakdown(foodCosts, laborCosts, 10000);

    expect(result.prime_cost).toBe(5500);
    expect(result.prime_cost_percentage).toBe(55);
  });

  it('handles zero revenue gracefully', () => {
    const foodCosts: InventoryTransactionRecord[] = [{ total_cost: -100 }];
    const laborCosts: LaborCostRecord[] = [{ total_labor_cost: 200 }];

    const result = calculateCostBreakdown(foodCosts, laborCosts, 0);

    expect(result.food_cost).toBe(100);
    expect(result.labor_cost).toBe(200);
    expect(result.food_cost_percentage).toBe(0);
    expect(result.labor_cost_percentage).toBe(0);
    expect(result.prime_cost_percentage).toBe(0);
  });

  it('rounds percentages to one decimal place', () => {
    const foodCosts: InventoryTransactionRecord[] = [{ total_cost: -333 }];
    const laborCosts: LaborCostRecord[] = [];

    const result = calculateCostBreakdown(foodCosts, laborCosts, 1000);

    expect(result.food_cost_percentage).toBe(33.3);
  });
});

// ===== PROFITABILITY TESTS =====

describe('calculateProfitability', () => {
  it('calculates gross profit correctly', () => {
    const result = calculateProfitability(10000, 5500);

    expect(result.gross_profit).toBe(4500);
  });

  it('calculates profit margin as percentage', () => {
    const result = calculateProfitability(10000, 5500);

    expect(result.profit_margin).toBe(45);
  });

  it('handles negative profit (loss)', () => {
    const result = calculateProfitability(10000, 12000);

    expect(result.gross_profit).toBe(-2000);
    expect(result.profit_margin).toBe(-20);
  });

  it('handles zero revenue', () => {
    const result = calculateProfitability(0, 1000);

    expect(result.gross_profit).toBe(-1000);
    expect(result.profit_margin).toBe(0);
  });

  it('rounds profit margin to one decimal', () => {
    const result = calculateProfitability(10000, 3333);

    expect(result.profit_margin).toBe(66.7);
  });
});

// ===== BENCHMARK TESTS =====

describe('calculateBenchmarks', () => {
  it('marks food cost as good when <= 32%', () => {
    const costs = {
      food_cost: 3000,
      food_cost_percentage: 30,
      labor_cost: 2500,
      labor_cost_percentage: 25,
      prime_cost: 5500,
      prime_cost_percentage: 55,
    };

    const result = calculateBenchmarks(costs);

    expect(result.food_cost_status).toBe('good');
  });

  it('marks food cost as caution when 33-35%', () => {
    const costs = {
      food_cost: 3400,
      food_cost_percentage: 34,
      labor_cost: 2500,
      labor_cost_percentage: 25,
      prime_cost: 5900,
      prime_cost_percentage: 59,
    };

    const result = calculateBenchmarks(costs);

    expect(result.food_cost_status).toBe('caution');
  });

  it('marks food cost as high when > 35%', () => {
    const costs = {
      food_cost: 4000,
      food_cost_percentage: 40,
      labor_cost: 2500,
      labor_cost_percentage: 25,
      prime_cost: 6500,
      prime_cost_percentage: 65,
    };

    const result = calculateBenchmarks(costs);

    expect(result.food_cost_status).toBe('high');
  });

  it('marks labor cost as good when <= 30%', () => {
    const costs = {
      food_cost: 3000,
      food_cost_percentage: 30,
      labor_cost: 2800,
      labor_cost_percentage: 28,
      prime_cost: 5800,
      prime_cost_percentage: 58,
    };

    const result = calculateBenchmarks(costs);

    expect(result.labor_cost_status).toBe('good');
  });

  it('marks labor cost as caution when 31-35%', () => {
    const costs = {
      food_cost: 3000,
      food_cost_percentage: 30,
      labor_cost: 3300,
      labor_cost_percentage: 33,
      prime_cost: 6300,
      prime_cost_percentage: 63,
    };

    const result = calculateBenchmarks(costs);

    expect(result.labor_cost_status).toBe('caution');
  });

  it('marks prime cost as good when <= 60%', () => {
    const costs = {
      food_cost: 3000,
      food_cost_percentage: 30,
      labor_cost: 2800,
      labor_cost_percentage: 28,
      prime_cost: 5800,
      prime_cost_percentage: 58,
    };

    const result = calculateBenchmarks(costs);

    expect(result.prime_cost_status).toBe('good');
  });

  it('marks prime cost as high when > 65%', () => {
    const costs = {
      food_cost: 3500,
      food_cost_percentage: 35,
      labor_cost: 3500,
      labor_cost_percentage: 35,
      prime_cost: 7000,
      prime_cost_percentage: 70,
    };

    const result = calculateBenchmarks(costs);

    expect(result.prime_cost_status).toBe('high');
  });

  it('provides target ranges', () => {
    const costs = {
      food_cost: 0,
      food_cost_percentage: 0,
      labor_cost: 0,
      labor_cost_percentage: 0,
      prime_cost: 0,
      prime_cost_percentage: 0,
    };

    const result = calculateBenchmarks(costs);

    expect(result.target_food_cost).toBe('28-32%');
    expect(result.target_labor_cost).toBe('25-30%');
    expect(result.target_prime_cost).toBe('55-60%');
  });
});

// ===== FULL INTEGRATION TEST =====

describe('calculatePeriodMetrics', () => {
  it('calculates complete period metrics from raw data', () => {
    // Simulate a typical restaurant day
    const sales: SaleRecord[] = [
      createSale({ id: '1', total_price: 500 }),
      createSale({ id: '2', total_price: 300 }),
      createSale({ id: '3', total_price: 200 }),
      // Discount
      createSale({ id: '4', total_price: -50, item_type: 'discount' }),
    ];

    const adjustments: AdjustmentRecord[] = [
      { adjustment_type: 'tax', total_price: 80 },
      { adjustment_type: 'tip', total_price: 150 },
    ];

    const foodCosts: InventoryTransactionRecord[] = [
      { total_cost: -285 }, // ~30% of net revenue
    ];

    const laborCosts: LaborCostRecord[] = [
      { total_labor_cost: 266.50 }, // ~28% of net revenue
    ];

    const result = calculatePeriodMetrics(sales, adjustments, foodCosts, laborCosts);

    // Revenue checks
    expect(result.revenue.gross_revenue).toBe(1000);
    expect(result.revenue.discounts).toBe(50);
    expect(result.revenue.net_revenue).toBe(950);
    expect(result.revenue.sales_tax).toBe(80);
    expect(result.revenue.tips).toBe(150);

    // Cost checks
    expect(result.costs.food_cost).toBe(285);
    expect(result.costs.labor_cost).toBe(266.50);
    expect(result.costs.prime_cost).toBe(551.50);

    // Profitability
    expect(result.profitability.gross_profit).toBe(398.50);
    expect(result.profitability.profit_margin).toBeCloseTo(41.9, 1);

    // Benchmarks should be good
    expect(result.benchmarks.food_cost_status).toBe('good');
    expect(result.benchmarks.labor_cost_status).toBe('good');
    expect(result.benchmarks.prime_cost_status).toBe('good');
  });

  it('handles restaurant with high costs (caution/high benchmarks)', () => {
    const sales: SaleRecord[] = [
      createSale({ total_price: 1000 }),
    ];

    const adjustments: AdjustmentRecord[] = [];

    const foodCosts: InventoryTransactionRecord[] = [
      { total_cost: -380 }, // 38% - high
    ];

    const laborCosts: LaborCostRecord[] = [
      { total_labor_cost: 340 }, // 34% - caution
    ];

    const result = calculatePeriodMetrics(sales, adjustments, foodCosts, laborCosts);

    expect(result.benchmarks.food_cost_status).toBe('high');
    expect(result.benchmarks.labor_cost_status).toBe('caution');
    expect(result.benchmarks.prime_cost_status).toBe('high');
  });

  it('handles empty data gracefully', () => {
    const result = calculatePeriodMetrics([], [], [], []);

    expect(result.revenue.gross_revenue).toBe(0);
    expect(result.revenue.net_revenue).toBe(0);
    expect(result.costs.food_cost).toBe(0);
    expect(result.costs.labor_cost).toBe(0);
    expect(result.profitability.gross_profit).toBe(0);
    expect(result.profitability.profit_margin).toBe(0);
  });
});
