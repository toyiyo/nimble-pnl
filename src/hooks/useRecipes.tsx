import { useState, useEffect, useCallback, useRef } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from './useAuth';
import { useToast } from '@/hooks/use-toast';
import { MEASUREMENT_UNITS, type IngredientUnit } from '@/lib/recipeUnits';
import { calculateInventoryImpact, getProductUnitInfo } from '@/lib/enhancedUnitConversion';
import { fetchAllRows, type PagedResult } from '@/utils/fetchAllRows';
import { fetchInChunks } from '@/utils/fetchInChunks';

export interface Recipe {
  id: string;
  restaurant_id: string;
  name: string;
  description?: string;
  pos_item_name?: string;
  pos_item_id?: string;
  serving_size: number;
  estimated_cost: number;
  is_active: boolean;
  created_at: string;
  updated_at: string;
  created_by?: string;
  avg_sale_price?: number;
  profit_margin?: number;
  profit_per_serving?: number;
  ingredients?: Array<{
    product_id: string;
    quantity: number;
    unit: string;
  }>;
}

export interface RecipeIngredient {
  id: string;
  recipe_id: string;
  product_id: string;
  quantity: number;
  unit: string;
  notes?: string;
  created_at: string;
  updated_at: string;
  product?: {
    id: string;
    name: string;
    cost_per_unit?: number;
    uom_purchase?: string;
  };
}

export interface CreateRecipeData {
  name: string;
  description?: string;
  pos_item_name?: string;
  pos_item_id?: string;
  serving_size: number;
  restaurant_id: string;
  ingredients: {
    product_id: string;
    quantity: number;
    unit: IngredientUnit;
    notes?: string;
  }[];
}

// Row shapes for the bulk queries (Q1/Q3/Q4/Q5) — narrower than the full
// generated DB types since each query selects an explicit column list
// (design doc §3), never `select('*')`.
interface RecipeRow {
  id: string;
  restaurant_id: string;
  name: string;
  description: string | null;
  pos_item_name: string | null;
  pos_item_id: string | null;
  serving_size: number | null;
  estimated_cost: number | null;
  is_active: boolean | null;
  created_at: string;
  updated_at: string;
  created_by: string | null;
}

interface IngredientRow {
  id: string;
  recipe_id: string;
  product_id: string;
  quantity: number;
  unit: string;
}

interface ProductRow {
  id: string;
  name: string;
  cost_per_unit: number | null;
  uom_purchase: string | null;
  size_value: number | null;
  size_unit: string | null;
  package_qty: number | null;
}

interface SalesStatsRow {
  item_name: string;
  avg_sale_price: number | null;
}

/**
 * Groups Q3 ingredients by recipe, looks products up from a `Map`, and calls
 * `calculateInventoryImpact` unchanged (design §3.6) to compute cost +
 * profitability entirely in memory — replacing the per-recipe N+1 that used
 * to issue one `recipe_ingredients` + `unified_sales` round trip per recipe.
 *
 * Exported (not just used internally) so it can be unit tested directly
 * against fixtures for cost/margin parity without standing up the full
 * `supabase` mock.
 */
export function buildEnhancedRecipes(
  recipes: RecipeRow[],
  ingredients: IngredientRow[],
  products: ProductRow[],
  salesStats: SalesStatsRow[],
): Recipe[] {
  const ingredientsByRecipe = new Map<string, IngredientRow[]>();
  for (const ingredient of ingredients) {
    const existing = ingredientsByRecipe.get(ingredient.recipe_id);
    if (existing) {
      existing.push(ingredient);
    } else {
      ingredientsByRecipe.set(ingredient.recipe_id, [ingredient]);
    }
  }

  const productsById = new Map(products.map((product) => [product.id, product]));

  // get_recipe_sales_stats returns avg_sale_price as NULL only when its
  // denominator (sum of coalesce(nullif(quantity,0),1)) is 0 -- i.e. no
  // matching sales rows -- which cannot happen for a GROUP BY row that
  // exists, but is filtered defensively to keep the Map's values `number`.
  const salesByItemName = new Map(
    salesStats
      .filter((row): row is SalesStatsRow & { avg_sale_price: number } => row.avg_sale_price !== null)
      .map((row) => [row.item_name, row.avg_sale_price])
  );

  return recipes.map((recipe) => {
    const recipeIngredients = ingredientsByRecipe.get(recipe.id) || [];

    let totalCost = 0;
    for (const ingredient of recipeIngredients) {
      const product = productsById.get(ingredient.product_id);
      if (!product || !product.cost_per_unit) continue;

      try {
        const { purchaseUnit, quantityPerPurchaseUnit, sizeValue, sizeUnit } = getProductUnitInfo(product);
        const result = calculateInventoryImpact(
          ingredient.quantity,
          ingredient.unit,
          quantityPerPurchaseUnit,
          purchaseUnit,
          product.name || '',
          product.cost_per_unit || 0,
          sizeValue,
          sizeUnit
        );
        totalCost += result.costImpact;
      } catch (conversionError) {
        console.warn(`Conversion error for ${product.name}:`, conversionError);
      }
    }

    // Mirrors the pre-existing `updatedCost || recipe.estimated_cost`
    // fallback exactly: a computed cost of precisely 0 (e.g. no ingredient
    // has a cost_per_unit yet) keeps the last-known stored cost rather than
    // displaying $0.00.
    const estimatedCost = totalCost || recipe.estimated_cost || 0;

    const avgSalePrice = recipe.pos_item_name
      ? salesByItemName.get(recipe.pos_item_name)
      : undefined;

    let profitMargin: number | undefined;
    let profitPerServing: number | undefined;
    if (avgSalePrice !== undefined) {
      profitPerServing = avgSalePrice - estimatedCost;
      profitMargin = avgSalePrice > 0 ? (profitPerServing / avgSalePrice) * 100 : 0;
    }

    return {
      id: recipe.id,
      restaurant_id: recipe.restaurant_id,
      name: recipe.name,
      description: recipe.description ?? undefined,
      pos_item_name: recipe.pos_item_name ?? undefined,
      pos_item_id: recipe.pos_item_id ?? undefined,
      serving_size: recipe.serving_size ?? 0,
      estimated_cost: estimatedCost,
      is_active: recipe.is_active ?? true,
      created_at: recipe.created_at,
      updated_at: recipe.updated_at,
      created_by: recipe.created_by ?? undefined,
      ingredients: recipeIngredients.map((ingredient) => ({
        product_id: ingredient.product_id,
        quantity: ingredient.quantity,
        unit: ingredient.unit,
      })),
      avg_sale_price: avgSalePrice,
      profit_margin: profitMargin,
      profit_per_serving: profitPerServing,
    };
  });
}

export const useRecipes = (restaurantId: string | null) => {
  const [recipes, setRecipes] = useState<Recipe[]>([]);
  const [loading, setLoading] = useState(true);
  const { user } = useAuth();
  const { toast } = useToast();

  const fetchRecipes = useCallback(async () => {
    if (!restaurantId || !user) {
      setLoading(false);
      return;
    }

    try {
      setLoading(true);

      // Bulk fetch (design §3): Q1 recipes, Q2 prep-recipe shadow links, Q4
      // products, and Q5 sales stats are mutually independent and run in
      // parallel. Q3 (recipe ingredients) needs Q1's recipe ids, so it runs
      // after -- two waterfall levels, five bounded requests total
      // regardless of recipe count. This replaces the ~400-request N+1 (one
      // recipe_ingredients + one unified_sales round trip per recipe, plus a
      // write-back) for the largest tenant.
      //
      // Shadow recipes (rows backing prep_recipes) are managed from the Prep
      // page and must not appear here. Fail closed: if the prep_recipes query
      // errors, fetchAllRows throws and the whole fetch aborts rather than
      // leak shadows back in.
      const [recipesResult, prepLinksResult, productsResult, salesStatsResult] = await Promise.all([
        fetchAllRows<RecipeRow>((from, to) =>
          supabase
            .from('recipes')
            .select(
              'id, restaurant_id, name, description, pos_item_name, pos_item_id, serving_size, estimated_cost, is_active, created_at, updated_at, created_by'
            )
            .eq('restaurant_id', restaurantId)
            .eq('is_active', true)
            .order('name')
            .order('id')
            .range(from, to) as unknown as PromiseLike<{ data: RecipeRow[] | null; error: unknown }>
        ),
        fetchAllRows<{ recipe_id: string | null }>((from, to) =>
          supabase
            .from('prep_recipes')
            .select('recipe_id')
            .eq('restaurant_id', restaurantId)
            .not('recipe_id', 'is', null)
            .order('id')
            .range(from, to) as unknown as PromiseLike<{ data: { recipe_id: string | null }[] | null; error: unknown }>
        ),
        fetchAllRows<ProductRow>((from, to) =>
          supabase
            .from('products')
            .select('id, name, cost_per_unit, uom_purchase, size_value, size_unit, package_qty')
            .eq('restaurant_id', restaurantId)
            .order('id')
            .range(from, to) as unknown as PromiseLike<{ data: ProductRow[] | null; error: unknown }>
        ),
        fetchAllRows<SalesStatsRow>((from, to) =>
          supabase
            .rpc('get_recipe_sales_stats', { p_restaurant_id: restaurantId })
            .range(from, to) as unknown as PromiseLike<{ data: SalesStatsRow[] | null; error: unknown }>
        ),
      ]);

      const shadowRecipeIds = new Set(
        prepLinksResult.rows.map((link) => link.recipe_id)
      );
      const activeRecipes = recipesResult.rows.filter(
        (recipe) => !shadowRecipeIds.has(recipe.id)
      );

      // Q3: recipe_ingredients for the surviving (non-shadow) recipes,
      // chunked at 200 ids/request (fetchInChunks short-circuits to zero
      // requests when activeRecipes is empty), each chunk independently
      // paginated via fetchAllRows.
      const recipeIds = activeRecipes.map((recipe) => recipe.id);
      const ingredientsResult: PagedResult<IngredientRow> = await fetchInChunks<string, IngredientRow>(
        recipeIds,
        (chunk) =>
          fetchAllRows<IngredientRow>((from, to) =>
            supabase
              .from('recipe_ingredients')
              .select('id, recipe_id, product_id, quantity, unit')
              .in('recipe_id', chunk)
              .order('recipe_id')
              .order('id')
              .range(from, to) as unknown as PromiseLike<{ data: IngredientRow[] | null; error: unknown }>
          )
      );

      const enhancedRecipes = buildEnhancedRecipes(
        activeRecipes,
        ingredientsResult.rows,
        productsResult.rows,
        salesStatsResult.rows,
      );

      setRecipes(enhancedRecipes);
    } catch (error: any) {
      console.error('Error fetching recipes:', error);
      // Fail closed: clear any previously-loaded recipes (e.g. from a prior
      // restaurant selection or a stale successful fetch) so a failed
      // refetch never leaves cross-tenant/stale data on screen.
      setRecipes([]);
      toast({
        title: "Error fetching recipes",
        description: error.message,
        variant: "destructive",
      });
    } finally {
      setLoading(false);
    }
  }, [restaurantId, user, toast]);

  const fetchRecipeIngredients = async (recipeId: string): Promise<RecipeIngredient[]> => {
    try {
      const { data, error } = await supabase
        .from('recipe_ingredients')
        .select(`
          *,
          product:products(id, name, cost_per_unit, uom_purchase)
        `)
        .eq('recipe_id', recipeId)
        .order('created_at');

      if (error) throw error;
      return data || [];
    } catch (error: any) {
      console.error('Error fetching recipe ingredients:', error);
      toast({
        title: "Error fetching recipe ingredients",
        description: error.message,
        variant: "destructive",
      });
      return [];
    }
  };

  const createRecipe = async (recipeData: CreateRecipeData): Promise<Recipe | null> => {
    if (!user) return null;

    try {
      // Debug RLS issues in development
      if (process.env.NODE_ENV === 'development') {
        const { debugRecipeCreationRLS } = await import('@/utils/debugRLS');
        await debugRecipeCreationRLS(recipeData.restaurant_id);
      }

      // Create the recipe
      const { data: recipe, error: recipeError } = await supabase
        .from('recipes')
        .insert({
          name: recipeData.name,
          description: recipeData.description,
          pos_item_name: recipeData.pos_item_name,
          pos_item_id: recipeData.pos_item_id,
          serving_size: recipeData.serving_size,
          restaurant_id: recipeData.restaurant_id,
          created_by: user.id,
        })
        .select()
        .single();

      if (recipeError) {
        console.error('Recipe creation error:', recipeError);
        if (recipeError.message.includes('row-level security')) {
          toast({
            title: "Permission Error",
            description: "You don't have permission to create recipes for this restaurant. Please contact the restaurant owner to add you with proper permissions.",
            variant: "destructive",
          });
          return null;
        }
        throw recipeError;
      }

        // Create recipe ingredients
        if (recipeData.ingredients.length > 0) {
          const ingredients = recipeData.ingredients.map(ingredient => ({
            ...ingredient,
            recipe_id: recipe.id,
          }));

          const { error: ingredientsError } = await (supabase
            .from('recipe_ingredients')
            .insert(ingredients as any) as any);

          if (ingredientsError) throw ingredientsError;
        }

      // Calculate and update recipe cost
      const cost = await calculateRecipeCost(recipe.id);
      if (cost !== null) {
        await supabase
          .from('recipes')
          .update({ estimated_cost: cost })
          .eq('id', recipe.id);
        
        recipe.estimated_cost = cost;
      }

      // Calculate profitability
      const profitData = await calculateRecipeProfitability(recipe);
      const enhancedRecipe = {
        ...recipe,
        avg_sale_price: profitData?.avg_sale_price,
        profit_margin: profitData?.profit_margin,
        profit_per_serving: profitData?.profit_per_serving
      };

      setRecipes(prev => [...prev, enhancedRecipe]);
      
      toast({
        title: "Recipe created",
        description: `${recipe.name} has been created successfully.`,
      });

      return enhancedRecipe;
    } catch (error: any) {
      console.error('Error creating recipe:', error);
      toast({
        title: "Error creating recipe",
        description: error.message,
        variant: "destructive",
      });
      return null;
    }
  };

  const updateRecipe = async (id: string, updates: Partial<Recipe>): Promise<boolean> => {
    try {
      const { error } = await supabase
        .from('recipes')
        .update(updates)
        .eq('id', id);

      if (error) throw error;

      setRecipes(prev =>
        prev.map(recipe =>
          recipe.id === id ? { ...recipe, ...updates } : recipe
        )
      );

      toast({
        title: "Recipe updated",
        description: "Recipe has been updated successfully.",
      });

      return true;
    } catch (error: any) {
      console.error('Error updating recipe:', error);
      toast({
        title: "Error updating recipe",
        description: error.message,
        variant: "destructive",
      });
      return false;
    }
  };

  const updateRecipeIngredients = async (recipeId: string, ingredients: {
    product_id: string;
    quantity: number;
    unit: IngredientUnit;
    notes?: string;
  }[]): Promise<boolean> => {
    try {
      // Delete existing ingredients
      const { error: deleteError } = await supabase
        .from('recipe_ingredients')
        .delete()
        .eq('recipe_id', recipeId);

      if (deleteError) throw deleteError;

      // Insert new ingredients
      if (ingredients.length > 0) {
        const ingredientsWithRecipeId = ingredients.map(ingredient => ({
          ...ingredient,
          recipe_id: recipeId,
        }));

        const { error: insertError } = await (supabase
          .from('recipe_ingredients')
          .insert(ingredientsWithRecipeId as any) as any);

        if (insertError) throw insertError;
      }

      return true;
    } catch (error: any) {
      console.error('Error updating recipe ingredients:', error);
      toast({
        title: "Error updating recipe ingredients",
        description: error.message,
        variant: "destructive",
      });
      return false;
    }
  };

  const deleteRecipe = async (id: string): Promise<boolean> => {
    try {
      // Shadow recipes back a prep (batch) recipe; soft-deleting one silently
      // breaks production deduction/costing. Blocked here AND by a DB trigger.
      const { data: prepLink, error: prepLinkError } = await supabase
        .from('prep_recipes')
        .select('name')
        .eq('recipe_id', id)
        .eq('restaurant_id', restaurantId)
        .limit(1)
        .maybeSingle();

      if (prepLinkError) throw prepLinkError;

      if (prepLink) {
        toast({
          title: "Can't delete this recipe",
          description: `It is managed by the batch recipe "${prepLink.name}". Go to the Prep page to manage it.`,
          variant: "destructive",
        });
        return false;
      }

      const { error } = await supabase
        .from('recipes')
        .update({ is_active: false })
        .eq('id', id);

      if (error) throw error;

      setRecipes(prev => prev.filter(recipe => recipe.id !== id));
      
      toast({
        title: "Recipe deleted",
        description: "Recipe has been deleted successfully.",
      });

      return true;
    } catch (error: any) {
      console.error('Error deleting recipe:', error);
      toast({
        title: "Error deleting recipe",
        description: error.message,
        variant: "destructive",
      });
      return false;
    }
  };

  const calculateRecipeCost = async (recipeId: string): Promise<number | null> => {
    try {
      // Fetch recipe ingredients with product details
      const { data: ingredients, error } = await supabase
        .from('recipe_ingredients')
        .select(`
          *,
          product:products(
            id,
            name,
            cost_per_unit,
            uom_purchase,
            size_value,
            size_unit
          )
        `)
        .eq('recipe_id', recipeId);

      if (error) throw error;
      if (!ingredients || ingredients.length === 0) return 0;

      let totalCost = 0;

      ingredients.forEach((ingredient: any) => {
        if (ingredient.product && ingredient.product.cost_per_unit) {
          const product = ingredient.product;
          try {
            // Use shared helper to get validated product unit info
            const { purchaseUnit, quantityPerPurchaseUnit, sizeValue, sizeUnit } = getProductUnitInfo(product);
            const costPerUnit = product.cost_per_unit || 0;

            const result = calculateInventoryImpact(
              ingredient.quantity,
              ingredient.unit,
              quantityPerPurchaseUnit,
              purchaseUnit,
              product.name || '',
              costPerUnit,
              sizeValue,
              sizeUnit
            );

            totalCost += result.costImpact;
          } catch (conversionError) {
            console.warn(`Conversion error for ${product.name}:`, conversionError);
          }
        }
      });

      return totalCost;
    } catch (error: any) {
      console.error('Error calculating recipe cost:', error);
      return null;
    }
  };

  const calculateRecipeProfitability = async (recipe: Recipe): Promise<{ avg_sale_price: number; profit_margin: number; profit_per_serving: number } | null> => {
    if (!recipe.pos_item_name) return null;

    try {
      // Get sales data for this POS item
      const { data: salesData, error } = await supabase
        .from('unified_sales')
        .select('unit_price, total_price, quantity')
        .eq('restaurant_id', recipe.restaurant_id)
        .eq('item_name', recipe.pos_item_name)
        .not('unit_price', 'is', null);

      if (error) throw error;

      if (!salesData || salesData.length === 0) return null;

      // Calculate average sale price
      const totalRevenue = salesData.reduce((sum, sale) => sum + (sale.total_price || 0), 0);
      const totalQuantity = salesData.reduce((sum, sale) => sum + (sale.quantity || 1), 0);
      const avgSalePrice = totalQuantity > 0 ? totalRevenue / totalQuantity : 0;

      // Calculate profit metrics
      const recipeCost = recipe.estimated_cost || 0;
      const profitPerServing = avgSalePrice - recipeCost;
      const profitMargin = avgSalePrice > 0 ? (profitPerServing / avgSalePrice) * 100 : 0;

      return {
        avg_sale_price: avgSalePrice,
        profit_margin: profitMargin,
        profit_per_serving: profitPerServing
      };
    } catch (error: any) {
      console.error('Error calculating recipe profitability:', error);
      return null;
    }
  };

  // Ref so the realtime callback always calls the latest fetchRecipes
  const fetchRecipesRef = useRef(fetchRecipes);
  fetchRecipesRef.current = fetchRecipes;

  useEffect(() => {
    fetchRecipes();
  }, [fetchRecipes]);

  useEffect(() => {
    if (!restaurantId) return;

    // Set up real-time subscription for recipe updates. Also listen on
    // prep_recipes: fetchRecipes filters shadow recipes out by checking
    // prep_recipes, and usePrepRecipes.createPrepRecipe inserts the backing
    // recipes row before the prep_recipes link row. Without this second
    // subscription, an open Recipes page can refetch on that recipes INSERT
    // (before the link exists) and never refetch again once the link lands,
    // leaving the shadow recipe visible until an unrelated change or manual
    // refresh.
    const channel = supabase
      .channel(`recipe-changes:${restaurantId}`)
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'recipes',
          filter: `restaurant_id=eq.${restaurantId}`
        },
        () => {
          fetchRecipesRef.current();
        }
      )
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'prep_recipes',
          filter: `restaurant_id=eq.${restaurantId}`
        },
        () => {
          fetchRecipesRef.current();
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [restaurantId]);

  return {
    recipes,
    loading,
    fetchRecipes,
    fetchRecipeIngredients,
    createRecipe,
    updateRecipe,
    updateRecipeIngredients,
    deleteRecipe,
    calculateRecipeCost,
    calculateRecipeProfitability,
  };
};