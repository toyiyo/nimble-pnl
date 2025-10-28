/**
 * Recipe Analytics Shared Module
 * 
 * Shared business logic for calculating recipe profitability and analytics.
 * This version is for Edge Functions (Deno runtime).
 */

export interface RecipeProfitabilityResult {
  id: string;
  name: string;
  pos_item_name: string | null;
  estimated_cost: number;
  selling_price: number;
  margin: number;
  food_cost_percentage: number;
  total_sales: number;
  total_quantity_sold: number;
  profit_per_serving: number;
  has_sales_data: boolean;
}

export interface RecipeProfitabilityOptions {
  restaurantId: string;
  recipeId?: string;
  daysBack?: number;
  includeZeroSales?: boolean;
  sortBy?: 'margin' | 'cost' | 'name' | 'sales';
}

export interface RecipeProfitabilitySummary {
  recipes: RecipeProfitabilityResult[];
  highestMargin?: RecipeProfitabilityResult;
  lowestMargin?: RecipeProfitabilityResult;
  averageFoodCost: number;
  averageMargin: number;
  totalRecipes: number;
  recipesWithSales: number;
}

/**
 * Calculate recipe profitability with actual sales data
 */
export async function calculateRecipeProfitability(
  supabase: any,
  options: RecipeProfitabilityOptions
): Promise<RecipeProfitabilitySummary> {
  const {
    restaurantId,
    recipeId,
    daysBack = 30,
    includeZeroSales = false,
    sortBy = 'margin'
  } = options;

  // Fetch recipes
  let recipesQuery = supabase
    .from('recipes')
    .select('id, name, estimated_cost, pos_item_name')
    .eq('restaurant_id', restaurantId)
    .eq('is_active', true);

  if (recipeId) {
    recipesQuery = recipesQuery.eq('id', recipeId);
  }

  const { data: recipes, error: recipesError } = await recipesQuery;

  if (recipesError) {
    throw new Error(`Failed to fetch recipes: ${recipesError.message}`);
  }

  if (!recipes || recipes.length === 0) {
    return {
      recipes: [],
      averageFoodCost: 0,
      averageMargin: 0,
      totalRecipes: 0,
      recipesWithSales: 0
    };
  }

  // Calculate date range
  const startDate = new Date(Date.now() - daysBack * 24 * 60 * 60 * 1000)
    .toISOString()
    .split('T')[0];

  // Fetch sales data for all recipes
  const recipeProfitability: RecipeProfitabilityResult[] = [];

  for (const recipe of recipes) {
    // Match by pos_item_name or recipe name
    const itemName = recipe.pos_item_name || recipe.name;
    
    const { data: salesData, error: salesError } = await supabase
      .from('unified_sales')
      .select('quantity, total_price, unit_price')
      .eq('restaurant_id', restaurantId)
      .eq('item_name', itemName)
      .gte('sale_date', startDate);

    if (salesError) {
      console.error('Error fetching sales data for recipe:', recipe.name, salesError);
      continue;
    }

    // Calculate sales metrics
    const totalQuantitySold = salesData?.reduce((sum: number, sale: any) => sum + (sale.quantity || 0), 0) || 0;
    const totalSales = salesData?.reduce((sum: number, sale: any) => sum + (sale.total_price || 0), 0) || 0;
    const averageSellingPrice = totalQuantitySold > 0 ? totalSales / totalQuantitySold : 0;
    const hasSalesData = totalQuantitySold > 0 && averageSellingPrice > 0;

    // Skip recipes without sales if not including them
    if (!includeZeroSales && !hasSalesData) {
      continue;
    }

    // Calculate profitability metrics
    const cost = recipe.estimated_cost || 0;
    const foodCostPercentage = averageSellingPrice > 0 ? (cost / averageSellingPrice) * 100 : 0;
    const margin = averageSellingPrice > 0 ? ((averageSellingPrice - cost) / averageSellingPrice) * 100 : 0;
    const profitPerServing = averageSellingPrice - cost;

    recipeProfitability.push({
      id: recipe.id,
      name: recipe.name,
      pos_item_name: recipe.pos_item_name,
      estimated_cost: cost,
      selling_price: averageSellingPrice,
      margin: Math.round(margin * 10) / 10,
      food_cost_percentage: Math.round(foodCostPercentage * 10) / 10,
      total_sales: Math.round(totalSales * 100) / 100,
      total_quantity_sold: totalQuantitySold,
      profit_per_serving: Math.round(profitPerServing * 100) / 100,
      has_sales_data: hasSalesData
    });
  }

  // Sort recipes
  recipeProfitability.sort((a, b) => {
    switch (sortBy) {
      case 'margin':
        return b.margin - a.margin;
      case 'cost':
        return b.estimated_cost - a.estimated_cost;
      case 'sales':
        return b.total_sales - a.total_sales;
      case 'name':
        return a.name.localeCompare(b.name);
      default:
        return 0;
    }
  });

  // Calculate summary metrics
  const recipesWithSales = recipeProfitability.filter(r => r.has_sales_data);
  
  const averageFoodCost = recipesWithSales.length > 0
    ? recipesWithSales.reduce((sum, r) => sum + r.food_cost_percentage, 0) / recipesWithSales.length
    : 0;

  const averageMargin = recipesWithSales.length > 0
    ? recipesWithSales.reduce((sum, r) => sum + r.margin, 0) / recipesWithSales.length
    : 0;

  const highestMargin = recipesWithSales.length > 0
    ? recipesWithSales.reduce((max, r) => r.margin > max.margin ? r : max)
    : undefined;

  const lowestMargin = recipesWithSales.length > 0
    ? recipesWithSales.reduce((min, r) => r.margin < min.margin ? r : min)
    : undefined;

  return {
    recipes: recipeProfitability,
    highestMargin,
    lowestMargin,
    averageFoodCost: Math.round(averageFoodCost * 10) / 10,
    averageMargin: Math.round(averageMargin * 10) / 10,
    totalRecipes: recipeProfitability.length,
    recipesWithSales: recipesWithSales.length
  };
}
