import { useQuery } from '@tanstack/react-query';

import { supabase } from '@/integrations/supabase/client';
import { fetchAllRows } from '@/utils/fetchAllRows';

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
      // Count distinct recipes, not ingredient lines: the same product can
      // appear on more than one line of one recipe. Paginate past
      // PostgREST's default row cap, with a stable `id` order so offset
      // pages neither skip nor repeat a row.
      const { rows } = await fetchAllRows<{ recipe_id: string }>((from, to) =>
        supabase
          .from('recipe_ingredients')
          .select('recipe_id, recipe:recipes!inner(restaurant_id)')
          .eq('product_id', productId as string)
          .eq('recipe.restaurant_id', restaurantId as string)
          .is('yield_pct_override', null)
          .order('id', { ascending: true })
          .range(from, to) as unknown as PromiseLike<{ data: { recipe_id: string }[] | null; error: unknown }>
      );

      const distinctRecipeIds = new Set(rows.map((row) => row.recipe_id));
      return distinctRecipeIds.size;
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
