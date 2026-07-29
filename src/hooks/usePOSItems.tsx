import { useQuery, keepPreviousData } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';

export interface POSItem {
  item_name: string;
  item_id?: string;
  source: 'pos_sales' | 'unified_sales';
  sales_count: number;
  last_sold?: string;
}

export const usePOSItems = (
  restaurantId: string | null,
  opts?: { search?: string; limit?: number }
) => {
  const search = opts?.search;
  const limit = opts?.limit;

  const {
    data,
    isLoading,
    error,
    refetch,
  } = useQuery({
    queryKey: ['pos-items', restaurantId, search, limit],
    // Typing is debounced, so superseded keystrokes would otherwise leave
    // their RPC running server-side for results nobody reads. Hand React
    // Query's signal to PostgREST so the aborted fetch takes the query with it.
    queryFn: async ({ signal }) => {
      const { data, error } = await supabase
        .rpc('search_pos_items', {
          p_restaurant_id: restaurantId,
          p_search: search,
          p_limit: limit,
        })
        .abortSignal(signal);

      if (error) throw error;
      return (data ?? []) as POSItem[];
    },
    enabled: !!restaurantId,
    staleTime: 30000,
    placeholderData: keepPreviousData,
  });

  return {
    posItems: data ?? [],
    loading: isLoading && !!restaurantId,
    error,
    refetch,
  };
};
