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
import { traceAICall, logAICall, extractTokenUsage, type AICallMetadata } from "../_shared/braintrust.ts";

// AI tool execution with OpenRouter multi-model fallback
const OPENROUTER_API_KEY = Deno.env.get('OPENROUTER_API_KEY') || '';

interface ToolExecutionRequest {
  tool_name: string;
  arguments: Record<string, any>;
  restaurant_id: string;
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
 */
async function executeGetKpis(
  args: any,
  restaurantId: string,
  supabase: any
): Promise<any> {
  const { period, start_date, end_date } = args;
  
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

  // Fetch sales data
  const { data: sales, error: salesError } = await supabase
    .from('unified_sales')
    .select('total_price, sale_date')
    .eq('restaurant_id', restaurantId)
    .gte('sale_date', startDateStr)
    .lte('sale_date', endDateStr);

  if (salesError) {
    throw new Error(`Failed to fetch sales: ${salesError.message}`);
  }

  const totalRevenue = sales?.reduce((sum: number, sale: any) => sum + (sale.total_price || 0), 0) || 0;

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

  // Get transaction count for the period
  const { count: transactionCount } = await supabase
    .from('bank_transactions')
    .select('*', { count: 'exact', head: true })
    .eq('restaurant_id', restaurantId)
    .gte('transaction_date', startDateStr)
    .lte('transaction_date', endDateStr);

  return {
    ok: true,
    data: {
      period,
      start_date: startDateStr,
      end_date: endDateStr,
      metrics: {
        total_revenue: totalRevenue,
        inventory_value: inventoryValue,
        transaction_count: transactionCount || 0,
        sales_count: sales?.length || 0,
      },
    },
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
  const dates = revenueDeposits.map((d: any) => new Date(d.transaction_date).getTime()).sort((a, b) => a - b);
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
    };
    
  } catch (error) {
    throw new Error(`Failed to calculate financial intelligence: ${error.message}`);
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
        };
      }
      
      default:
        throw new Error(`Unknown statement type: ${statement_type}`);
    }
  } catch (error) {
    throw new Error(`Failed to generate financial statement: ${error.message}`);
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
  const { period, compare_to_previous = true, include_items = false } = args;

  // Calculate date ranges
  const now = new Date();
  let startDate: Date;
  let endDate: Date = now;
  let prevStartDate: Date;
  let prevEndDate: Date;

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
    default:
      startDate = new Date(now.getFullYear(), now.getMonth(), 1);
      prevStartDate = new Date(now.getFullYear(), now.getMonth() - 1, 1);
      prevEndDate = new Date(now.getFullYear(), now.getMonth(), 0, 23, 59, 59);
  }

  const startDateStr = startDate.toISOString().split('T')[0];
  const endDateStr = endDate.toISOString().split('T')[0];

  // Fetch current period sales
  const { data: currentSales, error: currentError } = await supabase
    .from('unified_sales')
    .select('total_price, sale_date')
    .eq('restaurant_id', restaurantId)
    .gte('sale_date', startDateStr)
    .lte('sale_date', endDateStr);

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
      .lte('sale_date', prevEndDateStr);

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
      unit: t.product?.individual_unit,
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
  let dataContext: any = {};

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

  } catch (error) {
    console.error('Error fetching data for insights:', error);
    throw new Error(`Failed to fetch data: ${error.message}`);
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
      
      const response = await traceAICall(
        'ai-execute-tool:get_ai_insights',
        metadata,
        async () => {
          return await fetch('https://openrouter.ai/api/v1/chat/completions', {
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
        }
      );

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

    return {
      ok: true,
      data: {
        report_type: type,
        format,
        generated_at: new Date().toISOString(),
        ...reportData,
      },
    };

  } catch (error) {
    throw new Error(`Failed to generate report: ${error.message}`);
  }
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

  } catch (error) {
    console.error('Tool execution error:', error);
    
    return new Response(
      JSON.stringify({
        ok: false,
        error: {
          code: 'TOOL_EXECUTION_ERROR',
          message: error.message || 'Failed to execute tool',
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
