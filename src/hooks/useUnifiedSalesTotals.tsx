import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

interface SalesTotals {
  totalCount: number;
  revenue: number;
  discounts: number;
  voids: number;
  passThroughAmount: number;
  uniqueItems: number;
  collectedAtPOS: number;
  uncategorizedCount: number;
  pendingReviewCount: number;
}

const EMPTY_TOTALS: SalesTotals = {
  totalCount: 0,
  revenue: 0,
  discounts: 0,
  voids: 0,
  passThroughAmount: 0,
  uniqueItems: 0,
  collectedAtPOS: 0,
  uncategorizedCount: 0,
  pendingReviewCount: 0,
};

interface UseUnifiedSalesTotalsOptions {
  startDate?: string;
  endDate?: string;
  searchTerm?: string;
}

export const useUnifiedSalesTotals = (
  restaurantId: string | null,
  options: UseUnifiedSalesTotalsOptions = {}
) => {
  const { startDate, endDate, searchTerm } = options;

  const { data, isLoading, error, refetch } = useQuery({
    queryKey: ["unified-sales-totals", restaurantId, startDate, endDate, searchTerm],
    queryFn: async (): Promise<SalesTotals> => {
      if (!restaurantId) {
        return EMPTY_TOTALS;
      }

      const { data, error } = await supabase.rpc("get_unified_sales_totals", {
        p_restaurant_id: restaurantId,
        p_start_date: startDate || null,
        p_end_date: endDate || null,
        p_search_term: searchTerm || null,
      });

      if (error) {
        console.error("Error fetching sales totals:", error);
        throw error;
      }

      // RPC returns an array with one row
      const result = data?.[0];

      return {
        totalCount: Number(result?.total_count ?? 0),
        revenue: Number(result?.revenue ?? 0),
        discounts: Number(result?.discounts ?? 0),
        voids: 0,
        passThroughAmount: Number(result?.pass_through_amount ?? 0),
        uniqueItems: Number(result?.unique_items ?? 0),
        collectedAtPOS: Number(result?.collected_at_pos ?? 0),
        uncategorizedCount: Number(result?.uncategorized_count ?? 0),
        pendingReviewCount: Number(result?.pending_review_count ?? 0),
      };
    },
    enabled: !!restaurantId,
    staleTime: 30000, // 30 seconds - keep fresh for real-time operations
    refetchOnWindowFocus: true,
  });

  return {
    totals: data ?? EMPTY_TOTALS,
    isLoading,
    error,
    refetch,
  };
};
