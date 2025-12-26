import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { normalizeAdjustmentsWithPassThrough, splitPassThroughSales, classifyPassThroughItem } from './utils/passThroughAdjustments';
import type { PassThroughType } from './utils/passThroughAdjustments';

// Re-export for backwards compatibility
export { classifyPassThroughItem };
export type { PassThroughType };

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

// Helper: merge categorized adjustments into a category map (exported for tests)
export function mergeCategorizedAdjustments(
  categoryMap: Map<string, RevenueCategory>,
  adjustments: any[] | null
) {
  const categorizedAdjustments = (adjustments || []).filter((a: any) => a.is_categorized && a.chart_account);
  categorizedAdjustments.forEach((adj: any) => {
    const key = `${adj.chart_account.id}-${adj.adjustment_type || 'adjustment'}`;
    const existing = categoryMap.get(key);

    if (existing) {
      existing.total_amount += adj.total_price || 0;
      existing.transaction_count += 1;
    } else {
      categoryMap.set(key, {
        account_id: adj.chart_account.id,
        account_code: adj.chart_account.account_code,
        account_name: adj.chart_account.account_name,
        account_type: adj.chart_account.account_type,
        account_subtype: adj.chart_account.account_subtype,
        total_amount: adj.total_price || 0,
        transaction_count: 1,
      });
    }
  });
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

      // Use database aggregation for efficient totals (no row limit issues)
      // This replaces fetching individual records and processing in JavaScript
      
      // 1. Get pass-through totals using RPC (tax, tips, service_charge, discount, fee)
      const { data: passThroughTotals, error: passThroughError } = await supabase
        .rpc('get_pass_through_totals', {
          p_restaurant_id: restaurantId,
          p_date_from: fromStr,
          p_date_to: toStr
        });

      if (passThroughError) {
        console.warn('Failed to fetch pass-through totals via RPC, falling back to individual query:', passThroughError);
        // Fall back to original query method if RPC not available
      }

      // 2. Get revenue by account using RPC (categorized and uncategorized)
      const { data: revenueByAccount, error: revenueError } = await supabase
        .rpc('get_revenue_by_account', {
          p_restaurant_id: restaurantId,
          p_date_from: fromStr,
          p_date_to: toStr
        });

      if (revenueError) {
        console.warn('Failed to fetch revenue by account via RPC, falling back to individual query:', revenueError);
        // Fall back to original query method if RPC not available
      }

      // If RPC functions are available, use aggregated data
      if (passThroughTotals && revenueByAccount) {
        // Process pass-through totals
        const passThroughMap = new Map<string, { total_amount: number; transaction_count: number }>();
        (passThroughTotals as any[]).forEach((row: any) => {
          passThroughMap.set(row.adjustment_type, {
            total_amount: Number(row.total_amount) || 0,
            transaction_count: Number(row.transaction_count) || 0
          });
        });

        const adjustmentTaxC = toC(passThroughMap.get('tax')?.total_amount || 0);
        const adjustmentTipsC = toC(passThroughMap.get('tip')?.total_amount || 0);
        const adjustmentServiceChargeC = toC(passThroughMap.get('service_charge')?.total_amount || 0);
        const adjustmentDiscountsC = toC(Math.abs(passThroughMap.get('discount')?.total_amount || 0));
        const adjustmentFeesC = toC(passThroughMap.get('fee')?.total_amount || 0);

        // Process revenue by account
        const categories: RevenueCategory[] = [];
        let uncategorizedRevenueC = 0;
        let categorizedRevenueC = 0;

        (revenueByAccount as any[]).forEach((row: any) => {
          const amount = Number(row.total_amount) || 0;
          const count = Number(row.transaction_count) || 0;

          if (!row.is_categorized) {
            // Uncategorized sales
            uncategorizedRevenueC = toC(amount);
          } else {
            // Categorized sales
            categories.push({
              account_id: row.account_id,
              account_code: row.account_code || '',
              account_name: row.account_name || '',
              account_type: row.account_type || '',
              account_subtype: row.account_subtype || '',
              total_amount: amount,
              transaction_count: count
            });
          }
        });

        // Separate categories by type
        const revenueCategories = categories.filter(c => 
          c.account_type === 'revenue' && 
          c.account_subtype !== 'discounts' &&
          c.account_subtype !== 'sales_tax' &&
          !c.account_name.toLowerCase().includes('discount') &&
          !c.account_name.toLowerCase().includes('comp') &&
          !c.account_name.toLowerCase().includes('refund') &&
          !c.account_name.toLowerCase().includes('tax')
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

        const otherLiabilityCategories = categories.filter(c =>
          c.account_type === 'liability' &&
          c.account_subtype !== 'sales_tax' &&
          c.account_subtype !== 'tips' &&
          !c.account_name.toLowerCase().includes('tax') &&
          !c.account_name.toLowerCase().includes('tip')
        );

        // If no categorized liabilities were found for pass-through amounts,
        // synthesize display categories from adjustment totals to surface names in the UI.
        const ensureCategory = (
          list: RevenueCategory[],
          adjustmentType: string,
          amountCents: number,
          fallback: { code: string; name: string; subtype: string }
        ) => {
          if (list.length === 0 && amountCents > 0) {
            list.push({
              account_id: `synthetic-${adjustmentType}`,
              account_code: fallback.code,
              account_name: fallback.name,
              account_type: 'liability',
              account_subtype: fallback.subtype,
              total_amount: fromC(amountCents),
              transaction_count: passThroughMap.get(adjustmentType)?.transaction_count || 0,
            });
          }
        };

        ensureCategory(taxCategories, 'tax', toC(passThroughMap.get('tax')?.total_amount || 0), {
          code: '2100',
          name: 'Sales Tax Payable',
          subtype: 'sales_tax',
        });

        ensureCategory(tipCategories, 'tip', toC(passThroughMap.get('tip')?.total_amount || 0), {
          code: '2150',
          name: 'Tips Payable',
          subtype: 'tips',
        });

        // Calculate totals
        categorizedRevenueC = revenueCategories.reduce((sum, c) => sum + toC(c.total_amount || 0), 0);
        const totalDiscountsC = discountCategories.reduce((sum, c) => sum + Math.abs(toC(c.total_amount || 0)), 0);
        const totalRefundsC = refundCategories.reduce((sum, c) => sum + Math.abs(toC(c.total_amount || 0)), 0);
        const totalTaxC = taxCategories.reduce((sum, c) => sum + toC(c.total_amount || 0), 0);
        const totalTipsC = tipCategories.reduce((sum, c) => sum + toC(c.total_amount || 0), 0);
        const totalOtherLiabilitiesC = otherLiabilityCategories.reduce((sum, c) => sum + toC(c.total_amount || 0), 0);

        // Combine categorized amounts with adjustment amounts
        const combinedTaxC = totalTaxC + adjustmentTaxC;
        const combinedTipsC = totalTipsC + adjustmentTipsC;
        const combinedOtherLiabilitiesC = totalOtherLiabilitiesC + adjustmentServiceChargeC + adjustmentFeesC;
        const combinedDiscountsC = totalDiscountsC + adjustmentDiscountsC;

        // Calculate final totals
        const grossRevenueC = categorizedRevenueC + uncategorizedRevenueC;
        const netRevenueC = grossRevenueC - combinedDiscountsC - totalRefundsC;
        const totalCollectedAtPOSC = grossRevenueC + combinedTaxC + combinedTipsC + combinedOtherLiabilitiesC;

        // Build adjustments breakdown array
        const adjustmentsBreakdown: AdjustmentBreakdown[] = [];
        
        if (adjustmentTaxC > 0) {
          adjustmentsBreakdown.push({
            adjustment_type: 'tax',
            total_amount: fromC(adjustmentTaxC),
            transaction_count: passThroughMap.get('tax')?.transaction_count || 0
          });
        }
        
        if (adjustmentTipsC > 0) {
          adjustmentsBreakdown.push({
            adjustment_type: 'tip',
            total_amount: fromC(adjustmentTipsC),
            transaction_count: passThroughMap.get('tip')?.transaction_count || 0
          });
        }
        
        if (adjustmentServiceChargeC > 0) {
          adjustmentsBreakdown.push({
            adjustment_type: 'service_charge',
            total_amount: fromC(adjustmentServiceChargeC),
            transaction_count: passThroughMap.get('service_charge')?.transaction_count || 0
          });
        }
        
        if (adjustmentFeesC > 0) {
          adjustmentsBreakdown.push({
            adjustment_type: 'fee',
            total_amount: fromC(adjustmentFeesC),
            transaction_count: passThroughMap.get('fee')?.transaction_count || 0
          });
        }
        
        if (adjustmentDiscountsC > 0) {
          adjustmentsBreakdown.push({
            adjustment_type: 'discount',
            total_amount: fromC(adjustmentDiscountsC),
            transaction_count: passThroughMap.get('discount')?.transaction_count || 0
          });
        }

        const hasCategorizationData = categorizedRevenueC > 0;
        const categorizationRate = grossRevenueC > 0 ? (categorizedRevenueC / grossRevenueC) * 100 : 0;

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
          uncategorized_revenue: fromC(uncategorizedRevenueC),
          totals: {
            total_collected_at_pos: fromC(totalCollectedAtPOSC),
            gross_revenue: fromC(grossRevenueC),
            categorized_revenue: fromC(categorizedRevenueC),
            uncategorized_revenue: fromC(uncategorizedRevenueC),
            total_discounts: fromC(combinedDiscountsC),
            total_refunds: fromC(totalRefundsC),
            net_revenue: fromC(netRevenueC),
            sales_tax: fromC(combinedTaxC),
            tips: fromC(combinedTipsC),
            other_liabilities: fromC(combinedOtherLiabilitiesC),
          },
          has_categorization_data: hasCategorizationData,
          categorization_rate: categorizationRate,
        };
      }

      // FALLBACK: Original implementation if RPC functions are not available
      // This will be used until the migration is applied
      // Note: Supabase has a default limit of 1000 rows, so we need to set a higher limit
      const { data: sales, error } = await supabase
        .from('unified_sales')
        .select(`
          id,
          total_price,
          item_type,
          item_name,
          adjustment_type,
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
        .is('adjustment_type', null)
        .limit(10000); // Override Supabase's default 1000 row limit

      if (error) throw error;

      // Query adjustments separately (tax, tips, service charges, discounts, fees)
      // Note: Supabase has a default limit of 1000 rows, so we need to set a higher limit
      // to ensure we get all adjustment items including taxes, tips, etc.
      const { data: adjustments, error: adjustmentsError } = await supabase
        .from('unified_sales')
        .select(`
          id,
          adjustment_type,
          total_price,
          item_name,
          is_categorized,
          category_id,
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
        .not('adjustment_type', 'is', null)
        .limit(10000); // Override Supabase's default 1000 row limit

      if (adjustmentsError) throw adjustmentsError;

      // Split out pass-through rows that may have been ingested without adjustment_type
      const { revenue: revenueSales, passThrough: passThroughSales } = splitPassThroughSales(sales);

      // Filter out parent sales that have been split into children
      // Include: unsplit sales (no children) + all child splits
      const parentIdsWithChildren = new Set(
        revenueSales
          ?.filter((s: any) => s.parent_sale_id !== null)
          .map((s: any) => s.parent_sale_id) || []
      );

      const filteredSales = revenueSales?.filter((s: any) => 
        !parentIdsWithChildren.has(s.id)
      ) || [];

      const allAdjustments = normalizeAdjustmentsWithPassThrough(adjustments, passThroughSales);

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

  // Group by account and item type (only categorized sales + categorized adjustments merged)
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

      // Merge categorized adjustments into the categories map so they appear in
      // the categorized lists (tax, tips, other liabilities). This keeps totals
      // unchanged but improves visibility for categorized pass-through items.
      mergeCategorizedAdjustments(categoryMap, allAdjustments);

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

      // Add adjustments from pass-through items (Square, Clover, Shift4, etc.)
      // Use classifyPassThroughItem to properly classify items based on chart_account
      // This ensures categorized liability items (like sales tax) are correctly counted
      const adjustmentTaxC = (allAdjustments || [])
        .filter(a => classifyPassThroughItem(a) === 'tax')
        .reduce((sum, a) => sum + toC(a.total_price || 0), 0);
      
      const adjustmentTipsC = (allAdjustments || [])
        .filter(a => classifyPassThroughItem(a) === 'tip')
        .reduce((sum, a) => sum + toC(a.total_price || 0), 0);
      
      const adjustmentServiceChargeC = (allAdjustments || [])
        .filter(a => classifyPassThroughItem(a) === 'service_charge')
        .reduce((sum, a) => sum + toC(a.total_price || 0), 0);
      
      const adjustmentDiscountsC = (allAdjustments || [])
        .filter(a => classifyPassThroughItem(a) === 'discount')
        .reduce((sum, a) => sum + Math.abs(toC(a.total_price || 0)), 0);
      
      const adjustmentFeesC = (allAdjustments || [])
        .filter(a => classifyPassThroughItem(a) === 'fee')
        .reduce((sum, a) => sum + toC(a.total_price || 0), 0);
      
      const adjustmentOtherC = (allAdjustments || [])
        .filter(a => classifyPassThroughItem(a) === 'other')
        .reduce((sum, a) => sum + toC(a.total_price || 0), 0);

      // Build adjustments breakdown array
      const adjustmentsBreakdown: AdjustmentBreakdown[] = [];
      
      if (adjustmentTaxC > 0) {
        adjustmentsBreakdown.push({
          adjustment_type: 'tax',
          total_amount: fromC(adjustmentTaxC),
          transaction_count: (allAdjustments || []).filter(a => classifyPassThroughItem(a) === 'tax').length,
        });
      }
      
      if (adjustmentTipsC > 0) {
        adjustmentsBreakdown.push({
          adjustment_type: 'tip',
          total_amount: fromC(adjustmentTipsC),
          transaction_count: (allAdjustments || []).filter(a => classifyPassThroughItem(a) === 'tip').length,
        });
      }
      
      if (adjustmentServiceChargeC > 0) {
        adjustmentsBreakdown.push({
          adjustment_type: 'service_charge',
          total_amount: fromC(adjustmentServiceChargeC),
          transaction_count: (allAdjustments || []).filter(a => classifyPassThroughItem(a) === 'service_charge').length,
        });
      }
      
      if (adjustmentFeesC > 0) {
        adjustmentsBreakdown.push({
          adjustment_type: 'fee',
          total_amount: fromC(adjustmentFeesC),
          transaction_count: (allAdjustments || []).filter(a => classifyPassThroughItem(a) === 'fee').length,
        });
      }
      
      if (adjustmentDiscountsC > 0) {
        adjustmentsBreakdown.push({
          adjustment_type: 'discount',
          total_amount: fromC(adjustmentDiscountsC),
          transaction_count: (allAdjustments || []).filter(a => classifyPassThroughItem(a) === 'discount').length,
        });
      }

      // Combine categorized amounts with adjustment amounts
      const combinedTaxC = totalTaxC + adjustmentTaxC;
      const combinedTipsC = totalTipsC + adjustmentTipsC;
      const combinedOtherLiabilitiesC = totalOtherLiabilitiesC + adjustmentServiceChargeC + adjustmentFeesC + adjustmentOtherC;
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
