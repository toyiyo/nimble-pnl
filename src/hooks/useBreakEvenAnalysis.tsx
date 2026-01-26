import { useQuery } from '@tanstack/react-query';
import { useMemo } from 'react';
import { format, subDays, startOfDay, endOfDay, differenceInDays, subMonths } from 'date-fns';
import { supabase } from '@/integrations/supabase/client';
import { useOperatingCosts } from './useOperatingCosts';
import { BreakEvenData, CostBreakdownItem } from '@/types/operatingCosts';

interface DailySalesData {
  date: string;
  netRevenue: number;
}

/**
 * Fetches daily sales for a date range from unified_sales
 */
async function fetchDailySales(
  restaurantId: string,
  startDate: Date,
  endDate: Date
): Promise<DailySalesData[]> {
  const { data, error } = await supabase
    .from('unified_sales')
    .select('sale_date, total_price')
    .eq('restaurant_id', restaurantId)
    .gte('sale_date', format(startDate, 'yyyy-MM-dd'))
    .lte('sale_date', format(endDate, 'yyyy-MM-dd'));
  
  if (error) throw error;
  
  // Aggregate by date
  const byDate: Record<string, number> = {};
  for (const row of data || []) {
    const date = row.sale_date;
    byDate[date] = (byDate[date] || 0) + (Number(row.total_price) || 0);
  }
  
  // Fill in missing dates with 0
  const result: DailySalesData[] = [];
  let current = new Date(startDate);
  while (current <= endDate) {
    const dateStr = format(current, 'yyyy-MM-dd');
    result.push({
      date: dateStr,
      netRevenue: byDate[dateStr] || 0,
    });
    current = new Date(current.getTime() + 24 * 60 * 60 * 1000);
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
) {
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
    
    // Calculate average daily sales for percentage-based costs
    const totalSales = salesData.reduce((sum, d) => sum + d.netRevenue, 0);
    const avgDailySales = totalSales / salesData.length;
    
    // Today's sales
    const todayStr = format(today, 'yyyy-MM-dd');
    const todaySalesEntry = salesData.find(d => d.date === todayStr);
    const todaySales = todaySalesEntry?.netRevenue || 0;
    
    // Process costs by type
    const fixedItems: CostBreakdownItem[] = [];
    const semiVariableItems: CostBreakdownItem[] = [];
    const variableItems: CostBreakdownItem[] = [];
    const customItems: CostBreakdownItem[] = [];
    
    for (const cost of costs) {
      const isPercentage = cost.entryType === 'percentage';
      let daily: number;
      let monthly: number;
      
      if (isPercentage) {
        // Percentage-based: calculate from average sales
        daily = avgDailySales * cost.percentageValue;
        monthly = daily * 30;
      } else {
        // Value-based: convert from cents to dollars, prorate to daily
        monthly = cost.monthlyValue / 100;
        daily = monthly / 30;
      }
      
      // For semi-variable costs that are auto-calculated, use the calculated value
      if (cost.costType === 'semi_variable' && cost.isAutoCalculated && !cost.manualOverride && autoUtilityCosts) {
        // Distribute auto-calculated utilities evenly across utility items
        const utilityItems = costs.filter(c => c.costType === 'semi_variable' && c.isAutoCalculated && !c.manualOverride);
        if (utilityItems.length > 0) {
          monthly = (autoUtilityCosts / 100) / utilityItems.length;
          daily = monthly / 30;
        }
      }
      
      const item: CostBreakdownItem = {
        id: cost.id,
        name: cost.name,
        category: cost.category,
        daily,
        monthly,
        percentage: isPercentage ? cost.percentageValue * 100 : undefined,
        isPercentage,
        source: cost.manualOverride || !cost.isAutoCalculated ? 'manual' : 'calculated',
      };
      
      switch (cost.costType) {
        case 'fixed':
          fixedItems.push(item);
          break;
        case 'semi_variable':
          semiVariableItems.push(item);
          break;
        case 'variable':
          variableItems.push(item);
          break;
        case 'custom':
          customItems.push(item);
          break;
      }
    }
    
    // Calculate totals
    const fixedDaily = fixedItems.reduce((sum, i) => sum + i.daily, 0);
    const semiVariableDaily = semiVariableItems.reduce((sum, i) => sum + i.daily, 0);
    const variableDaily = variableItems.reduce((sum, i) => sum + i.daily, 0);
    const customDaily = customItems.reduce((sum, i) => sum + i.daily, 0);
    const dailyBreakEven = fixedDaily + semiVariableDaily + variableDaily + customDaily;
    
    // Today's status
    const todayDelta = todaySales - dailyBreakEven;
    const todayStatus: 'above' | 'at' | 'below' = 
      todayDelta > dailyBreakEven * 0.05 ? 'above' :
      todayDelta < -dailyBreakEven * 0.05 ? 'below' : 'at';
    
    // Build history
    const history = salesData.map(d => {
      const delta = d.netRevenue - dailyBreakEven;
      const status: 'above' | 'at' | 'below' = 
        delta > dailyBreakEven * 0.05 ? 'above' :
        delta < -dailyBreakEven * 0.05 ? 'below' : 'at';
      
      return {
        date: d.date,
        sales: d.netRevenue,
        breakEven: dailyBreakEven,
        delta,
        status,
      };
    });
    
    // Summary stats
    const aboveDays = history.filter(h => h.status === 'above');
    const belowDays = history.filter(h => h.status === 'below');
    
    const daysAbove = aboveDays.length;
    const daysBelow = belowDays.length;
    const avgSurplus = aboveDays.length > 0 
      ? aboveDays.reduce((sum, h) => sum + h.delta, 0) / aboveDays.length 
      : 0;
    const avgShortfall = belowDays.length > 0 
      ? belowDays.reduce((sum, h) => sum + h.delta, 0) / belowDays.length 
      : 0;
    
    return {
      dailyBreakEven,
      todaySales,
      todayStatus,
      todayDelta,
      fixedCosts: {
        items: fixedItems,
        totalDaily: fixedDaily,
      },
      semiVariableCosts: {
        items: semiVariableItems,
        totalDaily: semiVariableDaily,
        monthsAveraged: 3,
      },
      variableCosts: {
        items: variableItems,
        totalDaily: variableDaily,
        avgDailySales,
      },
      customCosts: {
        items: customItems,
        totalDaily: customDaily,
      },
      history,
      daysAbove,
      daysBelow,
      avgSurplus,
      avgShortfall,
    };
  }, [restaurantId, costs, salesData, autoUtilityCosts, today]);
  
  return {
    data: breakEvenData,
    isLoading: costsLoading || salesLoading || utilitiesLoading,
    error: salesError,
  };
}
