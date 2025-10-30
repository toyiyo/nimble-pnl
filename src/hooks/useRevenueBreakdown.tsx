import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';

export interface RevenueCategory {
  account_id: string;
  account_code: string;
  account_name: string;
  account_type: string;
  account_subtype: string;
  total_amount: number;
  transaction_count: number;
}

export function useRevenueBreakdown(
  restaurantId: string | null, 
  dateFrom: Date, 
  dateTo: Date
) {
  return useQuery({
    queryKey: ['revenue-breakdown', restaurantId, dateFrom, dateTo],
    queryFn: async () => {
      if (!restaurantId) return null;

      const fromStr = dateFrom.toISOString().split('T')[0];
      const toStr = dateTo.toISOString().split('T')[0];

      // Query unified_sales with category info
      const { data: sales, error } = await supabase
        .from('unified_sales')
        .select(`
          id,
          total_price,
          item_type,
          category_id,
          is_categorized,
          chart_account:chart_of_accounts!category_id (
            id,
            account_code,
            account_name,
            account_type,
            account_subtype
          )
        `)
        .eq('restaurant_id', restaurantId)
        .gte('sale_date', fromStr)
        .lte('sale_date', toStr)
        .eq('is_categorized', true);

      if (error) throw error;

      // Group by account
      const categoryMap = new Map<string, RevenueCategory>();

      sales?.forEach((sale: any) => {
        if (!sale.chart_account) return;

        const key = sale.chart_account.id;
        const existing = categoryMap.get(key);

        if (existing) {
          existing.total_amount += sale.total_price || 0;
          existing.transaction_count += 1;
        } else {
          categoryMap.set(key, {
            account_id: sale.chart_account.id,
            account_code: sale.chart_account.account_code,
            account_name: sale.chart_account.account_name,
            account_type: sale.chart_account.account_type,
            account_subtype: sale.chart_account.account_subtype,
            total_amount: sale.total_price || 0,
            transaction_count: 1,
          });
        }
      });

      const categories = Array.from(categoryMap.values());

      // Separate into revenue types
      const revenueCategories = categories.filter(c => c.account_type === 'revenue');
      const discountCategories = categories.filter(c => 
        c.account_subtype === 'discounts' || 
        c.account_name.toLowerCase().includes('discount') ||
        c.account_name.toLowerCase().includes('comp')
      );
      const taxCategories = categories.filter(c => 
        c.account_subtype === 'sales_tax' ||
        c.account_name.toLowerCase().includes('tax')
      );
      const tipCategories = categories.filter(c => 
        c.account_subtype === 'tips' ||
        c.account_name.toLowerCase().includes('tip')
      );

      // Calculate totals
      const grossRevenue = revenueCategories.reduce((sum, c) => sum + c.total_amount, 0);
      const totalDiscounts = discountCategories.reduce((sum, c) => sum + Math.abs(c.total_amount), 0);
      const totalTax = taxCategories.reduce((sum, c) => sum + c.total_amount, 0);
      const totalTips = tipCategories.reduce((sum, c) => sum + c.total_amount, 0);
      const netRevenue = grossRevenue - totalDiscounts;

      return {
        revenue_categories: revenueCategories.sort((a, b) => a.account_code.localeCompare(b.account_code)),
        discount_categories: discountCategories,
        tax_categories: taxCategories,
        tip_categories: tipCategories,
        totals: {
          gross_revenue: grossRevenue,
          total_discounts: totalDiscounts,
          net_revenue: netRevenue,
          sales_tax: totalTax,
          tips: totalTips,
        },
      };
    },
    enabled: !!restaurantId,
    staleTime: 30000,
  });
}
