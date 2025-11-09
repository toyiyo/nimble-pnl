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

      // Fetch all sales to properly handle split sales (use LEFT JOIN to include uncategorized)
      const { data: salesData, error: salesError } = await supabase
        .from('unified_sales')
        .select(`
          id,
          sale_date,
          total_price,
          item_type,
          parent_sale_id,
          is_categorized,
          chart_account:chart_of_accounts!category_id(
            account_type,
            account_subtype,
            account_name
          )
        `)
        .eq('restaurant_id', restaurantId)
        .gte('sale_date', format(dateFrom, 'yyyy-MM-dd'))
        .lte('sale_date', format(dateTo, 'yyyy-MM-dd'));

      if (salesError) throw salesError;

      // Filter out parent sales that have been split into children
      // Include: unsplit sales (no children) + all child splits
      const parentIdsWithChildren = new Set(
        salesData
          ?.filter((s: any) => s.parent_sale_id !== null)
          .map((s: any) => s.parent_sale_id) || []
      );

      const filteredSales = salesData?.filter((s: any) => 
        !parentIdsWithChildren.has(s.id)
      ) || [];

      // Group sales by month and categorize
      const monthlyMap = new Map<string, MonthlyMetrics>();

      filteredSales?.forEach((sale) => {
        // Parse date as local date, not UTC midnight
        const [year, monthNum, day] = sale.sale_date.split('-').map(Number);
        const localDate = new Date(year, monthNum - 1, day);
        const monthKey = format(localDate, 'yyyy-MM');

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

        // Only process categorized sales (skip uncategorized to match useRevenueBreakdown logic)
        if (!sale.is_categorized || !sale.chart_account) {
          // Uncategorized sales are treated as revenue for reporting purposes
          if (sale.item_type === 'sale' || !sale.item_type) {
            month.gross_revenue += Math.round(sale.total_price * 100);
          }
          return;
        }

        // Categorize based on item_type and account_type
        // Use cents to avoid floating-point precision errors
        if (sale.item_type === 'sale' || !sale.item_type) {
          if (sale.chart_account.account_type === 'revenue') {
            month.gross_revenue += Math.round(sale.total_price * 100);
          } else if (sale.chart_account.account_type === 'liability') {
            // Categorize liabilities by checking BOTH subtype and account_name
            const subtype = sale.chart_account.account_subtype?.toLowerCase() || '';
            const accountName = sale.chart_account.account_name?.toLowerCase() || '';

            if ((subtype.includes('sales') && subtype.includes('tax')) ||
                (accountName.includes('sales') && accountName.includes('tax'))) {
              month.sales_tax += Math.round(sale.total_price * 100);
            } else if (subtype.includes('tip') || accountName.includes('tip')) {
              month.tips += Math.round(sale.total_price * 100);
            } else {
              month.other_liabilities += Math.round(sale.total_price * 100);
            }
          }
        } else if (sale.item_type === 'discount') {
          month.discounts += Math.round(Math.abs(sale.total_price) * 100);
        } else if (sale.item_type === 'refund') {
          month.refunds += Math.round(Math.abs(sale.total_price) * 100);
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
        // Parse date as local date, not UTC midnight
        const [year, monthNum, dayNum] = day.date.split('-').map(Number);
        const localDate = new Date(year, monthNum - 1, dayNum);
        const monthKey = format(localDate, 'yyyy-MM');
        
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
        // Use cents to avoid floating-point precision errors
        month.food_cost += Math.round((day.food_cost || 0) * 100);
        month.labor_cost += Math.round((day.labor_cost || 0) * 100);
      });

      // Calculate net_revenue and total_collected_at_pos for each month
      // Convert from cents back to dollars
      const result = Array.from(monthlyMap.values()).map((month) => ({
        period: month.period,
        gross_revenue: Math.round(month.gross_revenue) / 100,
        discounts: Math.round(month.discounts) / 100,
        refunds: Math.round(month.refunds) / 100,
        sales_tax: Math.round(month.sales_tax) / 100,
        tips: Math.round(month.tips) / 100,
        other_liabilities: Math.round(month.other_liabilities) / 100,
        food_cost: Math.round(month.food_cost) / 100,
        labor_cost: Math.round(month.labor_cost) / 100,
        has_data: month.has_data,
        net_revenue: Math.round(month.gross_revenue - month.discounts - month.refunds) / 100,
        total_collected_at_pos: Math.round(month.gross_revenue + month.sales_tax + month.tips + month.other_liabilities) / 100,
      }));

      // Sort by period descending (most recent first)
      return result.sort((a, b) => b.period.localeCompare(a.period));
    },
    enabled: !!restaurantId,
    staleTime: 30000,
    refetchOnWindowFocus: true,
  });
}
