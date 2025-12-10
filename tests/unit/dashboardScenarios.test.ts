/**
 * Dashboard Scenario Tests
 * 
 * These tests validate complete financial calculations using realistic
 * restaurant scenarios. Each scenario represents actual business situations
 * and validates that all derived metrics are mathematically correct.
 * 
 * CRITICAL: If these tests fail, it likely means the dashboard is showing
 * incorrect financial data to restaurant owners.
 */

import { describe, it, expect } from 'vitest';
import {
  calculateRevenueBreakdown,
  calculateCostBreakdown,
  calculateProfitability,
  calculateBenchmarks,
  calculatePeriodMetrics,
  filterSplitSales,
  type SaleRecord,
  type AdjustmentRecord,
  type InventoryTransactionRecord,
  type LaborCostRecord,
} from '../../supabase/functions/_shared/periodMetrics';

// ===== HELPER FACTORIES =====

function createSale(overrides: Partial<SaleRecord> = {}): SaleRecord {
  return {
    id: `sale-${Math.random().toString(36).substring(7)}`,
    total_price: 0,
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

// ===== SCENARIO 1: TYPICAL LUNCH SERVICE =====

describe('Scenario: Typical Lunch Service', () => {
  /**
   * A typical lunch service with:
   * - 50 transactions averaging $15 each = $750 gross
   * - 8.25% sales tax = $61.88
   * - $45 in tips (6% average)
   * - $25 discount applied
   * - Food cost: $225 (30%)
   * - Labor cost: $187.50 (25%)
   */
  
  const createLunchServiceData = () => {
    const sales: SaleRecord[] = [];
    
    // 50 sales of varying amounts totaling $750
    const amounts = [12, 15, 18, 14, 16, 13, 17, 15, 14, 16, 
                     12, 15, 18, 14, 16, 13, 17, 15, 14, 16,
                     12, 15, 18, 14, 16, 13, 17, 15, 14, 16,
                     12, 15, 18, 14, 16, 13, 17, 15, 14, 16,
                     12, 15, 18, 14, 16, 13, 17, 15, 14, 16];
    
    amounts.forEach((amount, i) => {
      sales.push(createSale({ id: `lunch-${i}`, total_price: amount }));
    });

    const adjustments: AdjustmentRecord[] = [
      { adjustment_type: 'tax', total_price: 61.88 },
      { adjustment_type: 'tip', total_price: 45 },
      { adjustment_type: 'discount', total_price: 25 },
    ];

    const foodCosts: InventoryTransactionRecord[] = [
      { total_cost: -225 },
    ];

    const laborCosts: LaborCostRecord[] = [
      { total_labor_cost: 187.50 },
    ];

    return { sales, adjustments, foodCosts, laborCosts };
  };

  it('calculates gross revenue correctly', () => {
    const { sales, adjustments } = createLunchServiceData();
    const result = calculateRevenueBreakdown(sales, adjustments);
    
    // Sum of all sales = 750
    expect(result.gross_revenue).toBe(750);
  });

  it('calculates net revenue after discount', () => {
    const { sales, adjustments } = createLunchServiceData();
    const result = calculateRevenueBreakdown(sales, adjustments);
    
    // Net = Gross - Discounts = 750 - 25 = 725
    expect(result.net_revenue).toBe(725);
  });

  it('calculates total collected at POS correctly', () => {
    const { sales, adjustments } = createLunchServiceData();
    const result = calculateRevenueBreakdown(sales, adjustments);
    
    // Total = Gross + Tax + Tips = 750 + 61.88 + 45 = 856.88
    // (discounts reduce net_revenue but don't affect total_collected)
    expect(result.total_collected_at_pos).toBe(856.88);
  });

  it('calculates food cost percentage correctly', () => {
    const { sales, adjustments, foodCosts, laborCosts } = createLunchServiceData();
    const revenue = calculateRevenueBreakdown(sales, adjustments);
    const costs = calculateCostBreakdown(foodCosts, laborCosts, revenue.net_revenue);
    
    // Food cost % = 225 / 725 * 100 = 31.03%
    expect(costs.food_cost_percentage).toBeCloseTo(31.0, 0);
  });

  it('calculates labor cost percentage correctly', () => {
    const { sales, adjustments, foodCosts, laborCosts } = createLunchServiceData();
    const revenue = calculateRevenueBreakdown(sales, adjustments);
    const costs = calculateCostBreakdown(foodCosts, laborCosts, revenue.net_revenue);
    
    // Labor cost % = 187.50 / 725 * 100 = 25.86%
    expect(costs.labor_cost_percentage).toBeCloseTo(25.9, 0);
  });

  it('calculates prime cost correctly', () => {
    const { sales, adjustments, foodCosts, laborCosts } = createLunchServiceData();
    const revenue = calculateRevenueBreakdown(sales, adjustments);
    const costs = calculateCostBreakdown(foodCosts, laborCosts, revenue.net_revenue);
    
    // Prime cost = 225 + 187.50 = 412.50
    expect(costs.prime_cost).toBe(412.50);
    
    // Prime cost % = 412.50 / 725 * 100 = 56.90%
    expect(costs.prime_cost_percentage).toBeCloseTo(56.9, 0);
  });

  it('calculates gross profit correctly', () => {
    const { sales, adjustments, foodCosts, laborCosts } = createLunchServiceData();
    const revenue = calculateRevenueBreakdown(sales, adjustments);
    const costs = calculateCostBreakdown(foodCosts, laborCosts, revenue.net_revenue);
    const profit = calculateProfitability(revenue.net_revenue, costs.prime_cost);
    
    // Gross profit = 725 - 412.50 = 312.50
    expect(profit.gross_profit).toBe(312.50);
    
    // Profit margin = 312.50 / 725 * 100 = 43.10%
    expect(profit.profit_margin).toBeCloseTo(43.1, 0);
  });

  it('benchmarks show healthy operation', () => {
    const { sales, adjustments, foodCosts, laborCosts } = createLunchServiceData();
    const revenue = calculateRevenueBreakdown(sales, adjustments);
    const costs = calculateCostBreakdown(foodCosts, laborCosts, revenue.net_revenue);
    const benchmarks = calculateBenchmarks(costs);
    
    // Food cost ~31% is in caution range (32-35%)
    expect(benchmarks.food_cost_status).toBe('good');
    // Labor cost ~26% is good (<=30%)
    expect(benchmarks.labor_cost_status).toBe('good');
    // Prime cost ~57% is good (<=60%)
    expect(benchmarks.prime_cost_status).toBe('good');
  });
});

// ===== SCENARIO 2: BUSY SATURDAY NIGHT =====

describe('Scenario: Busy Saturday Night Dinner Service', () => {
  /**
   * High-volume dinner service:
   * - $5,000 in food sales
   * - $2,500 in bar sales
   * - $618.75 sales tax (8.25%)
   * - $1,125 in tips (15%)
   * - $200 service charges
   * - $150 in refunds (returns)
   * - $100 in comps/discounts
   * - Food cost: $2,100 (29% of net)
   * - Labor cost: $2,175 (30% of net)
   */
  
  const createSaturdayDinnerData = () => {
    const sales: SaleRecord[] = [
      // Food sales
      createSale({ id: 'food-1', total_price: 5000 }),
      // Bar sales  
      createSale({ id: 'bar-1', total_price: 2500 }),
      // Refund
      createSale({ id: 'refund-1', total_price: -150, item_type: 'refund' }),
      // Discount/comp
      createSale({ id: 'discount-1', total_price: -100, item_type: 'discount' }),
    ];

    const adjustments: AdjustmentRecord[] = [
      { adjustment_type: 'tax', total_price: 618.75 },
      { adjustment_type: 'tip', total_price: 1125 },
      { adjustment_type: 'service_charge', total_price: 200 },
    ];

    const foodCosts: InventoryTransactionRecord[] = [
      { total_cost: -1400 }, // Food inventory
      { total_cost: -700 },  // Bar inventory
    ];

    const laborCosts: LaborCostRecord[] = [
      { total_labor_cost: 1200 }, // Kitchen staff
      { total_labor_cost: 600 },  // FOH staff
      { total_labor_cost: 375 },  // Management
    ];

    return { sales, adjustments, foodCosts, laborCosts };
  };

  it('calculates gross revenue from food + bar sales', () => {
    const { sales, adjustments } = createSaturdayDinnerData();
    const result = calculateRevenueBreakdown(sales, adjustments);
    
    // Gross = 5000 + 2500 = 7500
    expect(result.gross_revenue).toBe(7500);
  });

  it('correctly subtracts refunds and discounts', () => {
    const { sales, adjustments } = createSaturdayDinnerData();
    const result = calculateRevenueBreakdown(sales, adjustments);
    
    expect(result.refunds).toBe(150);
    expect(result.discounts).toBe(100);
    // Net = 7500 - 150 - 100 = 7250
    expect(result.net_revenue).toBe(7250);
  });

  it('separates liabilities correctly', () => {
    const { sales, adjustments } = createSaturdayDinnerData();
    const result = calculateRevenueBreakdown(sales, adjustments);
    
    expect(result.sales_tax).toBe(618.75);
    expect(result.tips).toBe(1125);
    expect(result.other_liabilities).toBe(200); // service charge
  });

  it('calculates total collected (what went into register)', () => {
    const { sales, adjustments } = createSaturdayDinnerData();
    const result = calculateRevenueBreakdown(sales, adjustments);
    
    // Total = Gross + Tax + Tips + Service Charges
    // 7500 + 618.75 + 1125 + 200 = 9443.75
    expect(result.total_collected_at_pos).toBe(9443.75);
  });

  it('aggregates costs from multiple categories', () => {
    const { sales, adjustments, foodCosts, laborCosts } = createSaturdayDinnerData();
    const revenue = calculateRevenueBreakdown(sales, adjustments);
    const costs = calculateCostBreakdown(foodCosts, laborCosts, revenue.net_revenue);
    
    // Food cost = 1400 + 700 = 2100
    expect(costs.food_cost).toBe(2100);
    
    // Labor cost = 1200 + 600 + 375 = 2175
    expect(costs.labor_cost).toBe(2175);
  });

  it('calculates accurate percentages based on NET revenue', () => {
    const { sales, adjustments, foodCosts, laborCosts } = createSaturdayDinnerData();
    const revenue = calculateRevenueBreakdown(sales, adjustments);
    const costs = calculateCostBreakdown(foodCosts, laborCosts, revenue.net_revenue);
    
    // Food % = 2100 / 7250 * 100 = 28.97%
    expect(costs.food_cost_percentage).toBeCloseTo(29.0, 0);
    
    // Labor % = 2175 / 7250 * 100 = 30%
    expect(costs.labor_cost_percentage).toBe(30);
    
    // Prime % = 4275 / 7250 * 100 = 58.97%
    expect(costs.prime_cost_percentage).toBeCloseTo(59.0, 0);
  });

  it('calculates profitability correctly', () => {
    const { sales, adjustments, foodCosts, laborCosts } = createSaturdayDinnerData();
    const result = calculatePeriodMetrics(sales, adjustments, foodCosts, laborCosts);
    
    // Profit = 7250 - 4275 = 2975
    expect(result.profitability.gross_profit).toBe(2975);
    
    // Margin = 2975 / 7250 * 100 = 41.03%
    expect(result.profitability.profit_margin).toBeCloseTo(41.0, 0);
  });
});

// ===== SCENARIO 3: SLOW MONDAY WITH LOSSES =====

describe('Scenario: Slow Monday (Operating at a Loss)', () => {
  /**
   * Low traffic day resulting in net loss:
   * - $400 gross sales
   * - $33 tax
   * - $20 tips
   * - Food cost: $180 (47% of net - too high)
   * - Labor cost: $320 (83% of net - fixed staff costs)
   * Total costs exceed revenue!
   */
  
  const createSlowMondayData = () => {
    const sales: SaleRecord[] = [
      createSale({ id: 'slow-1', total_price: 150 }),
      createSale({ id: 'slow-2', total_price: 125 }),
      createSale({ id: 'slow-3', total_price: 75 }),
      createSale({ id: 'slow-4', total_price: 50 }),
    ];

    const adjustments: AdjustmentRecord[] = [
      { adjustment_type: 'tax', total_price: 33 },
      { adjustment_type: 'tip', total_price: 20 },
    ];

    const foodCosts: InventoryTransactionRecord[] = [
      { total_cost: -180 },
    ];

    const laborCosts: LaborCostRecord[] = [
      { total_labor_cost: 320 }, // Minimum staffing still required
    ];

    return { sales, adjustments, foodCosts, laborCosts };
  };

  it('shows negative profit (loss)', () => {
    const { sales, adjustments, foodCosts, laborCosts } = createSlowMondayData();
    const result = calculatePeriodMetrics(sales, adjustments, foodCosts, laborCosts);
    
    // Net revenue = 400
    expect(result.revenue.net_revenue).toBe(400);
    
    // Prime cost = 180 + 320 = 500
    expect(result.costs.prime_cost).toBe(500);
    
    // Loss = 400 - 500 = -100
    expect(result.profitability.gross_profit).toBe(-100);
    
    // Negative margin
    expect(result.profitability.profit_margin).toBe(-25);
  });

  it('shows high benchmark warnings', () => {
    const { sales, adjustments, foodCosts, laborCosts } = createSlowMondayData();
    const result = calculatePeriodMetrics(sales, adjustments, foodCosts, laborCosts);
    
    // Food 45%, Labor 80% - both way over benchmarks
    expect(result.benchmarks.food_cost_status).toBe('high');
    expect(result.benchmarks.labor_cost_status).toBe('high');
    expect(result.benchmarks.prime_cost_status).toBe('high');
  });

  it('percentages exceed 100% when costs > revenue', () => {
    const { sales, adjustments, foodCosts, laborCosts } = createSlowMondayData();
    const revenue = calculateRevenueBreakdown(sales, adjustments);
    const costs = calculateCostBreakdown(foodCosts, laborCosts, revenue.net_revenue);
    
    // Prime cost % = 500 / 400 * 100 = 125%
    expect(costs.prime_cost_percentage).toBe(125);
  });
});

// ===== SCENARIO 4: SPLIT SALES (COMBO MEALS) =====

describe('Scenario: Split Sales (Combo Meals)', () => {
  /**
   * Tests that parent sales with children are not double-counted.
   * Example: A $12.99 combo is split into:
   * - Burger: $7.99
   * - Fries: $2.50  
   * - Drink: $2.50
   */
  
  it('excludes parent sale when children exist', () => {
    const sales: SaleRecord[] = [
      // Parent combo sale (should be excluded)
      createSale({ id: 'combo-1', total_price: 12.99 }),
      // Child items (should be included)
      createSale({ id: 'burger-1', total_price: 7.99, parent_sale_id: 'combo-1' }),
      createSale({ id: 'fries-1', total_price: 2.50, parent_sale_id: 'combo-1' }),
      createSale({ id: 'drink-1', total_price: 2.50, parent_sale_id: 'combo-1' }),
      // Standalone sale (should be included)
      createSale({ id: 'standalone', total_price: 5.00 }),
    ];

    const filtered = filterSplitSales(sales);
    
    // Should have 4 sales: 3 children + 1 standalone
    expect(filtered.length).toBe(4);
    expect(filtered.map(s => s.id)).not.toContain('combo-1');
  });

  it('calculates revenue from children only', () => {
    const sales: SaleRecord[] = [
      createSale({ id: 'combo-1', total_price: 12.99 }),
      createSale({ id: 'burger-1', total_price: 7.99, parent_sale_id: 'combo-1' }),
      createSale({ id: 'fries-1', total_price: 2.50, parent_sale_id: 'combo-1' }),
      createSale({ id: 'drink-1', total_price: 2.50, parent_sale_id: 'combo-1' }),
    ];

    const result = calculateRevenueBreakdown(sales, []);
    
    // Should be children total: 7.99 + 2.50 + 2.50 = 12.99
    // NOT children + parent (25.98)
    expect(result.gross_revenue).toBeCloseTo(12.99, 2);
  });

  it('handles multiple split combos', () => {
    const sales: SaleRecord[] = [
      // Combo 1
      createSale({ id: 'combo-1', total_price: 12.99 }),
      createSale({ id: 'c1-item1', total_price: 6.99, parent_sale_id: 'combo-1' }),
      createSale({ id: 'c1-item2', total_price: 6.00, parent_sale_id: 'combo-1' }),
      // Combo 2
      createSale({ id: 'combo-2', total_price: 15.99 }),
      createSale({ id: 'c2-item1', total_price: 8.99, parent_sale_id: 'combo-2' }),
      createSale({ id: 'c2-item2', total_price: 7.00, parent_sale_id: 'combo-2' }),
    ];

    const result = calculateRevenueBreakdown(sales, []);
    
    // Children only: (6.99+6.00) + (8.99+7.00) = 12.99 + 15.99 = 28.98
    expect(result.gross_revenue).toBeCloseTo(28.98, 2);
  });
});

// ===== SCENARIO 5: MIXED LIABILITY TYPES =====

describe('Scenario: Complex Liability Classification', () => {
  /**
   * Tests that different liability types are classified correctly
   * based on chart_account properties.
   */
  
  it('classifies sales tax by account_subtype', () => {
    const sales: SaleRecord[] = [
      createSale({ total_price: 100 }),
      createSale({
        total_price: 8.25,
        chart_account: {
          account_type: 'liability',
          account_subtype: 'sales_tax_payable',
        },
      }),
    ];

    const result = calculateRevenueBreakdown(sales, []);
    
    expect(result.gross_revenue).toBe(100);
    expect(result.sales_tax).toBe(8.25);
    expect(result.tips).toBe(0);
  });

  it('classifies tips by account_subtype', () => {
    const sales: SaleRecord[] = [
      createSale({ total_price: 100 }),
      createSale({
        total_price: 18,
        chart_account: {
          account_type: 'liability',
          account_subtype: 'tips_payable',
        },
      }),
    ];

    const result = calculateRevenueBreakdown(sales, []);
    
    expect(result.gross_revenue).toBe(100);
    expect(result.tips).toBe(18);
  });

  it('classifies service fees as other liabilities', () => {
    const sales: SaleRecord[] = [
      createSale({ total_price: 100 }),
      createSale({
        total_price: 5,
        chart_account: {
          account_type: 'liability',
          account_subtype: 'service_fees',
        },
      }),
    ];

    const result = calculateRevenueBreakdown(sales, []);
    
    expect(result.other_liabilities).toBe(5);
  });

  it('handles multiple liability types in one transaction set', () => {
    const sales: SaleRecord[] = [
      // Regular sales
      createSale({ id: '1', total_price: 100 }),
      createSale({ id: '2', total_price: 50 }),
      // Tax
      createSale({
        id: 'tax-1',
        total_price: 12.38,
        chart_account: { account_type: 'liability', account_subtype: 'sales_tax' },
      }),
      // Tips
      createSale({
        id: 'tip-1',
        total_price: 22.50,
        chart_account: { account_type: 'liability', account_subtype: 'tip' },
      }),
      // Delivery fee
      createSale({
        id: 'fee-1',
        total_price: 3.99,
        chart_account: { account_type: 'liability', account_subtype: 'delivery_fee' },
      }),
    ];

    const result = calculateRevenueBreakdown(sales, []);
    
    expect(result.gross_revenue).toBe(150);
    expect(result.sales_tax).toBe(12.38);
    expect(result.tips).toBe(22.50);
    expect(result.other_liabilities).toBe(3.99);
    expect(result.total_collected_at_pos).toBeCloseTo(188.87, 2);
  });
});

// ===== SCENARIO 6: FULL MONTH AGGREGATION =====

describe('Scenario: Full Month Financial Summary', () => {
  /**
   * Validates monthly totals match expectations:
   * - 30 days of operation
   * - Mix of good and bad days
   * - Total should match sum of individual days
   */
  
  it('calculates accurate monthly totals', () => {
    // Simulate 30 days worth of sales
    const sales: SaleRecord[] = [];
    const dailyRevenues = [
      // Week 1 (Mon-Sun): slow start
      400, 600, 800, 1200, 2500, 3000, 2000,
      // Week 2: average
      500, 700, 900, 1400, 2800, 3200, 2200,
      // Week 3: good week
      600, 800, 1000, 1600, 3000, 3500, 2400,
      // Week 4: best week
      700, 900, 1100, 1800, 3200, 3800, 2600,
      // Final 2 days
      800, 1000,
    ];

    let saleId = 0;
    dailyRevenues.forEach(revenue => {
      sales.push(createSale({ id: `sale-${saleId++}`, total_price: revenue }));
    });

    const totalGross = dailyRevenues.reduce((sum, r) => sum + r, 0);
    
    // Average food cost 30%, labor 28%
    const foodCosts: InventoryTransactionRecord[] = [
      { total_cost: -(totalGross * 0.30) },
    ];
    const laborCosts: LaborCostRecord[] = [
      { total_labor_cost: totalGross * 0.28 },
    ];

    const result = calculatePeriodMetrics(sales, [], foodCosts, laborCosts);

    // Verify totals
    expect(result.revenue.gross_revenue).toBe(totalGross);
    expect(result.revenue.net_revenue).toBe(totalGross); // No discounts
    
    // Verify percentages
    expect(result.costs.food_cost_percentage).toBeCloseTo(30, 0);
    expect(result.costs.labor_cost_percentage).toBeCloseTo(28, 0);
    expect(result.costs.prime_cost_percentage).toBeCloseTo(58, 0);
    
    // Verify profit
    const expectedProfit = totalGross * (1 - 0.30 - 0.28);
    expect(result.profitability.gross_profit).toBeCloseTo(expectedProfit, 0);
  });
});

// ===== SCENARIO 7: EDGE CASES =====

describe('Edge Cases and Boundary Conditions', () => {
  it('handles exactly $0 in sales', () => {
    const result = calculatePeriodMetrics([], [], [], []);
    
    expect(result.revenue.gross_revenue).toBe(0);
    expect(result.revenue.net_revenue).toBe(0);
    expect(result.costs.food_cost_percentage).toBe(0);
    expect(result.profitability.profit_margin).toBe(0);
  });

  it('handles costs with no revenue', () => {
    const foodCosts: InventoryTransactionRecord[] = [{ total_cost: -500 }];
    const laborCosts: LaborCostRecord[] = [{ total_labor_cost: 300 }];
    
    const result = calculatePeriodMetrics([], [], foodCosts, laborCosts);
    
    // Costs should still be recorded
    expect(result.costs.food_cost).toBe(500);
    expect(result.costs.labor_cost).toBe(300);
    
    // Percentages should be 0 (not Infinity)
    expect(result.costs.food_cost_percentage).toBe(0);
    expect(result.costs.labor_cost_percentage).toBe(0);
    
    // Profit should be negative
    expect(result.profitability.gross_profit).toBe(-800);
  });

  it('handles very small amounts (penny precision)', () => {
    const sales: SaleRecord[] = [
      createSale({ total_price: 0.01 }),
      createSale({ total_price: 0.02 }),
      createSale({ total_price: 0.03 }),
    ];

    const result = calculateRevenueBreakdown(sales, []);
    
    expect(result.gross_revenue).toBeCloseTo(0.06, 2);
  });

  it('handles very large amounts', () => {
    const sales: SaleRecord[] = [
      createSale({ total_price: 1000000 }), // $1M
    ];
    const foodCosts: InventoryTransactionRecord[] = [
      { total_cost: -300000 }, // 30%
    ];

    const result = calculatePeriodMetrics(sales, [], foodCosts, []);
    
    expect(result.revenue.gross_revenue).toBe(1000000);
    expect(result.costs.food_cost).toBe(300000);
    expect(result.costs.food_cost_percentage).toBe(30);
  });

  it('handles sales with missing chart_account gracefully', () => {
    const sales: SaleRecord[] = [
      createSale({ total_price: 100, is_categorized: false, chart_account: null }),
      createSale({ total_price: 50, is_categorized: true, chart_account: null }),
    ];

    const result = calculateRevenueBreakdown(sales, []);
    
    // Both uncategorized sales AND sales with is_categorized=true but null chart_account
    // are treated as revenue (fallback behavior)
    expect(result.gross_revenue).toBe(150);
  });

  it('handles negative total_cost correctly (expense)', () => {
    // Inventory usage is typically negative (reducing inventory value)
    const foodCosts: InventoryTransactionRecord[] = [
      { total_cost: -100 },
      { total_cost: -200 },
    ];

    const costs = calculateCostBreakdown(foodCosts, [], 1000);
    
    // Should be absolute value
    expect(costs.food_cost).toBe(300);
  });

  it('handles positive total_cost correctly (adjustment/return)', () => {
    // Sometimes inventory adjustments are positive
    const foodCosts: InventoryTransactionRecord[] = [
      { total_cost: -500 },
      { total_cost: 100 }, // Return/credit
    ];

    const costs = calculateCostBreakdown(foodCosts, [], 1000);
    
    // Net cost = abs(-500 + 100) = 400
    expect(costs.food_cost).toBe(400);
  });
});

// ===== MATHEMATICAL IDENTITY TESTS =====

describe('Mathematical Identities (Validation)', () => {
  it('net_revenue = gross_revenue - discounts - refunds', () => {
    const sales: SaleRecord[] = [
      createSale({ total_price: 1000 }),
      createSale({ total_price: -50, item_type: 'discount' }),
      createSale({ total_price: -30, item_type: 'refund' }),
    ];

    const result = calculateRevenueBreakdown(sales, []);
    
    expect(result.net_revenue).toBe(
      result.gross_revenue - result.discounts - result.refunds
    );
  });

  it('prime_cost = food_cost + labor_cost', () => {
    const foodCosts: InventoryTransactionRecord[] = [{ total_cost: -1500 }];
    const laborCosts: LaborCostRecord[] = [{ total_labor_cost: 1200 }];

    const costs = calculateCostBreakdown(foodCosts, laborCosts, 5000);
    
    expect(costs.prime_cost).toBe(costs.food_cost + costs.labor_cost);
  });

  it('gross_profit = net_revenue - prime_cost', () => {
    const sales: SaleRecord[] = [createSale({ total_price: 5000 })];
    const foodCosts: InventoryTransactionRecord[] = [{ total_cost: -1500 }];
    const laborCosts: LaborCostRecord[] = [{ total_labor_cost: 1200 }];

    const result = calculatePeriodMetrics(sales, [], foodCosts, laborCosts);
    
    expect(result.profitability.gross_profit).toBe(
      result.revenue.net_revenue - result.costs.prime_cost
    );
  });

  it('profit_margin = gross_profit / net_revenue * 100', () => {
    const sales: SaleRecord[] = [createSale({ total_price: 10000 })];
    const foodCosts: InventoryTransactionRecord[] = [{ total_cost: -3000 }];
    const laborCosts: LaborCostRecord[] = [{ total_labor_cost: 2500 }];

    const result = calculatePeriodMetrics(sales, [], foodCosts, laborCosts);
    
    const expectedMargin = (result.profitability.gross_profit / result.revenue.net_revenue) * 100;
    expect(result.profitability.profit_margin).toBeCloseTo(expectedMargin, 1);
  });

  it('total_collected = gross_revenue + tax + tips + other_liabilities', () => {
    const sales: SaleRecord[] = [createSale({ total_price: 500 })];
    const adjustments: AdjustmentRecord[] = [
      { adjustment_type: 'tax', total_price: 41.25 },
      { adjustment_type: 'tip', total_price: 75 },
      { adjustment_type: 'service_charge', total_price: 15 },
    ];

    const result = calculateRevenueBreakdown(sales, adjustments);
    
    expect(result.total_collected_at_pos).toBe(
      result.gross_revenue + result.sales_tax + result.tips + result.other_liabilities
    );
  });
});

// ===== PRECISION AND ROUNDING TESTS =====

describe('Precision and Rounding', () => {
  it('percentages are rounded to 1 decimal place', () => {
    // 1/3 = 33.333...% should round to 33.3%
    const foodCosts: InventoryTransactionRecord[] = [{ total_cost: -333.33 }];
    const costs = calculateCostBreakdown(foodCosts, [], 1000);
    
    expect(costs.food_cost_percentage).toBe(33.3);
  });

  it('handles floating point precision issues', () => {
    // 0.1 + 0.2 = 0.30000000000000004 in JS
    const sales: SaleRecord[] = [
      createSale({ total_price: 0.1 }),
      createSale({ total_price: 0.2 }),
    ];

    const result = calculateRevenueBreakdown(sales, []);
    
    // Should handle this gracefully
    expect(result.gross_revenue).toBeCloseTo(0.3, 10);
  });

  it('maintains accuracy across many small transactions', () => {
    // 100 transactions of $0.99 each
    const sales: SaleRecord[] = Array(100).fill(null).map((_, i) => 
      createSale({ id: `sale-${i}`, total_price: 0.99 })
    );

    const result = calculateRevenueBreakdown(sales, []);
    
    // Should be exactly $99.00
    expect(result.gross_revenue).toBeCloseTo(99, 2);
  });
});
