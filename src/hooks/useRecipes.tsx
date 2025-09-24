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
      setRecipes(data || []);
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

      if (recipeError) throw recipeError;

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

      setRecipes(prev => [...prev, recipe]);
      
      toast({
        title: "Recipe created",
        description: `${recipe.name} has been created successfully.`,
      });

      return recipe;
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
      const { data, error } = await supabase
        .rpc('calculate_recipe_cost', { recipe_id: recipeId });

      if (error) throw error;
      return data;
    } catch (error: any) {
      console.error('Error calculating recipe cost:', error);
      return null;
    }
  };

  useEffect(() => {
    fetchRecipes();
  }, [fetchRecipes]);

  return {
    recipes,
    loading,
    fetchRecipes,
    fetchRecipeIngredients,
    createRecipe,
    updateRecipe,
    deleteRecipe,
    calculateRecipeCost,
  };
};