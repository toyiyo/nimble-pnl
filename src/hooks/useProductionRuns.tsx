import { useCallback, useEffect, useMemo, useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from './useAuth';
import { useToast } from './use-toast';
import { IngredientUnit, toIngredientUnit } from '@/lib/recipeUnits';
import { PrepRecipe, PrepRecipeIngredient } from './usePrepRecipes';

export type ProductionRunStatus = 'planned' | 'in_progress' | 'completed' | 'cancelled' | 'draft';

export interface ProductionRunIngredient {
  id: string;
  production_run_id: string;
  product_id: string;
  expected_quantity?: number | null;
  actual_quantity?: number | null;
  unit?: IngredientUnit | null;
  variance_percent?: number | null;
  product?: {
    id: string;
    name: string;
    cost_per_unit?: number;
    uom_purchase?: string;
    current_stock?: number;
  };
}

export interface ProductionRun {
  id: string;
  restaurant_id: string;
  prep_recipe_id: string;
  status: ProductionRunStatus;
  target_yield?: number | null;
  target_yield_unit?: IngredientUnit | null;
  actual_yield?: number | null;
  actual_yield_unit?: IngredientUnit | null;
  variance_percent?: number | null;
  expected_total_cost?: number | null;
  actual_total_cost?: number | null;
  cost_per_unit?: number | null;
  scheduled_for?: string | null;
  started_at?: string | null;
  completed_at?: string | null;
  notes?: string | null;
  prepared_by?: string | null;
  created_by?: string | null;
  created_at?: string | null;
  updated_at?: string | null;
  prep_recipe?: PrepRecipe;
  ingredients?: ProductionRunIngredient[];
}

export interface CreateProductionRunInput {
  restaurant_id: string;
  prep_recipe: PrepRecipe;
  target_yield?: number;
  target_yield_unit?: IngredientUnit;
  status?: ProductionRunStatus;
  scheduled_for?: string | null;
  notes?: string;
}

export interface CompleteRunPayload {
  runId: string;
  actual_yield?: number;
  actual_yield_unit?: IngredientUnit;
  status?: ProductionRunStatus;
  ingredients?: Array<{
    id?: string;
    product_id: string;
    expected_quantity?: number | null;
    actual_quantity?: number | null;
    unit?: IngredientUnit | null;
  }>;
}

export const useProductionRuns = (restaurantId: string | null) => {
  const { user } = useAuth();
  const { toast } = useToast();
  const [runs, setRuns] = useState<ProductionRun[]>([]);
  const [loading, setLoading] = useState<boolean>(true);

  const fetchRuns = useCallback(async () => {
    if (!restaurantId || !user) {
      setLoading(false);
      return;
    }

    try {
      setLoading(true);
      const { data, error } = await supabase
        .from('production_runs')
        .select(`
          *,
          prep_recipe:prep_recipes(
            *,
            output_product:products(id, name, current_stock, uom_purchase, cost_per_unit),
            ingredients:prep_recipe_ingredients(
              id,
              product_id,
              quantity,
              unit,
              notes,
              sort_order,
              product:products(id, name, cost_per_unit, uom_purchase, current_stock)
            )
          ),
          ingredients:production_run_ingredients(
            id,
            production_run_id,
            product_id,
            expected_quantity,
            actual_quantity,
            unit,
            variance_percent,
            product:products(id, name, cost_per_unit, uom_purchase, current_stock)
          )
        `)
        .eq('restaurant_id', restaurantId)
        .order('created_at', { ascending: false });

      if (error) throw error;

      const normalized = (data || []).map((run: any) => ({
        ...run,
        target_yield_unit: run.target_yield_unit ? toIngredientUnit(run.target_yield_unit) : null,
        actual_yield_unit: run.actual_yield_unit ? toIngredientUnit(run.actual_yield_unit) : null,
        ingredients: (run.ingredients || []).map((ing: any) => ({
          ...ing,
          unit: ing.unit ? toIngredientUnit(ing.unit) : null,
        })),
        prep_recipe: run.prep_recipe
          ? {
              ...run.prep_recipe,
              default_yield_unit: toIngredientUnit(run.prep_recipe.default_yield_unit),
              ingredients: (run.prep_recipe.ingredients || []).map((ing: any) => ({
                ...ing,
                unit: toIngredientUnit(ing.unit),
              })) as PrepRecipeIngredient[],
            }
          : undefined,
      })) as ProductionRun[];

      setRuns(normalized);
    } catch (err: any) {
      console.error('Error fetching production runs:', err);
      toast({
        title: 'Could not load batches',
        description: err.message,
        variant: 'destructive',
      });
    } finally {
      setLoading(false);
    }
  }, [restaurantId, user, toast]);

  const createProductionRun = useCallback(async (input: CreateProductionRunInput) => {
    if (!user) return null;

    try {
      const targetYield = input.target_yield ?? input.prep_recipe.default_yield;
      const targetUnit = input.target_yield_unit ?? input.prep_recipe.default_yield_unit;
      const scale = input.prep_recipe.default_yield > 0 ? targetYield / input.prep_recipe.default_yield : 1;

      const { data: run, error } = await supabase
        .from('production_runs')
        .insert({
          restaurant_id: input.restaurant_id,
          prep_recipe_id: input.prep_recipe.id,
          status: input.status || 'planned',
          target_yield: targetYield,
          target_yield_unit: targetUnit,
          scheduled_for: input.scheduled_for,
          notes: input.notes,
          created_by: user.id,
        })
        .select()
        .single();

      if (error) throw error;

      const ingredients = input.prep_recipe.ingredients || [];
      if (ingredients.length > 0) {
        const ingredientRows = ingredients.map((ing) => ({
          production_run_id: run.id,
          product_id: ing.product_id,
          expected_quantity: (ing.quantity || 0) * scale,
          actual_quantity: (ing.quantity || 0) * scale,
          unit: ing.unit,
          variance_percent: 0,
        }));

        const { error: ingredientError } = await supabase
          .from('production_run_ingredients')
          .insert(ingredientRows);

        if (ingredientError) throw ingredientError;
      }

      toast({
        title: 'Batch created',
        description: `${input.prep_recipe.name} scheduled at ${targetYield} ${targetUnit}`,
      });

      await fetchRuns();
      return run as ProductionRun;
    } catch (err: any) {
      console.error('Error creating production run:', err);
      toast({
        title: 'Could not create batch',
        description: err.message,
        variant: 'destructive',
      });
      return null;
    }
  }, [user, toast, fetchRuns]);

  const getRestaurantName = useCallback(async (restaurantId: string) => {
    const { data, error } = await supabase
      .from('restaurants')
      .select('name')
      .eq('id', restaurantId)
      .single();

    if (error) throw error;
    return data?.name as string;
  }, []);

  const ensureRestaurantSupplier = useCallback(async (restaurantId: string) => {
    const restaurantName = await getRestaurantName(restaurantId);
    const { data: existing, error: existingError } = await supabase
      .from('suppliers')
      .select('id, name')
      .eq('restaurant_id', restaurantId)
      .ilike('name', restaurantName)
      .limit(1);

    if (existingError) throw existingError;
    if (existing && existing.length > 0) {
      return { supplierId: existing[0].id as string, supplierName: existing[0].name as string };
    }

    const { data: supplier, error: supplierError } = await supabase
      .from('suppliers')
      .insert({
        restaurant_id: restaurantId,
        name: restaurantName,
      })
      .select()
      .single();

    if (supplierError) throw supplierError;
    return { supplierId: supplier.id as string, supplierName: supplier.name as string };
  }, [getRestaurantName]);

  const updateRunStatus = useCallback(async (runId: string, status: ProductionRunStatus) => {
    try {
      const { error } = await supabase
        .from('production_runs')
        .update({
          status,
          started_at: status === 'in_progress' ? new Date().toISOString() : undefined,
          completed_at: status === 'completed' ? new Date().toISOString() : undefined,
        })
        .eq('id', runId);

      if (error) throw error;
      await fetchRuns();
      return true;
    } catch (err: any) {
      console.error('Error updating run status:', err);
      toast({
        title: 'Could not update batch',
        description: err.message,
        variant: 'destructive',
      });
      return false;
    }
  }, [toast, fetchRuns]);

  const saveRunActuals = useCallback(async (payload: CompleteRunPayload) => {
    try {
      const run = runs.find(r => r.id === payload.runId);
      const targetYield = run?.target_yield ?? 0;
      const actualYield = payload.actual_yield ?? run?.actual_yield ?? run?.target_yield ?? 0;
      const variance = targetYield ? ((actualYield - targetYield) / targetYield) * 100 : null;
      const statusToSet: ProductionRunStatus = payload.status || 'completed';
      const ingredientJson = payload.ingredients ? payload.ingredients.map(ing => ({
        id: ing.id,
        product_id: ing.product_id,
        expected_quantity: ing.expected_quantity,
        actual_quantity: ing.actual_quantity,
        unit: ing.unit
      })) : [];

      // Calculate ingredient total cost to price the output item
      let ingredientCostTotal = 0;
      if (run?.ingredients && run.ingredients.length > 0) {
        const payloadLookup = new Map(
          (payload.ingredients || []).map(ing => [ing.product_id, ing])
        );
        ingredientCostTotal = run.ingredients.reduce((sum, ing) => {
          const payloadIng = payloadLookup.get(ing.product_id);
          const rawQty = payloadIng?.actual_quantity ?? payloadIng?.expected_quantity ?? ing.actual_quantity ?? ing.expected_quantity ?? 0;
          const actualQty = Number(rawQty) || 0;
          const costPerUnit = ing.product?.cost_per_unit || 0;
          return sum + costPerUnit * actualQty;
        }, 0);
      }

      // Ensure the prep recipe has an output product so completion can add inventory.
      let outputProductId = run?.prep_recipe?.output_product_id || null;
      let supplierInfo: { supplierId: string; supplierName: string } | null = null;

      if ((ingredientCostTotal > 0 || !outputProductId) && run?.restaurant_id) {
        supplierInfo = await ensureRestaurantSupplier(run.restaurant_id);
      }

      if (!outputProductId && run?.prep_recipe) {
        const unit = payload.actual_yield_unit || run.actual_yield_unit || run.target_yield_unit || run.prep_recipe.default_yield_unit || 'unit';

        const { data: existingProducts, error: existingError } = await supabase
          .from('products')
          .select('id')
          .eq('restaurant_id', run.restaurant_id)
          .ilike('name', run.prep_recipe.name)
          .limit(1);

        if (existingError) throw existingError;

        if (existingProducts && existingProducts.length > 0) {
          outputProductId = existingProducts[0].id;
        } else {
          const slug = run.prep_recipe.name
            .toUpperCase()
            .replace(/[^A-Z0-9]+/g, '-')
            .replace(/^-+|-+$/g, '') || 'PREP';
          const sku = `PREP-${slug}`.slice(0, 24) + `-${Date.now().toString(36).slice(-4).toUpperCase()}`;

          const { data: newProduct, error: productError } = await supabase
            .from('products')
            .insert({
              restaurant_id: run.restaurant_id,
              name: run.prep_recipe.name,
              sku,
              uom_purchase: unit,
              size_value: 1,
              size_unit: unit,
              package_qty: 1,
              current_stock: 0,
              par_level_min: 0,
              par_level_max: 0,
              reorder_point: 0,
              cost_per_unit: ingredientCostTotal,
              supplier_id: supplierInfo?.supplierId || null,
              supplier_name: supplierInfo?.supplierName || null,
              description: 'Auto-created prep output',
            })
            .select()
            .single();

          if (productError) throw productError;
          outputProductId = newProduct?.id || null;
        }
        if (outputProductId) {
          await supabase
            .from('prep_recipes')
            .update({ output_product_id: outputProductId })
            .eq('id', run.prep_recipe.id);
        }
      } else if (outputProductId && (ingredientCostTotal > 0 || supplierInfo)) {
        const { data: currentProduct, error: currentError } = await supabase
          .from('products')
          .select('cost_per_unit, supplier_id, supplier_name')
          .eq('id', outputProductId)
          .single();

        if (currentError) throw currentError;

        const updates: any = {};
        if (ingredientCostTotal > 0 && (!currentProduct?.cost_per_unit || currentProduct.cost_per_unit === 0)) {
          updates.cost_per_unit = ingredientCostTotal;
        }
        if (supplierInfo) {
          if (!currentProduct?.supplier_id) updates.supplier_id = supplierInfo.supplierId;
          if (!currentProduct?.supplier_name) updates.supplier_name = supplierInfo.supplierName;
        }

        if (Object.keys(updates).length > 0) {
          updates.updated_at = new Date().toISOString();
          await supabase
            .from('products')
            .update(updates)
            .eq('id', outputProductId);
        }
      }

      if (statusToSet === 'completed') {
        const { error } = await supabase.rpc('complete_production_run', {
          p_run_id: payload.runId,
          p_actual_yield: actualYield,
          p_actual_yield_unit: payload.actual_yield_unit || run?.actual_yield_unit || run?.target_yield_unit,
          p_ingredients: ingredientJson
        });

        if (error) throw error;

        toast({
          title: 'Batch completed',
          description: 'Inventory updated and costs locked',
        });
      } else {
        const { error } = await supabase
          .from('production_runs')
          .update({
            actual_yield: actualYield,
            actual_yield_unit: payload.actual_yield_unit || run?.actual_yield_unit || run?.target_yield_unit,
            variance_percent: variance,
            status: statusToSet,
            completed_at: statusToSet === 'completed' ? new Date().toISOString() : run?.completed_at,
          })
          .eq('id', payload.runId);

        if (error) throw error;

        if (ingredientJson.length > 0) {
          const ingredientRows = ingredientJson.map((ing) => ({
            id: ing.id,
            production_run_id: payload.runId,
            product_id: ing.product_id,
            expected_quantity: ing.expected_quantity,
            actual_quantity: ing.actual_quantity,
            unit: ing.unit,
            variance_percent: ing.expected_quantity
              ? (((ing.actual_quantity || 0) - ing.expected_quantity) / ing.expected_quantity) * 100
              : null,
          }));

          const { error: ingredientError } = await supabase
            .from('production_run_ingredients')
            .upsert(ingredientRows);

          if (ingredientError) throw ingredientError;
        }

        toast({
          title: 'Batch updated',
          description: 'Actuals saved',
        });
      }

      await fetchRuns();
      return true;
    } catch (err: any) {
      console.error('Error saving run actuals:', err);
      toast({
        title: 'Could not save batch actuals',
        description: err.message,
        variant: 'destructive',
      });
      return false;
    }
  }, [runs, toast, fetchRuns, ensureRestaurantSupplier]);

  useEffect(() => {
    fetchRuns();
  }, [fetchRuns]);

  const statusCounts = useMemo(() => {
    return runs.reduce<Record<ProductionRunStatus | 'all', number>>((acc, run) => {
      acc.all = (acc.all || 0) + 1;
      acc[run.status] = (acc[run.status] || 0) + 1;
      return acc;
    }, { all: 0 } as Record<ProductionRunStatus | 'all', number>);
  }, [runs]);

  return {
    runs,
    loading,
    fetchRuns,
    createProductionRun,
    updateRunStatus,
    saveRunActuals,
    statusCounts,
  };
};
