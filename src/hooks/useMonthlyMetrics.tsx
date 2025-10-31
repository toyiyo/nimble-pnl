import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { format } from 'date-fns';

export interface MonthlyMetrics {
  period: string; // 'YYYY-MM'
  gross_revenue: number;
  total_collected_at_pos: number;
  net_revenue: number;
  discounts: number;
  refunds: number;
  sales_tax: number;
  tips: number;
  other_liabilities: number;
  food_cost: number;
  labor_cost: number;
  has_data: boolean;
}

/**
 * Hook to fetch monthly aggregated metrics from unified_sales (revenue + liabilities) 
 * and daily_pnl (costs). This is the correct source for monthly financial data.
 * 
 * ✅ Use this hook for monthly performance tables
 * ❌ Don't use getMonthlyData() from useDailyPnL (incorrect revenue)
 */
export function useMonthlyMetrics(
  restaurantId: string | null,
  dateFrom: Date,
  dateTo: Date
) {
  return useQuery({
    queryKey: ['monthly-metrics', restaurantId, format(dateFrom, 'yyyy-MM-dd'), format(dateTo, 'yyyy-MM-dd')],
    queryFn: async () => {
      if (!restaurantId) return [];

      // Fetch all sales from unified_sales (excluding child splits)
      const { data: salesData, error: salesError } = await supabase
        .from('unified_sales')
        .select(`
          sale_date,
          total_price,
          item_type,
          chart_of_accounts!unified_sales_category_id_fkey(
            account_type,
            account_subtype
          )
        `)
        .eq('restaurant_id', restaurantId)
        .gte('sale_date', format(dateFrom, 'yyyy-MM-dd'))
        .lte('sale_date', format(dateTo, 'yyyy-MM-dd'))
        .is('parent_sale_id', null); // Exclude child splits

      if (salesError) throw salesError;

      // Group sales by month and categorize
      const monthlyMap = new Map<string, MonthlyMetrics>();

      salesData?.forEach((sale) => {
        const monthKey = format(new Date(sale.sale_date), 'yyyy-MM');

        if (!monthlyMap.has(monthKey)) {
          monthlyMap.set(monthKey, {
            period: monthKey,
            gross_revenue: 0,
            total_collected_at_pos: 0,
            net_revenue: 0,
            discounts: 0,
            refunds: 0,
            sales_tax: 0,
            tips: 0,
            other_liabilities: 0,
            food_cost: 0,
            labor_cost: 0,
            has_data: false,
          });
        }

        const month = monthlyMap.get(monthKey)!;
        month.has_data = true;

        // Categorize based on item_type and account_type
        if (sale.item_type === 'sale') {
          if (sale.chart_of_accounts?.account_type === 'revenue') {
            month.gross_revenue += sale.total_price;
          } else if (sale.chart_of_accounts?.account_type === 'liability') {
            // Categorize liabilities by checking subtype
            const subtype = sale.chart_of_accounts?.account_subtype?.toLowerCase() || '';
            if (subtype.includes('sales') && subtype.includes('tax')) {
              month.sales_tax += sale.total_price;
            } else if (subtype.includes('tip')) {
              month.tips += sale.total_price;
            } else {
              month.other_liabilities += sale.total_price;
            }
          }
        } else if (sale.item_type === 'discount') {
          month.discounts += Math.abs(sale.total_price);
        } else if (sale.item_type === 'refund') {
          month.refunds += Math.abs(sale.total_price);
        }
      });

      // Fetch costs from daily_pnl
      const { data: costsData, error: costsError } = await supabase
        .from('daily_pnl')
        .select('date, food_cost, labor_cost')
        .eq('restaurant_id', restaurantId)
        .gte('date', format(dateFrom, 'yyyy-MM-dd'))
        .lte('date', format(dateTo, 'yyyy-MM-dd'));

      if (costsError) throw costsError;

      // Aggregate costs by month
      costsData?.forEach((day) => {
        const monthKey = format(new Date(day.date), 'yyyy-MM');
        
        if (!monthlyMap.has(monthKey)) {
          monthlyMap.set(monthKey, {
            period: monthKey,
            gross_revenue: 0,
            total_collected_at_pos: 0,
            net_revenue: 0,
            discounts: 0,
            refunds: 0,
            sales_tax: 0,
            tips: 0,
            other_liabilities: 0,
            food_cost: 0,
            labor_cost: 0,
            has_data: true,
          });
        }

        const month = monthlyMap.get(monthKey)!;
        month.food_cost += day.food_cost || 0;
        month.labor_cost += day.labor_cost || 0;
      });

      // Calculate net_revenue and total_collected_at_pos for each month
      const result = Array.from(monthlyMap.values()).map((month) => ({
        ...month,
        net_revenue: month.gross_revenue - month.discounts - month.refunds,
        total_collected_at_pos:
          month.gross_revenue + month.sales_tax + month.tips + month.other_liabilities,
      }));

      // Sort by period descending (most recent first)
      return result.sort((a, b) => b.period.localeCompare(a.period));
    },
    enabled: !!restaurantId,
    staleTime: 30000,
    refetchOnWindowFocus: true,
  });
}
