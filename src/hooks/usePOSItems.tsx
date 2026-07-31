import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';

export interface POSItem {
  item_name: string;
  // Nullable, not merely optional: search_pos_items returns NULL here when
  // every contributing sale row for an item has a NULL id, which the
  // migration's FILTER clause preserves rather than inventing a value.
  item_id?: string | null;
  source: 'pos_sales' | 'unified_sales';
  sales_count: number;
  last_sold?: string | null;
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
    // `keepPreviousData` exists to stop the list flickering empty between
    // debounced keystrokes. Applied unconditionally it also spans a
    // *restaurant* change, because restaurantId is part of the query key --
    // so switching restaurants would render the previous tenant's POS items
    // until the new fetch resolved. Keep the previous page only while the
    // same tenant is being searched.
    placeholderData: (previous, previousQuery) =>
      previousQuery?.queryKey[1] === restaurantId ? previous : undefined,
  });

  return {
    posItems: data ?? [],
    loading: isLoading && !!restaurantId,
    error,
    refetch,
  };
};
