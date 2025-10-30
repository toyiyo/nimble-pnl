import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';

export interface RevenueCategory {
  category_id: string | null;
  account_code: string;
  account_name: string;
  total: number;
}

export interface RevenueBreakdown {
  revenueCategories: RevenueCategory[];
  discountsAndComps: number;
  refunds: number;
  tips: number;
  salesTax: number;
  grossRevenue: number;
  netRevenue: number;
  hasCategorizationData: boolean;
}

export const useRevenueBreakdown = (
  restaurantId: string | null,
  dateFrom: Date,
  dateTo: Date
) => {
  return useQuery({
    queryKey: ['revenue-breakdown', restaurantId, dateFrom.toISOString(), dateTo.toISOString()],
    queryFn: async (): Promise<RevenueBreakdown> => {
      if (!restaurantId) {
        throw new Error('Restaurant ID is required');
      }

      const fromStr = dateFrom.toISOString().split('T')[0];
      const toStr = dateTo.toISOString().split('T')[0];

      // Query unified_sales with categorization data
      const { data: sales, error } = await supabase
        .from('unified_sales')
        .select(`
          id,
          total_price,
          item_type,
          category_id,
          is_categorized,
          chart_account:chart_of_accounts(
            id,
            account_code,
            account_name,
            account_type
          )
        `)
        .eq('restaurant_id', restaurantId)
        .gte('sale_date', fromStr)
        .lte('sale_date', toStr)
        .eq('is_categorized', true);

      if (error) throw error;

      // Check if we have any categorized data
      const hasCategorizationData = sales && sales.length > 0;

      if (!hasCategorizationData) {
        return {
          revenueCategories: [],
          discountsAndComps: 0,
          refunds: 0,
          tips: 0,
          salesTax: 0,
          grossRevenue: 0,
          netRevenue: 0,
          hasCategorizationData: false,
        };
      }

      // Aggregate by category and item type
      const categoryMap = new Map<string, { account_code: string; account_name: string; total: number }>();
      let discountsTotal = 0;
      let refundsTotal = 0;
      let tipsTotal = 0;
      let salesTaxTotal = 0;
      let grossRevenueTotal = 0;

      sales.forEach((sale: any) => {
        const amount = sale.total_price || 0;
        const itemType = sale.item_type || 'sale';
        const chartAccount = sale.chart_account;

        // Categorize by item type
        switch (itemType) {
          case 'discount':
          case 'comp':
            discountsTotal += amount;
            break;
          case 'tip':
            tipsTotal += amount;
            break;
          case 'tax':
            salesTaxTotal += amount;
            break;
          case 'sale':
          default:
            // Regular sales - group by category
            if (chartAccount && sale.category_id) {
              const key = `${chartAccount.account_code}-${chartAccount.account_name}`;
              const existing = categoryMap.get(key);
              if (existing) {
                existing.total += amount;
              } else {
                categoryMap.set(key, {
                  account_code: chartAccount.account_code,
                  account_name: chartAccount.account_name,
                  total: amount,
                });
              }
              grossRevenueTotal += amount;
            }
            break;
        }
      });

      // Convert map to array and sort by account code
      const revenueCategories: RevenueCategory[] = Array.from(categoryMap.values())
        .map((cat) => ({
          category_id: null, // We don't need the ID for display
          account_code: cat.account_code,
          account_name: cat.account_name,
          total: cat.total,
        }))
        .sort((a, b) => a.account_code.localeCompare(b.account_code));

      const netRevenue = grossRevenueTotal - discountsTotal - refundsTotal;

      return {
        revenueCategories,
        discountsAndComps: discountsTotal,
        refunds: refundsTotal,
        tips: tipsTotal,
        salesTax: salesTaxTotal,
        grossRevenue: grossRevenueTotal,
        netRevenue,
        hasCategorizationData: true,
      };
    },
    enabled: !!restaurantId,
    staleTime: 30000, // 30 seconds
    refetchOnWindowFocus: true,
  });
};
