import { useCallback, useEffect, useMemo, useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from './useAuth';
import { useToast } from './use-toast';
import { IngredientUnit, toIngredientUnit } from '@/lib/recipeUnits';
import { calculateIngredientsCost } from '@/lib/prepCostCalculation';

export interface PrepRecipeIngredient {
  id: string;
  prep_recipe_id: string;
  product_id: string;
  quantity: number;
  unit: IngredientUnit;
  notes?: string;
  sort_order?: number;
  product?: {
    id: string;
    name: string;
    cost_per_unit?: number;
    current_stock?: number;
    uom_purchase?: string;
    size_value?: number | null;
    size_unit?: string | null;
    category?: string;
  };
}

export interface PrepRecipeProcedureStep {
  id: string;
  prep_recipe_id: string;
  step_number: number;
  instruction: string;
  timer_minutes?: number | null;
  critical_point?: boolean;
}

export interface PrepRecipe {
  id: string;
  restaurant_id: string;
  recipe_id?: string | null;
  name: string;
  description?: string;
  output_product_id?: string | null;
  default_yield: number;
  default_yield_unit: IngredientUnit;
  prep_time_minutes?: number | null;
  // Enhanced fields
  category?: string;
  shelf_life_days?: number | null;
  storage_instructions?: string;
  oven_temp?: number | null;
  oven_temp_unit?: 'F' | 'C';
  equipment_notes?: string;
  // End enhanced fields
  created_by?: string;
  created_at?: string;
  updated_at?: string;
  output_product?: {
    id: string;
    name: string;
    current_stock?: number;
    uom_purchase?: string;
    cost_per_unit?: number;
    size_value?: number | null;
    size_unit?: string | null;
    shelf_life_days?: number | null;
  } | null;
  ingredients?: PrepRecipeIngredient[];
  procedure_steps?: PrepRecipeProcedureStep[];
}

export interface CreatePrepRecipeInput {
  restaurant_id: string;
  name: string;
  description?: string;
  output_product_id?: string | null;
  default_yield: number;
  default_yield_unit: IngredientUnit;
  prep_time_minutes?: number | null;
  // Enhanced fields
  category?: string;
  shelf_life_days?: number | null;
  storage_instructions?: string;
  oven_temp?: number | null;
  oven_temp_unit?: 'F' | 'C';
  equipment_notes?: string;
  // End enhanced fields
  ingredients: Array<{
    product_id: string;
    quantity: number;
    unit: IngredientUnit;
    notes?: string;
    sort_order?: number;
  }>;
  procedure_steps?: Array<{
    step_number: number;
    instruction: string;
    timer_minutes?: number | null;
    critical_point?: boolean;
  }>;
}

export interface UpdatePrepRecipeInput extends Partial<CreatePrepRecipeInput> {
  id: string;
  procedure_steps?: Array<{
    id?: string;
    step_number: number;
    instruction: string;
    timer_minutes?: number | null;
    critical_point?: boolean;
  }>;
}

type IngredientPayload = Array<{
  prep_recipe_id: string;
  product_id: string;
  quantity: number;
  unit: IngredientUnit;
  notes?: string;
  sort_order?: number;
}>;

function getErrorMessage(err: unknown, fallback = 'An unexpected error occurred'): string {
  return err instanceof Error ? err.message : fallback;
}

type RawPrepRecipeIngredient = Omit<PrepRecipeIngredient, 'unit'> & { unit: string };
type RawPrepRecipe = Omit<PrepRecipe, 'default_yield_unit' | 'ingredients'> & {
  default_yield_unit: string;
  ingredients?: RawPrepRecipeIngredient[];
};

export const usePrepRecipes = (restaurantId: string | null) => {
  const { user } = useAuth();
  const { toast } = useToast();
  const [prepRecipes, setPrepRecipes] = useState<PrepRecipe[]>([]);
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);

  const fetchPrepRecipes = useCallback(async () => {
    if (!restaurantId || !user) {
      setLoading(false);
      return;
    }

    try {
      setLoading(true);
      setError(null); // Clear error on retry

      // Try with procedure_steps first, fallback to without if table doesn't exist
      let data;
      let error;

      ({ data, error } = await (supabase
        .from('prep_recipes')
        .select(`
          *,
          output_product:products(id, name, current_stock, uom_purchase, cost_per_unit, size_value, size_unit),
          ingredients:prep_recipe_ingredients(
            id,
            prep_recipe_id,
            product_id,
            quantity,
            unit,
            notes,
            sort_order,
            product:products(id, name, cost_per_unit, current_stock, uom_purchase, size_value, size_unit, category)
          ),
          procedure_steps:prep_recipe_procedure_steps(
            id,
            prep_recipe_id,
            step_number,
            instruction,
            timer_minutes,
            critical_point
          )
        `)
        .eq('restaurant_id', restaurantId)
        .order('name') as any));

      // If error mentions procedure_steps table, retry without it
      if (error && (error.message?.includes('prep_recipe_procedure_steps') || error.code === '42P01')) {
        console.warn('procedure_steps table not found, fetching without it');
        ({ data, error } = await (supabase
          .from('prep_recipes')
          .select(`
            *,
            output_product:products(id, name, current_stock, uom_purchase, cost_per_unit, size_value, size_unit),
            ingredients:prep_recipe_ingredients(
              id,
              prep_recipe_id,
              product_id,
              quantity,
              unit,
              notes,
              sort_order,
              product:products(id, name, cost_per_unit, current_stock, uom_purchase, size_value, size_unit, category)
            )
          `)
          .eq('restaurant_id', restaurantId)
          .order('name') as any));
      }

      if (error) throw error;

      // Normalize units from the database into the UI-safe union type
      const normalized = (data || []).map((recipe: RawPrepRecipe) => ({
        ...recipe,
        default_yield_unit: toIngredientUnit(recipe.default_yield_unit),
        ingredients: (recipe.ingredients || []).map((ing: RawPrepRecipeIngredient) => ({
          ...ing,
          unit: toIngredientUnit(ing.unit),
        })),
      })) as PrepRecipe[];

      setPrepRecipes(normalized);
    } catch (err: unknown) {
      console.error('Error fetching prep recipes:', err);
      const errorMessage = getErrorMessage(err, 'Failed to load prep recipes');
      setError(errorMessage);
      toast({
        title: 'Could not load prep recipes',
        description: errorMessage,
        variant: 'destructive',
      });
    } finally {
      setLoading(false);
    }
  }, [restaurantId, user, toast]);

  const getRestaurantName = useCallback(async (restaurantId: string): Promise<string> => {
    const { data, error } = await supabase
      .from('restaurants')
      .select('name')
      .eq('id', restaurantId)
      .single();

    if (error) throw error;
    return data?.name ?? '';
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
      const [first] = existing;
      return { supplierId: first.id ?? '', supplierName: first.name ?? '' };
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
    return { supplierId: supplier.id ?? '', supplierName: supplier.name ?? '' };
  }, [getRestaurantName]);

  const buildIngredientPayload = useCallback((input: CreatePrepRecipeInput): IngredientPayload => {
    return (input.ingredients || []).filter(ing => ing.product_id).map((ing, index) => ({
      prep_recipe_id: '',
      product_id: ing.product_id,
      quantity: ing.quantity,
      unit: ing.unit,
      notes: ing.notes,
      sort_order: ing.sort_order ?? index,
    }));
  }, []);

  const calculateIngredientCostTotal = useCallback(async (restaurant_id: string, ingredientPayload: IngredientPayload) => {
    if (!restaurant_id) {
      throw new Error('Restaurant is required to calculate ingredient costs');
    }

    const ingredientProductIds = ingredientPayload.map(ing => ing.product_id).filter(Boolean);
    if (ingredientProductIds.length === 0) return 0;

    const { data: ingredientProducts, error: productError } = await supabase
      .from('products')
      .select('id, name, cost_per_unit, uom_purchase, size_value, size_unit, current_stock')
      .in('id', ingredientProductIds)
      .eq('restaurant_id', restaurant_id);

    if (productError) throw productError;

    const productMap = new Map((ingredientProducts || []).map(p => [p.id, p]));
    const ingredientsForCalculation = ingredientPayload.map((ing) => ({
      product_id: ing.product_id,
      quantity: ing.quantity,
      unit: ing.unit,
      product: productMap.get(ing.product_id),
    }));

    const result = calculateIngredientsCost(ingredientsForCalculation);
    if (result.warnings.length > 0) {
      console.warn('[Prep Recipe Cost Calculation] Warnings:', result.warnings);
    }

    return result.totalCost;
  }, []);

  const ensureSupplierIfNeeded = useCallback(async (restaurant_id: string, ingredientCostTotal: number, outputProductId?: string | null) => {
    if (ingredientCostTotal > 0 || !outputProductId) {
      return ensureRestaurantSupplier(restaurant_id);
    }
    return null;
  }, [ensureRestaurantSupplier]);

  const findExistingOutputProduct = useCallback(async (restaurantId: string, name: string): Promise<string | null> => {
    const { data, error } = await supabase
      .from('products')
      .select('id')
      .eq('restaurant_id', restaurantId)
      .ilike('name', name)
      .limit(1)
      .maybeSingle();

    if (error) throw error;
    return data?.id ?? null;
  }, []);

  const createOutputProduct = useCallback(async (input: CreatePrepRecipeInput, ingredientCostTotal: number, supplierInfo?: { supplierId: string; supplierName: string } | null) => {
    const slug = input.name
      .toUpperCase()
      .replace(/[^A-Z0-9]+/g, '-')
      .replace(/(^-+|-+$)/g, '') || 'PREP';
    const sku = `PREP-${slug}`.slice(0, 24) + `-${Date.now().toString(36).slice(-4).toUpperCase()}`;
    const costPerUnit = input.default_yield > 0 ? ingredientCostTotal / input.default_yield : ingredientCostTotal;

    const { data: newProduct, error: productError } = await supabase
      .from('products')
      .insert({
        restaurant_id: input.restaurant_id,
        name: input.name,
        sku,
        uom_purchase: input.default_yield_unit || 'unit',
        size_value: 1,
        size_unit: input.default_yield_unit || null,
        package_qty: 1,
        current_stock: 0,
        par_level_min: 0,
        par_level_max: 0,
        reorder_point: 0,
        cost_per_unit: costPerUnit,
        supplier_id: supplierInfo?.supplierId || null,
        supplier_name: supplierInfo?.supplierName || null,
        description: 'Auto-created prep output',
        shelf_life_days: input.shelf_life_days ?? null,
      })
      .select()
      .single();

    if (productError) throw productError;
    return newProduct?.id || null;
  }, []);

  const updateExistingOutputProduct = useCallback(async (outputProductId: string, restaurantId: string, ingredientCostTotal: number, defaultYield: number, supplierInfo?: { supplierId: string; supplierName: string } | null, shelfLifeDays?: number | null) => {
    if (!restaurantId) {
      throw new Error('Restaurant is required to update output product');
    }

    const costPerUnit = defaultYield > 0 ? ingredientCostTotal / defaultYield : ingredientCostTotal;

    const { data: currentProduct, error: currentError } = await supabase
      .from('products')
      .select('cost_per_unit, supplier_id, supplier_name, shelf_life_days')
      .eq('id', outputProductId)
      .eq('restaurant_id', restaurantId)
      .single();

    if (currentError) throw currentError;

    const updates: Partial<{
      cost_per_unit: number;
      supplier_id: string;
      supplier_name: string;
      shelf_life_days: number | null;
      updated_at: string;
    }> = {};
    if (costPerUnit > 0 && (!currentProduct?.cost_per_unit || currentProduct.cost_per_unit === 0)) {
      updates.cost_per_unit = costPerUnit;
    }
    if (supplierInfo) {
      if (!currentProduct?.supplier_id) updates.supplier_id = supplierInfo.supplierId;
      if (!currentProduct?.supplier_name) updates.supplier_name = supplierInfo.supplierName;
    }
    // Update shelf_life_days if provided and product doesn't have a non-zero value
    if (shelfLifeDays !== undefined) {
      if (!currentProduct?.shelf_life_days || currentProduct.shelf_life_days === 0) {
        updates.shelf_life_days = shelfLifeDays;
      }
    }

    if (Object.keys(updates).length > 0) {
      updates.updated_at = new Date().toISOString();
      await supabase
        .from('products')
        .update(updates)
        .eq('id', outputProductId)
        .eq('restaurant_id', restaurantId);
    }
  }, []);

  const resolveOutputProduct = useCallback(async (input: CreatePrepRecipeInput, ingredientCostTotal: number) => {
    const outputProductId = input.output_product_id || null;
    const supplierInfo = await ensureSupplierIfNeeded(input.restaurant_id, ingredientCostTotal, outputProductId);

    if (!outputProductId) {
      const existingId = await findExistingOutputProduct(input.restaurant_id, input.name);
      if (existingId) return existingId;
      return createOutputProduct(input, ingredientCostTotal, supplierInfo);
    }

    await updateExistingOutputProduct(outputProductId, input.restaurant_id, ingredientCostTotal, input.default_yield, supplierInfo, input.shelf_life_days);
    return outputProductId;
  }, [ensureSupplierIfNeeded, findExistingOutputProduct, createOutputProduct, updateExistingOutputProduct]);

  const insertProcedureSteps = useCallback(async (
    recipeId: string,
    procedureSteps: CreatePrepRecipeInput['procedure_steps']
  ) => {
    if (!procedureSteps || procedureSteps.length === 0) return;

    const stepRows = procedureSteps
      .filter((step) => step.instruction.trim())
      .map((step) => ({
        prep_recipe_id: recipeId,
        step_number: step.step_number,
        instruction: step.instruction,
        timer_minutes: step.timer_minutes,
        critical_point: step.critical_point || false,
      }));

    if (stepRows.length === 0) return;

    const { error: stepError } = await (supabase
      .from('prep_recipe_procedure_steps' as any)
      .insert(stepRows as any) as any);

    if (stepError) throw stepError;
  }, []);

  const insertRecipeIngredients = useCallback(async (
    prepRecipeId: string,
    linkedRecipeId: string,
    ingredientPayload: IngredientPayload
  ) => {
    if (ingredientPayload.length === 0) return;

    const ingredientRows = ingredientPayload.map((ing) => ({
      ...ing,
      prep_recipe_id: prepRecipeId,
    }));

    const { error: ingredientError } = await (supabase
      .from('prep_recipe_ingredients')
      .insert(ingredientRows as any) as any);

    if (ingredientError) throw ingredientError;

    const recipeIngredientRows = ingredientPayload.map((ing) => ({
      recipe_id: linkedRecipeId,
      product_id: ing.product_id,
      quantity: ing.quantity,
      unit: ing.unit,
      notes: ing.notes,
    }));

    const { error: recipeIngredientError } = await (supabase
      .from('recipe_ingredients')
      .insert(recipeIngredientRows as any) as any);

    if (recipeIngredientError) throw recipeIngredientError;
  }, []);

  const createPrepRecipe = useCallback(async (input: CreatePrepRecipeInput) => {
    if (!user) return null;

    try {
      const ingredientPayload = buildIngredientPayload(input);
      const ingredientCostTotal = await calculateIngredientCostTotal(input.restaurant_id, ingredientPayload);
      const outputProductId = await resolveOutputProduct(input, ingredientCostTotal);

      const { data: linkedRecipe, error: linkedRecipeError } = await supabase
        .from('recipes')
        .insert({
          restaurant_id: input.restaurant_id,
          name: input.name,
          description: input.description,
          serving_size: input.default_yield || 1,
          estimated_cost: ingredientCostTotal,
          is_active: true,
          created_by: user.id,
        })
        .select()
        .single();

      if (linkedRecipeError) throw linkedRecipeError;

      const { data: recipe, error } = await (supabase
        .from('prep_recipes')
        .insert({
          restaurant_id: input.restaurant_id,
          recipe_id: linkedRecipe.id,
          name: input.name,
          description: input.description,
          output_product_id: outputProductId,
          default_yield: input.default_yield,
          default_yield_unit: input.default_yield_unit,
          prep_time_minutes: input.prep_time_minutes,
          category: input.category || 'prep',
          shelf_life_days: input.shelf_life_days,
          storage_instructions: input.storage_instructions,
          oven_temp: input.oven_temp,
          oven_temp_unit: input.oven_temp_unit,
          equipment_notes: input.equipment_notes,
          created_by: user.id,
        } as any)
        .select()
        .single() as any);

      if (error) {
        await supabase.from('recipes').delete().eq('id', linkedRecipe.id);
        throw error;
      }

      // Insert ingredients and procedure steps, rollback on failure
      try {
        await insertRecipeIngredients(recipe.id, linkedRecipe.id, ingredientPayload);
        await insertProcedureSteps(recipe.id, input.procedure_steps);
      } catch (insertError) {
        await supabase.from('prep_recipes').delete().eq('id', recipe.id);
        await supabase.from('recipes').delete().eq('id', linkedRecipe.id);
        throw insertError;
      }

      toast({
        title: 'Prep recipe created',
        description: `${input.name} saved as a production blueprint`,
      });

      // Fetch the complete recipe with populated relations
      const { data: completeRecipe, error: fetchError } = await (supabase
        .from('prep_recipes')
        .select(`
          *,
          output_product:products(id, name, current_stock, uom_purchase, cost_per_unit),
          ingredients:prep_recipe_ingredients(
            id,
            prep_recipe_id,
            product_id,
            quantity,
            unit,
            notes,
            sort_order,
            product:products(id, name, cost_per_unit, current_stock, uom_purchase, category)
          ),
          procedure_steps:prep_recipe_procedure_steps(
            id,
            prep_recipe_id,
            step_number,
            instruction,
            timer_minutes,
            critical_point
          )
        `)
        .eq('id', recipe.id)
        .eq('restaurant_id', input.restaurant_id)
        .single() as any);

      if (fetchError) throw fetchError;

      // Normalize units from the database into the UI-safe union type
      if (!completeRecipe) {
        throw new Error('Prep recipe fetch returned no data');
      }

      const normalizedRecipe: PrepRecipe = {
        ...completeRecipe,
        default_yield_unit: toIngredientUnit(completeRecipe.default_yield_unit),
        ingredients: (completeRecipe.ingredients || []).map((ing: any) => ({
          ...ing,
          unit: toIngredientUnit(ing.unit),
        })),
      };

      await fetchPrepRecipes();
      return normalizedRecipe;
    } catch (err: unknown) {
      console.error('Error creating prep recipe:', err);
      toast({
        title: 'Could not create prep recipe',
        description: getErrorMessage(err),
        variant: 'destructive',
      });
      return null;
    }
  }, [user, toast, fetchPrepRecipes, buildIngredientPayload, calculateIngredientCostTotal, resolveOutputProduct, insertRecipeIngredients, insertProcedureSteps]);

  const updatePrepRecipe = useCallback(async (input: UpdatePrepRecipeInput) => {
    if (!user) return false;

    try {
      const { id, ingredients, procedure_steps, ...updates } = input;
      const outputProductId = updates.output_product_id || null;
      const targetRestaurantId = input.restaurant_id || restaurantId;

      if (!targetRestaurantId) {
        throw new Error('Restaurant is required to update prep recipe');
      }

      const { data: prepRecipeLink, error: prepRecipeLinkError } = await supabase
        .from('prep_recipes')
        .select('recipe_id')
        .eq('id', id)
        .eq('restaurant_id', targetRestaurantId)
        .single();

      if (prepRecipeLinkError) throw prepRecipeLinkError;

      const { error } = await (supabase
        .from('prep_recipes')
        .update({ ...updates, output_product_id: outputProductId } as any)
        .eq('id', id)
        .eq('restaurant_id', targetRestaurantId) as any);

      if (error) throw error;

      if (prepRecipeLink?.recipe_id) {
        const recipeUpdates: Record<string, unknown> = {};
        if (updates.name !== undefined) recipeUpdates.name = updates.name;
        if (updates.description !== undefined) recipeUpdates.description = updates.description;
        if (updates.default_yield !== undefined) recipeUpdates.serving_size = updates.default_yield;

        if (Object.keys(recipeUpdates).length > 0) {
          const { error: recipeUpdateError } = await supabase
            .from('recipes')
            .update(recipeUpdates)
            .eq('id', prepRecipeLink.recipe_id)
            .eq('restaurant_id', targetRestaurantId);

          if (recipeUpdateError) throw recipeUpdateError;
        }
      }

      if (ingredients) {
        const ingredientPayload = ingredients
          .filter(ing => ing.product_id)
          .map((ing, index) => ({
            product_id: ing.product_id,
            quantity: ing.quantity,
            unit: ing.unit,
            notes: ing.notes,
            sort_order: ing.sort_order ?? index,
          }));

        const { error: ingredientError } = await supabase.rpc('update_prep_recipe_ingredients', {
          p_prep_recipe_id: id,
          p_ingredients: ingredientPayload,
        });

        if (ingredientError) throw ingredientError;

        if (prepRecipeLink?.recipe_id) {
          const { error: deleteRecipeIngredientsError } = await supabase
            .from('recipe_ingredients')
            .delete()
            .eq('recipe_id', prepRecipeLink.recipe_id);

          if (deleteRecipeIngredientsError) throw deleteRecipeIngredientsError;

          if (ingredientPayload.length > 0) {
            const recipeIngredientRows = ingredientPayload.map((ing) => ({
              recipe_id: prepRecipeLink.recipe_id,
              product_id: ing.product_id,
              quantity: ing.quantity,
              unit: ing.unit,
              notes: ing.notes,
            }));

            const { error: recipeIngredientError } = await (supabase
              .from('recipe_ingredients')
              .insert(recipeIngredientRows as any) as any);

            if (recipeIngredientError) throw recipeIngredientError;
          }
        }
      }

      // Handle procedure steps update if provided
      if (procedure_steps !== undefined) {
        // Delete existing steps
        const { error: deleteStepsError } = await (supabase
          .from('prep_recipe_procedure_steps' as any)
          .delete()
          .eq('prep_recipe_id', id) as any);

        if (deleteStepsError) throw deleteStepsError;

        // Insert new steps if any
        const stepRows = (procedure_steps || [])
          .filter((step) => step.instruction.trim())
          .map((step) => ({
            prep_recipe_id: id,
            step_number: step.step_number,
            instruction: step.instruction,
            timer_minutes: step.timer_minutes,
            critical_point: step.critical_point || false,
          }));

        if (stepRows.length > 0) {
          const { error: stepError } = await (supabase
            .from('prep_recipe_procedure_steps' as any)
            .insert(stepRows as any) as any);

          if (stepError) throw stepError;
        }
      }

      toast({
        title: 'Prep recipe updated',
        description: `${updates.name || 'Recipe'} has been refreshed`,
      });

      await fetchPrepRecipes();
      return true;
    } catch (err: unknown) {
      console.error('Error updating prep recipe:', err);
      toast({
        title: 'Could not update prep recipe',
        description: getErrorMessage(err),
        variant: 'destructive',
      });
      return false;
    }
  }, [user, toast, fetchPrepRecipes, restaurantId]);

  const deletePrepRecipe = useCallback(async (id: string, restaurantIdParam?: string) => {
    if (!user) return false;

    const targetRestaurantId = restaurantIdParam || restaurantId;
    if (!targetRestaurantId) {
      throw new Error('Restaurant is required to delete prep recipe');
    }

    try {
      const { data: prepRecipeLink, error: prepRecipeLinkError } = await supabase
        .from('prep_recipes')
        .select('recipe_id')
        .eq('id', id)
        .eq('restaurant_id', targetRestaurantId)
        .single();

      if (prepRecipeLinkError) throw prepRecipeLinkError;

      const { error } = await supabase
        .from('prep_recipes')
        .delete()
        .eq('id', id)
        .eq('restaurant_id', targetRestaurantId);

      if (error) throw error;

      if (prepRecipeLink?.recipe_id) {
        const { error: deleteRecipeError } = await supabase
          .from('recipes')
          .delete()
          .eq('id', prepRecipeLink.recipe_id)
          .eq('restaurant_id', targetRestaurantId);

        if (deleteRecipeError) throw deleteRecipeError;
      }

      toast({
        title: 'Prep recipe deleted',
        description: 'Blueprint removed from prep library',
      });

      setPrepRecipes(prev => prev.filter(r => r.id !== id));
      return true;
    } catch (err: unknown) {
      console.error('Error deleting prep recipe:', err);
      toast({
        title: 'Could not delete prep recipe',
        description: getErrorMessage(err),
        variant: 'destructive',
      });
      return false;
    }
  }, [user, toast, restaurantId]);

  const recipeStats = useMemo(() => {
    return prepRecipes.reduce<Record<string, { ingredientCount: number; costPerBatch: number; costPerUnit: number }>>((acc, recipe) => {
      const ingredientsForCalculation = (recipe.ingredients || []).map((ing) => ({
        product_id: ing.product_id,
        quantity: ing.quantity,
        unit: ing.unit,
        product: ing.product
          ? {
              id: ing.product.id,
              name: ing.product.name,
              cost_per_unit: ing.product.cost_per_unit,
              uom_purchase: ing.product.uom_purchase,
              size_value: ing.product.size_value,
              size_unit: ing.product.size_unit,
              current_stock: ing.product.current_stock,
            }
          : undefined,
      }));

      const costResult = calculateIngredientsCost(ingredientsForCalculation);
      const costPerBatch = costResult.totalCost;
      const costPerUnit = recipe.default_yield > 0 ? costPerBatch / recipe.default_yield : 0;

      acc[recipe.id] = {
        ingredientCount: recipe.ingredients?.length || 0,
        costPerBatch,
        costPerUnit,
      };
      return acc;
    }, {});
  }, [prepRecipes]);

  useEffect(() => {
    fetchPrepRecipes();
  }, [fetchPrepRecipes]);

  return {
    prepRecipes,
    loading,
    error,
    fetchPrepRecipes,
    createPrepRecipe,
    updatePrepRecipe,
    deletePrepRecipe,
    recipeStats,
  };
};
