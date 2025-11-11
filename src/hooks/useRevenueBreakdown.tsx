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

export interface AdjustmentBreakdown {
  adjustment_type: string;
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
  adjustments: AdjustmentBreakdown[];
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
  // Format dates as strings for stable query key
  const fromStr = dateFrom.toISOString().split('T')[0];
  const toStr = dateTo.toISOString().split('T')[0];
  
  return useQuery({
    queryKey: ['revenue-breakdown', restaurantId, fromStr, toStr],
    queryFn: async (): Promise<RevenueBreakdownData | null> => {
      if (!restaurantId) return null;

      // Integer cents helpers to eliminate floating-point errors
      const toC = (n: number) => Math.round((n || 0) * 100);
      const fromC = (c: number) => Math.round(c) / 100;

      const fromStr = dateFrom.toISOString().split('T')[0];
      const toStr = dateTo.toISOString().split('T')[0];

      // Query unified_sales excluding pass-through items (adjustment_type IS NOT NULL)
      // Pass-through items include: tips, sales tax, service charges, discounts, fees
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
        .lte('sale_date', toStr)
        .is('adjustment_type', null);

      if (error) throw error;

      // Query adjustments separately (tax, tips, service charges, discounts, fees)
      const { data: adjustments, error: adjustmentsError } = await supabase
        .from('unified_sales')
        .select('adjustment_type, total_price')
        .eq('restaurant_id', restaurantId)
        .gte('sale_date', fromStr)
        .lte('sale_date', toStr)
        .not('adjustment_type', 'is', null);

      if (adjustmentsError) throw adjustmentsError;

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

      // Debug: Track alcohol sales
      const alcoholSales = filteredSales?.filter((s: any) => 
        s.chart_account?.account_code === '4020' || 
        s.chart_account?.account_name?.toLowerCase().includes('alcohol')
      ) || [];
      
      if (alcoholSales.length > 0) {
        console.group('🍺 Alcohol Sales Debug (useRevenueBreakdown)');
        console.table(alcoholSales.map((s: any) => ({
          price: s.total_price,
          is_categorized: s.is_categorized,
          has_account: !!s.chart_account,
          account_type: s.chart_account?.account_type,
          account_code: s.chart_account?.account_code,
          item_type: s.item_type,
        })));
        console.log('Total alcohol sales found:', alcoholSales.length);
        console.log('Total alcohol revenue:', alcoholSales.reduce((sum: number, s: any) => sum + s.total_price, 0));
        console.groupEnd();
      }

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
          adjustments: [],
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

      // Add adjustments from adjustment_type column (Square, Clover pass-through items)
      const adjustmentTaxC = (adjustments || [])
        .filter(a => a.adjustment_type === 'tax')
        .reduce((sum, a) => sum + toC(a.total_price || 0), 0);
      
      const adjustmentTipsC = (adjustments || [])
        .filter(a => a.adjustment_type === 'tip')
        .reduce((sum, a) => sum + toC(a.total_price || 0), 0);
      
      const adjustmentServiceChargeC = (adjustments || [])
        .filter(a => a.adjustment_type === 'service_charge')
        .reduce((sum, a) => sum + toC(a.total_price || 0), 0);
      
      const adjustmentDiscountsC = (adjustments || [])
        .filter(a => a.adjustment_type === 'discount')
        .reduce((sum, a) => sum + Math.abs(toC(a.total_price || 0)), 0);
      
      const adjustmentFeesC = (adjustments || [])
        .filter(a => a.adjustment_type === 'fee')
        .reduce((sum, a) => sum + toC(a.total_price || 0), 0);

      // Build adjustments breakdown array
      const adjustmentsBreakdown: AdjustmentBreakdown[] = [];
      
      if (adjustmentTaxC > 0) {
        adjustmentsBreakdown.push({
          adjustment_type: 'tax',
          total_amount: fromC(adjustmentTaxC),
          transaction_count: (adjustments || []).filter(a => a.adjustment_type === 'tax').length,
        });
      }
      
      if (adjustmentTipsC > 0) {
        adjustmentsBreakdown.push({
          adjustment_type: 'tip',
          total_amount: fromC(adjustmentTipsC),
          transaction_count: (adjustments || []).filter(a => a.adjustment_type === 'tip').length,
        });
      }
      
      if (adjustmentServiceChargeC > 0) {
        adjustmentsBreakdown.push({
          adjustment_type: 'service_charge',
          total_amount: fromC(adjustmentServiceChargeC),
          transaction_count: (adjustments || []).filter(a => a.adjustment_type === 'service_charge').length,
        });
      }
      
      if (adjustmentFeesC > 0) {
        adjustmentsBreakdown.push({
          adjustment_type: 'fee',
          total_amount: fromC(adjustmentFeesC),
          transaction_count: (adjustments || []).filter(a => a.adjustment_type === 'fee').length,
        });
      }
      
      if (adjustmentDiscountsC > 0) {
        adjustmentsBreakdown.push({
          adjustment_type: 'discount',
          total_amount: fromC(adjustmentDiscountsC),
          transaction_count: (adjustments || []).filter(a => a.adjustment_type === 'discount').length,
        });
      }

      // Combine categorized amounts with adjustment amounts
      const combinedTaxC = totalTaxC + adjustmentTaxC;
      const combinedTipsC = totalTipsC + adjustmentTipsC;
      const combinedOtherLiabilitiesC = totalOtherLiabilitiesC + adjustmentServiceChargeC + adjustmentFeesC;
      const combinedDiscountsC = totalDiscountsC + adjustmentDiscountsC;
      
      // Totals in cents - use combined values including adjustments
      const grossRevenueC = categorizedRevenueC + uncategorizedRevenueC;
      const netRevenueC = grossRevenueC - combinedDiscountsC - totalRefundsC;
      
      // Convert once to dollars for output
      const categorizedRevenue = fromC(categorizedRevenueC);
      const grossRevenue = fromC(grossRevenueC);
      const totalDiscounts = fromC(combinedDiscountsC);
      const totalRefunds = fromC(totalRefundsC);
      const netRevenue = fromC(netRevenueC);
      const totalTax = fromC(combinedTaxC);
      const totalTips = fromC(combinedTipsC);
      const totalOtherLiabilities = fromC(combinedOtherLiabilitiesC);
      
      // Calculate total collected at POS (revenue + pass-through collections)
      const totalCollectedAtPOSC = grossRevenueC + combinedTaxC + combinedTipsC + combinedOtherLiabilitiesC;
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
        adjustments: adjustmentsBreakdown,
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
    staleTime: 300000, // 5 minutes - reduce refetch frequency
    refetchOnWindowFocus: false, // Disable automatic refetch on window focus
    refetchOnMount: false, // Disable automatic refetch on mount
  });
}
