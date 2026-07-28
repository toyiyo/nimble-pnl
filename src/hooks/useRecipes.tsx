import { useEffect, useCallback } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { QueryClient } from '@tanstack/react-query';
import type { RealtimeChannel, RealtimePostgresChangesPayload } from '@supabase/supabase-js';
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
 * Cost contribution of a single ingredient line, via `calculateInventoryImpact`.
 * Shared by `buildEnhancedRecipes` (bulk path) and `calculateRecipeCost`
 * (single-recipe path still used by `RecipeDialog`) so the conversion call and
 * its failure handling exist in exactly one place.
 *
 * Returns 0 (not skipped) when the product has no `cost_per_unit` or the
 * conversion throws, so callers can unconditionally `+=` the result.
 */
function computeIngredientCost(
  ingredient: { quantity: number; unit: string },
  product: { name?: string | null; cost_per_unit?: number | null; uom_purchase?: string | null; size_value?: number | null; size_unit?: string | null } | null | undefined
): number {
  if (!product || !product.cost_per_unit) return 0;

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
    return result.costImpact;
  } catch (conversionError) {
    console.warn(`Conversion error for ${product.name}:`, conversionError);
    return 0;
  }
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
      totalCost += computeIngredientCost(ingredient, product);
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

/** Costs are money, so drift is measured at currency precision. A difference
 * below half a cent is float noise out of `calculateInventoryImpact`, not a
 * real change: comparing with a bare `!==` reports drift forever
 * (`12.340000000000002` vs `12.34`), re-issuing the heal on every load and
 * reviving the write→realtime→refetch stampede this change exists to kill. */
const COST_DRIFT_EPSILON = 0.005;

export interface RecipeCostHealRow {
  id: string;
  restaurant_id: string;
  name: string;
  estimated_cost: number;
}

/**
 * Picks the recipes whose freshly computed cost differs from what is stored
 * by at least half a cent (design §3.7). Pure and exported so the rounded
 * comparison — the property that makes "zero writes once converged" true —
 * is testable without the supabase mock.
 */
export function selectDriftedCostRows(
  storedRecipes: RecipeRow[],
  enhancedRecipes: Recipe[],
): RecipeCostHealRow[] {
  const storedById = new Map(storedRecipes.map((recipe) => [recipe.id, recipe]));
  const drifted: RecipeCostHealRow[] = [];

  for (const enhanced of enhancedRecipes) {
    const stored = storedById.get(enhanced.id);
    if (!stored) continue;
    if (Math.abs(enhanced.estimated_cost - (stored.estimated_cost ?? 0)) < COST_DRIFT_EPSILON) {
      continue;
    }
    drifted.push({
      id: enhanced.id,
      restaurant_id: enhanced.restaurant_id,
      name: enhanced.name,
      estimated_cost: enhanced.estimated_cost,
    });
  }

  return drifted;
}

/**
 * Writes drifted costs back in a single batched upsert, replacing the
 * per-recipe `UPDATE` that used to run inside the N+1 loop.
 *
 * Deliberately non-fatal: heal writes go through the existing `edit:recipes`
 * capability RLS gate, so view-only roles (`collaborator_accountant`,
 * `staff`) are rejected. That is expected, matches the previous behaviour
 * (the old write-back never checked its error either), and must never
 * surface as an error toast on a page the user can legitimately read.
 *
 * Returns the ids actually written, for the realtime echo guard.
 */
async function healRecipeCosts(
  storedRecipes: RecipeRow[],
  enhancedRecipes: Recipe[],
): Promise<string[]> {
  const drifted = selectDriftedCostRows(storedRecipes, enhancedRecipes);
  if (drifted.length === 0) return [];
  const ids = drifted.map((row) => row.id);

  // Arm the echo guard *before* the write, not after it resolves. Postgres
  // broadcasts the UPDATE the moment the transaction commits, and that
  // websocket frame can reach the realtime handler before this HTTP promise
  // settles. Armed late, the page treats its own heal as a foreign edit and
  // refetches for nothing.
  recordHealEchoes(ids);

  // `try` rather than just checking `error`: a PostgREST failure arrives as a
  // resolved `{ error }`, but a dropped connection rejects instead. Both mean
  // the same thing here -- nothing was written -- and the rejection path also
  // has to be caught because the caller invokes this fire-and-forget, where an
  // escaping rejection would surface as an unhandled promise rejection.
  try {
    const { error } = await supabase.from('recipes').upsert(drifted);
    if (error) throw new Error(error.message);
    return ids;
  } catch (healError) {
    console.warn('Recipe cost heal skipped:', healError);
    // Nothing was written, so nothing will echo. Leaving the ids armed would
    // make the next genuine edit of one of these recipes look like our echo
    // and get swallowed.
    forgetHealEchoes(ids);
    return [];
  }
}

/** How long a heal write stays eligible to be recognised as its own realtime
 * echo. Long enough to cover the round trip, short enough that a genuine edit
 * of the same recipe moments later is never swallowed. */
const HEAL_ECHO_TTL_MS = 10_000;

/** Recipe ids written by a cost heal, mapped to when they expire.
 *
 * The heal runs inside `fetchRecipesData`, which is module scope rather than
 * hook scope, so the record has to live here too — and that is also what makes
 * it correct: any of the six mount points can be the one that healed, and every
 * one of them must recognise the resulting realtime event as its own.
 */
const pendingHealEchoes = new Map<string, number>();

export function recordHealEchoes(ids: string[]): void {
  const expiresAt = Date.now() + HEAL_ECHO_TTL_MS;
  for (const id of ids) pendingHealEchoes.set(id, expiresAt);
}

/** Undo `recordHealEchoes` for ids whose write never landed. */
export function forgetHealEchoes(ids: string[]): void {
  for (const id of ids) pendingHealEchoes.delete(id);
}

/**
 * True when a realtime `recipes` event is the echo of a heal we just wrote.
 *
 * Consumes the entry, so only the first event for a healed id is ignored: a
 * genuine edit to the same recipe a moment later still refetches. Without this
 * the heal writes an UPDATE, the UPDATE echoes back over realtime, the echo
 * triggers a refetch, and the refetch runs the heal again — the write→refetch
 * stampede (5,748 updates over 588 rows) this change exists to kill.
 */
export function isHealEcho(recipeId: string | undefined | null): boolean {
  if (!recipeId) return false;
  const expiresAt = pendingHealEchoes.get(recipeId);
  if (expiresAt === undefined) return false;
  pendingHealEchoes.delete(recipeId);
  return expiresAt > Date.now();
}

/** Test seam: drop every recorded echo. */
export function resetHealEchoes(): void {
  pendingHealEchoes.clear();
}

/** Shared cache key root. `useRecipes` is mounted at six independent points
 * (Recipes, POSSales, POSSaleDialog, MapPOSItemDialog, RecipeDialog,
 * DeleteRecipeDialog); they must all read and invalidate the same entry, or
 * each one re-runs the whole fetch and writes go stale on the others. */
export const RECIPES_QUERY_KEY = 'recipes';

export const recipesQueryKey = (restaurantId: string | null) =>
  [RECIPES_QUERY_KEY, restaurantId] as const;

interface RecipeChannelEntry {
  channel: RealtimeChannel;
  refCount: number;
}

/**
 * One realtime channel per (QueryClient, restaurant), shared by every mount.
 *
 * Keyed by QueryClient so separate React trees (and separate tests) never
 * share a subscription. `useRecipes` is mounted at six points; a channel per
 * mount would mean six websocket subscriptions and — worse — six
 * `invalidateQueries` calls per database change. `invalidateQueries` defaults
 * to `cancelRefetch: true`, so those six would cancel and restart each other's
 * refetch: six requests for one change, which is the fan-out this whole change
 * exists to remove. One channel means one invalidation means one request.
 */
const recipeChannelsByClient = new WeakMap<QueryClient, Map<string, RecipeChannelEntry>>();

/**
 * Subscribes to recipe changes for a restaurant and returns an unsubscribe
 * function. The underlying channel is created on the first subscriber and torn
 * down when the last one leaves.
 *
 * Also listens on prep_recipes: the fetch filters shadow recipes out by
 * checking prep_recipes, and `usePrepRecipes.createPrepRecipe` inserts the
 * backing recipes row *before* the prep_recipes link row. Without the second
 * subscription an open Recipes page refreshes on that recipes INSERT (while
 * the link is still missing) and never again once the link lands, leaving the
 * shadow recipe visible until an unrelated change or a manual refresh.
 */
function subscribeToRecipeChanges(restaurantId: string, queryClient: QueryClient): () => void {
  let byRestaurant = recipeChannelsByClient.get(queryClient);
  if (!byRestaurant) {
    byRestaurant = new Map();
    recipeChannelsByClient.set(queryClient, byRestaurant);
  }

  let entry = byRestaurant.get(restaurantId);
  if (!entry) {
    const invalidate = () => {
      queryClient.invalidateQueries({ queryKey: [RECIPES_QUERY_KEY, restaurantId] });
    };

    const channel = supabase
      .channel(`recipe-changes:${restaurantId}`)
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'recipes',
          filter: `restaurant_id=eq.${restaurantId}`,
        },
        (payload: RealtimePostgresChangesPayload<{ id?: string }>) => {
          // Invalidate rather than fetch directly: every mount point reads one
          // cache entry, so a single invalidation refreshes all of them with
          // one request, and React Query does nothing at all when the page is
          // unmounted.
          const changedId =
            (payload.new as { id?: string } | null)?.id ??
            (payload.old as { id?: string } | null)?.id;
          if (isHealEcho(changedId)) return;
          invalidate();
        }
      )
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'prep_recipes',
          filter: `restaurant_id=eq.${restaurantId}`,
        },
        // No echo guard: nothing in this hook writes prep_recipes.
        invalidate
      )
      .subscribe();

    entry = { channel, refCount: 0 };
    byRestaurant.set(restaurantId, entry);
  }

  entry.refCount += 1;
  const subscribed = entry;

  return () => {
    subscribed.refCount -= 1;
    if (subscribed.refCount > 0) return;
    supabase.removeChannel(subscribed.channel);
    byRestaurant.delete(restaurantId);
  };
}

/**
 * The whole page-load fetch, as a plain function so React Query owns the
 * caching, deduplication and error state. Throws on failure — the caller
 * renders an explicit error state rather than an empty list.
 */
export async function fetchRecipesData(restaurantId: string): Promise<Recipe[]> {
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

  // `fetchAllRows`/`fetchInChunks` stop at DEFAULT_MAX_PAGES (20k rows) and
  // report it through `capped` rather than throwing, so a truncated load is
  // otherwise indistinguishable from a complete one. Say so, the way every
  // other consumer of the helper does.
  const cappedQueries = [
    recipesResult.capped && 'recipes',
    prepLinksResult.capped && 'prep_recipes',
    productsResult.capped && 'products',
    salesStatsResult.capped && 'get_recipe_sales_stats',
    ingredientsResult.capped && 'recipe_ingredients',
  ].filter((name): name is string => Boolean(name));
  if (cappedQueries.length > 0) {
    console.warn(
      '[useRecipes] fetch hit the pagination cap (20k rows); results may be truncated',
      { restaurantId, queries: cappedQueries },
    );
  }

  // Heal stored costs off the render path (design §3.7): one batched
  // upsert of only the drifted rows, deliberately not awaited so it
  // never delays first paint, and convergent — the next load finds no
  // drift and issues zero writes. It records the ids it is about to write so
  // the realtime subscription recognises the resulting UPDATE as its own echo
  // instead of refetching (and re-healing) in a loop.
  //
  // Not when the cost inputs were truncated, though. A capped
  // `recipe_ingredients` or `products` page means ingredient lines or product
  // costs are simply missing, so `buildEnhancedRecipes` computes an
  // understated cost — and healing would write that wrong number to the
  // database, where every later load reads it back as truth. A truncated page
  // may degrade what the screen shows; it must never corrupt what is stored.
  // A capped `recipes`/`prep_recipes` page is different: the recipes that did
  // arrive still have complete ingredients, so their heal stays sound.
  //
  // Fire-and-forget, so it needs its own `.catch`: the heal is a background
  // nicety and must never reject the load the user is waiting on. The upsert
  // itself is already guarded inside; this catches anything that throws before
  // it, on the way to computing the drift.
  if (!ingredientsResult.capped && !productsResult.capped) {
    void healRecipeCosts(activeRecipes, enhancedRecipes).catch((healError) => {
      console.warn('Recipe cost heal skipped:', healError);
    });
  }

  return enhancedRecipes;
}

export const useRecipes = (restaurantId: string | null) => {
  const { user } = useAuth();
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const queryKey = recipesQueryKey(restaurantId);

  const {
    data,
    isLoading,
    isError,
    error,
    refetch,
  } = useQuery({
    queryKey,
    queryFn: () => fetchRecipesData(restaurantId as string),
    enabled: !!restaurantId && !!user,
    staleTime: 30000,
    refetchOnWindowFocus: true,
  });

  // Fail closed: React Query keeps the last successful `data` when a refetch
  // fails, which for a multi-tenant page means a failed load can leave the
  // previous restaurant's recipes on screen. Surface nothing instead.
  const recipes = isError ? [] : (data ?? []);

  useEffect(() => {
    if (!error) return;
    console.error('Error fetching recipes:', error);
    toast({
      title: "Error fetching recipes",
      description: (error as Error).message,
      variant: "destructive",
    });
  }, [error, toast]);

  const invalidateRecipes = useCallback(() => {
    queryClient.invalidateQueries({ queryKey: [RECIPES_QUERY_KEY, restaurantId] });
  }, [queryClient, restaurantId]);

  const fetchRecipes = useCallback(async () => {
    await refetch();
  }, [refetch]);

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

  const createRecipeMutation = useMutation({
    mutationFn: async (recipeData: CreateRecipeData): Promise<Recipe | null> => {
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

      // Cost and profitability are deliberately NOT computed here any more.
      // The invalidation below refetches through fetchRecipesData, which
      // derives both in memory and heals the stored cost in its batched
      // upsert — so the old three extra round trips (cost query, cost
      // UPDATE, unbounded unified_sales query) are pure duplication now.
      toast({
        title: "Recipe created",
        description: `${recipe.name} has been created successfully.`,
      });

      return recipe as Recipe;
    } catch (error: any) {
      console.error('Error creating recipe:', error);
      toast({
        title: "Error creating recipe",
        description: error.message,
        variant: "destructive",
      });
      return null;
    }
    },
    onSuccess: (created) => {
      if (created) invalidateRecipes();
    },
  });

  const createRecipe = useCallback(
    (recipeData: CreateRecipeData) => createRecipeMutation.mutateAsync(recipeData),
    [createRecipeMutation]
  );

  const updateRecipeMutation = useMutation({
    mutationFn: async ({ id, updates }: { id: string; updates: Partial<Recipe> }): Promise<boolean> => {
    try {
      const { error } = await supabase
        .from('recipes')
        .update(updates)
        .eq('id', id);

      if (error) throw error;

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
    },
    onSuccess: (ok) => {
      if (ok) invalidateRecipes();
    },
  });

  const updateRecipe = useCallback(
    (id: string, updates: Partial<Recipe>) => updateRecipeMutation.mutateAsync({ id, updates }),
    [updateRecipeMutation]
  );

  const updateRecipeIngredientsMutation = useMutation({
    mutationFn: async ({ recipeId, ingredients }: {
      recipeId: string;
      ingredients: {
        product_id: string;
        quantity: number;
        unit: IngredientUnit;
        notes?: string;
      }[];
    }): Promise<boolean> => {
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
    },
    onSuccess: (ok) => {
      if (ok) invalidateRecipes();
    },
  });

  const updateRecipeIngredients = useCallback(
    (
      recipeId: string,
      ingredients: {
        product_id: string;
        quantity: number;
        unit: IngredientUnit;
        notes?: string;
      }[]
    ) => updateRecipeIngredientsMutation.mutateAsync({ recipeId, ingredients }),
    [updateRecipeIngredientsMutation]
  );

  const deleteRecipeMutation = useMutation({
    mutationFn: async (id: string): Promise<boolean> => {
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
    },
    onSuccess: (ok) => {
      if (ok) invalidateRecipes();
    },
  });

  const deleteRecipe = useCallback(
    (id: string) => deleteRecipeMutation.mutateAsync(id),
    [deleteRecipeMutation]
  );

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

      ingredients.forEach((ingredient) => {
        totalCost += computeIngredientCost(ingredient, ingredient.product);
      });

      return totalCost;
    } catch (error) {
      console.error('Error calculating recipe cost:', error);
      return null;
    }
  };

  // No manual fetch effect: useQuery owns when to fetch, dedupes the six
  // mount points onto one request, and re-uses the cache within staleTime.

  useEffect(() => {
    if (!restaurantId) return;
    return subscribeToRecipeChanges(restaurantId, queryClient);
  }, [restaurantId, queryClient]);

  return {
    recipes,
    loading: isLoading,
    isError,
    fetchRecipes,
    fetchRecipeIngredients,
    createRecipe,
    updateRecipe,
    updateRecipeIngredients,
    deleteRecipe,
    calculateRecipeCost,
  };
};