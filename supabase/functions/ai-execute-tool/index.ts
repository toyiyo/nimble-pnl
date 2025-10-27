import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { corsHeaders } from "../_shared/cors.ts";
import { canUseTool } from "../_shared/tools-registry.ts";

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
      message: `Navigate to ${section}`,
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
    case 'quarter':
      const quarter = Math.floor(now.getMonth() / 3);
      startDate = new Date(now.getFullYear(), quarter * 3, 1);
      break;
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
 * Execute get_inventory_status tool
 */
async function executeGetInventoryStatus(
  args: any,
  restaurantId: string,
  supabase: any
): Promise<any> {
  const { include_low_stock = true, category } = args;

  let query = supabase
    .from('products')
    .select('id, name, current_stock, minimum_quantity, cost_per_unit, category')
    .eq('restaurant_id', restaurantId);

  if (category) {
    query = query.eq('category', category);
  }

  const { data: products, error } = await query;

  if (error) {
    throw new Error(`Failed to fetch inventory: ${error.message}`);
  }

  const lowStockItems = products?.filter((p: any) => 
    p.current_stock <= (p.minimum_quantity || 0)
  ) || [];

  const totalValue = products?.reduce((sum: number, item: any) => 
    sum + ((item.current_stock || 0) * (item.cost_per_unit || 0)), 0) || 0;

  return {
    ok: true,
    data: {
      total_items: products?.length || 0,
      total_value: totalValue,
      low_stock_count: lowStockItems.length,
      low_stock_items: include_low_stock ? lowStockItems.slice(0, 10) : [],
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
  const { recipe_id, sort_by = 'margin' } = args;

  let query = supabase
    .from('recipes')
    .select(`
      id,
      name,
      estimated_cost,
      pos_item_name,
      recipe_ingredients (
        product_id,
        quantity
      )
    `)
    .eq('restaurant_id', restaurantId)
    .eq('is_active', true);

  if (recipe_id) {
    query = query.eq('id', recipe_id);
  }

  const { data: recipes, error } = await query;

  if (error) {
    throw new Error(`Failed to fetch recipes: ${error.message}`);
  }

  const recipesWithAnalytics = recipes?.map((recipe: any) => {
    const cost = recipe.estimated_cost || 0;
    // Get price from unified_sales if available (will need separate query per recipe for real data)
    const price = 0; // Placeholder since we don't have sale_price in recipes table
    const margin = price > 0 ? ((price - cost) / price) * 100 : 0;
    const profit = price - cost;

    return {
      id: recipe.id,
      name: recipe.name,
      cost,
      price,
      margin: Math.round(margin * 10) / 10,
      profit,
      ingredient_count: recipe.recipe_ingredients?.length || 0,
    };
  }) || [];

  // Sort recipes
  recipesWithAnalytics.sort((a: any, b: any) => {
    switch (sort_by) {
      case 'margin':
        return b.margin - a.margin;
      case 'cost':
        return b.cost - a.cost;
      case 'name':
        return a.name.localeCompare(b.name);
      default:
        return 0;
    }
  });

  return {
    ok: true,
    data: {
      recipes: recipesWithAnalytics.slice(0, 20),
      total_count: recipesWithAnalytics.length,
      average_margin: recipesWithAnalytics.reduce((sum: number, r: any) => sum + r.margin, 0) / (recipesWithAnalytics.length || 1),
    },
  };
}

/**
 * Execute get_sales_summary tool
 */
async function executeGetSalesSummary(
  args: any,
  restaurantId: string,
  supabase: any
): Promise<any> {
  const { period, compare_to_previous = true } = args;

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
      comparison,
    },
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
