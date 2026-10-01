/**
 * Recipe Analytics Shared Module
 *
 * Shared business logic for calculating recipe profitability and analytics.
 * This version is for Edge Functions (Deno runtime).
 */
import { calculateDeduction as calculateUnitDeduction } from './inventoryConversion.ts';

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

export interface DeductionIngredientInput {
  product_name: string;
  quantity: number;
  unit: string;
  purchase_unit: string;
  size_value: number | null;
  size_unit: string | null;
  cost_per_unit: number;
  yield_pct: number;
  yield_source: 'product' | 'override';
}

export interface DeductionIngredientResult {
  product_name: string;
  quantity: number;
  unit: string;
  yield_pct: number;
  yield_source: 'product' | 'override';
  portion_cost: number;
  loaded_cost: number;
}

export interface RecipeDeductionResult {
  portion_cost: number;
  loaded_cost: number;
  waste_cost: number;
  ingredients: DeductionIngredientResult[];
}

export interface RecipeIngredientRow {
  recipe_id: string;
  product_name: string;
  quantity: number;
  unit: string;
  purchase_unit: string;
  size_value: number | null;
  size_unit: string | null;
  cost_per_unit: number;
  product_yield_pct: number | null;
  yield_pct_override: number | null;
}

const YIELD_MIN = 50;
const YIELD_MAX = 100;

/**
 * Resolve one ingredient line's effective yield percent. The line override
 * wins over the product yield. A missing value on both sides defaults to
 * 100 (no waste). Every value clamps to [YIELD_MIN, YIELD_MAX], the same
 * range the CHECK constraints enforce.
 *
 * Mirrors `resolveYieldPct` in `src/lib/recipeYield.ts` for this Deno
 * runtime, which cannot import that client-side module.
 */
function resolveIngredientYield(
  productYieldPct: number | null,
  yieldPctOverride: number | null
): { yieldPct: number; source: 'product' | 'override' } {
  const hasOverride = yieldPctOverride !== null && yieldPctOverride !== undefined;
  const source: 'product' | 'override' = hasOverride ? 'override' : 'product';
  const rawValue = hasOverride
    ? yieldPctOverride
    : productYieldPct !== null && productYieldPct !== undefined
      ? productYieldPct
      : 100;
  const yieldPct = Math.min(YIELD_MAX, Math.max(YIELD_MIN, rawValue as number));
  return { yieldPct, source };
}

/**
 * Calculate a recipe's portion, loaded, and waste cost, with one entry per
 * ingredient line. `loaded_cost` applies the yield percent to each line, so
 * a 90% yield line costs more per portion than its raw unit conversion.
 *
 * Calls `calculateDeduction` from `_shared/inventoryConversion.ts` for the
 * unit conversion, then scales the result by `100 / yield_pct` per line.
 * See docs/superpowers/specs/2026-09-30-recipe-yield-waste-design.md, section 7.
 */
export function calculateDeduction(
  ingredients: DeductionIngredientInput[]
): RecipeDeductionResult {
  const lines: DeductionIngredientResult[] = ingredients.map((ingredient) => {
    const conversion = calculateUnitDeduction(
      {
        recipeQuantity: ingredient.quantity,
        recipeUnit: ingredient.unit,
        productName: ingredient.product_name,
        purchaseUnit: ingredient.purchase_unit,
        sizeValue: ingredient.size_value,
        sizeUnit: ingredient.size_unit,
        costPerUnit: ingredient.cost_per_unit,
      },
      1
    );

    const portionCost = conversion.costPerRecipeUnit * ingredient.quantity;
    const loadedCost = portionCost * (100 / ingredient.yield_pct);

    return {
      product_name: ingredient.product_name,
      quantity: ingredient.quantity,
      unit: ingredient.unit,
      yield_pct: ingredient.yield_pct,
      yield_source: ingredient.yield_source,
      portion_cost: portionCost,
      loaded_cost: loadedCost,
    };
  });

  const portionCost = lines.reduce((sum, line) => sum + line.portion_cost, 0);
  const loadedCost = lines.reduce((sum, line) => sum + line.loaded_cost, 0);

  return {
    portion_cost: portionCost,
    loaded_cost: loadedCost,
    waste_cost: loadedCost - portionCost,
    ingredients: lines,
  };
}

/**
 * Group ingredient rows by `recipe_id` and calculate the portion, loaded,
 * and waste cost for each recipe. Each row resolves its own effective
 * yield percent (line override wins over the product yield) before the
 * cost calculation runs. See docs/superpowers/specs/2026-09-30-recipe-yield-waste-design.md,
 * section 7.
 *
 * Takes rows already fetched by the caller, so it stays a pure grouping
 * step — the one `.in('recipe_id', ids)` query lives in the caller
 * (`executeGetRecipeAnalytics`), not here.
 */
export function buildRecipeDeductions(
  rows: RecipeIngredientRow[]
): Map<string, RecipeDeductionResult> {
  const rowsByRecipeId = new Map<string, RecipeIngredientRow[]>();
  for (const row of rows) {
    const existing = rowsByRecipeId.get(row.recipe_id) || [];
    existing.push(row);
    rowsByRecipeId.set(row.recipe_id, existing);
  }

  const deductionsByRecipeId = new Map<string, RecipeDeductionResult>();
  for (const [recipeId, ingredientRows] of rowsByRecipeId) {
    const ingredients: DeductionIngredientInput[] = ingredientRows.map((row) => {
      const { yieldPct, source } = resolveIngredientYield(row.product_yield_pct, row.yield_pct_override);
      return {
        product_name: row.product_name,
        quantity: row.quantity,
        unit: row.unit,
        purchase_unit: row.purchase_unit,
        size_value: row.size_value,
        size_unit: row.size_unit,
        cost_per_unit: row.cost_per_unit,
        yield_pct: yieldPct,
        yield_source: source,
      };
    });

    deductionsByRecipeId.set(recipeId, calculateDeduction(ingredients));
  }

  return deductionsByRecipeId;
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

  // Batch fetch sales data for all recipes in a single query
  const itemNames = recipes.map((r: { pos_item_name?: string; name: string }) => r.pos_item_name || r.name);
  
  const { data: allSalesData, error: salesError } = await supabase
    .from('unified_sales')
    .select('item_name, quantity, total_price, unit_price')
    .eq('restaurant_id', restaurantId)
    .in('item_name', itemNames)
    .gte('sale_date', startDate);

  if (salesError) {
    console.error('Error fetching batch sales data:', salesError);
    throw new Error(`Failed to fetch sales data: ${salesError.message}`);
  }

  // Create lookup map: item_name -> sales records
  const salesByItem = new Map<string, any[]>();
  (allSalesData || []).forEach((sale: { item_name: string }) => {
    const existing = salesByItem.get(sale.item_name) || [];
    existing.push(sale);
    salesByItem.set(sale.item_name, existing);
  });

  // Process each recipe with its sales data from the lookup map
  const recipeProfitability: RecipeProfitabilityResult[] = [];

  for (const recipe of recipes) {
    const itemName = recipe.pos_item_name || recipe.name;
    const salesData = salesByItem.get(itemName) || [];

    // Calculate sales metrics
    const totalQuantitySold = salesData.reduce((sum: number, sale: any) => sum + (sale.quantity || 0), 0);
    const totalSales = salesData.reduce((sum: number, sale: any) => sum + (sale.total_price || 0), 0);
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
