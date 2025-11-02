import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useRevenueBreakdown } from './useRevenueBreakdown';
import { format } from 'date-fns';

export interface PeriodMetrics {
  // Revenue from unified_sales (accurate source)
  collectedAtPOS: number;
  grossRevenue: number;
  discounts: number;
  refunds: number;
  netRevenue: number;
  categorizedRevenue: number;
  uncategorizedRevenue: number;
  
  // Costs from daily_pnl (still valid)
  foodCost: number;
  laborCost: number;
  primeCost: number;
  
  // Calculated metrics
  foodCostPercentage: number;
  laborCostPercentage: number;
  primeCostPercentage: number;
  grossProfit: number;
  profitMargin: number;
  
  // Liabilities (pass-through)
  salesTax: number;
  tips: number;
  otherLiabilities: number;
  
  // Period info
  periodStart: Date;
  periodEnd: Date;
  daysInPeriod: number;
  
  // Data availability flags
  hasRevenueData: boolean;
  hasCostData: boolean;
}

/**
 * Combined metrics hook that sources revenue from unified_sales and costs from daily_pnl.
 * This is the single source of truth for period financial metrics.
 * 
 * ✅ Use this hook for all period-based financial calculations
 * ❌ Do NOT use useDailyPnL or usePnLAnalytics for revenue calculations
 */
export function usePeriodMetrics(
  restaurantId: string | null,
  dateFrom: Date,
  dateTo: Date
): {
  data: PeriodMetrics | null;
  isLoading: boolean;
  error: Error | null;
  refetch: () => void;
} {
  // Get revenue from unified_sales (correct source: $10,950)
  const { data: revenueData, isLoading: revenueLoading, refetch: refetchRevenue } = useRevenueBreakdown(
    restaurantId,
    dateFrom,
    dateTo
  );
  
  // Get costs from daily_pnl (still valid for food/labor costs)
  const { data: costsData, isLoading: costsLoading, refetch: refetchCosts } = useQuery({
    queryKey: ['period-costs', restaurantId, format(dateFrom, 'yyyy-MM-dd'), format(dateTo, 'yyyy-MM-dd')],
    queryFn: async () => {
      if (!restaurantId) return null;
      
      const { data, error } = await supabase
        .from('daily_pnl')
        .select('food_cost, labor_cost')
        .eq('restaurant_id', restaurantId)
        .gte('date', format(dateFrom, 'yyyy-MM-dd'))
        .lte('date', format(dateTo, 'yyyy-MM-dd'));
      
      if (error) throw error;
      if (!data || data.length === 0) return null;
      
      return {
        totalFoodCost: data.reduce((sum, d) => sum + (d.food_cost || 0), 0),
        totalLaborCost: data.reduce((sum, d) => sum + (d.labor_cost || 0), 0),
      };
    },
    enabled: !!restaurantId,
    staleTime: 300000, // 5 minutes - reduce refetch frequency
    refetchOnWindowFocus: false, // Disable automatic refetch on window focus
    refetchOnMount: false, // Disable automatic refetch on mount
  });
  
  const metrics = useMemo((): PeriodMetrics | null => {
    if (!revenueData) {
      return null;
    }
    
    const netRevenue = revenueData.totals.net_revenue;
    const foodCost = costsData?.totalFoodCost || 0;
    const laborCost = costsData?.totalLaborCost || 0;
    const primeCost = foodCost + laborCost;
    
    // Calculate days in period (inclusive)
    const daysInPeriod = Math.max(1, Math.ceil((dateTo.getTime() - dateFrom.getTime()) / (1000 * 60 * 60 * 24)) + 1);
    
    return {
      collectedAtPOS: revenueData.totals.total_collected_at_pos,
      grossRevenue: revenueData.totals.gross_revenue,
      discounts: revenueData.totals.total_discounts,
      refunds: revenueData.totals.total_refunds,
      netRevenue,
      categorizedRevenue: revenueData.totals.categorized_revenue,
      uncategorizedRevenue: revenueData.totals.uncategorized_revenue,
      
      foodCost,
      laborCost,
      primeCost,
      
      foodCostPercentage: netRevenue > 0 ? (foodCost / netRevenue) * 100 : 0,
      laborCostPercentage: netRevenue > 0 ? (laborCost / netRevenue) * 100 : 0,
      primeCostPercentage: netRevenue > 0 ? (primeCost / netRevenue) * 100 : 0,
      grossProfit: netRevenue - primeCost,
      profitMargin: netRevenue > 0 ? ((netRevenue - primeCost) / netRevenue) * 100 : 0,
      
      salesTax: revenueData.totals.sales_tax,
      tips: revenueData.totals.tips,
      otherLiabilities: revenueData.totals.other_liabilities,
      
      periodStart: dateFrom,
      periodEnd: dateTo,
      daysInPeriod,
      
      hasRevenueData: revenueData.has_categorization_data || revenueData.totals.gross_revenue > 0,
      hasCostData: !!costsData,
    };
  }, [revenueData, costsData, dateFrom, dateTo]);
  
  const refetch = () => {
    refetchRevenue();
    refetchCosts();
  };
  
  return {
    data: metrics,
    isLoading: revenueLoading || costsLoading,
    error: null,
    refetch,
  };
}
