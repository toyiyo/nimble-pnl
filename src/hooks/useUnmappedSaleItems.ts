import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/hooks/useAuth';

export const UNMAPPED_SALE_ITEMS_QUERY_KEY = 'unmapped-sale-items';

/**
 * The banner lists five names and a count, so there is nothing to gain from
 * fetching more -- and staying far below PostgREST's 1000-row response cap
 * means there is no silent truncation to detect.
 */
export const UNMAPPED_SALE_ITEMS_LIMIT = 200;

/**
 * POS item names with no recipe mapped to them, for the AI suggestions banner.
 *
 * The page used to derive this from `useUnifiedSales`, which pulled a 500-row
 * page of sales plus a second copy of the recipe list and diffed them in the
 * browser -- two large payloads on every /recipes load to produce a handful of
 * strings. `get_unmapped_sale_item_names` does the same diff server-side, with
 * the same case-insensitive, untrimmed matching, in one round trip.
 */
export const useUnmappedSaleItems = (restaurantId: string | null) => {
  const { user } = useAuth();

  const { data, isLoading, isError } = useQuery({
    queryKey: [UNMAPPED_SALE_ITEMS_QUERY_KEY, restaurantId],
    queryFn: async () => {
      const { data, error } = await supabase.rpc('get_unmapped_sale_item_names', {
        p_restaurant_id: restaurantId as string,
        p_limit: UNMAPPED_SALE_ITEMS_LIMIT,
      });

      if (error) throw error;
      return (data ?? []).map((row) => row.item_name);
    },
    enabled: !!restaurantId && !!user,
    staleTime: 60000,
  });

  return {
    // React Query keeps the last successful data on error. The banner is
    // advisory and cross-tenant, so a failed load must show nothing rather
    // than the previous restaurant's items.
    unmappedItems: isError ? [] : data ?? [],
    loading: isLoading,
    isError,
  };
};
