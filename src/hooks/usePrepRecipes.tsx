import { useCallback, useEffect, useMemo, useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from './useAuth';
import { useToast } from './use-toast';
import { IngredientUnit, toIngredientUnit } from '@/lib/recipeUnits';

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
    category?: string;
  };
}

export interface PrepRecipe {
  id: string;
  restaurant_id: string;
  name: string;
  description?: string;
  output_product_id?: string | null;
  default_yield: number;
  default_yield_unit: IngredientUnit;
  prep_time_minutes?: number | null;
  created_by?: string;
  created_at?: string;
  updated_at?: string;
  output_product?: {
    id: string;
    name: string;
    current_stock?: number;
    uom_purchase?: string;
    cost_per_unit?: number;
  } | null;
  ingredients?: PrepRecipeIngredient[];
}

export interface CreatePrepRecipeInput {
  restaurant_id: string;
  name: string;
  description?: string;
  output_product_id?: string | null;
  default_yield: number;
  default_yield_unit: IngredientUnit;
  prep_time_minutes?: number | null;
  ingredients: Array<{
    product_id: string;
    quantity: number;
    unit: IngredientUnit;
    notes?: string;
    sort_order?: number;
  }>;
}

export interface UpdatePrepRecipeInput extends Partial<CreatePrepRecipeInput> {
  id: string;
}

type IngredientPayload = Array<{
  prep_recipe_id: string;
  product_id: string;
  quantity: number;
  unit: IngredientUnit;
  notes?: string;
  sort_order?: number;
}>;

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
      const { data, error } = await supabase
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
          )
        `)
        .eq('restaurant_id', restaurantId)
        .order('name');

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
      const errorMessage = err instanceof Error ? err.message : 'Failed to load prep recipes';
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
      .select('id, cost_per_unit')
      .in('id', ingredientProductIds)
      .eq('restaurant_id', restaurant_id);

    if (productError) throw productError;

    const costMap = new Map((ingredientProducts || []).map(p => [p.id, p.cost_per_unit || 0]));
    return ingredientPayload.reduce((sum, ing) => {
      const costPerUnit = costMap.get(ing.product_id) || 0;
      return sum + costPerUnit * (ing.quantity || 0);
    }, 0);
  }, []);

  const ensureSupplierIfNeeded = useCallback(async (restaurant_id: string, ingredientCostTotal: number, outputProductId?: string | null) => {
    if (ingredientCostTotal > 0 || !outputProductId) {
      return ensureRestaurantSupplier(restaurant_id);
    }
    return null;
  }, [ensureRestaurantSupplier]);

  const findExistingOutputProduct = useCallback(async (restaurantId: string, name: string) => {
    const { data: existingProducts, error: existingError } = await supabase
      .from('products')
      .select('id')
      .eq('restaurant_id', restaurantId)
      .ilike('name', name)
      .limit(1);

    if (existingError) throw existingError;
    return existingProducts && existingProducts.length > 0 ? existingProducts[0].id : null;
  }, []);

  const createOutputProduct = useCallback(async (input: CreatePrepRecipeInput, ingredientCostTotal: number, supplierInfo?: { supplierId: string; supplierName: string } | null) => {
    const slug = input.name
      .toUpperCase()
      .replaceAll(/[^A-Z0-9]+/g, '-')
      .replaceAll(/(^-+|-+$)/g, '') || 'PREP';
    const sku = `PREP-${slug}`.slice(0, 24) + `-${Date.now().toString(36).slice(-4).toUpperCase()}`;

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
        cost_per_unit: ingredientCostTotal,
        supplier_id: supplierInfo?.supplierId || null,
        supplier_name: supplierInfo?.supplierName || null,
        description: 'Auto-created prep output',
      })
      .select()
      .single();

    if (productError) throw productError;
    return newProduct?.id || null;
  }, []);

  const updateExistingOutputProduct = useCallback(async (outputProductId: string, restaurantId: string, ingredientCostTotal: number, supplierInfo?: { supplierId: string; supplierName: string } | null) => {
    if (!restaurantId) {
      throw new Error('Restaurant is required to update output product');
    }

    const { data: currentProduct, error: currentError } = await supabase
      .from('products')
      .select('cost_per_unit, supplier_id, supplier_name')
      .eq('id', outputProductId)
      .eq('restaurant_id', restaurantId)
      .single();

    if (currentError) throw currentError;

    const updates: Partial<{
      cost_per_unit: number;
      supplier_id: string;
      supplier_name: string;
      updated_at: string;
    }> = {};
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

    await updateExistingOutputProduct(outputProductId, input.restaurant_id, ingredientCostTotal, supplierInfo);
    return outputProductId;
  }, [ensureSupplierIfNeeded, findExistingOutputProduct, createOutputProduct, updateExistingOutputProduct]);

  const createPrepRecipe = useCallback(async (input: CreatePrepRecipeInput) => {
    if (!user) return null;

    try {
      const ingredientPayload = buildIngredientPayload(input);
      const ingredientCostTotal = await calculateIngredientCostTotal(input.restaurant_id, ingredientPayload);
      const outputProductId = await resolveOutputProduct(input, ingredientCostTotal);

      const { data: recipe, error } = await supabase
        .from('prep_recipes')
        .insert({
          restaurant_id: input.restaurant_id,
          name: input.name,
          description: input.description,
          output_product_id: outputProductId,
          default_yield: input.default_yield,
          default_yield_unit: input.default_yield_unit,
          prep_time_minutes: input.prep_time_minutes,
          created_by: user.id,
        })
        .select()
        .single();

      if (error) throw error;

      if (ingredientPayload.length) {
        const ingredientRows = ingredientPayload.map((ing) => ({
          ...ing,
          prep_recipe_id: recipe.id,
        }));

        const { error: ingredientError } = await supabase
          .from('prep_recipe_ingredients')
          .insert(ingredientRows);

        if (ingredientError) throw ingredientError;
      }

      toast({
        title: 'Prep recipe created',
        description: `${input.name} saved as a production blueprint`,
      });

      // Fetch the complete recipe with populated relations
      const { data: completeRecipe, error: fetchError } = await supabase
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
          )
        `)
        .eq('id', recipe.id)
        .eq('restaurant_id', input.restaurant_id)
        .single();

      if (fetchError) throw fetchError;

      // Normalize units from the database into the UI-safe union type
      if (!completeRecipe) {
        throw new Error('Prep recipe fetch returned no data');
      }

      const normalizedRecipe = {
        ...completeRecipe,
        default_yield_unit: toIngredientUnit(completeRecipe.default_yield_unit),
        ingredients: (completeRecipe.ingredients || []).map((ing: RawPrepRecipeIngredient) => ({
          ...ing,
          unit: toIngredientUnit(ing.unit),
        })),
      } as PrepRecipe;

      await fetchPrepRecipes();
      return normalizedRecipe;
    } catch (err: unknown) {
      console.error('Error creating prep recipe:', err);
      const description = err instanceof Error ? err.message : 'An unexpected error occurred';
      toast({
        title: 'Could not create prep recipe',
        description,
        variant: 'destructive',
      });
      return null;
    }
  }, [user, toast, fetchPrepRecipes, buildIngredientPayload, calculateIngredientCostTotal, resolveOutputProduct]);

  const updatePrepRecipe = useCallback(async (input: UpdatePrepRecipeInput) => {
    if (!user) return false;

    try {
      const { id, ingredients, ...updates } = input;
      const outputProductId = updates.output_product_id || null;
      const targetRestaurantId = input.restaurant_id || restaurantId;

      if (!targetRestaurantId) {
        throw new Error('Restaurant is required to update prep recipe');
      }

      const { error } = await supabase
        .from('prep_recipes')
        .update({ ...updates, output_product_id: outputProductId })
        .eq('id', id)
        .eq('restaurant_id', targetRestaurantId);

      if (error) throw error;

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
      }

      toast({
        title: 'Prep recipe updated',
        description: `${updates.name || 'Recipe'} has been refreshed`,
      });

      await fetchPrepRecipes();
      return true;
    } catch (err: unknown) {
      console.error('Error updating prep recipe:', err);
      const description = err instanceof Error ? err.message : 'An unexpected error occurred';
      toast({
        title: 'Could not update prep recipe',
        description,
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
      const { error } = await supabase
        .from('prep_recipes')
        .delete()
        .eq('id', id)
        .eq('restaurant_id', targetRestaurantId);

      if (error) throw error;

      toast({
        title: 'Prep recipe deleted',
        description: 'Blueprint removed from prep library',
      });

      setPrepRecipes(prev => prev.filter(r => r.id !== id));
      return true;
    } catch (err: unknown) {
      console.error('Error deleting prep recipe:', err);
      const description = err instanceof Error ? err.message : 'An unexpected error occurred';
      toast({
        title: 'Could not delete prep recipe',
        description,
        variant: 'destructive',
      });
      return false;
    }
  }, [user, toast, restaurantId]);

  const recipeStats = useMemo(() => {
    return prepRecipes.reduce<Record<string, { ingredientCount: number; costPerBatch: number; costPerUnit: number }>>((acc, recipe) => {
      const costPerBatch = (recipe.ingredients || []).reduce((sum, ing) => {
        const unitCost = ing.product?.cost_per_unit || 0;
        return sum + unitCost * (ing.quantity || 0);
      }, 0);
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
