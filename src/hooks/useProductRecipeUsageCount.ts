import { useQuery } from '@tanstack/react-query';

import { supabase } from '@/integrations/supabase/client';

export interface ProductRecipeUsageCountResult {
  count: number;
  isLoading: boolean;
  isError: boolean;
}

/**
 * Counts recipes in the selected restaurant that use this product with no
 * line-level yield override. Shown on the product sheet as
 * "Used in N recipes" (design §6.3).
 *
 * The query is disabled when `restaurantId` or `productId` is null.
 */
export function useProductRecipeUsageCount(
  restaurantId: string | null,
  productId: string | null,
): ProductRecipeUsageCountResult {
  const enabled = !!restaurantId && !!productId;

  const { data, isLoading, isError } = useQuery({
    queryKey: ['product-recipe-usage-count', restaurantId, productId],
    queryFn: async (): Promise<number> => {
      const { count, error } = await supabase
        .from('recipe_ingredients')
        .select('id, recipe:recipes!inner(restaurant_id)', { count: 'exact', head: true })
        .eq('product_id', productId as string)
        .eq('recipe.restaurant_id', restaurantId as string)
        .is('yield_pct_override', null);

      if (error) throw error;
      return count ?? 0;
    },
    enabled,
    staleTime: 60000,
    refetchOnWindowFocus: true,
  });

  return {
    count: enabled ? (data ?? 0) : 0,
    isLoading: enabled ? isLoading : false,
    isError: enabled ? isError : false,
  };
}
