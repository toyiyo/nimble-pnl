import { useQuery } from '@tanstack/react-query';

import { supabase } from '@/integrations/supabase/client';
import { toDateOnlyString } from '@/lib/dateOnly';

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
      const startDate = new Date();
      startDate.setDate(startDate.getDate() - 7);
      const startStr = toDateOnlyString(startDate);

      const { data, error } = await supabase
        .from('unified_sales')
        .select('quantity')
        .eq('restaurant_id', restaurantId as string)
        .eq('item_name', posItemName as string)
        .gte('sale_date', startStr);

      if (error) throw error;
      if (!data) return 0;

      return data.reduce((sum, row) => sum + Number((row as { quantity: number }).quantity ?? 0), 0);
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
