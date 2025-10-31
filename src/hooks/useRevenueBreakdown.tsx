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

export interface RevenueBreakdownData {
  revenue_categories: RevenueCategory[];
  discount_categories: RevenueCategory[];
  refund_categories: RevenueCategory[];
  tax_categories: RevenueCategory[];
  tip_categories: RevenueCategory[];
  other_liability_categories: RevenueCategory[];
  uncategorized_revenue: number;
  totals: {
    total_collected_at_pos: number;
    gross_revenue: number;
    categorized_revenue: number;
    uncategorized_revenue: number;
    total_discounts: number;
    total_refunds: number;
    net_revenue: number;
    sales_tax: number;
    tips: number;
    other_liabilities: number;
  };
  has_categorization_data: boolean;
  categorization_rate: number;
}

export function useRevenueBreakdown(
  restaurantId: string | null, 
  dateFrom: Date, 
  dateTo: Date
) {
  return useQuery({
    queryKey: ['revenue-breakdown', restaurantId, dateFrom, dateTo],
    queryFn: async (): Promise<RevenueBreakdownData | null> => {
      if (!restaurantId) return null;

      // Integer cents helpers to eliminate floating-point errors
      const toC = (n: number) => Math.round((n || 0) * 100);
      const fromC = (c: number) => Math.round(c) / 100;

      const fromStr = dateFrom.toISOString().split('T')[0];
      const toStr = dateTo.toISOString().split('T')[0];

      // Query ALL unified_sales to properly handle split sales
      const { data: sales, error } = await supabase
        .from('unified_sales')
        .select(`
          id,
          total_price,
          item_type,
          category_id,
          is_categorized,
          parent_sale_id,
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
        .lte('sale_date', toStr);

      if (error) throw error;

      // Filter out parent sales that have been split into children
      // Include: unsplit sales (no children) + all child splits
      const parentIdsWithChildren = new Set(
        sales
          ?.filter((s: any) => s.parent_sale_id !== null)
          .map((s: any) => s.parent_sale_id) || []
      );

      const filteredSales = sales?.filter((s: any) => 
        !parentIdsWithChildren.has(s.id)
      ) || [];

      const totalCount = filteredSales.length;

      // Separate categorized and uncategorized sales
      const categorizedSales = filteredSales?.filter((s: any) => s.is_categorized && s.chart_account) || [];
      // Only include actual 'sale' items in uncategorized (exclude refunds, voids, pass-throughs)
      const uncategorizedSales = filteredSales?.filter((s: any) => 
        !s.is_categorized && String(s.item_type || 'sale').toLowerCase() === 'sale'
      ) || [];
      
      const hasCategorizationData = categorizedSales.length > 0;

      // Calculate uncategorized revenue in cents early for empty state check
      const uncategorizedRevenueC = uncategorizedSales.reduce((sum: number, sale: any) => 
        sum + toC(sale.total_price || 0), 0
      );
      const uncategorizedRevenue = fromC(uncategorizedRevenueC);

      if (!hasCategorizationData && uncategorizedRevenue === 0) {
        return {
          revenue_categories: [],
          discount_categories: [],
          refund_categories: [],
          tax_categories: [],
          tip_categories: [],
          other_liability_categories: [],
          uncategorized_revenue: 0,
          totals: {
            total_collected_at_pos: 0,
            gross_revenue: 0,
            categorized_revenue: 0,
            uncategorized_revenue: 0,
            total_discounts: 0,
            total_refunds: 0,
            net_revenue: 0,
            sales_tax: 0,
            tips: 0,
            other_liabilities: 0,
          },
          has_categorization_data: false,
          categorization_rate: 0,
        };
      }

      // Group by account and item type (only categorized sales)
      const categoryMap = new Map<string, RevenueCategory>();

      categorizedSales.forEach((sale: any) => {
        if (!sale.chart_account) return;

        const key = `${sale.chart_account.id}-${sale.item_type || 'sale'}`;
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

      // Separate into different types based on account_type and item_type
      const revenueCategories = categories.filter(c => 
        c.account_type === 'revenue' && 
        c.account_subtype !== 'discounts' &&
        c.account_subtype !== 'sales_tax' && // Exclude sales tax from revenue
        !c.account_name.toLowerCase().includes('discount') &&
        !c.account_name.toLowerCase().includes('comp') &&
        !c.account_name.toLowerCase().includes('refund') &&
        !c.account_name.toLowerCase().includes('tax') // Exclude any tax-related accounts
      );

      const discountCategories = categories.filter(c => 
        c.account_subtype === 'discounts' || 
        c.account_name.toLowerCase().includes('discount') ||
        c.account_name.toLowerCase().includes('comp')
      );

      const refundCategories = categories.filter(c =>
        c.account_name.toLowerCase().includes('refund') ||
        c.account_name.toLowerCase().includes('return')
      );

      const taxCategories = categories.filter(c => 
        c.account_type === 'liability' && (
          c.account_subtype === 'sales_tax' ||
          c.account_name.toLowerCase().includes('tax')
        )
      );

      const tipCategories = categories.filter(c => 
        c.account_type === 'liability' && (
          c.account_subtype === 'tips' ||
          c.account_name.toLowerCase().includes('tip')
        )
      );

      // Other liability accounts (franchise fees, notes payable, etc.)
      const otherLiabilityCategories = categories.filter(c =>
        c.account_type === 'liability' &&
        c.account_subtype !== 'sales_tax' &&
        c.account_subtype !== 'tips' &&
        !c.account_name.toLowerCase().includes('tax') &&
        !c.account_name.toLowerCase().includes('tip')
      );

      // Calculate totals in cents (integers) to eliminate floating-point errors
      const categorizedRevenueC = revenueCategories.reduce((sum, c) => sum + toC(c.total_amount || 0), 0);
      const totalDiscountsC = discountCategories.reduce((sum, c) => sum + Math.abs(toC(c.total_amount || 0)), 0);
      const totalRefundsC = refundCategories.reduce((sum, c) => sum + Math.abs(toC(c.total_amount || 0)), 0);
      const totalTaxC = taxCategories.reduce((sum, c) => sum + toC(c.total_amount || 0), 0);
      const totalTipsC = tipCategories.reduce((sum, c) => sum + toC(c.total_amount || 0), 0);
      const totalOtherLiabilitiesC = otherLiabilityCategories.reduce((sum, c) => sum + toC(c.total_amount || 0), 0);
      
      // Totals in cents
      const grossRevenueC = categorizedRevenueC + uncategorizedRevenueC;
      const netRevenueC = grossRevenueC - totalDiscountsC - totalRefundsC;
      
      // Convert once to dollars for output
      const categorizedRevenue = fromC(categorizedRevenueC);
      const grossRevenue = fromC(grossRevenueC);
      const totalDiscounts = fromC(totalDiscountsC);
      const totalRefunds = fromC(totalRefundsC);
      const netRevenue = fromC(netRevenueC);
      const totalTax = fromC(totalTaxC);
      const totalTips = fromC(totalTipsC);
      const totalOtherLiabilities = fromC(totalOtherLiabilitiesC);
      
      // Calculate total collected at POS (revenue + pass-through collections)
      const totalCollectedAtPOSC = grossRevenueC + totalTaxC + totalTipsC + totalOtherLiabilitiesC;
      const totalCollectedAtPOS = fromC(totalCollectedAtPOSC);
      
      // Calculate categorization rate based on revenue dollars
      const categorizationRate = grossRevenueC > 0 ? (categorizedRevenueC / grossRevenueC) * 100 : 0;

      // Validation: Check arithmetic
      const calculatedGross = categorizedRevenue + uncategorizedRevenue;
      if (Math.abs(calculatedGross - grossRevenue) > 0.01) {
        console.error('Revenue breakdown arithmetic error:', {
          categorizedRevenue,
          uncategorizedRevenue,
          calculatedGross,
          reportedGross: grossRevenue,
          difference: calculatedGross - grossRevenue
        });
      }

      return {
        revenue_categories: revenueCategories.sort((a, b) => 
          (a.account_code || '').localeCompare(b.account_code || '')
        ),
        discount_categories: discountCategories,
        refund_categories: refundCategories,
        tax_categories: taxCategories,
        tip_categories: tipCategories,
        other_liability_categories: otherLiabilityCategories.sort((a, b) => 
          (a.account_code || '').localeCompare(b.account_code || '')
        ),
        uncategorized_revenue: uncategorizedRevenue,
        totals: {
          total_collected_at_pos: totalCollectedAtPOS,
          gross_revenue: grossRevenue,
          categorized_revenue: categorizedRevenue,
          uncategorized_revenue: uncategorizedRevenue,
          total_discounts: totalDiscounts,
          total_refunds: totalRefunds,
          net_revenue: netRevenue,
          sales_tax: totalTax,
          tips: totalTips,
          other_liabilities: totalOtherLiabilities,
        },
        has_categorization_data: hasCategorizationData,
        categorization_rate: categorizationRate,
      };
    },
    enabled: !!restaurantId,
    staleTime: 30000,
    refetchOnWindowFocus: true,
  });
}
