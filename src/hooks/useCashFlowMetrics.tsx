import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useRestaurantContext } from "@/contexts/RestaurantContext";
import { format } from "date-fns";
import { deriveCashFlowMetrics, type CashFlowMetrics, type DailyFlow } from "@/lib/cashFlowMetrics";

interface CashFlowMetricsResponse {
  daily: DailyFlow[];
  comparison: { inflow: number; outflow: number };
}

export function useCashFlowMetrics(startDate: Date, endDate: Date, bankAccountId: string = 'all') {
  const { selectedRestaurant } = useRestaurantContext();

  return useQuery({
    queryKey: ['cash-flow-metrics', selectedRestaurant?.restaurant_id, format(startDate, 'yyyy-MM-dd'), format(endDate, 'yyyy-MM-dd'), bankAccountId],
    queryFn: async (): Promise<CashFlowMetrics> => {
      if (!selectedRestaurant?.restaurant_id) {
        throw new Error("No restaurant selected");
      }

      const { data, error } = await supabase.rpc('get_cash_flow_metrics', {
        p_restaurant_id: selectedRestaurant.restaurant_id,
        p_start_date: format(startDate, 'yyyy-MM-dd'),
        p_end_date: format(endDate, 'yyyy-MM-dd'),
        p_bank_account_id: bankAccountId === 'all' ? null : bankAccountId,
      });

      if (error) throw error;
      if (!data) throw new Error("No cash flow data returned");

      const result = data as unknown as CashFlowMetricsResponse;

      return deriveCashFlowMetrics(result.daily, result.comparison.inflow, startDate, endDate);
    },
    enabled: !!selectedRestaurant?.restaurant_id,
    staleTime: 30000, // 30 seconds
    refetchOnWindowFocus: true,
    refetchOnMount: true,
  });
}
