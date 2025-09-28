import { useState, useEffect } from 'react';
import { supabase } from '@/integrations/supabase/client';

interface RecipeIngredient {
  id: string;
  recipe_id: string;
  quantity: number;
  unit: string;
  recipe: {
    id: string;
    name: string;
    pos_item_name: string | null;
  };
}

export function useProductRecipes(productId: string | null, restaurantId: string | null) {
  const [recipes, setRecipes] = useState<RecipeIngredient[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    async function fetchProductRecipes() {
      if (!productId || !restaurantId) {
        setRecipes([]);
        return;
      }

      setLoading(true);
      try {
        const { data, error } = await supabase
          .from('recipe_ingredients')
          .select(`
            id,
            recipe_id,
            quantity,
            unit,
            recipe:recipes!inner (
              id,
              name,
              pos_item_name
            )
          `)
          .eq('product_id', productId)
          .eq('recipe.restaurant_id', restaurantId)
          .eq('recipe.is_active', true);

        if (error) throw error;
        setRecipes(data || []);
      } catch (error) {
        console.error('Error fetching product recipes:', error);
        setRecipes([]);
      } finally {
        setLoading(false);
      }
    }

    fetchProductRecipes();
  }, [productId, restaurantId]);

  return { recipes, loading };
}