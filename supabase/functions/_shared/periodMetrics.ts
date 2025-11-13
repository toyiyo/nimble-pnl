/**
 * Period Metrics Shared Module
 * 
 * Pure calculation functions for revenue, costs, and profitability metrics.
 * This module is designed to work in both Deno (Edge Functions) and Node.js (Frontend).
 * 
 * Used by:
 * - Frontend: src/hooks/usePeriodMetrics.tsx
 * - Edge Functions: supabase/functions/ai-execute-tool/index.ts
 * 
 * Pattern follows:
 * - supabase/functions/_shared/recipeAnalytics.ts
 * - supabase/functions/_shared/inventoryTransactions.ts
 */

// ===== TYPE DEFINITIONS =====

export interface SaleRecord {
  id: string;
  total_price: number;
  item_type: string | null;
  parent_sale_id: string | null;
  is_categorized: boolean;
  chart_account: {
    account_type: string;
    account_subtype: string | null;
  } | null;
}

export interface AdjustmentRecord {
  adjustment_type: string;
  total_price: number;
}

export interface InventoryTransactionRecord {
  total_cost: number;
}

export interface LaborCostRecord {
  total_labor_cost: number;
}

export interface RevenueBreakdown {
  gross_revenue: number;
  discounts: number;
  refunds: number;
  net_revenue: number;
  total_collected_at_pos: number;
  sales_tax: number;
  tips: number;
  other_liabilities: number;
  sales_count: number;
}

export interface CostBreakdown {
  food_cost: number;
  food_cost_percentage: number;
  labor_cost: number;
  labor_cost_percentage: number;
  prime_cost: number;
  prime_cost_percentage: number;
}

export interface ProfitabilityMetrics {
  gross_profit: number;
  profit_margin: number;
}

export interface BenchmarkStatus {
  food_cost_status: 'good' | 'caution' | 'high';
  labor_cost_status: 'good' | 'caution' | 'high';
  prime_cost_status: 'good' | 'caution' | 'high';
  target_food_cost: string;
  target_labor_cost: string;
  target_prime_cost: string;
}

export interface PeriodMetricsResult {
  revenue: RevenueBreakdown;
  costs: CostBreakdown;
  profitability: ProfitabilityMetrics;
  liabilities: {
    sales_tax: number;
    tips: number;
    other_liabilities: number;
  };
  benchmarks: BenchmarkStatus;
}

// ===== HELPER FUNCTIONS =====

/**
 * Filter out parent sales that have been split into children to avoid double-counting
 */
export function filterSplitSales(sales: SaleRecord[]): SaleRecord[] {
  const parentIdsWithChildren = new Set(
    sales
      .filter((s) => s.parent_sale_id !== null)
      .map((s) => s.parent_sale_id)
  );

  return sales.filter((s) => !parentIdsWithChildren.has(s.id));
}

/**
 * Check if an account is a sales tax liability
 */
function isSalesTaxAccount(account: { account_type: string; account_subtype: string | null }): boolean {
  const subtype = (account.account_subtype || '').toLowerCase();
  return account.account_type === 'liability' && subtype.includes('sales') && subtype.includes('tax');
}

/**
 * Check if an account is a tip liability
 */
function isTipAccount(account: { account_type: string; account_subtype: string | null }): boolean {
  const subtype = (account.account_subtype || '').toLowerCase();
  return account.account_type === 'liability' && subtype.includes('tip');
}

/**
 * Calculate revenue breakdown from sales data
 */
export function calculateRevenueBreakdown(
  sales: SaleRecord[],
  adjustments: AdjustmentRecord[]
): RevenueBreakdown {
  // Filter split sales
  const validSales = filterSplitSales(sales);

  let grossRevenue = 0;
  let discounts = 0;
  let refunds = 0;
  let salesTax = 0;
  let tips = 0;
  let otherLiabilities = 0;

  // Process categorized sales
  validSales.forEach((sale) => {
    if (!sale.is_categorized || !sale.chart_account) {
      // Uncategorized sales treated as revenue
      if (sale.item_type === 'sale' || !sale.item_type) {
        grossRevenue += sale.total_price || 0;
      }
      return;
    }

    const itemType = sale.item_type || 'sale';
    const account = sale.chart_account;

    if (itemType === 'sale') {
      if (account.account_type === 'revenue') {
        grossRevenue += sale.total_price || 0;
      } else if (account.account_type === 'liability') {
        if (isSalesTaxAccount(account)) {
          salesTax += sale.total_price || 0;
        } else if (isTipAccount(account)) {
          tips += sale.total_price || 0;
        } else {
          otherLiabilities += sale.total_price || 0;
        }
      }
    } else if (itemType === 'discount') {
      discounts += Math.abs(sale.total_price || 0);
    } else if (itemType === 'refund') {
      refunds += Math.abs(sale.total_price || 0);
    }
  });

  // Process adjustments (Square/Clover pass-through items)
  adjustments.forEach((adj) => {
    switch (adj.adjustment_type) {
      case 'tax':
        salesTax += adj.total_price || 0;
        break;
      case 'tip':
        tips += adj.total_price || 0;
        break;
      case 'service_charge':
      case 'fee':
        otherLiabilities += adj.total_price || 0;
        break;
      case 'discount':
        discounts += Math.abs(adj.total_price || 0);
        break;
    }
  });

  const netRevenue = grossRevenue - discounts - refunds;
  const totalCollectedAtPOS = grossRevenue + salesTax + tips + otherLiabilities;

  return {
    gross_revenue: grossRevenue,
    discounts,
    refunds,
    net_revenue: netRevenue,
    total_collected_at_pos: totalCollectedAtPOS,
    sales_tax: salesTax,
    tips,
    other_liabilities: otherLiabilities,
    sales_count: validSales.length,
  };
}

/**
 * Calculate cost breakdown from inventory and labor data
 */
export function calculateCostBreakdown(
  foodCostRecords: InventoryTransactionRecord[],
  laborCostRecords: LaborCostRecord[],
  netRevenue: number
): CostBreakdown {
  const foodCost = Math.abs(
    foodCostRecords.reduce((sum, r) => sum + (r.total_cost || 0), 0)
  );

  const laborCost = laborCostRecords.reduce(
    (sum, r) => sum + (r.total_labor_cost || 0),
    0
  );

  const primeCost = foodCost + laborCost;

  const foodCostPercentage = netRevenue > 0 ? (foodCost / netRevenue) * 100 : 0;
  const laborCostPercentage = netRevenue > 0 ? (laborCost / netRevenue) * 100 : 0;
  const primeCostPercentage = netRevenue > 0 ? (primeCost / netRevenue) * 100 : 0;

  return {
    food_cost: foodCost,
    food_cost_percentage: Math.round(foodCostPercentage * 10) / 10,
    labor_cost: laborCost,
    labor_cost_percentage: Math.round(laborCostPercentage * 10) / 10,
    prime_cost: primeCost,
    prime_cost_percentage: Math.round(primeCostPercentage * 10) / 10,
  };
}

/**
 * Calculate profitability metrics
 */
export function calculateProfitability(
  netRevenue: number,
  primeCost: number
): ProfitabilityMetrics {
  const grossProfit = netRevenue - primeCost;
  const profitMargin = netRevenue > 0 ? (grossProfit / netRevenue) * 100 : 0;

  return {
    gross_profit: grossProfit,
    profit_margin: Math.round(profitMargin * 10) / 10,
  };
}

/**
 * Calculate benchmark status based on industry standards
 */
export function calculateBenchmarks(costs: CostBreakdown): BenchmarkStatus {
  const foodCostStatus =
    costs.food_cost_percentage <= 32
      ? 'good'
      : costs.food_cost_percentage <= 35
      ? 'caution'
      : 'high';

  const laborCostStatus =
    costs.labor_cost_percentage <= 30
      ? 'good'
      : costs.labor_cost_percentage <= 35
      ? 'caution'
      : 'high';

  const primeCostStatus =
    costs.prime_cost_percentage <= 60
      ? 'good'
      : costs.prime_cost_percentage <= 65
      ? 'caution'
      : 'high';

  return {
    food_cost_status: foodCostStatus,
    labor_cost_status: laborCostStatus,
    prime_cost_status: primeCostStatus,
    target_food_cost: '28-32%',
    target_labor_cost: '25-30%',
    target_prime_cost: '55-60%',
  };
}

/**
 * Calculate all period metrics from raw data
 * This is the main function that orchestrates all calculations
 */
export function calculatePeriodMetrics(
  sales: SaleRecord[],
  adjustments: AdjustmentRecord[],
  foodCostRecords: InventoryTransactionRecord[],
  laborCostRecords: LaborCostRecord[]
): PeriodMetricsResult {
  // Step 1: Calculate revenue breakdown
  const revenue = calculateRevenueBreakdown(sales, adjustments);

  // Step 2: Calculate cost breakdown
  const costs = calculateCostBreakdown(
    foodCostRecords,
    laborCostRecords,
    revenue.net_revenue
  );

  // Step 3: Calculate profitability
  const profitability = calculateProfitability(revenue.net_revenue, costs.prime_cost);

  // Step 4: Calculate benchmarks
  const benchmarks = calculateBenchmarks(costs);

  return {
    revenue,
    costs,
    profitability,
    liabilities: {
      sales_tax: revenue.sales_tax,
      tips: revenue.tips,
      other_liabilities: revenue.other_liabilities,
    },
    benchmarks,
  };
}
