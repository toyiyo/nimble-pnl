import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useRestaurantContext } from "@/contexts/RestaurantContext";
import { subDays, differenceInDays, format } from "date-fns";

interface CashFlowMetrics {
  netInflows7d: number;
  netInflows30d: number;
  netOutflows7d: number;
  netOutflows30d: number;
  netCashFlow7d: number;
  netCashFlow30d: number;
  avgDailyCashFlow: number;
  volatility: number;
  trend: number[];
  trailingTrendPercentage: number;
}

export function useCashFlowMetrics() {
  const { selectedRestaurant } = useRestaurantContext();

  return useQuery({
    queryKey: ['cash-flow-metrics', selectedRestaurant?.restaurant_id],
    queryFn: async (): Promise<CashFlowMetrics> => {
      if (!selectedRestaurant?.restaurant_id) {
        throw new Error("No restaurant selected");
      }

      const now = new Date();
      const date7dAgo = subDays(now, 7);
      const date30dAgo = subDays(now, 30);
      const date60dAgo = subDays(now, 60);

      // Fetch transactions for the last 60 days (for trend comparison)
      const { data: transactions, error } = await supabase
        .from('bank_transactions')
        .select('transaction_date, amount, status')
        .eq('restaurant_id', selectedRestaurant.restaurant_id)
        .eq('status', 'posted')
        .gte('transaction_date', format(date60dAgo, 'yyyy-MM-dd'))
        .order('transaction_date', { ascending: true });

      if (error) throw error;

      const txns = transactions || [];

      // Calculate inflows and outflows for 7 days
      const netInflows7d = txns
        .filter(t => new Date(t.transaction_date) >= date7dAgo && t.amount > 0)
        .reduce((sum, t) => sum + t.amount, 0);

      const netOutflows7d = Math.abs(
        txns
          .filter(t => new Date(t.transaction_date) >= date7dAgo && t.amount < 0)
          .reduce((sum, t) => sum + t.amount, 0)
      );

      // Calculate inflows and outflows for 30 days
      const netInflows30d = txns
        .filter(t => new Date(t.transaction_date) >= date30dAgo && t.amount > 0)
        .reduce((sum, t) => sum + t.amount, 0);

      const netOutflows30d = Math.abs(
        txns
          .filter(t => new Date(t.transaction_date) >= date30dAgo && t.amount < 0)
          .reduce((sum, t) => sum + t.amount, 0)
      );

      const netCashFlow7d = netInflows7d - netOutflows7d;
      const netCashFlow30d = netInflows30d - netOutflows30d;
      const avgDailyCashFlow = netCashFlow30d / 30;

      // Calculate volatility (standard deviation of daily cash flows)
      const dailyFlows = new Map<string, number>();
      txns.forEach(t => {
        if (new Date(t.transaction_date) >= date30dAgo) {
          const dateKey = format(new Date(t.transaction_date), 'yyyy-MM-dd');
          dailyFlows.set(dateKey, (dailyFlows.get(dateKey) || 0) + t.amount);
        }
      });

      const flowValues = Array.from(dailyFlows.values());
      const meanFlow = flowValues.reduce((sum, val) => sum + val, 0) / flowValues.length;
      const variance = flowValues.reduce((sum, val) => sum + Math.pow(val - meanFlow, 2), 0) / flowValues.length;
      const volatility = Math.sqrt(variance);

      // Calculate 14-day trend for sparkline
      const date14dAgo = subDays(now, 14);
      const trendData = Array.from({ length: 14 }, (_, i) => {
        const date = subDays(now, 13 - i);
        const dateKey = format(date, 'yyyy-MM-dd');
        return dailyFlows.get(dateKey) || 0;
      });

      // Calculate trailing 3-month trend (compare last 30d to previous 30d)
      const inflowsPrevious30d = txns
        .filter(t => {
          const txnDate = new Date(t.transaction_date);
          return txnDate >= date60dAgo && txnDate < date30dAgo && t.amount > 0;
        })
        .reduce((sum, t) => sum + t.amount, 0);

      const trailingTrendPercentage = inflowsPrevious30d > 0 
        ? ((netInflows30d - inflowsPrevious30d) / inflowsPrevious30d) * 100
        : 0;

      return {
        netInflows7d,
        netInflows30d,
        netOutflows7d,
        netOutflows30d,
        netCashFlow7d,
        netCashFlow30d,
        avgDailyCashFlow,
        volatility,
        trend: trendData,
        trailingTrendPercentage,
      };
    },
    enabled: !!selectedRestaurant?.restaurant_id,
    staleTime: 30000, // 30 seconds
    refetchOnWindowFocus: true,
    refetchOnMount: true,
  });
}
