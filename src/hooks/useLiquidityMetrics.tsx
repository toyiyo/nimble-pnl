import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useRestaurantContext } from "@/contexts/RestaurantContext";
import { format, differenceInDays, addDays, subDays, parseISO } from "date-fns";

interface LiquidityMetrics {
  currentBalance: number;
  daysOfCash: number;
  projectedZeroDate: Date | null;
  avgDailyOutflow: number;
  avgWeeklyOutflow: number;
  cashBurnRate: number;
  burnRateTrend: number[];
  runwayStatus: 'healthy' | 'caution' | 'critical';
  recommendation: string;
}

export function useLiquidityMetrics(startDate: Date, endDate: Date) {
  const { selectedRestaurant } = useRestaurantContext();

  return useQuery({
    queryKey: ['liquidity-metrics', selectedRestaurant?.restaurant_id, format(startDate, 'yyyy-MM-dd'), format(endDate, 'yyyy-MM-dd')],
    queryFn: async (): Promise<LiquidityMetrics> => {
      if (!selectedRestaurant?.restaurant_id) {
        throw new Error("No restaurant selected");
      }

      // Fetch all transactions up to endDate to calculate balance
      const { data: allTransactions, error: allError } = await supabase
        .from('bank_transactions')
        .select('transaction_date, amount, status')
        .eq('restaurant_id', selectedRestaurant.restaurant_id)
        .eq('status', 'posted')
        .lte('transaction_date', format(endDate, 'yyyy-MM-dd'))
        .order('transaction_date', { ascending: true });

      if (allError) throw allError;

      const allTxns = allTransactions || [];

      // Calculate current balance (cumulative sum of all transactions)
      const currentBalance = allTxns.reduce((sum, t) => sum + t.amount, 0);

      // Fetch recent outflows for burn rate calculation
      const periodDays = differenceInDays(endDate, startDate) + 1;
      
      const { data: periodTransactions, error: periodError } = await supabase
        .from('bank_transactions')
        .select('transaction_date, amount, status')
        .eq('restaurant_id', selectedRestaurant.restaurant_id)
        .eq('status', 'posted')
        .gte('transaction_date', format(startDate, 'yyyy-MM-dd'))
        .lte('transaction_date', format(endDate, 'yyyy-MM-dd'))
        .order('transaction_date', { ascending: true });

      if (periodError) throw periodError;

      const periodTxns = periodTransactions || [];

      // Calculate outflows and inflows for period
      const outflows = periodTxns
        .filter(t => t.amount < 0)
        .reduce((sum, t) => sum + Math.abs(t.amount), 0);

      const inflows = periodTxns
        .filter(t => t.amount > 0)
        .reduce((sum, t) => sum + t.amount, 0);

      const avgDailyOutflow = outflows / periodDays;
      const avgWeeklyOutflow = avgDailyOutflow * 7;

      // Cash burn rate (net outflow per week)
      const avgWeeklyInflow = (inflows / periodDays) * 7;
      const cashBurnRate = avgWeeklyOutflow - avgWeeklyInflow;

      // Days of cash remaining
      const daysOfCash = avgDailyOutflow > 0 ? currentBalance / avgDailyOutflow : 999;

      // Projected zero date
      const projectedZeroDate = daysOfCash < 999 && daysOfCash > 0
        ? addDays(endDate, Math.floor(daysOfCash))
        : null;

      // Burn rate trend (last 8 weeks)
      const weeksToAnalyze = Math.min(8, Math.floor(periodDays / 7));
      const burnRateTrend: number[] = [];

      for (let i = 0; i < weeksToAnalyze; i++) {
        const weekEnd = subDays(endDate, i * 7);
        const weekStart = subDays(weekEnd, 6);

        const weekTxns = periodTxns.filter(t => {
          const txnDate = parseISO(t.transaction_date);
          return txnDate >= weekStart && txnDate <= weekEnd;
        });

        const weekOutflow = weekTxns
          .filter(t => t.amount < 0)
          .reduce((sum, t) => sum + Math.abs(t.amount), 0);

        const weekInflow = weekTxns
          .filter(t => t.amount > 0)
          .reduce((sum, t) => sum + t.amount, 0);

        burnRateTrend.unshift(weekOutflow - weekInflow);
      }

      // Runway status
      let runwayStatus: 'healthy' | 'caution' | 'critical' = 'healthy';
      if (daysOfCash < 30) runwayStatus = 'critical';
      else if (daysOfCash < 60) runwayStatus = 'caution';

      // Recommendation
      let recommendation = '';
      if (runwayStatus === 'critical') {
        recommendation = `Critical: Only ${Math.floor(daysOfCash)} days of cash. Reduce weekly burn by $${Math.round(cashBurnRate * 0.3)} or increase revenue.`;
      } else if (runwayStatus === 'caution') {
        recommendation = `Caution: ${Math.floor(daysOfCash)} days remaining. Monitor cash flow closely and consider reducing expenses by $${Math.round(avgWeeklyOutflow * 0.1)}/week.`;
      } else {
        recommendation = `Healthy: ${Math.floor(daysOfCash)} days of runway. Continue monitoring weekly trends.`;
      }

      return {
        currentBalance,
        daysOfCash,
        projectedZeroDate,
        avgDailyOutflow,
        avgWeeklyOutflow,
        cashBurnRate,
        burnRateTrend,
        runwayStatus,
        recommendation,
      };
    },
    enabled: !!selectedRestaurant?.restaurant_id,
    staleTime: 30000,
    refetchOnWindowFocus: true,
    refetchOnMount: true,
  });
}
