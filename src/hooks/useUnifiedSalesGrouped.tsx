import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';

export interface GroupedSaleItem {
  item_name: string;
  total_quantity: number;
  total_revenue: number;
  sale_count: number;
}

export type GroupedSortBy = 'revenue' | 'quantity' | 'sales' | 'name';

// RPC numerics can arrive as strings over the wire (see useRevenueBreakdown's
// UnifiedSalesTotalsRow for the same pattern) — coerced to numbers below.
type GroupedSaleItemRow = {
  item_name: string;
  total_quantity: number | string;
  total_revenue: number | string;
  sale_count: number | string;
};

interface UseUnifiedSalesGroupedOptions {
  startDate?: string;
  endDate?: string;
  searchTerm?: string;
  categorizationFilter?: 'all' | 'uncategorized' | 'pending-review' | 'categorized';
  recipeFilter?: 'all' | 'with-recipe' | 'without-recipe';
  sortBy?: GroupedSortBy;
  sortDirection?: 'asc' | 'desc';
}

export const useUnifiedSalesGrouped = (
  restaurantId: string | null,
  options: UseUnifiedSalesGroupedOptions = {}
) => {
  const {
    startDate, endDate, searchTerm,
    categorizationFilter = 'all',
    recipeFilter = 'all',
    sortBy = 'revenue',
    sortDirection = 'desc',
  } = options;

  const { data, isLoading, error, refetch } = useQuery({
    queryKey: [
      'unified-sales-grouped', restaurantId, startDate ?? '', endDate ?? '',
      searchTerm ?? '', categorizationFilter, recipeFilter, sortBy, sortDirection,
    ],
    queryFn: async (): Promise<GroupedSaleItem[]> => {
      if (!restaurantId) return [];

      const { data, error } = await supabase.rpc('get_unified_sales_grouped_by_item', {
        p_restaurant_id: restaurantId,
        p_start_date: startDate || null,
        p_end_date: endDate || null,
        p_search_term: searchTerm || null,
        p_categorization_filter: categorizationFilter,
        p_recipe_filter: recipeFilter,
        p_sort_by: sortBy,
        p_sort_direction: sortDirection,
      });

      if (error) {
        console.error('Error fetching grouped sales:', error);
        throw error;
      }

      return (data ?? []).map((row: GroupedSaleItemRow) => ({
        item_name: row.item_name,
        total_quantity: Number(row.total_quantity ?? 0),
        total_revenue: Number(row.total_revenue ?? 0),
        sale_count: Number(row.sale_count ?? 0),
      }));
    },
    enabled: !!restaurantId,
    staleTime: 30000,
    refetchOnWindowFocus: true, // aligned with useUnifiedSalesTotals so they don't drift
  });

  return { groups: data ?? [], isLoading, error, refetch };
};
