import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';

interface RecipeInfo {
  id: string;
  name: string;
  pos_item_name: string | null;
}

interface RecipeIngredient {
  id: string;
  product_id: string;
  recipe_id: string;
  quantity: number;
  unit: string;
  recipe: RecipeInfo;
}

export interface ProductRecipeMap {
  [productId: string]: RecipeIngredient[];
}

/**
 * Fetches recipe usage for ALL products in a restaurant in a single query.
 * Use this instead of useProductRecipes when displaying many products at once
 * (e.g., in virtualized lists) to avoid N+1 query problems.
 *
 * Uses React Query for caching and automatic refetching.
 */
export function useAllProductRecipes(restaurantId: string | null) {
  const { data, isLoading, isError, error } = useQuery({
    queryKey: ['allProductRecipes', restaurantId],
    queryFn: async () => {
      if (!restaurantId) {
        return [];
      }

      const { data: ingredients, error } = await supabase
        .from('recipe_ingredients')
        .select(`
          id,
          product_id,
          recipe_id,
          quantity,
          unit,
          recipe:recipes!inner (
            id,
            name,
            pos_item_name
          )
        `)
        .eq('recipe.restaurant_id', restaurantId)
        .eq('recipe.is_active', true);

      if (error) {
        throw error;
      }

      return (ingredients || []) as RecipeIngredient[];
    },
    enabled: !!restaurantId,
    staleTime: 60000, // 1 minute - recipe associations don't change frequently
    refetchOnWindowFocus: false, // Avoid refetching during scroll interactions
  });

  // Group by product_id for easy lookup
  const recipesByProduct = useMemo(() => {
    const map: ProductRecipeMap = {};
    if (!data) return map;

    for (const item of data) {
      if (!map[item.product_id]) {
        map[item.product_id] = [];
      }
      map[item.product_id].push(item);
    }
    return map;
  }, [data]);

  return {
    recipesByProduct,
    loading: isLoading,
    isError,
    error,
  };
}
