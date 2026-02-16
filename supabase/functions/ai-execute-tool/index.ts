import "https://deno.land/x/xhr@0.1.0/mod.ts";
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { corsHeaders } from "../_shared/cors.ts";
import { canUseTool } from "../_shared/tools-registry.ts";
import { MODELS } from "../_shared/model-router.ts";
import { 
  fetchInventoryTransactions,
  calculateTransactionsSummary,
  groupTransactions,
  type InventoryTransactionQuery 
} from "../_shared/inventoryTransactions.ts";
import { logAICall, extractTokenUsage, type AICallMetadata } from "../_shared/braintrust.ts";

// AI tool execution with OpenRouter multi-model fallback
const OPENROUTER_API_KEY = Deno.env.get('OPENROUTER_API_KEY') || '';

interface ToolExecutionRequest {
  tool_name: string;
  arguments: Record<string, any>;
  restaurant_id: string;
}

interface DateRange {
  startDate: Date;
  endDate: Date;
  startDateStr: string;
  endDateStr: string;
}

type PeriodType =
  | 'today' | 'yesterday' | 'tomorrow'
  | 'week' | 'month' | 'quarter' | 'year'
  | 'current_week' | 'last_week' | 'current_month' | 'last_month'
  | 'custom';

/**
 * Calculate date range from period string
 * Centralizes the repeated date calculation logic across tool handlers
 */
function calculateDateRange(
  period: PeriodType,
  customStartDate?: string,
  customEndDate?: string
): DateRange {
  const now = new Date();
  let startDate: Date;
  let endDate: Date = now;

  switch (period) {
    case 'today':
      startDate = new Date(now.getFullYear(), now.getMonth(), now.getDate());
      endDate = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 23, 59, 59);
      break;
    case 'yesterday':
      startDate = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 1);
      endDate = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 1, 23, 59, 59);
      break;
    case 'tomorrow':
      startDate = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1);
      endDate = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1, 23, 59, 59);
      break;
    case 'week':
      startDate = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 7);
      break;
    case 'current_week': {
      const dayOfWeek = now.getDay();
      startDate = new Date(now.getFullYear(), now.getMonth(), now.getDate() - dayOfWeek);
      endDate = new Date(now.getFullYear(), now.getMonth(), now.getDate() + (6 - dayOfWeek), 23, 59, 59);
      break;
    }
    case 'last_week': {
      const dayOfWeek = now.getDay();
      startDate = new Date(now.getFullYear(), now.getMonth(), now.getDate() - dayOfWeek - 7);
      endDate = new Date(now.getFullYear(), now.getMonth(), now.getDate() - dayOfWeek - 1, 23, 59, 59);
      break;
    }
    case 'month':
    case 'current_month':
      startDate = new Date(now.getFullYear(), now.getMonth(), 1);
      endDate = new Date(now.getFullYear(), now.getMonth() + 1, 0, 23, 59, 59);
      break;
    case 'last_month':
      startDate = new Date(now.getFullYear(), now.getMonth() - 1, 1);
      endDate = new Date(now.getFullYear(), now.getMonth(), 0, 23, 59, 59);
      break;
    case 'quarter': {
      const quarter = Math.floor(now.getMonth() / 3);
      startDate = new Date(now.getFullYear(), quarter * 3, 1);
      break;
    }
    case 'year':
      startDate = new Date(now.getFullYear(), 0, 1);
      break;
    case 'custom':
      if (!customStartDate || !customEndDate) {
        throw new Error('Custom period requires start_date and end_date');
      }
      startDate = new Date(customStartDate);
      endDate = new Date(customEndDate);
      break;
    default:
      // Default to current week
      startDate = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 7);
  }

  return {
    startDate,
    endDate,
    startDateStr: startDate.toISOString().split('T')[0],
    endDateStr: endDate.toISOString().split('T')[0],
  };
}

/**
 * Execute navigation tool
 */
function executeNavigate(args: any): any {
  const { section, entity_id } = args;
  
  const routes: Record<string, string> = {
    'dashboard': '/',
    'inventory': '/inventory',
    'recipes': '/recipes',
    'pos-sales': '/pos-sales',
    'banking': '/banking',
    'transactions': '/transactions',
    'accounting': '/accounting',
    'financial-statements': '/financial-statements',
    'financial-intelligence': '/financial-intelligence',
    'reports': '/reports',
    'integrations': '/integrations',
    'team': '/team',
    'settings': '/settings',
    'daily-brief': '/daily-brief',
    'ops-inbox': '/ops-inbox',
  };

  const basePath = routes[section] || '/';
  const path = entity_id ? `${basePath}?id=${entity_id}` : basePath;

  return {
    ok: true,
    data: {
      path,
      section,
      message: `I can take you to ${section}. Would you like to go there?`,
      action_required: 'navigation_confirmation',
    },
  };
}

/**
 * Execute get_kpis tool
 * Returns comprehensive KPIs including revenue, COGS, labor, prime cost, and profitability metrics
 * Uses shared calculation logic from periodMetrics.ts
 */
async function executeGetKpis(
  args: any,
  restaurantId: string,
  supabase: any
): Promise<any> {
  const { period, start_date, end_date } = args;
  
  // Import shared calculation module
  const { calculatePeriodMetrics } = await import('../_shared/periodMetrics.ts');
  
  // Calculate date range based on period
  const now = new Date();
  let startDate: Date;
  let endDate: Date = now;

  switch (period) {
    case 'today':
      startDate = new Date(now.getFullYear(), now.getMonth(), now.getDate());
      break;
    case 'yesterday':
      startDate = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 1);
      endDate = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 1, 23, 59, 59);
      break;
    case 'week':
      startDate = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 7);
      break;
    case 'month':
      startDate = new Date(now.getFullYear(), now.getMonth(), 1);
      break;
    case 'quarter': {
      const quarter = Math.floor(now.getMonth() / 3);
      startDate = new Date(now.getFullYear(), quarter * 3, 1);
      break;
    }
    case 'year':
      startDate = new Date(now.getFullYear(), 0, 1);
      break;
    case 'custom':
      if (!start_date || !end_date) {
        throw new Error('Custom period requires start_date and end_date');
      }
      startDate = new Date(start_date);
      endDate = new Date(end_date);
      break;
    default:
      startDate = new Date(now.getFullYear(), now.getMonth(), 1);
  }

  const startDateStr = startDate.toISOString().split('T')[0];
  const endDateStr = endDate.toISOString().split('T')[0];

  // ====== FETCH DATA FROM DATABASE ======
  
  // Fetch sales (excluding adjustments)
  const { data: sales, error: salesError } = await supabase
    .from('unified_sales')
    .select('id, total_price, item_type, parent_sale_id, is_categorized, chart_account:chart_of_accounts!category_id(account_type, account_subtype)')
    .eq('restaurant_id', restaurantId)
    .gte('sale_date', startDateStr)
    .lte('sale_date', endDateStr)
    .is('adjustment_type', null);

  if (salesError) {
    throw new Error(`Failed to fetch sales: ${salesError.message}`);
  }

  // Fetch adjustments separately
  const { data: adjustments, error: adjustmentsError } = await supabase
    .from('unified_sales')
    .select('adjustment_type, total_price')
    .eq('restaurant_id', restaurantId)
    .gte('sale_date', startDateStr)
    .lte('sale_date', endDateStr)
    .not('adjustment_type', 'is', null);

  if (adjustmentsError) {
    throw new Error(`Failed to fetch adjustments: ${adjustmentsError.message}`);
  }

  // Fetch food costs (COGS)
  const { data: foodCostData, error: foodCostError } = await supabase
    .from('inventory_transactions')
    .select('total_cost')
    .eq('restaurant_id', restaurantId)
    .eq('transaction_type', 'usage')
    .gte('created_at', startDateStr)
    .lte('created_at', endDateStr + 'T23:59:59.999Z');

  if (foodCostError) {
    throw new Error(`Failed to fetch food costs: ${foodCostError.message}`);
  }

  // Fetch labor costs using time_punches + employees (same as Dashboard)
  // Import labor calculation module
  const { calculateActualLaborCost } = await import('../_shared/laborCalculations.ts');

  // Fetch time punches for the period
  const { data: timePunches, error: punchesError } = await supabase
    .from('time_punches')
    .select('id, employee_id, restaurant_id, punch_time, punch_type')
    .eq('restaurant_id', restaurantId)
    .gte('punch_time', startDate.toISOString())
    .lte('punch_time', endDate.toISOString())
    .order('punch_time', { ascending: true });

  if (punchesError) {
    throw new Error(`Failed to fetch time punches: ${punchesError.message}`);
  }

  // Fetch all employees (including inactive for historical accuracy)
  const { data: employees, error: employeesError } = await supabase
    .from('employees')
    .select('*')
    .eq('restaurant_id', restaurantId);

  if (employeesError) {
    throw new Error(`Failed to fetch employees: ${employeesError.message}`);
  }

  // Calculate labor costs using shared module (same logic as Dashboard)
  const { breakdown: laborBreakdown } = calculateActualLaborCost(
    employees || [],
    timePunches || [],
    startDate,
    endDate
  );

  // Convert to format expected by calculatePeriodMetrics
  // Labor total is in dollars, convert to cents for consistency
  const laborCostData = [{ total_labor_cost: Math.round(laborBreakdown.total * 100) / 100 }];

  // Fetch inventory value
  const { data: inventory, error: invError } = await supabase
    .from('products')
    .select('current_stock, cost_per_unit')
    .eq('restaurant_id', restaurantId);

  if (invError) {
    throw new Error(`Failed to fetch inventory: ${invError.message}`);
  }

  const inventoryValue = inventory?.reduce((sum: number, item: any) => 
    sum + ((item.current_stock || 0) * (item.cost_per_unit || 0)), 0) || 0;

  // Get bank transaction count
  const { count: transactionCount } = await supabase
    .from('bank_transactions')
    .select('*', { count: 'exact', head: true })
    .eq('restaurant_id', restaurantId)
    .gte('transaction_date', startDateStr)
    .lte('transaction_date', endDateStr);

  // ====== CALCULATE METRICS USING SHARED MODULE ======
  
  const metrics = calculatePeriodMetrics(
    sales || [],
    adjustments || [],
    foodCostData || [],
    laborCostData || []
  );

  return {
    ok: true,
    data: {
      period,
      start_date: startDateStr,
      end_date: endDateStr,

      // All metrics from shared calculation module
      revenue: metrics.revenue,
      costs: metrics.costs,
      profitability: metrics.profitability,
      liabilities: metrics.liabilities,
      benchmarks: metrics.benchmarks,

      // Additional metrics not in shared module
      inventory_value: inventoryValue,
      bank_transaction_count: transactionCount || 0,
    },
    evidence: [
      { table: 'unified_sales', date: startDateStr, summary: `Sales data ${startDateStr} to ${endDateStr}` },
      { table: 'inventory_transactions', date: startDateStr, summary: `Food cost (usage) ${startDateStr} to ${endDateStr}` },
      { table: 'time_punches', date: startDateStr, summary: `Labor from time punches ${startDateStr} to ${endDateStr}` },
      { table: 'products', summary: `Current inventory snapshot (${inventory?.length || 0} items)` },
    ],
  };
}

/**
 * Execute get_inventory_status tool (enhanced)
 */
async function executeGetInventoryStatus(
  args: any,
  restaurantId: string,
  supabase: any
): Promise<any> {
  const { include_low_stock = true, category } = args;

  let query = supabase
    .from('products')
    .select(`
      id, 
      name, 
      current_stock, 
      par_level_min, 
      par_level_max,
      reorder_point,
      cost_per_unit, 
      category,
      product_suppliers (
        supplier:suppliers (
          name
        ),
        is_preferred
      )
    `)
    .eq('restaurant_id', restaurantId);

  if (category) {
    query = query.eq('category', category);
  }

  const { data: products, error } = await query;

  if (error) {
    throw new Error(`Failed to fetch inventory: ${error.message}`);
  }

  const lowStockItems = products?.filter((p: any) => 
    p.current_stock <= (p.par_level_min || 0)
  ) || [];

  const totalValue = products?.reduce((sum: number, item: any) => 
    sum + ((item.current_stock || 0) * (item.cost_per_unit || 0)), 0) || 0;

  return {
    ok: true,
    data: {
      total_items: products?.length || 0,
      total_value: totalValue,
      low_stock_count: lowStockItems.length,
      low_stock_items: include_low_stock ? lowStockItems.slice(0, 10).map((item: any) => ({
        id: item.id,
        name: item.name,
        current_stock: item.current_stock,
        par_level_min: item.par_level_min,
        reorder_point: item.reorder_point,
        preferred_supplier: item.product_suppliers?.find((ps: any) => ps.is_preferred)?.supplier?.name || 'No supplier',
      })) : [],
    },
    evidence: [
      { table: 'products', summary: `Inventory snapshot: ${products?.length || 0} items, ${lowStockItems.length} low stock` },
    ],
  };
}

/**
 * Execute get_recipe_analytics tool
 */
async function executeGetRecipeAnalytics(
  args: any,
  restaurantId: string,
  supabase: any
): Promise<any> {
  const { 
    recipe_id, 
    sort_by = 'margin',
    days_back = 30,
    include_zero_sales = false
  } = args;

  // Import the shared service from _shared directory
  const { calculateRecipeProfitability } = await import('../_shared/recipeAnalytics.ts');

  try {
    const summary = await calculateRecipeProfitability(supabase, {
      restaurantId,
      recipeId: recipe_id,
      daysBack: days_back,
      includeZeroSales: include_zero_sales,
      sortBy: sort_by
    });

    return {
      ok: true,
      data: {
        recipes: summary.recipes.slice(0, 20), // Limit to top 20 for AI responses
        total_count: summary.totalRecipes,
        recipes_with_sales: summary.recipesWithSales,
        average_margin: summary.averageMargin,
        average_food_cost: summary.averageFoodCost,
        highest_margin: summary.highestMargin ? {
          name: summary.highestMargin.name,
          margin: summary.highestMargin.margin,
          selling_price: summary.highestMargin.selling_price
        } : null,
        lowest_margin: summary.lowestMargin ? {
          name: summary.lowestMargin.name,
          margin: summary.lowestMargin.margin,
          selling_price: summary.lowestMargin.selling_price
        } : null,
        analysis_period_days: days_back
      },
      evidence: [
        { table: 'recipes', summary: `Recipe profitability for ${summary.totalRecipes} recipes (${days_back} days back)` },
        { table: 'unified_sales', summary: `Sales data for recipe margin calculation (${summary.recipesWithSales} recipes with sales)` },
      ],
    };
  } catch (error: any) {
    throw new Error(`Failed to calculate recipe analytics: ${error.message}`);
  }
}

/**
 * Helper: Calculate cash flow metrics
 */
async function calculateCashFlow(
  args: any,
  restaurantId: string,
  supabase: any,
  results: any
): Promise<void> {
  const { start_date, end_date, bank_account_id } = args;
  
  // Fetch bank transactions
  let query = supabase
    .from('bank_transactions')
    .select('amount, transaction_date, category_id')
    .eq('restaurant_id', restaurantId)
    .gte('transaction_date', start_date)
    .lte('transaction_date', end_date);
  
  if (bank_account_id) {
    query = query.eq('bank_account_id', bank_account_id);
  }
  
  const { data: transactions, error } = await query;
  
  if (error) throw new Error(`Failed to fetch transactions: ${error.message}`);
  
  const inflows = transactions?.filter((t: any) => t.amount > 0).reduce((sum: number, t: any) => sum + t.amount, 0) || 0;
  const outflows = Math.abs(transactions?.filter((t: any) => t.amount < 0).reduce((sum: number, t: any) => sum + t.amount, 0) || 0);
  const netCashFlow = inflows - outflows;
  
  // Calculate daily average
  const days = Math.ceil((new Date(end_date).getTime() - new Date(start_date).getTime()) / (1000 * 60 * 60 * 24));
  const avgDailyCashFlow = days > 0 ? netCashFlow / days : 0;
  
  // Calculate volatility (standard deviation)
  const dailyFlows: Record<string, number> = {};
  transactions?.forEach((t: any) => {
    const date = t.transaction_date;
    dailyFlows[date] = (dailyFlows[date] || 0) + t.amount;
  });
  
  const flowValues = Object.values(dailyFlows);
  const mean = flowValues.reduce((sum: number, val: number) => sum + val, 0) / (flowValues.length || 1);
  const variance = flowValues.reduce((sum: number, val: number) => sum + Math.pow(val - mean, 2), 0) / (flowValues.length || 1);
  const volatility = Math.sqrt(variance);
  
  results.cash_flow = {
    inflows_7d: inflows,
    outflows_7d: outflows,
    net_cash_flow_7d: netCashFlow,
    avg_daily_cash_flow: avgDailyCashFlow,
    volatility: volatility,
    transaction_count: transactions?.length || 0,
  };
}

/**
 * Helper: Calculate revenue health metrics
 */
async function calculateRevenueHealth(
  args: any,
  restaurantId: string,
  supabase: any,
  results: any
): Promise<void> {
  const { start_date, end_date, bank_account_id } = args;
  
  // Fetch bank transactions that look like revenue deposits
  let query = supabase
    .from('bank_transactions')
    .select('amount, transaction_date, description')
    .eq('restaurant_id', restaurantId)
    .gte('transaction_date', start_date)
    .lte('transaction_date', end_date)
    .gt('amount', 0);
  
  if (bank_account_id) {
    query = query.eq('bank_account_id', bank_account_id);
  }
  
  const { data: deposits, error } = await query;
  
  if (error) throw new Error(`Failed to fetch deposits: ${error.message}`);
  
  // Filter for likely revenue deposits (excluding small transfers/refunds)
  const revenueDeposits = deposits?.filter((d: any) => d.amount > 10) || [];
  
  const totalRevenue = revenueDeposits.reduce((sum: number, d: any) => sum + d.amount, 0);
  const avgDeposit = revenueDeposits.length > 0 ? totalRevenue / revenueDeposits.length : 0;
  const largestDeposit = revenueDeposits.reduce((max: number, d: any) => Math.max(max, d.amount), 0);
  
  // Calculate deposit frequency
  const dates = revenueDeposits.map((d: any) => new Date(d.transaction_date).getTime()).sort((a: number, b: number) => a - b);
  let totalGap = 0;
  for (let i = 1; i < dates.length; i++) {
    totalGap += (dates[i] - dates[i-1]) / (1000 * 60 * 60 * 24); // Convert to days
  }
  const avgDaysBetweenDeposits = dates.length > 1 ? totalGap / (dates.length - 1) : 0;
  
  results.revenue_health = {
    deposit_count: revenueDeposits.length,
    avg_deposit_size: avgDeposit,
    largest_deposit: largestDeposit,
    total_revenue: totalRevenue,
    avg_days_between_deposits: avgDaysBetweenDeposits,
    deposit_frequency_score: avgDaysBetweenDeposits < 2 ? 5 : avgDaysBetweenDeposits < 4 ? 4 : avgDaysBetweenDeposits < 7 ? 3 : 2,
  };
}

/**
 * Helper: Calculate spending metrics
 */
async function calculateSpending(
  args: any,
  restaurantId: string,
  supabase: any,
  results: any
): Promise<void> {
  const { start_date, end_date, bank_account_id } = args;
  
  // Fetch expense transactions
  let query = supabase
    .from('bank_transactions')
    .select(`
      amount, 
      transaction_date, 
      description,
      merchant_name,
      category:chart_of_accounts!category_id(id, account_name, account_code)
    `)
    .eq('restaurant_id', restaurantId)
    .gte('transaction_date', start_date)
    .lte('transaction_date', end_date)
    .lt('amount', 0);
  
  if (bank_account_id) {
    query = query.eq('bank_account_id', bank_account_id);
  }
  
  const { data: expenses, error } = await query;
  
  if (error) throw new Error(`Failed to fetch expenses: ${error.message}`);
  
  const totalExpenses = Math.abs(expenses?.reduce((sum: number, e: any) => sum + e.amount, 0) || 0);
  
  // Group by merchant/vendor
  const byVendor: Record<string, number> = {};
  expenses?.forEach((e: any) => {
    const vendor = e.merchant_name || e.description || 'Unknown';
    byVendor[vendor] = (byVendor[vendor] || 0) + Math.abs(e.amount);
  });
  
  const topVendors = Object.entries(byVendor)
    .sort(([, a], [, b]) => b - a)
    .slice(0, 10)
    .map(([name, amount]) => ({ name, amount }));
  
  // Group by category
  const byCategory: Record<string, number> = {};
  expenses?.forEach((e: any) => {
    const category = e.category?.account_name || 'Uncategorized';
    byCategory[category] = (byCategory[category] || 0) + Math.abs(e.amount);
  });
  
  results.spending = {
    total_expenses: totalExpenses,
    expense_count: expenses?.length || 0,
    avg_transaction: expenses?.length ? totalExpenses / expenses.length : 0,
    top_vendors: topVendors,
    by_category: Object.entries(byCategory).map(([name, amount]) => ({ name, amount })),
  };
}

/**
 * Helper: Calculate liquidity metrics
 */
async function calculateLiquidity(
  args: any,
  restaurantId: string,
  supabase: any,
  results: any
): Promise<void> {
  const { bank_account_id } = args;
  
  // Fetch current bank balances
  const { data: banks, error: banksError } = await supabase
    .from('connected_banks')
    .select(`
      id,
      institution_name,
      bank_account_balances (
        account_name,
        current_balance
      )
    `)
    .eq('restaurant_id', restaurantId)
    .eq('status', 'connected');
  
  if (banksError) throw new Error(`Failed to fetch banks: ${banksError.message}`);
  
  const totalCash = banks?.reduce((sum: number, bank: any) => {
    const balance = bank.bank_account_balances?.[0]?.current_balance || 0;
    return sum + balance;
  }, 0) || 0;
  
  // Calculate burn rate from recent outflows
  let outflowQuery = supabase
    .from('bank_transactions')
    .select('amount, transaction_date')
    .eq('restaurant_id', restaurantId)
    .lt('amount', 0)
    .gte('transaction_date', new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString().split('T')[0]);
  
  if (bank_account_id) {
    outflowQuery = outflowQuery.eq('bank_account_id', bank_account_id);
  }
  
  const { data: recentOutflows } = await outflowQuery;
  
  const totalOutflows = Math.abs(recentOutflows?.reduce((sum: number, t: any) => sum + t.amount, 0) || 0);
  const avgDailyOutflow = totalOutflows / 30;
  const daysOfCash = avgDailyOutflow > 0 ? totalCash / avgDailyOutflow : 999;
  
  results.liquidity = {
    current_balance: totalCash,
    avg_daily_outflow: avgDailyOutflow,
    days_of_cash: Math.round(daysOfCash),
    runway_status: daysOfCash > 60 ? 'healthy' : daysOfCash > 30 ? 'caution' : 'critical',
    projected_zero_date: daysOfCash < 999 ? new Date(Date.now() + daysOfCash * 24 * 60 * 60 * 1000).toISOString().split('T')[0] : null,
  };
}

/**
 * Helper: Calculate prediction metrics
 */
async function calculatePredictions(
  args: any,
  restaurantId: string,
  supabase: any,
  results: any
): Promise<void> {
  const { bank_account_id } = args;
  
  // Simple predictions based on historical patterns
  let query = supabase
    .from('bank_transactions')
    .select('amount, transaction_date, description, merchant_name')
    .eq('restaurant_id', restaurantId)
    .gte('transaction_date', new Date(Date.now() - 60 * 24 * 60 * 60 * 1000).toISOString().split('T')[0]);
  
  if (bank_account_id) {
    query = query.eq('bank_account_id', bank_account_id);
  }
  
  const { data: historical } = await query;
  
  // Find recurring patterns
  const depositPattern = historical?.filter((t: any) => t.amount > 100);
  const avgDepositSize = depositPattern?.reduce((sum: number, t: any) => sum + t.amount, 0) / (depositPattern?.length || 1);
  
  // Calculate days since last deposit
  const lastDepositDate = depositPattern?.reduce((latest: string, t: any) => {
    return t.transaction_date > latest ? t.transaction_date : latest;
  }, '1970-01-01');
  
  const daysSinceDeposit = Math.floor((Date.now() - new Date(lastDepositDate).getTime()) / (1000 * 60 * 60 * 24));
  
  results.predictions = {
    next_deposit_prediction: {
      expected_days_from_now: Math.max(0, 7 - daysSinceDeposit), // Assume weekly deposits
      expected_amount: avgDepositSize,
      confidence: depositPattern?.length > 4 ? 'high' : depositPattern?.length > 2 ? 'medium' : 'low',
    },
  };
}

/**
 * Execute get_financial_intelligence tool
 */
async function executeGetFinancialIntelligence(
  args: any,
  restaurantId: string,
  supabase: any
): Promise<any> {
  const { analysis_type, start_date, end_date, bank_account_id } = args;
  
  const results: any = {};
  
  try {
    // Call appropriate metric calculation functions based on analysis_type
    if (analysis_type === 'all' || analysis_type === 'cash_flow') {
      await calculateCashFlow(args, restaurantId, supabase, results);
    }
    
    if (analysis_type === 'all' || analysis_type === 'revenue_health') {
      await calculateRevenueHealth(args, restaurantId, supabase, results);
    }
    
    if (analysis_type === 'all' || analysis_type === 'spending') {
      await calculateSpending(args, restaurantId, supabase, results);
    }
    
    if (analysis_type === 'all' || analysis_type === 'liquidity') {
      await calculateLiquidity(args, restaurantId, supabase, results);
    }
    
    if (analysis_type === 'all' || analysis_type === 'predictions') {
      await calculatePredictions(args, restaurantId, supabase, results);
    }
    
    return {
      ok: true,
      data: {
        period: { start_date, end_date },
        analysis_type,
        ...results,
      },
      evidence: [
        { table: 'bank_transactions', summary: `Bank transactions for ${analysis_type} analysis from ${start_date} to ${end_date}` },
        { table: 'bank_account_balances', summary: `Current bank account balances for liquidity and cash flow metrics` },
      ],
    };

  } catch (error: unknown) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    throw new Error(`Failed to calculate financial intelligence: ${errorMessage}`);
  }
}

/**
 * Execute get_bank_transactions tool
 */
async function executeGetBankTransactions(
  args: any,
  restaurantId: string,
  supabase: any
): Promise<any> {
  const { 
    start_date, 
    end_date, 
    bank_account_id, 
    category_id, 
    min_amount, 
    max_amount, 
    is_categorized,
    limit = 50 
  } = args;
  
  let query = supabase
    .from('bank_transactions')
    .select(`
      id,
      amount,
      description,
      merchant_name,
      transaction_date,
      is_categorized,
      ai_confidence,
      bank_account:connected_banks(institution_name),
      category:chart_of_accounts!category_id(account_name, account_code)
    `)
    .eq('restaurant_id', restaurantId)
    .gte('transaction_date', start_date)
    .lte('transaction_date', end_date)
    .order('transaction_date', { ascending: false })
    .limit(limit);
  
  if (bank_account_id) {
    query = query.eq('bank_account_id', bank_account_id);
  }
  
  if (category_id) {
    query = query.eq('category_id', category_id);
  }
  
  if (min_amount !== undefined) {
    query = query.gte('amount', min_amount);
  }
  
  if (max_amount !== undefined) {
    query = query.lte('amount', max_amount);
  }
  
  if (is_categorized !== undefined) {
    query = query.eq('is_categorized', is_categorized);
  }
  
  const { data: transactions, error } = await query;
  
  if (error) {
    throw new Error(`Failed to fetch transactions: ${error.message}`);
  }
  
  // Calculate summary stats
  const total = transactions?.reduce((sum: number, t: any) => sum + t.amount, 0) || 0;
  const inflows = transactions?.filter((t: any) => t.amount > 0).reduce((sum: number, t: any) => sum + t.amount, 0) || 0;
  const outflows = Math.abs(transactions?.filter((t: any) => t.amount < 0).reduce((sum: number, t: any) => sum + t.amount, 0) || 0);
  const categorized = transactions?.filter((t: any) => t.is_categorized).length || 0;
  
  return {
    ok: true,
    data: {
      period: { start_date, end_date },
      summary: {
        total_transactions: transactions?.length || 0,
        total_net: total,
        total_inflows: inflows,
        total_outflows: outflows,
        categorized_count: categorized,
        categorization_rate: transactions?.length ? (categorized / transactions.length) * 100 : 0,
      },
      transactions: transactions?.map((t: any) => ({
        id: t.id,
        date: t.transaction_date,
        amount: t.amount,
        description: t.description,
        merchant: t.merchant_name,
        bank: t.bank_account?.institution_name,
        category: t.category?.account_name || 'Uncategorized',
        is_categorized: t.is_categorized,
        ai_confidence: t.ai_confidence,
      })) || [],
    },
    evidence: [
      { table: 'bank_transactions', summary: `${transactions?.length || 0} transactions from ${start_date} to ${end_date}` },
    ],
  };
}

/**
 * Execute get_financial_statement tool
 */
async function executeGetFinancialStatement(
  args: any,
  restaurantId: string,
  supabase: any
): Promise<any> {
  const { statement_type, start_date, end_date } = args;
  
  try {
    switch (statement_type) {
      case 'income_statement': {
        // Fetch revenue from unified_sales
        const { data: sales } = await supabase
          .from('unified_sales')
          .select('total_price')
          .eq('restaurant_id', restaurantId)
          .gte('sale_date', start_date)
          .lte('sale_date', end_date);
        
        const revenue = sales?.reduce((sum: number, s: any) => sum + (s.total_price || 0), 0) || 0;
        
        // Fetch COGS from inventory transactions
        const { data: cogs } = await supabase
          .from('inventory_transactions')
          .select('total_cost')
          .eq('restaurant_id', restaurantId)
          .eq('transaction_type', 'usage')
          .gte('created_at', start_date)
          .lte('created_at', end_date);
        
        const totalCogs = Math.abs(cogs?.reduce((sum: number, c: any) => sum + (c.total_cost || 0), 0) || 0);
        
        // Fetch expenses from journal entries
        const { data: expenseAccounts } = await supabase
          .from('chart_of_accounts')
          .select('id')
          .eq('restaurant_id', restaurantId)
          .eq('account_type', 'expense');
        
        const expenseAccountIds = expenseAccounts?.map((a: any) => a.id) || [];
        
        const { data: expenses } = await supabase
          .from('journal_entry_lines')
          .select(`
            debit_amount,
            credit_amount,
            journal_entry:journal_entries!inner(entry_date)
          `)
          .in('account_id', expenseAccountIds)
          .gte('journal_entry.entry_date', start_date)
          .lte('journal_entry.entry_date', end_date);
        
        const totalExpenses = expenses?.reduce((sum: number, e: any) => 
          sum + (e.debit_amount || 0) - (e.credit_amount || 0), 0) || 0;
        
        const grossProfit = revenue - totalCogs;
        const netIncome = grossProfit - totalExpenses;
        
        return {
          ok: true,
          data: {
            statement_type: 'Income Statement',
            period: { start_date, end_date },
            revenue: revenue,
            cost_of_goods_sold: totalCogs,
            gross_profit: grossProfit,
            gross_margin: revenue > 0 ? (grossProfit / revenue) * 100 : 0,
            operating_expenses: totalExpenses,
            net_income: netIncome,
            net_margin: revenue > 0 ? (netIncome / revenue) * 100 : 0,
          },
          evidence: [
            { table: 'unified_sales', summary: `Revenue data from ${start_date} to ${end_date} (${sales?.length || 0} sales)` },
            { table: 'inventory_transactions', summary: `COGS from usage transactions ${start_date} to ${end_date}` },
            { table: 'journal_entry_lines', summary: `Operating expenses from journal entries ${start_date} to ${end_date}` },
          ],
        };
      }
      
      case 'balance_sheet': {
        // Get as of date (end_date)
        const asOfDate = end_date;
        
        // Assets
        const { data: cashAccounts } = await supabase
          .from('connected_banks')
          .select(`
            bank_account_balances(current_balance)
          `)
          .eq('restaurant_id', restaurantId)
          .eq('status', 'connected');
        
        const cash = cashAccounts?.reduce((sum: number, bank: any) => 
          sum + (bank.bank_account_balances?.[0]?.current_balance || 0), 0) || 0;
        
        const { data: inventory } = await supabase
          .from('products')
          .select('current_stock, cost_per_unit')
          .eq('restaurant_id', restaurantId);
        
        const inventoryValue = inventory?.reduce((sum: number, p: any) => 
          sum + ((p.current_stock || 0) * (p.cost_per_unit || 0)), 0) || 0;
        
        const totalAssets = cash + inventoryValue;
        
        // Simplified - would need accounts payable and other liability tracking
        const totalLiabilities = 0;
        const totalEquity = totalAssets - totalLiabilities;
        
        return {
          ok: true,
          data: {
            statement_type: 'Balance Sheet',
            as_of_date: asOfDate,
            assets: {
              current_assets: {
                cash: cash,
                inventory: inventoryValue,
                total: cash + inventoryValue,
              },
              total_assets: totalAssets,
            },
            liabilities: {
              current_liabilities: {
                accounts_payable: 0, // Placeholder
                total: totalLiabilities,
              },
              total_liabilities: totalLiabilities,
            },
            equity: {
              retained_earnings: totalEquity,
              total_equity: totalEquity,
            },
            total_liabilities_and_equity: totalLiabilities + totalEquity,
          },
          evidence: [
            { table: 'connected_banks', summary: `Cash balances from connected bank accounts as of ${asOfDate}` },
            { table: 'products', summary: `Inventory valuation from ${inventory?.length || 0} products` },
          ],
        };
      }
      
      case 'cash_flow': {
        const { data: transactions } = await supabase
          .from('bank_transactions')
          .select('amount, transaction_date')
          .eq('restaurant_id', restaurantId)
          .gte('transaction_date', start_date)
          .lte('transaction_date', end_date)
          .order('transaction_date', { ascending: true });
        
        const inflows = transactions?.filter((t: any) => t.amount > 0).reduce((sum: number, t: any) => sum + t.amount, 0) || 0;
        const outflows = Math.abs(transactions?.filter((t: any) => t.amount < 0).reduce((sum: number, t: any) => sum + t.amount, 0) || 0);
        
        return {
          ok: true,
          data: {
            statement_type: 'Cash Flow Statement',
            period: { start_date, end_date },
            operating_activities: {
              cash_inflows: inflows,
              cash_outflows: outflows,
              net_cash_from_operations: inflows - outflows,
            },
            investing_activities: {
              net_cash_from_investing: 0, // Placeholder
            },
            financing_activities: {
              net_cash_from_financing: 0, // Placeholder
            },
            net_change_in_cash: inflows - outflows,
          },
          evidence: [
            { table: 'bank_transactions', summary: `Cash flow from ${transactions?.length || 0} transactions ${start_date} to ${end_date}` },
          ],
        };
      }
      
      case 'trial_balance': {
        // Get all account balances as of end_date
        const { data: accounts } = await supabase
          .from('chart_of_accounts')
          .select(`
            id,
            account_code,
            account_name,
            account_type,
            account_balances!inner(balance)
          `)
          .eq('restaurant_id', restaurantId)
          .eq('is_active', true)
          .lte('account_balances.as_of_date', end_date)
          .order('account_code', { ascending: true });
        
        // Group by debit and credit based on account type
        const debits: any[] = [];
        const credits: any[] = [];
        let totalDebits = 0;
        let totalCredits = 0;
        
        accounts?.forEach((account: any) => {
          const balance = account.account_balances?.[0]?.balance || 0;
          const item = {
            account_code: account.account_code,
            account_name: account.account_name,
            balance: Math.abs(balance),
          };
          
          // Assets, Expenses = Debits
          // Liabilities, Equity, Revenue = Credits
          if (['asset', 'expense', 'cogs'].includes(account.account_type)) {
            debits.push(item);
            totalDebits += Math.abs(balance);
          } else {
            credits.push(item);
            totalCredits += Math.abs(balance);
          }
        });
        
        return {
          ok: true,
          data: {
            statement_type: 'Trial Balance',
            as_of_date: end_date,
            debits: debits,
            credits: credits,
            total_debits: totalDebits,
            total_credits: totalCredits,
            in_balance: Math.abs(totalDebits - totalCredits) < 0.01,
            difference: totalDebits - totalCredits,
          },
          evidence: [
            { table: 'chart_of_accounts', summary: `Trial balance from ${accounts?.length || 0} active accounts as of ${end_date}` },
            { table: 'account_balances', summary: `Account balances for debit/credit classification` },
          ],
        };
      }
      
      default:
        throw new Error(`Unknown statement type: ${statement_type}`);
    }
  } catch (error: unknown) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    throw new Error(`Failed to generate financial statement: ${errorMessage}`);
  }
}

/**
 * Execute get_sales_summary tool (enhanced)
 */
async function executeGetSalesSummary(
  args: any,
  restaurantId: string,
  supabase: any
): Promise<any> {
  const { 
    period, 
    start_date, 
    end_date, 
    compare_to_previous = true, 
    include_items = false 
  } = args;

  // Calculate date ranges
  const now = new Date();
  let startDate: Date;
  let endDate: Date = now;
  let prevStartDate: Date;
  let prevEndDate: Date;

  // If custom dates provided, use those
  if (start_date && end_date) {
    // Parse dates explicitly to avoid timezone issues
    const [startYear, startMonth, startDay] = start_date.split('-').map(Number);
    const [endYear, endMonth, endDay] = end_date.split('-').map(Number);
    startDate = new Date(startYear, startMonth - 1, startDay);
    endDate = new Date(endYear, endMonth - 1, endDay, 23, 59, 59);
    
    // Calculate previous period with same duration
    const durationMs = endDate.getTime() - startDate.getTime();
    prevEndDate = new Date(startDate.getTime() - 1);
    prevStartDate = new Date(prevEndDate.getTime() - durationMs);
  } else {
    // Calculate based on period
    switch (period) {
      case 'today':
        startDate = new Date(now.getFullYear(), now.getMonth(), now.getDate());
        prevStartDate = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 1);
        prevEndDate = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 1, 23, 59, 59);
        break;
      case 'yesterday':
        startDate = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 1);
        endDate = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 1, 23, 59, 59);
        prevStartDate = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 2);
        prevEndDate = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 2, 23, 59, 59);
        break;
      case 'week':
        startDate = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 7);
        prevStartDate = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 14);
        prevEndDate = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 7);
        break;
      case 'month':
        startDate = new Date(now.getFullYear(), now.getMonth(), 1);
        prevStartDate = new Date(now.getFullYear(), now.getMonth() - 1, 1);
        prevEndDate = new Date(now.getFullYear(), now.getMonth(), 0, 23, 59, 59);
        break;
      case 'quarter': {
        const quarter = Math.floor(now.getMonth() / 3);
        startDate = new Date(now.getFullYear(), quarter * 3, 1);
        prevStartDate = new Date(now.getFullYear(), (quarter - 1) * 3, 1);
        prevEndDate = new Date(now.getFullYear(), quarter * 3, 0, 23, 59, 59);
        break;
      }
      default:
        startDate = new Date(now.getFullYear(), now.getMonth(), 1);
        prevStartDate = new Date(now.getFullYear(), now.getMonth() - 1, 1);
        prevEndDate = new Date(now.getFullYear(), now.getMonth(), 0, 23, 59, 59);
    }
  }

  const startDateStr = startDate.toISOString().split('T')[0];
  const endDateStr = endDate.toISOString().split('T')[0];

  // Fetch current period sales (excluding adjustments - only actual revenue)
  const { data: currentSales, error: currentError } = await supabase
    .from('unified_sales')
    .select('total_price, sale_date, item_name')
    .eq('restaurant_id', restaurantId)
    .gte('sale_date', startDateStr)
    .lte('sale_date', endDateStr)
    .is('adjustment_type', null)
    .is('parent_sale_id', null);

  if (currentError) {
    throw new Error(`Failed to fetch sales: ${currentError.message}`);
  }

  const currentTotal = currentSales?.reduce((sum: number, sale: any) => sum + (sale.total_price || 0), 0) || 0;
  const currentCount = currentSales?.length || 0;

  // Get items breakdown if requested
  let itemsBreakdown = null;
  if (include_items) {
    const itemsSummary: Record<string, { count: number; total: number }> = {};
    currentSales?.forEach((sale: any) => {
      const item = sale.item_name || 'Unknown';
      if (!itemsSummary[item]) {
        itemsSummary[item] = { count: 0, total: 0 };
      }
      itemsSummary[item].count += 1;
      itemsSummary[item].total += sale.total_price || 0;
    });
    
    itemsBreakdown = Object.entries(itemsSummary)
      .sort(([, a], [, b]) => b.total - a.total)
      .slice(0, 20)
      .map(([name, data]) => ({
        item_name: name,
        quantity_sold: data.count,
        total_sales: data.total,
        avg_price: data.count > 0 ? data.total / data.count : 0,
      }));
  }

  let comparison = null;

  if (compare_to_previous) {
    const prevStartDateStr = prevStartDate.toISOString().split('T')[0];
    const prevEndDateStr = prevEndDate.toISOString().split('T')[0];

    const { data: prevSales, error: prevError } = await supabase
      .from('unified_sales')
      .select('total_price')
      .eq('restaurant_id', restaurantId)
      .gte('sale_date', prevStartDateStr)
      .lte('sale_date', prevEndDateStr)
      .is('adjustment_type', null)
      .is('parent_sale_id', null);

    if (!prevError) {
      const prevTotal = prevSales?.reduce((sum: number, sale: any) => sum + (sale.total_price || 0), 0) || 0;
      const change = prevTotal > 0 ? ((currentTotal - prevTotal) / prevTotal) * 100 : 0;

      comparison = {
        previous_total: prevTotal,
        change_percent: Math.round(change * 10) / 10,
        change_amount: currentTotal - prevTotal,
      };
    }
  }

  return {
    ok: true,
    data: {
      period,
      start_date: startDateStr,
      end_date: endDateStr,
      total_sales: currentTotal,
      transaction_count: currentCount,
      average_transaction: currentCount > 0 ? currentTotal / currentCount : 0,
      top_items: itemsBreakdown,
      comparison,
    },
    evidence: [
      { table: 'unified_sales', summary: `${currentCount} sales from ${startDateStr} to ${endDateStr}` },
    ],
  };
}

/**
 * Execute get_inventory_transactions tool
 * Reuses shared service logic for consistency with frontend
 */
async function executeGetInventoryTransactions(
  args: any,
  restaurantId: string,
  supabase: any
): Promise<any> {
  const {
    transaction_type = 'all',
    product_id,
    start_date,
    end_date,
    days_back = 30,
    supplier_id,
    min_cost,
    max_cost,
    include_summary = true,
    group_by = 'none',
    limit = 50
  } = args;

  // Calculate date range
  let startDateStr: string;
  let endDateStr: string;

  if (start_date && end_date) {
    startDateStr = start_date;
    endDateStr = end_date;
  } else {
    const now = new Date();
    const daysToLookBack = Math.min(days_back, 90); // Max 90 days
    const startDate = new Date(now.getTime() - daysToLookBack * 24 * 60 * 60 * 1000);
    startDateStr = startDate.toISOString().split('T')[0];
    endDateStr = now.toISOString().split('T')[0];
  }

  // ✅ REUSE: Call the SAME service function used by the frontend
  const transactions = await fetchInventoryTransactions(supabase, {
    restaurantId,
    typeFilter: transaction_type,
    startDate: startDateStr,
    endDate: endDateStr,
    limit: Math.min(limit, 200),
    productId: product_id,
    supplierId: supplier_id,
    minCost: min_cost,
    maxCost: max_cost
  });

  // ✅ REUSE: Calculate summary using same function
  const summary = include_summary 
    ? calculateTransactionsSummary(transactions)
    : null;

  // ✅ REUSE: Group using same function
  const groupedData = group_by !== 'none'
    ? groupTransactions(transactions, group_by as any)
    : null;

  // Format for AI consumption
  const formattedTransactions = transactions.map((t: any) => ({
    id: t.id,
    type: t.transaction_type,
    product: {
      id: t.product?.id,
      name: t.product?.name,
      sku: t.product?.sku,
      category: t.product?.category,
      unit: t.product?.uom_recipe,
    },
    quantity: t.quantity,
    unit_cost: t.unit_cost,
    total_cost: t.total_cost,
    supplier: t.supplier?.name,
    reason: t.reason,
    reference_id: t.reference_id,
    lot_number: t.lot_number,
    expiry_date: t.expiry_date,
    location: t.location,
    performed_by: t.performed_by || 'Unknown',
    date: t.created_at,
  }));

  return {
    ok: true,
    data: {
      period: { start_date: startDateStr, end_date: endDateStr },
      filters: {
        transaction_type: transaction_type !== 'all' ? transaction_type : 'all types',
        product_id,
        supplier_id,
      },
      summary,
      grouped: groupedData,
      transactions: formattedTransactions,
      has_more: transactions.length >= limit,
    },
    evidence: [
      { table: 'inventory_transactions', summary: `${transactions.length} inventory transactions from ${startDateStr} to ${endDateStr} (type: ${transaction_type})` },
    ],
  };
}

/**
 * Execute get_ai_insights tool using OpenRouter with multi-model fallback
 */
async function executeGetAiInsights(
  args: any,
  restaurantId: string,
  supabase: any
): Promise<any> {
  const { focus_area = 'overall_health' } = args;

  // Fetch relevant data based on focus area
  const dataContext: any = {};

  try {
    // Get KPIs
    const kpisResult = await executeGetKpis({ period: 'month' }, restaurantId, supabase);
    dataContext.kpis = kpisResult.data;

    // Get inventory status
    const inventoryResult = await executeGetInventoryStatus({ include_low_stock: true }, restaurantId, supabase);
    dataContext.inventory = inventoryResult.data;

    // Get recipe analytics
    const recipeResult = await executeGetRecipeAnalytics({ sort_by: 'margin' }, restaurantId, supabase);
    dataContext.recipes = recipeResult.data;

    // Get sales summary
    const salesResult = await executeGetSalesSummary({ period: 'month', compare_to_previous: true }, restaurantId, supabase);
    dataContext.sales = salesResult.data;

    // Focus area specific data
    if (focus_area === 'cost_reduction') {
      // Get high-cost products
      const { data: highCostProducts } = await supabase
        .from('products')
        .select('name, cost_per_unit, current_stock')
        .eq('restaurant_id', restaurantId)
        .order('cost_per_unit', { ascending: false })
        .limit(10);
      dataContext.high_cost_products = highCostProducts;
    }

  } catch (error: unknown) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    console.error('Error fetching data for insights:', error);
    throw new Error(`Failed to fetch data: ${errorMessage}`);
  }

  // Construct prompt for AI
  const prompt = `You are a restaurant financial analyst. Analyze the following data and provide 3-5 specific, actionable insights for ${focus_area.replace('_', ' ')}.

Restaurant Data:
${JSON.stringify(dataContext, null, 2)}

Focus Area: ${focus_area}

Provide insights in the following format. Be specific with numbers and actionable recommendations.`;

  // Try models in order (free first, then paid)
  let lastError: Error | null = null;
  
  for (const model of MODELS.filter(m => m.supportsTools)) {
    try {
      console.log(`Trying model: ${model.name} (${model.id})`);
      
      const metadata: AICallMetadata = {
        model: model.id,
        provider: 'openrouter',
        restaurant_id: restaurantId,
        edge_function: 'ai-execute-tool:get_ai_insights',
        temperature: 0.7,
        max_tokens: 2000,
        stream: false,
        attempt: MODELS.indexOf(model) + 1,
        success: false,
      };
      
      const response = await fetch('https://openrouter.ai/api/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${OPENROUTER_API_KEY}`,
          'Content-Type': 'application/json',
          'HTTP-Referer': 'https://app.easyshifthq.com',
          'X-Title': 'EasyShiftHQ AI Insights',
        },
        body: JSON.stringify({
          model: model.id,
          messages: [
            {
              role: 'system',
              content: 'You are a restaurant financial analyst specializing in actionable business insights.',
            },
            {
              role: 'user',
              content: prompt,
            },
          ],
          tools: [
            {
              type: 'function',
              function: {
                name: 'provide_insights',
                description: 'Provide actionable business insights',
                parameters: {
                  type: 'object',
                  properties: {
                    insights: {
                      type: 'array',
                      items: {
                        type: 'object',
                        properties: {
                          category: { type: 'string', description: 'Category of the insight' },
                          insight: { type: 'string', description: 'The specific insight or finding' },
                          impact: { type: 'string', enum: ['high', 'medium', 'low'], description: 'Expected impact level' },
                          action: { type: 'string', description: 'Specific action to take' },
                          estimated_savings: { type: 'number', description: 'Estimated monthly savings in dollars (optional)' },
                        },
                        required: ['category', 'insight', 'impact', 'action'],
                      },
                    },
                  },
                  required: ['insights'],
                },
              },
            },
          ],
          tool_choice: { type: 'function', function: { name: 'provide_insights' } },
          temperature: 0.7,
          max_tokens: 2000,
        }),
      });

      if (!response.ok) {
        const errorText = await response.text();
        let errorMessage = `OpenRouter API error (${response.status}): ${errorText}`;
        
        // Log error
        logAICall(
          'ai-execute-tool:get_ai_insights:error',
          { model: model.id, focus_area },
          null,
          { ...metadata, success: false, status_code: response.status, error: errorText },
          null
        );
        
        // Parse error to check if it's a moderation error
        try {
          const errorData = JSON.parse(errorText);
          if (errorData.error) {
            errorMessage = `Model ${model.name} failed: ${errorData.error.message || errorText}`;
            
            // Check for moderation errors (403)
            if (errorData.error.code === 403 || response.status === 403) {
              console.log(`[OpenRouter AI Insights] Moderation error on model ${model.name}:`, errorData.error.message);
              throw new Error(`MODERATION_ERROR: ${errorMessage}`);
            }
          }
        } catch (parseError) {
          // If parsing fails, use the raw error text
          if (!(parseError instanceof Error && parseError.message.includes('MODERATION_ERROR'))) {
            console.error('[OpenRouter AI Insights] Failed to parse error response:', parseError);
          } else {
            throw parseError; // Re-throw moderation errors
          }
        }
        
        throw new Error(errorMessage);
      }

      const data = await response.json();
      const tokenUsage = extractTokenUsage(data);
      
      if (data.choices?.[0]?.message?.tool_calls?.[0]) {
        const toolCall = data.choices[0].message.tool_calls[0];
        const insights = JSON.parse(toolCall.function.arguments);
        
        // Log successful insights generation
        logAICall(
          'ai-execute-tool:get_ai_insights:success',
          { model: model.id, focus_area, data_points: Object.keys(dataContext).length },
          { insights_count: insights.insights?.length || 0 },
          { ...metadata, success: true, status_code: 200 },
          tokenUsage
        );
        
        return {
          ok: true,
          data: {
            focus_area,
            insights: insights.insights,
            model_used: model.name,
            data_points_analyzed: Object.keys(dataContext).length,
          },
          evidence: [
            { table: 'unified_sales', summary: `Monthly sales data for ${focus_area} analysis` },
            { table: 'products', summary: `Inventory and recipe data for insight generation` },
          ],
        };
      }

      throw new Error('No tool call in response');

    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      const isModeration = errorMessage.includes('MODERATION_ERROR') || errorMessage.includes('moderation') || errorMessage.includes('flagged');
      const is403 = errorMessage.includes('403');
      
      if (isModeration || is403) {
        console.log(`[OpenRouter AI Insights] Model ${model.name} hit moderation/403 error, trying next model...`);
      } else {
        console.error(`[OpenRouter AI Insights] Model ${model.name} failed:`, errorMessage);
      }
      
      lastError = error instanceof Error ? error : new Error(String(error));
      // Continue to next model
    }
  }

  // All models failed
  throw new Error(`All AI models failed. Last error: ${lastError?.message || 'Unknown error'}`);
}

/**
 * Execute generate_report tool
 */
async function executeGenerateReport(
  args: any,
  restaurantId: string,
  supabase: any
): Promise<any> {
  const { type, start_date, end_date, format = 'json' } = args;

  // Validate dates
  const startDate = new Date(start_date);
  const endDate = new Date(end_date);
  
  if (isNaN(startDate.getTime()) || isNaN(endDate.getTime())) {
    throw new Error('Invalid date format');
  }

  let reportData: any = {};

  try {
    switch (type) {
      case 'monthly_pnl': {
        // Get revenue from unified_sales
        const { data: sales } = await supabase
          .from('unified_sales')
          .select('total_price, sale_date')
          .eq('restaurant_id', restaurantId)
          .gte('sale_date', start_date)
          .lte('sale_date', end_date);

        const totalRevenue = sales?.reduce((sum: number, s: any) => sum + (s.total_price || 0), 0) || 0;

        // Get COGS from inventory transactions
        const { data: inventory } = await supabase
          .from('inventory_transactions')
          .select('total_cost, transaction_type')
          .eq('restaurant_id', restaurantId)
          .gte('created_at', start_date)
          .lte('created_at', end_date)
          .eq('transaction_type', 'usage');

        const totalCOGS = Math.abs(inventory?.reduce((sum: number, i: any) => sum + (i.total_cost || 0), 0) || 0);

        // Get expenses from bank transactions
        const { data: expenses } = await supabase
          .from('bank_transactions')
          .select('amount, description')
          .eq('restaurant_id', restaurantId)
          .gte('transaction_date', start_date)
          .lte('transaction_date', end_date)
          .lt('amount', 0);

        const totalExpenses = Math.abs(expenses?.reduce((sum: number, e: any) => sum + (e.amount || 0), 0) || 0);

        reportData = {
          period: { start_date, end_date },
          revenue: totalRevenue,
          cogs: totalCOGS,
          gross_profit: totalRevenue - totalCOGS,
          gross_margin: totalRevenue > 0 ? ((totalRevenue - totalCOGS) / totalRevenue) * 100 : 0,
          expenses: totalExpenses,
          net_profit: totalRevenue - totalCOGS - totalExpenses,
          net_margin: totalRevenue > 0 ? ((totalRevenue - totalCOGS - totalExpenses) / totalRevenue) * 100 : 0,
        };
        break;
      }

      case 'inventory_variance': {
        const { data: products } = await supabase
          .from('products')
          .select('id, name, current_stock, par_level_min, par_level_max, cost_per_unit')
          .eq('restaurant_id', restaurantId);

        reportData = {
          period: { start_date, end_date },
          items: products?.map((p: any) => ({
            name: p.name,
            current_stock: p.current_stock || 0,
            par_min: p.par_level_min || 0,
            par_max: p.par_level_max || 0,
            variance: (p.current_stock || 0) - (p.par_level_min || 0),
            value: (p.current_stock || 0) * (p.cost_per_unit || 0),
            status: (p.current_stock || 0) < (p.par_level_min || 0) ? 'low' : 
                   (p.current_stock || 0) > (p.par_level_max || 0) ? 'high' : 'ok',
          })) || [],
        };
        break;
      }

      case 'recipe_profitability': {
        const recipeResult = await executeGetRecipeAnalytics({ sort_by: 'margin' }, restaurantId, supabase);
        reportData = {
          period: { start_date, end_date },
          recipes: recipeResult.data.recipes,
        };
        break;
      }

      case 'sales_by_category': {
        const { data: sales } = await supabase
          .from('unified_sales')
          .select('item_name, total_price, pos_category, sale_date')
          .eq('restaurant_id', restaurantId)
          .gte('sale_date', start_date)
          .lte('sale_date', end_date);

        // Group by category
        const byCategory: Record<string, { total: number; count: number }> = {};
        sales?.forEach((s: any) => {
          const cat = s.pos_category || 'Uncategorized';
          if (!byCategory[cat]) {
            byCategory[cat] = { total: 0, count: 0 };
          }
          byCategory[cat].total += s.total_price || 0;
          byCategory[cat].count += 1;
        });

        reportData = {
          period: { start_date, end_date },
          categories: Object.entries(byCategory).map(([name, data]) => ({
            name,
            total_sales: data.total,
            item_count: data.count,
            average_price: data.count > 0 ? data.total / data.count : 0,
          })),
        };
        break;
      }

      case 'cash_flow': {
        const { data: transactions } = await supabase
          .from('bank_transactions')
          .select('amount, description, transaction_date, category:chart_of_accounts!category_id(account_name)')
          .eq('restaurant_id', restaurantId)
          .gte('transaction_date', start_date)
          .lte('transaction_date', end_date)
          .order('transaction_date', { ascending: true });

        const inflows = transactions?.filter((t: any) => t.amount > 0).reduce((sum: number, t: any) => sum + t.amount, 0) || 0;
        const outflows = Math.abs(transactions?.filter((t: any) => t.amount < 0).reduce((sum: number, t: any) => sum + t.amount, 0) || 0);

        reportData = {
          period: { start_date, end_date },
          cash_inflows: inflows,
          cash_outflows: outflows,
          net_cash_flow: inflows - outflows,
          transactions: transactions?.map((t: any) => ({
            date: t.transaction_date,
            description: t.description,
            amount: t.amount,
            category: t.category?.account_name || 'Uncategorized',
          })) || [],
        };
        break;
      }

      case 'balance_sheet': {
        // Simplified balance sheet
        const { data: inventory } = await supabase
          .from('products')
          .select('current_stock, cost_per_unit')
          .eq('restaurant_id', restaurantId);

        const inventoryValue = inventory?.reduce((sum: number, i: any) => 
          sum + ((i.current_stock || 0) * (i.cost_per_unit || 0)), 0) || 0;

        const { data: bank } = await supabase
          .from('connected_banks')
          .select('bank_account_balances(current_balance)')
          .eq('restaurant_id', restaurantId);

        const cashBalance = bank?.[0]?.bank_account_balances?.[0]?.current_balance || 0;

        reportData = {
          as_of: end_date,
          assets: {
            cash: cashBalance,
            inventory: inventoryValue,
            total: cashBalance + inventoryValue,
          },
          liabilities: {
            total: 0, // Placeholder - would need accounts payable data
          },
          equity: {
            total: cashBalance + inventoryValue, // Simplified
          },
        };
        break;
      }

      default:
        throw new Error(
          `Unknown report type: ${type}. Valid types are: monthly_pnl, inventory_variance, recipe_profitability, sales_by_category, cash_flow, balance_sheet`
        );
    }

    // Build evidence based on report type
    const reportEvidence: { table: string; summary: string }[] = [];
    switch (type) {
      case 'monthly_pnl':
        reportEvidence.push(
          { table: 'unified_sales', summary: `Revenue data for P&L report ${start_date} to ${end_date}` },
          { table: 'inventory_transactions', summary: `COGS from usage transactions ${start_date} to ${end_date}` },
          { table: 'bank_transactions', summary: `Expense transactions ${start_date} to ${end_date}` },
        );
        break;
      case 'inventory_variance':
        reportEvidence.push(
          { table: 'products', summary: `Inventory variance for all products vs par levels` },
        );
        break;
      case 'recipe_profitability':
        reportEvidence.push(
          { table: 'recipes', summary: `Recipe profitability analysis` },
          { table: 'unified_sales', summary: `Sales data for recipe margin calculation` },
        );
        break;
      case 'sales_by_category':
        reportEvidence.push(
          { table: 'unified_sales', summary: `Sales by category ${start_date} to ${end_date}` },
        );
        break;
      case 'cash_flow':
        reportEvidence.push(
          { table: 'bank_transactions', summary: `Cash flow transactions ${start_date} to ${end_date}` },
        );
        break;
      case 'balance_sheet':
        reportEvidence.push(
          { table: 'products', summary: `Inventory valuation for balance sheet` },
          { table: 'connected_banks', summary: `Cash balances from connected bank accounts` },
        );
        break;
    }

    return {
      ok: true,
      data: {
        report_type: type,
        format,
        generated_at: new Date().toISOString(),
        ...reportData,
      },
      evidence: reportEvidence,
    };

  } catch (error: unknown) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    throw new Error(`Failed to generate report: ${errorMessage}`);
  }
}

// ============================================================================
// NEW TOOL EXECUTION HANDLERS
// ============================================================================

/**
 * Execute get_labor_costs tool
 * Uses same calculation logic as Dashboard (time_punches + employees)
 */
async function executeGetLaborCosts(
  args: any,
  restaurantId: string,
  supabase: any
): Promise<any> {
  const { period, start_date, end_date, include_daily_breakdown = true, include_employee_breakdown = false } = args;

  const { calculateActualLaborCost } = await import('../_shared/laborCalculations.ts');
  const { startDate, endDate, startDateStr, endDateStr } = calculateDateRange(period, start_date, end_date);

  // Fetch time punches and employees in parallel
  const [punchesResult, employeesResult] = await Promise.all([
    supabase
      .from('time_punches')
      .select('id, employee_id, restaurant_id, punch_time, punch_type')
      .eq('restaurant_id', restaurantId)
      .gte('punch_time', startDate.toISOString())
      .lte('punch_time', endDate.toISOString())
      .order('punch_time', { ascending: true }),
    supabase
      .from('employees')
      .select('*')
      .eq('restaurant_id', restaurantId),
  ]);

  if (punchesResult.error) throw new Error(`Failed to fetch time punches: ${punchesResult.error.message}`);
  if (employeesResult.error) throw new Error(`Failed to fetch employees: ${employeesResult.error.message}`);

  const timePunches = punchesResult.data || [];
  const employees = employeesResult.data || [];

  // Calculate labor costs
  const { breakdown, dailyCosts } = calculateActualLaborCost(employees, timePunches, startDate, endDate);

  // Build employee breakdown if requested
  const employeeBreakdown = include_employee_breakdown
    ? employees.filter((e: any) => e.status === 'active').map((e: any) => ({
        employee_id: e.id,
        employee_name: e.name,
        position: e.position,
        compensation_type: e.compensation_type,
      }))
    : null;

  return {
    ok: true,
    data: {
      period,
      start_date: startDateStr,
      end_date: endDateStr,
      breakdown: {
        hourly: breakdown.hourly,
        salary: breakdown.salary,
        contractor: breakdown.contractor,
        daily_rate: breakdown.daily_rate,
        total: breakdown.total,
      },
      daily_costs: include_daily_breakdown ? dailyCosts : undefined,
      employee_breakdown: employeeBreakdown,
    },
    evidence: [
      { table: 'time_punches', summary: `${timePunches.length} time punches from ${startDateStr} to ${endDateStr}` },
      { table: 'employees', summary: `${employees.length} employees for labor cost calculation` },
    ],
  };
}

/**
 * Execute get_schedule_overview tool
 * Shows scheduled shifts and projected labor costs
 */
async function executeGetScheduleOverview(
  args: any,
  restaurantId: string,
  supabase: any
): Promise<any> {
  const { period, start_date, end_date, include_projected_costs = true } = args;

  const { calculateScheduledLaborCost } = await import('../_shared/laborCalculations.ts');

  // For schedule overview, 'week' and 'month' look forward from today
  const now = new Date();
  let startDate: Date;
  let endDate: Date;

  if (period === 'week') {
    startDate = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    endDate = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 7);
  } else if (period === 'month') {
    startDate = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    endDate = new Date(now.getFullYear(), now.getMonth() + 1, now.getDate());
  } else {
    const range = calculateDateRange(period as PeriodType, start_date, end_date);
    startDate = range.startDate;
    endDate = range.endDate;
  }

  const startDateStr = startDate.toISOString().split('T')[0];
  const endDateStr = endDate.toISOString().split('T')[0];

  // Fetch shifts and employees in parallel
  const [shiftsResult, employeesResult] = await Promise.all([
    supabase
      .from('shifts')
      .select('*, employee:employees(id, name, position, compensation_type, hourly_rate)')
      .eq('restaurant_id', restaurantId)
      .gte('start_time', startDate.toISOString())
      .lte('start_time', endDate.toISOString())
      .order('start_time', { ascending: true }),
    supabase
      .from('employees')
      .select('*')
      .eq('restaurant_id', restaurantId)
      .eq('status', 'active'),
  ]);

  if (shiftsResult.error) throw new Error(`Failed to fetch shifts: ${shiftsResult.error.message}`);
  if (employeesResult.error) throw new Error(`Failed to fetch employees: ${employeesResult.error.message}`);

  const shifts = shiftsResult.data || [];
  const employees = employeesResult.data || [];

  // Calculate projected costs if requested and there are shifts
  let projectedCosts = null;
  if (include_projected_costs && shifts.length > 0) {
    const shiftData = shifts.map((s: any) => ({
      employee_id: s.employee_id,
      start_time: s.start_time,
      end_time: s.end_time,
      break_duration: s.break_duration || 0,
    }));

    const { breakdown } = calculateScheduledLaborCost(shiftData, employees, startDate, endDate);
    projectedCosts = breakdown;
  }

  // Group shifts by date
  const shiftsByDate: Record<string, any[]> = {};
  for (const shift of shifts) {
    const dateKey = new Date(shift.start_time).toISOString().split('T')[0];
    if (!shiftsByDate[dateKey]) {
      shiftsByDate[dateKey] = [];
    }
    shiftsByDate[dateKey].push({
      id: shift.id,
      employee_name: shift.employee?.name || 'Unknown',
      position: shift.position || shift.employee?.position,
      start_time: shift.start_time,
      end_time: shift.end_time,
      status: shift.status,
    });
  }

  return {
    ok: true,
    data: {
      period,
      start_date: startDateStr,
      end_date: endDateStr,
      total_shifts: shifts.length,
      shifts_by_date: shiftsByDate,
      projected_labor_costs: projectedCosts,
    },
    evidence: [
      { table: 'shifts', summary: `${shifts.length} scheduled shifts from ${startDateStr} to ${endDateStr}` },
    ],
  };
}

/**
 * Execute get_payroll_summary tool
 * Comprehensive payroll calculation with tips and manual payments
 */
async function executeGetPayrollSummary(
  args: any,
  restaurantId: string,
  supabase: any
): Promise<any> {
  const { period, start_date, end_date, include_employee_details = true } = args;
  const { calculateActualLaborCost } = await import('../_shared/laborCalculations.ts');
  const { startDate, endDate, startDateStr, endDateStr } = calculateDateRange(period, start_date, end_date);

  // Fetch all required data in parallel
  const [punchesResult, employeesResult, tipsResult, manualResult] = await Promise.all([
    supabase
      .from('time_punches')
      .select('*')
      .eq('restaurant_id', restaurantId)
      .gte('punch_time', startDate.toISOString())
      .lte('punch_time', endDate.toISOString())
      .order('punch_time', { ascending: true }),
    supabase
      .from('employees')
      .select('*')
      .eq('restaurant_id', restaurantId),
    supabase
      .from('tip_splits')
      .select('id, total_amount')
      .eq('restaurant_id', restaurantId)
      .in('status', ['approved', 'archived'])
      .gte('split_date', startDateStr)
      .lte('split_date', endDateStr),
    supabase
      .from('daily_labor_allocations')
      .select('*')
      .eq('restaurant_id', restaurantId)
      .eq('source', 'per-job')
      .gte('date', startDateStr)
      .lte('date', endDateStr),
  ]);

  if (punchesResult.error) throw new Error(`Failed to fetch time punches: ${punchesResult.error.message}`);
  if (employeesResult.error) throw new Error(`Failed to fetch employees: ${employeesResult.error.message}`);
  if (tipsResult.error) throw new Error(`Failed to fetch tips: ${tipsResult.error.message}`);
  if (manualResult.error) throw new Error(`Failed to fetch manual payments: ${manualResult.error.message}`);

  const punches = punchesResult.data || [];
  const employees = employeesResult.data || [];
  const tipSplits = tipsResult.data || [];
  const manualPayments = manualResult.data || [];

  // Fetch tip split items if there are splits
  const tipsPerEmployee = new Map<string, number>();
  if (tipSplits.length > 0) {
    const splitIds = tipSplits.map((s: any) => s.id);
    const { data: tipItems } = await supabase
      .from('tip_split_items')
      .select('employee_id, amount')
      .in('tip_split_id', splitIds);

    for (const item of tipItems || []) {
      const current = tipsPerEmployee.get(item.employee_id) || 0;
      tipsPerEmployee.set(item.employee_id, current + item.amount);
    }
  }

  // Calculate labor costs
  const { breakdown } = calculateActualLaborCost(employees, punches, startDate, endDate);

  const totalTipsCents = tipSplits.reduce((sum: number, s: any) => sum + s.total_amount, 0);
  const totalManualPaymentsCents = manualPayments.reduce((sum: number, p: any) => sum + p.allocated_cost, 0);
  const totalTips = totalTipsCents / 100;
  const totalManualPaymentsAmount = totalManualPaymentsCents / 100;

  // Build employee details if requested
  const activeEmployees = employees.filter((e: any) => e.status === 'active');
  const employeeDetails = include_employee_details
    ? activeEmployees.map((e: any) => ({
        employee_id: e.id,
        employee_name: e.name,
        position: e.position,
        compensation_type: e.compensation_type,
        tips: (tipsPerEmployee.get(e.id) || 0) / 100,
      }))
    : null;

  return {
    ok: true,
    data: {
      period,
      start_date: startDateStr,
      end_date: endDateStr,
      summary: {
        total_gross_pay: breakdown.total,
        total_tips: totalTips,
        total_manual_payments: totalManualPaymentsAmount,
        total_payroll: breakdown.total + totalTips + totalManualPaymentsAmount,
        by_compensation_type: {
          hourly: breakdown.hourly,
          salary: breakdown.salary,
          contractor: breakdown.contractor,
          daily_rate: breakdown.daily_rate,
        },
      },
      employee_count: activeEmployees.length,
      employee_details: employeeDetails,
    },
    evidence: [
      { table: 'time_punches', summary: `${punches.length} time punches from ${startDateStr} to ${endDateStr}` },
      { table: 'employees', summary: `${activeEmployees.length} active employees out of ${employees.length} total` },
    ],
  };
}

/**
 * Execute get_tip_summary tool
 */
async function executeGetTipSummary(
  args: any,
  restaurantId: string,
  supabase: any
): Promise<any> {
  const { period, start_date, end_date, status_filter = 'all' } = args;
  const { startDateStr, endDateStr } = calculateDateRange(period, start_date, end_date);

  // Build query
  let query = supabase
    .from('tip_splits')
    .select(`
      *,
      items:tip_split_items(
        employee_id,
        amount,
        employee:employees(name)
      )
    `)
    .eq('restaurant_id', restaurantId)
    .gte('split_date', startDateStr)
    .lte('split_date', endDateStr)
    .order('split_date', { ascending: false });

  if (status_filter !== 'all') {
    query = query.eq('status', status_filter);
  }

  const { data: splits, error } = await query;
  if (error) throw new Error(`Failed to fetch tip splits: ${error.message}`);

  const allSplits = splits || [];

  // Calculate summary by status
  const byStatus: Record<string, { count: number; total: number }> = {
    draft: { count: 0, total: 0 },
    approved: { count: 0, total: 0 },
    archived: { count: 0, total: 0 },
  };

  // Aggregate employee earnings
  const employeeEarnings: Record<string, { name: string; total: number }> = {};

  for (const split of allSplits) {
    if (byStatus[split.status]) {
      byStatus[split.status].count++;
      byStatus[split.status].total += split.total_amount;
    }
    for (const item of split.items || []) {
      if (!employeeEarnings[item.employee_id]) {
        employeeEarnings[item.employee_id] = { name: item.employee?.name || 'Unknown', total: 0 };
      }
      employeeEarnings[item.employee_id].total += item.amount;
    }
  }

  const totalTipsCents = allSplits.reduce((sum: number, s: any) => sum + s.total_amount, 0);

  return {
    ok: true,
    data: {
      period,
      start_date: startDateStr,
      end_date: endDateStr,
      total_splits: allSplits.length,
      total_tips: totalTipsCents / 100,
      by_status: {
        draft: { count: byStatus.draft.count, total: byStatus.draft.total / 100 },
        approved: { count: byStatus.approved.count, total: byStatus.approved.total / 100 },
        archived: { count: byStatus.archived.count, total: byStatus.archived.total / 100 },
      },
      top_earners: Object.entries(employeeEarnings)
        .map(([id, data]) => ({ employee_id: id, name: data.name, total: data.total / 100 }))
        .sort((a, b) => b.total - a.total)
        .slice(0, 10),
    },
    evidence: [
      { table: 'tip_splits', summary: `${allSplits.length} tip splits from ${startDateStr} to ${endDateStr}` },
    ],
  };
}

/**
 * Execute get_pending_outflows tool
 */
async function executeGetPendingOutflows(
  args: any,
  restaurantId: string,
  supabase: any
): Promise<any> {
  const { status_filter = 'all', include_category_breakdown = true } = args;
  const PENDING_STATUSES = ['pending', 'stale_30', 'stale_60', 'stale_90'];

  // Build query
  let query = supabase
    .from('pending_outflows')
    .select(`
      *,
      chart_account:chart_of_accounts!category_id(
        id,
        account_name
      )
    `)
    .eq('restaurant_id', restaurantId)
    .order('issue_date', { ascending: false });

  if (status_filter !== 'all') {
    query = status_filter === 'pending'
      ? query.in('status', PENDING_STATUSES)
      : query.eq('status', status_filter);
  }

  const { data: outflows, error } = await query;
  if (error) throw new Error(`Failed to fetch pending outflows: ${error.message}`);

  const allOutflows = outflows || [];
  const activePending = allOutflows.filter((o: any) => PENDING_STATUSES.includes(o.status));

  // Calculate by status
  const byStatus: Record<string, { count: number; total: number }> = {};
  for (const o of allOutflows) {
    if (!byStatus[o.status]) {
      byStatus[o.status] = { count: 0, total: 0 };
    }
    byStatus[o.status].count++;
    byStatus[o.status].total += o.amount;
  }

  // Category breakdown
  let categoryBreakdown = null;
  if (include_category_breakdown) {
    const byCategory: Record<string, { count: number; total: number }> = {};
    for (const o of activePending) {
      const categoryName = o.chart_account?.account_name || 'Uncategorized';
      if (!byCategory[categoryName]) {
        byCategory[categoryName] = { count: 0, total: 0 };
      }
      byCategory[categoryName].count++;
      byCategory[categoryName].total += o.amount;
    }

    categoryBreakdown = Object.entries(byCategory)
      .map(([name, data]) => ({ category: name, count: data.count, total: data.total }))
      .sort((a, b) => b.total - a.total);
  }

  const STALE_STATUSES = ['stale_30', 'stale_60', 'stale_90'];
  const staleItems = allOutflows
    .filter((o: any) => STALE_STATUSES.includes(o.status))
    .map((o: any) => ({
      id: o.id,
      description: o.description,
      amount: o.amount,
      issue_date: o.issue_date,
      status: o.status,
      category: o.chart_account?.account_name || 'Uncategorized',
    }));

  return {
    ok: true,
    data: {
      total_pending: activePending.reduce((sum: number, o: any) => sum + o.amount, 0),
      pending_count: activePending.length,
      by_status: byStatus,
      category_breakdown: categoryBreakdown,
      stale_items: staleItems,
    },
    evidence: [
      { table: 'pending_outflows', summary: `${allOutflows.length} outflows (${activePending.length} active pending, ${staleItems.length} stale)` },
    ],
  };
}

/**
 * Execute get_operating_costs tool
 */
async function executeGetOperatingCosts(
  args: any,
  restaurantId: string,
  supabase: any
): Promise<any> {
  const { period, start_date, end_date, include_break_even = true } = args;
  const { startDateStr, endDateStr } = calculateDateRange(period, start_date, end_date);

  // Fetch operating costs
  const { data: costs, error: costsError } = await supabase
    .from('restaurant_operating_costs')
    .select('*')
    .eq('restaurant_id', restaurantId)
    .eq('is_active', true)
    .order('cost_type')
    .order('display_order');

  if (costsError) throw new Error(`Failed to fetch operating costs: ${costsError.message}`);

  // Group by type
  const byCostType: Record<string, any[]> = {
    fixed: [],
    semi_variable: [],
    variable: [],
    custom: [],
  };

  for (const cost of costs || []) {
    if (byCostType[cost.cost_type]) {
      byCostType[cost.cost_type].push({
        name: cost.name,
        category: cost.category,
        monthly_value: cost.monthly_value / 100,
        percentage_value: cost.percentage_value,
        entry_type: cost.entry_type,
      });
    }
  }

  // Calculate totals
  const fixedTotal = byCostType.fixed.reduce((sum, c) => sum + c.monthly_value, 0);
  const semiVariableTotal = byCostType.semi_variable.reduce((sum, c) => sum + c.monthly_value, 0);
  const variableTotal = byCostType.variable.reduce((sum, c) => sum + c.monthly_value, 0);

  // Fetch revenue for break-even calculation
  let breakEvenAnalysis = null;
  if (include_break_even) {
    const { data: sales, error: salesError } = await supabase
      .from('unified_sales')
      .select('total_price')
      .eq('restaurant_id', restaurantId)
      .gte('sale_date', startDateStr)
      .lte('sale_date', endDateStr)
      .is('adjustment_type', null)
      .is('parent_sale_id', null);

    if (!salesError && sales) {
      const totalRevenue = sales.reduce((sum: number, s: any) => sum + (s.total_price || 0), 0);
      const totalFixedCosts = fixedTotal + semiVariableTotal;
      const variableCostPercentage = variableTotal > 0 && totalRevenue > 0
        ? (variableTotal / totalRevenue) * 100
        : 25; // Default estimate

      const contributionMargin = 100 - variableCostPercentage;
      const breakEvenRevenue = contributionMargin > 0
        ? (totalFixedCosts / (contributionMargin / 100))
        : 0;

      breakEvenAnalysis = {
        total_fixed_costs: totalFixedCosts,
        variable_cost_percentage: variableCostPercentage,
        contribution_margin_percentage: contributionMargin,
        break_even_revenue: breakEvenRevenue,
        current_revenue: totalRevenue,
        above_break_even: totalRevenue >= breakEvenRevenue,
        margin_of_safety: totalRevenue > 0 ? ((totalRevenue - breakEvenRevenue) / totalRevenue) * 100 : 0,
      };
    }
  }

  return {
    ok: true,
    data: {
      period,
      start_date: startDateStr,
      end_date: endDateStr,
      costs_by_type: {
        fixed: { items: byCostType.fixed, total: fixedTotal },
        semi_variable: { items: byCostType.semi_variable, total: semiVariableTotal },
        variable: { items: byCostType.variable, total: variableTotal },
        custom: { items: byCostType.custom, total: byCostType.custom.reduce((sum, c) => sum + c.monthly_value, 0) },
      },
      total_monthly_costs: fixedTotal + semiVariableTotal + variableTotal,
      break_even_analysis: breakEvenAnalysis,
    },
    evidence: [
      { table: 'restaurant_operating_costs', summary: `${(costs || []).length} active operating cost items` },
    ],
  };
}

/**
 * Execute get_monthly_trends tool
 */
async function executeGetMonthlyTrends(
  args: any,
  restaurantId: string,
  supabase: any
): Promise<any> {
  const { months_back = 12, include_percentages = true } = args;

  const now = new Date();
  const startDate = new Date(now.getFullYear(), now.getMonth() - months_back + 1, 1);
  const endDate = new Date(now.getFullYear(), now.getMonth() + 1, 0);

  const startDateStr = startDate.toISOString().split('T')[0];
  const endDateStr = endDate.toISOString().split('T')[0];

  // Use the RPC function for monthly sales metrics
  const { data: salesMetrics, error: salesError } = await supabase
    .rpc('get_monthly_sales_metrics', {
      p_restaurant_id: restaurantId,
      p_date_from: startDateStr,
      p_date_to: endDateStr,
    });

  if (salesError) {
    console.warn('RPC not available, using simplified calculation:', salesError);
  }

  // Fetch food costs by month
  const { data: foodCosts, error: foodError } = await supabase
    .from('inventory_transactions')
    .select('created_at, total_cost')
    .eq('restaurant_id', restaurantId)
    .eq('transaction_type', 'usage')
    .gte('created_at', startDateStr)
    .lte('created_at', endDateStr + 'T23:59:59.999Z');

  if (foodError) throw new Error(`Failed to fetch food costs: ${foodError.message}`);

  // Group food costs by month
  const foodCostByMonth: Record<string, number> = {};
  foodCosts?.forEach((t: any) => {
    const monthKey = new Date(t.created_at).toISOString().slice(0, 7);
    foodCostByMonth[monthKey] = (foodCostByMonth[monthKey] || 0) + Math.abs(t.total_cost || 0);
  });

  // Build monthly trends
  const months: any[] = [];

  if (salesMetrics?.length) {
    salesMetrics.forEach((row: any) => {
      const foodCost = foodCostByMonth[row.period] || 0;
      const netRevenue = Number(row.gross_revenue) - Number(row.discounts || 0);

      const monthData: any = {
        period: row.period,
        gross_revenue: Number(row.gross_revenue),
        net_revenue: netRevenue,
        discounts: Number(row.discounts || 0),
        sales_tax: Number(row.sales_tax || 0),
        tips: Number(row.tips || 0),
        food_cost: foodCost,
      };

      if (include_percentages && netRevenue > 0) {
        monthData.food_cost_percentage = (foodCost / netRevenue) * 100;
      }

      months.push(monthData);
    });
  } else {
    // Fallback: generate empty months
    for (let i = 0; i < months_back; i++) {
      const monthDate = new Date(now.getFullYear(), now.getMonth() - i, 1);
      const monthKey = monthDate.toISOString().slice(0, 7);
      months.push({
        period: monthKey,
        gross_revenue: 0,
        net_revenue: 0,
        food_cost: foodCostByMonth[monthKey] || 0,
      });
    }
  }

  // Sort by period descending
  months.sort((a, b) => b.period.localeCompare(a.period));

  return {
    ok: true,
    data: {
      months_included: months.length,
      start_date: startDateStr,
      end_date: endDateStr,
      monthly_data: months.slice(0, months_back),
      summary: {
        total_revenue: months.reduce((sum, m) => sum + m.net_revenue, 0),
        total_food_cost: months.reduce((sum, m) => sum + m.food_cost, 0),
        average_monthly_revenue: months.length > 0
          ? months.reduce((sum, m) => sum + m.net_revenue, 0) / months.length
          : 0,
      },
    },
    evidence: [
      { table: 'daily_pnl', summary: `Monthly trends for ${months.length} months from ${startDateStr} to ${endDateStr}` },
    ],
  };
}

/**
 * Execute get_expense_health tool
 */
async function executeGetExpenseHealth(
  args: any,
  restaurantId: string,
  supabase: any
): Promise<any> {
  const { period, start_date, end_date, bank_account_id } = args;
  const { startDateStr, endDateStr } = calculateDateRange(period, start_date, end_date);

  // Processing fee detection patterns
  const processingFeePatterns = [
    'square fee', 'stripe fee', 'processing fee', 'merchant fee',
    'card fee', 'payment fee', 'square', 'stripe', 'clover fee', 'toast fee',
  ];

  // Fetch bank transactions
  let txQuery = supabase
    .from('bank_transactions')
    .select(`
      amount,
      description,
      merchant_name,
      category_id,
      is_split,
      chart_of_accounts!category_id(account_name, account_subtype)
    `)
    .eq('restaurant_id', restaurantId)
    .in('status', ['posted', 'pending'])
    .gte('transaction_date', startDateStr)
    .lte('transaction_date', endDateStr);

  if (bank_account_id) {
    txQuery = txQuery.eq('connected_bank_id', bank_account_id);
  }

  const { data: transactions, error: txError } = await txQuery;

  if (txError) throw new Error(`Failed to fetch transactions: ${txError.message}`);

  const txns = transactions || [];

  // Calculate metrics
  const revenue = txns.filter((t: any) => t.amount > 0).reduce((sum: number, t: any) => sum + t.amount, 0);

  const foodCost = Math.abs(
    txns.filter((t: any) => {
      if (t.amount >= 0) return false;
      if (!t.category_id || !t.chart_of_accounts) return false;
      const subtype = t.chart_of_accounts.account_subtype;
      const name = (t.chart_of_accounts.account_name || '').toLowerCase();
      return subtype === 'cost_of_goods_sold' || name.includes('food') || name.includes('inventory');
    }).reduce((sum: number, t: any) => sum + t.amount, 0)
  );

  const laborCost = Math.abs(
    txns.filter((t: any) => {
      if (t.amount >= 0) return false;
      if (!t.category_id || !t.chart_of_accounts) return false;
      const subtype = t.chart_of_accounts.account_subtype;
      const name = (t.chart_of_accounts.account_name || '').toLowerCase();
      return subtype === 'payroll' || name.includes('payroll') || name.includes('labor');
    }).reduce((sum: number, t: any) => sum + t.amount, 0)
  );

  const processingFees = Math.abs(
    txns.filter((t: any) => {
      if (t.amount >= 0) return false;
      const desc = ((t.description || '') + ' ' + (t.merchant_name || '')).toLowerCase();
      return processingFeePatterns.some(pattern => desc.includes(pattern));
    }).reduce((sum: number, t: any) => sum + t.amount, 0)
  );

  const outflows = txns.filter((t: any) => t.amount < 0);
  const totalOutflows = Math.abs(outflows.reduce((sum: number, t: any) => sum + t.amount, 0));
  const uncategorizedSpend = Math.abs(
    outflows.filter((t: any) => !t.category_id && !t.is_split).reduce((sum: number, t: any) => sum + t.amount, 0)
  );

  // Calculate percentages
  const foodCostPercentage = revenue > 0 ? (foodCost / revenue) * 100 : 0;
  const laborPercentage = revenue > 0 ? (laborCost / revenue) * 100 : 0;
  const primeCostPercentage = revenue > 0 ? ((foodCost + laborCost) / revenue) * 100 : 0;
  const processingFeePercentage = revenue > 0 ? (processingFees / revenue) * 100 : 0;
  const uncategorizedPercentage = totalOutflows > 0 ? (uncategorizedSpend / totalOutflows) * 100 : 0;

  // Get current bank balance
  const { data: balances, error: balError } = await supabase
    .from('bank_account_balances')
    .select('current_balance, connected_banks!inner(restaurant_id)')
    .eq('connected_banks.restaurant_id', restaurantId)
    .eq('is_active', true);

  const totalCashBalance = (balances || []).reduce((sum: number, b: any) => sum + Number(b.current_balance), 0);
  const cashCoverageBeforePayroll = laborCost > 0 ? totalCashBalance / laborCost : 0;

  // Determine status
  const getStatus = (value: number, good: number, caution: number) => {
    if (value <= good) return 'good';
    if (value <= caution) return 'caution';
    return 'high';
  };

  // Build alerts
  const alerts: string[] = [];
  if (primeCostPercentage > 65) {
    alerts.push(`Prime cost is ${primeCostPercentage.toFixed(1)}% - above the 65% warning threshold`);
  }
  if (uncategorizedPercentage > 10) {
    alerts.push(`${uncategorizedPercentage.toFixed(1)}% of spending is uncategorized`);
  }
  if (cashCoverageBeforePayroll < 1.5) {
    alerts.push(`Cash coverage before payroll is only ${cashCoverageBeforePayroll.toFixed(1)}x`);
  }

  return {
    ok: true,
    data: {
      period,
      start_date: startDateStr,
      end_date: endDateStr,
      metrics: {
        food_cost: {
          amount: foodCost,
          percentage: foodCostPercentage,
          target: { min: 28, max: 32 },
          status: getStatus(foodCostPercentage, 32, 35),
        },
        labor_cost: {
          amount: laborCost,
          percentage: laborPercentage,
          target: { min: 25, max: 30 },
          status: getStatus(laborPercentage, 30, 35),
        },
        prime_cost: {
          amount: foodCost + laborCost,
          percentage: primeCostPercentage,
          target: { min: 55, max: 60 },
          status: getStatus(primeCostPercentage, 60, 65),
        },
        processing_fees: {
          amount: processingFees,
          percentage: processingFeePercentage,
          target: 3.2,
          status: getStatus(processingFeePercentage, 3.2, 4.0),
        },
        uncategorized_spend: {
          amount: uncategorizedSpend,
          percentage: uncategorizedPercentage,
          target: 5,
          status: getStatus(uncategorizedPercentage, 5, 10),
        },
        cash_coverage: {
          multiplier: cashCoverageBeforePayroll,
          current_balance: totalCashBalance,
          status: cashCoverageBeforePayroll >= 2 ? 'good' : cashCoverageBeforePayroll >= 1.5 ? 'caution' : 'critical',
        },
      },
      revenue: revenue,
      alerts: alerts,
    },
    evidence: [
      { table: 'bank_transactions', summary: `${txns.length} transactions from ${startDateStr} to ${endDateStr} for expense health analysis` },
    ],
  };
}

/**
 * Execute get_proactive_insights tool
 * Returns top open inbox items + latest daily brief for proactive AI context
 */
async function executeGetProactiveInsights(
  args: any,
  restaurantId: string,
  supabase: any
): Promise<any> {
  const { include_brief = true } = args;

  // Fetch top 5 open ops inbox items by priority
  const { data: inboxItems, error: inboxError } = await supabase
    .from('ops_inbox_item')
    .select('id, title, description, kind, priority, status, due_at, meta, created_at')
    .eq('restaurant_id', restaurantId)
    .eq('status', 'open')
    .order('priority', { ascending: true })
    .limit(5);

  if (inboxError) {
    throw new Error(`Failed to fetch inbox items: ${inboxError.message}`);
  }

  let briefData = null;
  if (include_brief) {
    const { data: brief, error: briefError } = await supabase
      .from('daily_brief')
      .select('id, brief_date, metrics_json, comparisons_json, variances_json, inbox_summary_json, recommendations_json, narrative')
      .eq('restaurant_id', restaurantId)
      .order('brief_date', { ascending: false })
      .limit(1)
      .maybeSingle();

    if (briefError) {
      console.error('Failed to fetch daily brief:', briefError.message);
    } else {
      briefData = brief;
    }
  }

  return {
    ok: true,
    data: {
      inbox: {
        items: inboxItems || [],
        total_open: inboxItems?.length || 0,
        has_critical: inboxItems?.some((i: any) => i.priority <= 2) || false,
      },
      brief: briefData ? {
        date: briefData.brief_date,
        narrative: briefData.narrative,
        metrics: briefData.metrics_json,
        variances: briefData.variances_json,
        recommendations: briefData.recommendations_json,
      } : null,
    },
    evidence: [
      { table: 'ops_inbox_item', summary: `${inboxItems?.length || 0} open inbox items (top 5 by priority)` },
      ...(briefData ? [{ table: 'daily_brief', summary: `Daily brief for ${briefData.brief_date}` }] : []),
    ],
  };
}

/**
 * Execute batch_categorize_transactions tool
 * Preview-first pattern: preview=true shows changes, confirmed=true executes
 */
async function executeBatchCategorizeTransactions(
  args: any,
  restaurantId: string,
  supabase: any
): Promise<any> {
  const { transaction_ids, category_id, preview = false, confirmed = false } = args;

  // Fetch the category info
  const { data: category, error: catError } = await supabase
    .from('chart_of_accounts')
    .select('id, account_name, account_code')
    .eq('id', category_id)
    .single();

  if (catError || !category) {
    throw new Error(`Invalid category_id: ${category_id}`);
  }

  // Fetch the transactions
  const { data: transactions, error: txnError } = await supabase
    .from('bank_transactions')
    .select('id, description, amount, transaction_date, merchant_name')
    .eq('restaurant_id', restaurantId)
    .in('id', transaction_ids);

  if (txnError) {
    throw new Error(`Failed to fetch transactions: ${txnError.message}`);
  }

  if (!transactions || transactions.length === 0) {
    return { ok: false, error: { code: 'NO_TRANSACTIONS', message: 'No matching transactions found' } };
  }

  if (preview) {
    return {
      ok: true,
      data: {
        action: 'batch_categorize_transactions',
        preview: true,
        category: { id: category.id, name: category.account_name, code: category.account_code },
        transactions: transactions.map((t: any) => ({
          id: t.id,
          description: t.description || t.merchant_name,
          amount: t.amount,
          date: t.transaction_date,
        })),
        count: transactions.length,
        message: `Will categorize ${transactions.length} transaction(s) as "${category.account_name}". Please confirm to proceed.`,
      },
      evidence: [
        { table: 'bank_transactions', summary: `${transactions.length} transactions to categorize` },
        { table: 'chart_of_accounts', id: category.id, summary: `Category: ${category.account_name} (${category.account_code})` },
      ],
    };
  }

  if (confirmed) {
    const { error: updateError } = await supabase
      .from('bank_transactions')
      .update({ category_id: category.id })
      .eq('restaurant_id', restaurantId)
      .in('id', transaction_ids);

    if (updateError) {
      throw new Error(`Failed to categorize transactions: ${updateError.message}`);
    }

    return {
      ok: true,
      data: {
        action: 'batch_categorize_transactions',
        confirmed: true,
        count: transactions.length,
        category: { id: category.id, name: category.account_name },
        message: `Successfully categorized ${transactions.length} transaction(s) as "${category.account_name}".`,
      },
      evidence: [
        { table: 'bank_transactions', summary: `${transactions.length} transactions categorized as ${category.account_name}` },
      ],
    };
  }

  return { ok: false, error: { code: 'INVALID_REQUEST', message: 'Must specify preview:true or confirmed:true' } };
}

/**
 * Execute batch_categorize_pos_sales tool
 * Preview-first pattern for POS sales categorization
 */
async function executeBatchCategorizePosSales(
  args: any,
  restaurantId: string,
  supabase: any
): Promise<any> {
  const { sale_ids, category_id, preview = false, confirmed = false } = args;

  const { data: category, error: catError } = await supabase
    .from('chart_of_accounts')
    .select('id, account_name, account_code')
    .eq('id', category_id)
    .single();

  if (catError || !category) {
    throw new Error(`Invalid category_id: ${category_id}`);
  }

  const { data: sales, error: salesError } = await supabase
    .from('unified_sales')
    .select('id, item_name, total_price, sale_date, source')
    .eq('restaurant_id', restaurantId)
    .in('id', sale_ids);

  if (salesError) {
    throw new Error(`Failed to fetch sales: ${salesError.message}`);
  }

  if (!sales || sales.length === 0) {
    return { ok: false, error: { code: 'NO_SALES', message: 'No matching sales found' } };
  }

  if (preview) {
    return {
      ok: true,
      data: {
        action: 'batch_categorize_pos_sales',
        preview: true,
        category: { id: category.id, name: category.account_name, code: category.account_code },
        sales: sales.map((s: any) => ({
          id: s.id,
          item_name: s.item_name,
          amount: s.total_price,
          date: s.sale_date,
          source: s.source,
        })),
        count: sales.length,
        message: `Will categorize ${sales.length} POS sale(s) as "${category.account_name}". Please confirm to proceed.`,
      },
      evidence: [
        { table: 'unified_sales', summary: `${sales.length} POS sales to categorize` },
        { table: 'chart_of_accounts', id: category.id, summary: `Category: ${category.account_name} (${category.account_code})` },
      ],
    };
  }

  if (confirmed) {
    const { error: updateError } = await supabase
      .from('unified_sales')
      .update({ category_id: category.id, is_categorized: true })
      .eq('restaurant_id', restaurantId)
      .in('id', sale_ids);

    if (updateError) {
      throw new Error(`Failed to categorize POS sales: ${updateError.message}`);
    }

    return {
      ok: true,
      data: {
        action: 'batch_categorize_pos_sales',
        confirmed: true,
        count: sales.length,
        category: { id: category.id, name: category.account_name },
        message: `Successfully categorized ${sales.length} POS sale(s) as "${category.account_name}".`,
      },
      evidence: [
        { table: 'unified_sales', summary: `${sales.length} POS sales categorized as ${category.account_name}` },
      ],
    };
  }

  return { ok: false, error: { code: 'INVALID_REQUEST', message: 'Must specify preview:true or confirmed:true' } };
}

/**
 * Execute create_categorization_rule tool
 * Preview-first: shows rule details + historical match count, then creates
 */
async function executeCreateCategorizationRule(
  args: any,
  restaurantId: string,
  supabase: any
): Promise<any> {
  const { rule_name, pattern_type, pattern_value, category_id, source = 'both', preview = false, confirmed = false } = args;

  const { data: category, error: catError } = await supabase
    .from('chart_of_accounts')
    .select('id, account_name, account_code')
    .eq('id', category_id)
    .single();

  if (catError || !category) {
    throw new Error(`Invalid category_id: ${category_id}`);
  }

  // Count historical matches
  let bankMatchCount = 0;
  let posMatchCount = 0;

  if (source === 'bank' || source === 'both') {
    let bankQuery = supabase
      .from('bank_transactions')
      .select('id', { count: 'exact', head: true })
      .eq('restaurant_id', restaurantId)
      .is('category_id', null);

    if (pattern_type === 'exact') bankQuery = bankQuery.eq('description', pattern_value);
    else if (pattern_type === 'contains') bankQuery = bankQuery.ilike('description', `%${pattern_value}%`);
    else if (pattern_type === 'starts_with') bankQuery = bankQuery.ilike('description', `${pattern_value}%`);
    else if (pattern_type === 'ends_with') bankQuery = bankQuery.ilike('description', `%${pattern_value}`);
    else throw new Error(`Unsupported pattern_type: ${pattern_type}. Use exact, contains, starts_with, or ends_with.`);

    const { count } = await bankQuery;
    bankMatchCount = count || 0;
  }

  if (source === 'pos' || source === 'both') {
    let posQuery = supabase
      .from('unified_sales')
      .select('id', { count: 'exact', head: true })
      .eq('restaurant_id', restaurantId)
      .eq('is_categorized', false);

    if (pattern_type === 'exact') posQuery = posQuery.eq('item_name', pattern_value);
    else if (pattern_type === 'contains') posQuery = posQuery.ilike('item_name', `%${pattern_value}%`);
    else if (pattern_type === 'starts_with') posQuery = posQuery.ilike('item_name', `${pattern_value}%`);
    else if (pattern_type === 'ends_with') posQuery = posQuery.ilike('item_name', `%${pattern_value}`);
    else throw new Error(`Unsupported pattern_type: ${pattern_type}. Use exact, contains, starts_with, or ends_with.`);

    const { count } = await posQuery;
    posMatchCount = count || 0;
  }

  if (preview) {
    return {
      ok: true,
      data: {
        action: 'create_categorization_rule',
        preview: true,
        rule: { name: rule_name, pattern_type, pattern_value, source },
        category: { id: category.id, name: category.account_name, code: category.account_code },
        historical_matches: {
          bank: bankMatchCount,
          pos: posMatchCount,
          total: bankMatchCount + posMatchCount,
        },
        message: `Rule "${rule_name}" would match ${bankMatchCount + posMatchCount} existing uncategorized item(s) (${bankMatchCount} bank, ${posMatchCount} POS). Please confirm to create.`,
      },
      evidence: [
        { table: 'bank_transactions', summary: `${bankMatchCount} uncategorized bank transactions match pattern` },
        { table: 'unified_sales', summary: `${posMatchCount} uncategorized POS sales match pattern` },
      ],
    };
  }

  if (confirmed) {
    const appliesTo = source === 'bank' ? 'bank_transactions' : source === 'pos' ? 'pos_sales' : 'both';
    const { data: rule, error: ruleError } = await supabase
      .from('categorization_rules')
      .insert({
        restaurant_id: restaurantId,
        rule_name,
        description_pattern: pattern_value,
        description_match_type: pattern_type,
        category_id: category.id,
        applies_to: appliesTo,
        is_active: true,
      })
      .select('id, rule_name')
      .single();

    if (ruleError) {
      throw new Error(`Failed to create rule: ${ruleError.message}`);
    }

    return {
      ok: true,
      data: {
        action: 'create_categorization_rule',
        confirmed: true,
        rule: { id: rule.id, name: rule.rule_name, pattern_type, pattern_value, source },
        category: { id: category.id, name: category.account_name },
        historical_matches: bankMatchCount + posMatchCount,
        message: `Created rule "${rule.name}". It will auto-categorize matching items as "${category.account_name}".`,
      },
      evidence: [
        { table: 'categorization_rules', id: rule.id, summary: `New rule: ${rule.name} → ${category.account_name}` },
      ],
    };
  }

  return { ok: false, error: { code: 'INVALID_REQUEST', message: 'Must specify preview:true or confirmed:true' } };
}

/**
 * Execute resolve_inbox_item tool
 * Marks an ops inbox item as done or dismissed (low risk, no preview needed)
 */
async function executeResolveInboxItem(
  args: any,
  restaurantId: string,
  supabase: any,
  userId: string
): Promise<any> {
  const { item_id, resolution } = args;

  const { data: item, error: fetchError } = await supabase
    .from('ops_inbox_item')
    .select('id, title, status, kind, priority')
    .eq('id', item_id)
    .eq('restaurant_id', restaurantId)
    .single();

  if (fetchError || !item) {
    throw new Error(`Inbox item not found: ${item_id}`);
  }

  if (item.status === 'done' || item.status === 'dismissed') {
    return {
      ok: true,
      data: {
        action: 'resolve_inbox_item',
        already_resolved: true,
        item: { id: item.id, title: item.title, status: item.status },
        message: `Item "${item.title}" is already ${item.status}.`,
      },
      evidence: [
        { table: 'ops_inbox_item', id: item.id, summary: `Item already ${item.status}` },
      ],
    };
  }

  const { error: updateError } = await supabase
    .from('ops_inbox_item')
    .update({
      status: resolution,
      resolved_at: new Date().toISOString(),
      resolved_by: userId,
    })
    .eq('id', item_id)
    .eq('restaurant_id', restaurantId);

  if (updateError) {
    throw new Error(`Failed to resolve inbox item: ${updateError.message}`);
  }

  return {
    ok: true,
    data: {
      action: 'resolve_inbox_item',
      item: { id: item.id, title: item.title, previous_status: item.status, new_status: resolution },
      message: `Marked "${item.title}" as ${resolution}.`,
    },
    evidence: [
      { table: 'ops_inbox_item', id: item.id, summary: `Item ${resolution}: ${item.title}` },
    ],
  };
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const authHeader = req.headers.get('Authorization');
    if (!authHeader) {
      throw new Error('Missing authorization header');
    }

    const supabase = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_ANON_KEY') ?? '',
      { global: { headers: { Authorization: authHeader } } }
    );

    const { data: { user }, error: userError } = await supabase.auth.getUser();
    if (userError || !user) {
      throw new Error('Unauthorized');
    }

    const body: ToolExecutionRequest = await req.json();
    const { tool_name, arguments: args, restaurant_id } = body;

    if (!tool_name || !restaurant_id) {
      throw new Error('Missing tool_name or restaurant_id');
    }

    // Verify user has access to this restaurant
    const { data: userRestaurant, error: accessError } = await supabase
      .from('user_restaurants')
      .select('role')
      .eq('user_id', user.id)
      .eq('restaurant_id', restaurant_id)
      .single();

    if (accessError || !userRestaurant) {
      throw new Error('Access denied to this restaurant');
    }

    // Check if user can use this tool
    if (!canUseTool(tool_name, userRestaurant.role)) {
      throw new Error(`Permission denied for tool: ${tool_name}`);
    }

    const startTime = Date.now();
    let result;

    // Execute the appropriate tool
    switch (tool_name) {
      case 'navigate':
        result = executeNavigate(args);
        break;
      case 'get_kpis':
        result = await executeGetKpis(args, restaurant_id, supabase);
        break;
      case 'get_inventory_status':
        result = await executeGetInventoryStatus(args, restaurant_id, supabase);
        break;
      case 'get_recipe_analytics':
        result = await executeGetRecipeAnalytics(args, restaurant_id, supabase);
        break;
      case 'get_sales_summary':
        result = await executeGetSalesSummary(args, restaurant_id, supabase);
        break;
      case 'get_inventory_transactions':
        result = await executeGetInventoryTransactions(args, restaurant_id, supabase);
        break;
      case 'get_financial_intelligence':
        result = await executeGetFinancialIntelligence(args, restaurant_id, supabase);
        break;
      case 'get_bank_transactions':
        result = await executeGetBankTransactions(args, restaurant_id, supabase);
        break;
      case 'get_financial_statement':
        result = await executeGetFinancialStatement(args, restaurant_id, supabase);
        break;
      case 'get_ai_insights':
        result = await executeGetAiInsights(args, restaurant_id, supabase);
        break;
      case 'generate_report':
        result = await executeGenerateReport(args, restaurant_id, supabase);
        break;
      case 'get_labor_costs':
        result = await executeGetLaborCosts(args, restaurant_id, supabase);
        break;
      case 'get_schedule_overview':
        result = await executeGetScheduleOverview(args, restaurant_id, supabase);
        break;
      case 'get_payroll_summary':
        result = await executeGetPayrollSummary(args, restaurant_id, supabase);
        break;
      case 'get_tip_summary':
        result = await executeGetTipSummary(args, restaurant_id, supabase);
        break;
      case 'get_pending_outflows':
        result = await executeGetPendingOutflows(args, restaurant_id, supabase);
        break;
      case 'get_operating_costs':
        result = await executeGetOperatingCosts(args, restaurant_id, supabase);
        break;
      case 'get_monthly_trends':
        result = await executeGetMonthlyTrends(args, restaurant_id, supabase);
        break;
      case 'get_expense_health':
        result = await executeGetExpenseHealth(args, restaurant_id, supabase);
        break;
      case 'get_proactive_insights':
        result = await executeGetProactiveInsights(args, restaurant_id, supabase);
        break;
      case 'batch_categorize_transactions':
        result = await executeBatchCategorizeTransactions(args, restaurant_id, supabase);
        break;
      case 'batch_categorize_pos_sales':
        result = await executeBatchCategorizePosSales(args, restaurant_id, supabase);
        break;
      case 'create_categorization_rule':
        result = await executeCreateCategorizationRule(args, restaurant_id, supabase);
        break;
      case 'resolve_inbox_item':
        result = await executeResolveInboxItem(args, restaurant_id, supabase, user.id);
        break;
      default:
        throw new Error(`Unknown tool: ${tool_name}`);
    }

    const took_ms = Date.now() - startTime;

    // Add metadata to result
    if (result.ok) {
      result.meta = {
        ...result.meta,
        took_ms,
      };
    }

    return new Response(
      JSON.stringify(result),
      {
        status: 200,
        headers: {
          ...corsHeaders,
          'Content-Type': 'application/json',
        },
      }
    );

  } catch (error: unknown) {
    const errorMessage = error instanceof Error ? error.message : 'Failed to execute tool';
    console.error('Tool execution error:', error);
    
    return new Response(
      JSON.stringify({
        ok: false,
        error: {
          code: 'TOOL_EXECUTION_ERROR',
          message: errorMessage,
        },
      }),
      {
        status: 500,
        headers: {
          ...corsHeaders,
          'Content-Type': 'application/json',
        },
      }
    );
  }
});
