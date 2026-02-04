import { useCallback, useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from './useAuth';
import { useToast } from './use-toast';
import { PrepRecipe } from './usePrepRecipes';
import { IngredientUnit } from '@/lib/recipeUnits';
import { calculateIngredientsCost, calculateIngredientCost } from '@/lib/prepCostCalculation';

export interface QuickCookIngredient {
  product_id: string;
  product_name: string;
  quantity: number;
  unit: IngredientUnit;
  current_stock: number;
  stock_unit: string; // Native unit the product is stored in (uom_purchase)
  is_sufficient: boolean;
}

export interface QuickCookPreview {
  recipe: PrepRecipe;
  ingredients_to_deduct: QuickCookIngredient[];
  output_quantity: number;
  output_unit: IngredientUnit;
  output_product_id: string | null | undefined;
  output_product_name: string;
  has_insufficient_stock: boolean;
  total_cost: number;
}

export interface QuickCookResult {
  success: boolean;
  production_run_id?: string;
  output_product_id?: string;
  output_quantity?: number;
  error?: string;
}

const getErrorMessage = (err: unknown): string => {
  if (err instanceof Error) return err.message;
  if (typeof err === 'string') return err;
  return 'An error occurred';
};

export const useQuickCook = (restaurantId: string | null) => {
  const { user } = useAuth();
  const { toast } = useToast();
  const [loading, setLoading] = useState(false);

  /**
   * Generate a preview of what will happen when quick-cooking.
   * Shows ingredient deductions and stock warnings.
   */
  const previewQuickCook = useCallback(
    async (recipe: PrepRecipe): Promise<QuickCookPreview | null> => {
      if (!restaurantId || !user) return null;

      try {
        const ingredients = recipe.ingredients || [];

        // Build preview from existing ingredient data (already fetched with recipe)
        const ingredientsToDeduct: QuickCookIngredient[] = ingredients.map((ing) => {
          const currentStock = ing.product?.current_stock ?? 0;
          const stockUnit = ing.product?.uom_purchase || ing.unit;
          const quantity = ing.quantity; // 1X yield

          // Calculate inventory deduction in stock units for proper sufficiency check
          let inventoryDeduction = quantity;
          try {
            if (ing.product) {
              const costResult = calculateIngredientCost({
                product_id: ing.product_id,
                quantity,
                unit: ing.unit,
                product: ing.product,
              });
              // Use converted deduction if valid, otherwise fall back to quantity
              inventoryDeduction = costResult.inventoryDeduction > 0 ? costResult.inventoryDeduction : quantity;
            }
          } catch {
            // Fall back to 1:1 if conversion fails
            inventoryDeduction = quantity;
          }

          return {
            product_id: ing.product_id,
            product_name: ing.product?.name || 'Unknown',
            quantity,
            unit: ing.unit,
            current_stock: currentStock,
            stock_unit: stockUnit,
            is_sufficient: currentStock >= inventoryDeduction,
          };
        });

        const hasInsufficientStock = ingredientsToDeduct.some((ing) => !ing.is_sufficient);

        // Calculate total cost using existing cost calculation
        const costResult = calculateIngredientsCost(
          ingredients.map((ing) => ({
            product_id: ing.product_id,
            quantity: ing.quantity,
            unit: ing.unit,
            product: ing.product,
          }))
        );

        return {
          recipe,
          ingredients_to_deduct: ingredientsToDeduct,
          output_quantity: recipe.default_yield,
          output_unit: recipe.default_yield_unit,
          output_product_id: recipe.output_product_id,
          output_product_name: recipe.output_product?.name || recipe.name,
          has_insufficient_stock: hasInsufficientStock,
          total_cost: costResult.totalCost,
        };
      } catch (err: unknown) {
        console.error('Error previewing quick cook:', err);
        toast({
          title: 'Could not preview cook',
          description: getErrorMessage(err),
          variant: 'destructive',
        });
        return null;
      }
    },
    [restaurantId, user, toast]
  );

  /**
   * Execute the quick cook operation.
   * Creates a production run at 1X, immediately completes it.
   * Auto-creates output product if needed, syncs shelf life.
   */
  const executeQuickCook = useCallback(
    async (recipe: PrepRecipe): Promise<QuickCookResult> => {
      if (!restaurantId || !user) {
        return { success: false, error: 'Not authenticated' };
      }

      setLoading(true);
      try {
        // Step 1: Ensure output product exists
        let outputProductId = recipe.output_product_id;

        if (!outputProductId) {
          // Check if product exists with same name
          const { data: existingProduct } = await supabase
            .from('products')
            .select('id')
            .eq('restaurant_id', restaurantId)
            .ilike('name', recipe.name)
            .limit(1)
            .maybeSingle();

          if (existingProduct) {
            outputProductId = existingProduct.id;
          } else {
            // Create new output product
            const slug = recipe.name
              .toUpperCase()
              .replaceAll(/[^A-Z0-9]+/g, '-')
              .replaceAll(/(^-+|-+$)/g, '') || 'PREP';
            const sku = `PREP-${slug}`.slice(0, 24) + `-${Date.now().toString(36).slice(-4).toUpperCase()}`;

            const { data: newProduct, error: productError } = await supabase
              .from('products')
              .insert({
                restaurant_id: restaurantId,
                name: recipe.name,
                sku,
                uom_purchase: recipe.default_yield_unit || 'unit',
                size_value: 1,
                size_unit: recipe.default_yield_unit || null,
                package_qty: 1,
                current_stock: 0,
                par_level_min: 0,
                par_level_max: 0,
                reorder_point: 0,
                cost_per_unit: 0,
                description: 'Auto-created from quick cook',
                shelf_life_days: recipe.shelf_life_days ?? null,
              })
              .select()
              .single();

            if (productError) throw productError;
            outputProductId = newProduct.id;

            // Link output product to recipe
            const { error: linkError } = await supabase
              .from('prep_recipes')
              .update({ output_product_id: outputProductId })
              .eq('id', recipe.id);

            if (linkError) {
              console.error('Failed to link output product to recipe', {
                recipeId: recipe.id,
                outputProductId,
                error: linkError,
              });
              throw new Error(`Failed to link output product to recipe: ${linkError.message}`);
            }
          }
        }

        // Step 2: Create production run at 1X yield
        const { data: run, error: runError } = await supabase
          .from('production_runs')
          .insert({
            restaurant_id: restaurantId,
            prep_recipe_id: recipe.id,
            status: 'in_progress',
            target_yield: recipe.default_yield,
            target_yield_unit: recipe.default_yield_unit,
            notes: 'Quick cook (1X)',
            created_by: user.id,
          })
          .select()
          .single();

        if (runError) throw runError;

        // Step 3: Create production run ingredients
        const ingredients = recipe.ingredients || [];
        if (ingredients.length > 0) {
          const ingredientRows = ingredients.map((ing) => ({
            production_run_id: run.id,
            product_id: ing.product_id,
            expected_quantity: ing.quantity,
            actual_quantity: ing.quantity,
            unit: ing.unit,
            variance_percent: 0,
          }));

          const { error: ingredientError } = await supabase
            .from('production_run_ingredients')
            .insert(ingredientRows);

          if (ingredientError) throw ingredientError;
        }

        // Step 4: Complete the production run (this handles all inventory transactions)
        const ingredientPayload = ingredients.map((ing) => ({
          product_id: ing.product_id,
          expected_quantity: ing.quantity,
          actual_quantity: ing.quantity,
          unit: ing.unit,
        }));

        const { error: completeError } = await supabase.rpc('complete_production_run', {
          p_run_id: run.id,
          p_actual_yield: recipe.default_yield,
          p_actual_yield_unit: recipe.default_yield_unit,
          p_ingredients: ingredientPayload,
        });

        if (completeError) throw completeError;

        toast({
          title: 'Quick cook completed',
          description: `${recipe.default_yield} ${recipe.default_yield_unit} of ${recipe.name} added to inventory.`,
        });

        return {
          success: true,
          production_run_id: run.id,
          output_product_id: outputProductId || undefined,
          output_quantity: recipe.default_yield,
        };
      } catch (err: unknown) {
        console.error('Error executing quick cook:', err);
        const errorMessage = getErrorMessage(err);
        toast({
          title: 'Quick cook failed',
          description: errorMessage,
          variant: 'destructive',
        });
        return { success: false, error: errorMessage };
      } finally {
        setLoading(false);
      }
    },
    [restaurantId, user, toast]
  );

  return {
    previewQuickCook,
    executeQuickCook,
    loading,
  };
};
