import { useQuery } from '@tanstack/react-query';

import { supabase } from '@/integrations/supabase/client';
import { toDateOnlyString } from '@/lib/dateOnly';
import { fetchAllRows } from '@/utils/fetchAllRows';

export interface RecipeWeeklyVolumeResult {
  weeklyVolume: number;
  isLoading: boolean;
  isError: boolean;
}

/**
 * Sums `unified_sales.quantity` for a POS item name over the last 7
 * restaurant days. Used by the RecipeDialog cost summary to show a weekly
 * waste-allowance estimate at current sales volume.
 *
 * The query is disabled when `restaurantId` or `posItemName` is null.
 */
export function useRecipeWeeklyVolume(
  restaurantId: string | null,
  posItemName: string | null,
): RecipeWeeklyVolumeResult {
  const enabled = !!restaurantId && !!posItemName;

  const { data, isLoading, isError } = useQuery({
    queryKey: ['recipe-weekly-volume', restaurantId, posItemName],
    queryFn: async (): Promise<number> => {
      // `sale_date` is a calendar date and `gte` is inclusive, so 6 days
      // back plus today covers exactly 7 restaurant days.
      const startDate = new Date();
      startDate.setDate(startDate.getDate() - 6);
      const startStr = toDateOnlyString(startDate);

      // Paginate past PostgREST's default row cap: a popular item can have
      // more than 1000 sale rows in a 7-day window.
      const { rows } = await fetchAllRows<{ quantity: number }>((from, to) =>
        supabase
          .from('unified_sales')
          .select('quantity')
          .eq('restaurant_id', restaurantId as string)
          .eq('item_name', posItemName as string)
          .gte('sale_date', startStr)
          .range(from, to) as unknown as PromiseLike<{ data: { quantity: number }[] | null; error: unknown }>
      );

      return rows.reduce((sum, row) => sum + Number(row.quantity ?? 0), 0);
    },
    enabled,
    staleTime: 60000,
    refetchOnWindowFocus: true,
  });

  return {
    weeklyVolume: enabled ? (data ?? 0) : 0,
    isLoading: enabled ? isLoading : false,
    isError: enabled ? isError : false,
  };
}
