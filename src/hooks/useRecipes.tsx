import { useState, useEffect, useCallback } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from './useAuth';
import { useToast } from '@/hooks/use-toast';

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
    unit: 'oz' | 'ml' | 'cup' | 'tbsp' | 'tsp' | 'lb' | 'kg' | 'g' | 'bottle' | 'can' | 'bag' | 'box' | 'piece' | 'serving';
    notes?: string;
  }[];
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
      const { data, error } = await supabase
        .from('recipes')
        .select('*')
        .eq('restaurant_id', restaurantId)
        .eq('is_active', true)
        .order('name');

      if (error) throw error;
      
      // Enhance recipes with updated costs and profitability data
      const enhancedRecipes = await Promise.all(
        (data || []).map(async (recipe) => {
          // Recalculate cost using the updated calculation function
          const updatedCost = await calculateRecipeCost(recipe.id);
          const recipeWithUpdatedCost = {
            ...recipe,
            estimated_cost: updatedCost || recipe.estimated_cost
          };
          
          // If cost was updated, save it to database
          if (updatedCost !== null && updatedCost !== recipe.estimated_cost) {
            await supabase
              .from('recipes')
              .update({ estimated_cost: updatedCost })
              .eq('id', recipe.id);
          }
          
          const profitData = await calculateRecipeProfitability(recipeWithUpdatedCost);
          return {
            ...recipeWithUpdatedCost,
            avg_sale_price: profitData?.avg_sale_price,
            profit_margin: profitData?.profit_margin,
            profit_per_serving: profitData?.profit_per_serving
          };
        })
      );

      setRecipes(enhancedRecipes);
    } catch (error: any) {
      console.error('Error fetching recipes:', error);
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

          const { error: ingredientsError } = await supabase
            .from('recipe_ingredients')
            .insert(ingredients);

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
    unit: 'oz' | 'ml' | 'cup' | 'tbsp' | 'tsp' | 'lb' | 'kg' | 'g' | 'bottle' | 'can' | 'bag' | 'box' | 'piece' | 'serving';
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

        const { error: insertError } = await supabase
          .from('recipe_ingredients')
          .insert(ingredientsWithRecipeId);

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
            size_unit,
            package_qty
          )
        `)
        .eq('recipe_id', recipeId);

      if (error) throw error;
      if (!ingredients || ingredients.length === 0) return 0;

      // Import the calculation logic used in RecipeDialog
      const { calculateInventoryImpact } = await import('@/lib/enhancedUnitConversion');

      let totalCost = 0;
      
      ingredients.forEach((ingredient: any) => {
        if (ingredient.product && ingredient.product.cost_per_unit) {
          const product = ingredient.product;
          try {
            const packageQuantity = (product.size_value || 1) * (product.package_qty || 1);
            const purchaseUnit = product.uom_purchase || 'unit';
            const costPerMeasurementUnit = (product.cost_per_unit || 0) / (product.package_qty || 1);
            
            const result = calculateInventoryImpact(
              ingredient.quantity,
              ingredient.unit,
              packageQuantity,
              purchaseUnit,
              product.name || '',
              costPerMeasurementUnit
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

  useEffect(() => {
    fetchRecipes();
    
    if (!restaurantId) return;
    
    // Set up real-time subscription for recipe updates
    const channel = supabase
      .channel('recipe-changes')
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'recipes',
          filter: `restaurant_id=eq.${restaurantId}`
        },
        () => {
          // Refetch recipes when any recipe is updated
          fetchRecipes();
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [fetchRecipes, restaurantId]);

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