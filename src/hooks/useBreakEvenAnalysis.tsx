import { useQuery } from '@tanstack/react-query';
import { useMemo } from 'react';
import { addDays, format, subDays, startOfDay, differenceInDays, subMonths } from 'date-fns';
import { supabase } from '@/integrations/supabase/client';
import { useOperatingCosts } from './useOperatingCosts';
import { BreakEvenData } from '@/types/operatingCosts';
import { calculateBreakEven } from '@/lib/breakEvenCalculator';

interface DailySalesData {
  date: string;
  netRevenue: number;
  transactionCount: number;
}

/**
 * Fetches daily sales for a date range using server-side RPC aggregation
 */
async function fetchDailySales(
  restaurantId: string,
  startDate: Date,
  endDate: Date
): Promise<DailySalesData[]> {
  const { data, error } = await supabase.rpc('get_daily_sales_totals', {
    p_restaurant_id: restaurantId,
    p_date_from: format(startDate, 'yyyy-MM-dd'),
    p_date_to: format(endDate, 'yyyy-MM-dd'),
  });

  if (error) throw error;

  // Build lookup from RPC results
  const byDate: Record<string, { revenue: number; count: number }> = {};
  for (const row of data || []) {
    byDate[row.sale_date] = {
      revenue: Number(row.total_revenue) || 0,
      count: Number(row.transaction_count) || 0,
    };
  }

  // Fill in missing dates with 0
  const result: DailySalesData[] = [];
  let current = new Date(startDate);
  while (current <= endDate) {
    const dateStr = format(current, 'yyyy-MM-dd');
    const entry = byDate[dateStr];
    result.push({
      date: dateStr,
      netRevenue: entry?.revenue || 0,
      transactionCount: entry?.count || 0,
    });
    current = addDays(current, 1);
  }

  return result;
}

/**
 * Calculate utility costs from bank transactions (for auto-calculated items)
 */
async function calculateUtilityCostsFromHistory(
  restaurantId: string,
  monthsBack: number = 3
): Promise<number> {
  const endDate = new Date();
  const startDate = subMonths(endDate, monthsBack);
  
  // Query bank transactions where category is utilities
  const { data, error } = await supabase
    .from('bank_transactions')
    .select(`
      amount,
      transaction_date,
      category_id,
      chart_of_accounts!category_id(account_subtype)
    `)
    .eq('restaurant_id', restaurantId)
    .gte('transaction_date', format(startDate, 'yyyy-MM-dd'))
    .lt('amount', 0); // Outflows only
  
  if (error) {
    console.error('Error fetching utility transactions:', error);
    return 0;
  }
  
  // Filter for utility transactions and sum
  const utilityTotal = (data || [])
    .filter(t => t.chart_of_accounts?.account_subtype === 'utilities')
    .reduce((sum, t) => sum + Math.abs(t.amount), 0);
  
  // Convert to monthly average (in cents)
  const days = differenceInDays(endDate, startDate) || 1;
  const monthlyAvg = (utilityTotal / days) * 30;
  
  return Math.round(monthlyAvg * 100); // Convert to cents
}

export function useBreakEvenAnalysis(
  restaurantId: string | null,
  historyDays: number = 14
): { data: BreakEvenData | null; isLoading: boolean; error: Error | null } {
  const { costs, isLoading: costsLoading } = useOperatingCosts(restaurantId);
  
  const today = useMemo(() => startOfDay(new Date()), []);
  const historyStart = useMemo(() => subDays(today, historyDays - 1), [today, historyDays]);
  
  // Fetch daily sales data
  const {
    data: salesData,
    isLoading: salesLoading,
    error: salesError,
  } = useQuery({
    queryKey: ['breakEvenSales', restaurantId, format(historyStart, 'yyyy-MM-dd'), format(today, 'yyyy-MM-dd')],
    queryFn: () => fetchDailySales(restaurantId!, historyStart, today),
    enabled: !!restaurantId,
    staleTime: 60000,
    refetchOnWindowFocus: true,
  });
  
  // Fetch auto-calculated utility costs
  const {
    data: autoUtilityCosts,
    isLoading: utilitiesLoading,
  } = useQuery({
    queryKey: ['autoUtilityCosts', restaurantId],
    queryFn: () => calculateUtilityCostsFromHistory(restaurantId!, 3),
    enabled: !!restaurantId,
    staleTime: 300000, // 5 minutes - utilities don't change often
  });
  
  // Calculate break-even data
  const breakEvenData = useMemo((): BreakEvenData | null => {
    if (!restaurantId || !salesData || salesData.length === 0) {
      return null;
    }
    const todayStr = format(today, 'yyyy-MM-dd');
    return calculateBreakEven(costs, salesData, autoUtilityCosts ?? 0, todayStr);
  }, [restaurantId, costs, salesData, autoUtilityCosts, today]);
  
  return {
    data: breakEvenData,
    isLoading: costsLoading || salesLoading || utilitiesLoading,
    error: salesError,
  };
}
