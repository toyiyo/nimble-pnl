import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useRestaurantContext } from "@/contexts/RestaurantContext";
import { subDays, differenceInDays, format, startOfDay, endOfDay, parseISO } from "date-fns";

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

export function useCashFlowMetrics(startDate: Date, endDate: Date, bankAccountId: string = 'all') {
  const { selectedRestaurant } = useRestaurantContext();

  return useQuery({
    queryKey: ['cash-flow-metrics', selectedRestaurant?.restaurant_id, format(startDate, 'yyyy-MM-dd'), format(endDate, 'yyyy-MM-dd'), bankAccountId],
    queryFn: async (): Promise<CashFlowMetrics> => {
      if (!selectedRestaurant?.restaurant_id) {
        throw new Error("No restaurant selected");
      }

      const periodDays = differenceInDays(endDate, startDate) + 1;
      const comparisonStartDate = subDays(startDate, periodDays);
      
      // Fetch transactions for the selected period + comparison period
      let query = supabase
        .from('bank_transactions')
        .select('transaction_date, amount, status')
        .eq('restaurant_id', selectedRestaurant.restaurant_id)
        .eq('status', 'posted')
        .gte('transaction_date', format(comparisonStartDate, 'yyyy-MM-dd'))
        .lte('transaction_date', format(endDate, 'yyyy-MM-dd'));

      // Apply bank account filter if specified
      if (bankAccountId && bankAccountId !== 'all') {
        query = query.eq('connected_bank_id', bankAccountId);
      }

      const { data: transactions, error } = await query.order('transaction_date', { ascending: true });

      if (error) throw error;

      const txns = transactions || [];
      
      // Filter transactions for current period (inclusive)
      const currentPeriodTxns = txns.filter(t => {
        const txnDate = parseISO(t.transaction_date);
        return txnDate >= startOfDay(startDate) && txnDate <= endOfDay(endDate);
      });
      
      // Filter transactions for comparison period
      const comparisonPeriodTxns = txns.filter(t => {
        const txnDate = parseISO(t.transaction_date);
        return txnDate >= startOfDay(comparisonStartDate) && txnDate < startOfDay(startDate);
      });

      // Calculate metrics for current period
      const netInflows30d = currentPeriodTxns
        .filter(t => t.amount > 0)
        .reduce((sum, t) => sum + t.amount, 0);

      const netOutflows30d = Math.abs(
        currentPeriodTxns
          .filter(t => t.amount < 0)
          .reduce((sum, t) => sum + t.amount, 0)
      );

      // For 7-day metrics, use last 7 days of the period
      const last7DaysStart = subDays(endDate, 6);
      const last7DaysTxns = currentPeriodTxns.filter(t => {
        const txnDate = parseISO(t.transaction_date);
        return txnDate >= startOfDay(last7DaysStart);
      });

      const netInflows7d = last7DaysTxns
        .filter(t => t.amount > 0)
        .reduce((sum, t) => sum + t.amount, 0);

      const netOutflows7d = Math.abs(
        last7DaysTxns
          .filter(t => t.amount < 0)
          .reduce((sum, t) => sum + t.amount, 0)
      );

      const netCashFlow7d = netInflows7d - netOutflows7d;
      const netCashFlow30d = netInflows30d - netOutflows30d;
      const avgDailyCashFlow = netCashFlow30d / periodDays;

      // Calculate volatility (standard deviation of daily cash flows)
      const dailyFlows = new Map<string, number>();
      currentPeriodTxns.forEach(t => {
        const dateKey = format(parseISO(t.transaction_date), 'yyyy-MM-dd');
        dailyFlows.set(dateKey, (dailyFlows.get(dateKey) || 0) + t.amount);
      });

      const flowValues = Array.from(dailyFlows.values());
      const meanFlow = flowValues.length > 0 ? flowValues.reduce((sum, val) => sum + val, 0) / flowValues.length : 0;
      const variance = flowValues.length > 0 ? flowValues.reduce((sum, val) => sum + Math.pow(val - meanFlow, 2), 0) / flowValues.length : 0;
      const volatility = Math.sqrt(variance);

      // Calculate trend for sparkline (last 14 days or period length, whichever is smaller)
      const trendDays = Math.min(14, periodDays);
      const trendData = Array.from({ length: trendDays }, (_, i) => {
        const date = subDays(endDate, trendDays - 1 - i);
        const dateKey = format(date, 'yyyy-MM-dd');
        return dailyFlows.get(dateKey) || 0;
      });

      // Calculate trailing trend (compare current period to previous equal-length period)
      const inflowsPreviousPeriod = comparisonPeriodTxns
        .filter(t => t.amount > 0)
        .reduce((sum, t) => sum + t.amount, 0);

      const trailingTrendPercentage = inflowsPreviousPeriod > 0 
        ? ((netInflows30d - inflowsPreviousPeriod) / inflowsPreviousPeriod) * 100
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
