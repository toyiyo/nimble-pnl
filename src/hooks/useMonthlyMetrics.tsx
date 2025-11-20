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
  pending_labor_cost: number;
  actual_labor_cost: number;
  has_data: boolean;
}

/**
 * Hook to fetch monthly aggregated metrics from unified_sales (revenue + liabilities) 
 * and source tables (inventory_transactions + daily_labor_costs + bank transactions/pending outflows for costs).
 * 
 * Labor costs now include:
 * - Pending labor: from daily_labor_costs (time punches - scheduled/accrued)
 * - Actual labor: from bank_transactions and pending_outflows (paid labor)
 * 
 * ✅ Use this hook for monthly performance tables
 * ❌ Don't use getMonthlyData() from useDailyPnL (incorrect/outdated)
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

      const normalizeToLocalDate = (rawDate: string | null | undefined, fieldName: string) => {
        if (!rawDate) {
          return null;
        }

        const parsed = new Date(rawDate);
        if (!Number.isNaN(parsed.getTime())) {
          return new Date(parsed.getFullYear(), parsed.getMonth(), parsed.getDate());
        }

        const match = /^([0-9]{4})-([0-9]{2})-([0-9]{2})/.exec(rawDate);
        if (match) {
          const [, year, month, day] = match;
          return new Date(Number(year), Number(month) - 1, Number(day));
        }

        console.warn(`[useMonthlyMetrics] Unable to parse ${fieldName}:`, rawDate);
        return null;
      };

      // Fetch sales excluding pass-through items (adjustment_type IS NOT NULL)
      // Pass-through items include: tips, sales tax, service charges, discounts, fees
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
        .lte('sale_date', format(dateTo, 'yyyy-MM-dd'))
        .is('adjustment_type', null);

      if (salesError) throw salesError;

      // Fetch adjustments separately (Square/Clover pass-through items)
      const { data: adjustmentsData, error: adjustmentsError } = await supabase
        .from('unified_sales')
        .select('sale_date, adjustment_type, total_price')
        .eq('restaurant_id', restaurantId)
        .gte('sale_date', format(dateFrom, 'yyyy-MM-dd'))
        .lte('sale_date', format(dateTo, 'yyyy-MM-dd'))
        .not('adjustment_type', 'is', null);

      if (adjustmentsError) throw adjustmentsError;

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
      
      // Debug: Track categorization for alcohol sales with detailed path tracking
      const alcoholSales: any[] = [];
      const alcoholSalesProcessing: any[] = [];

      filteredSales?.forEach((sale) => {
        // Debug: Track alcohol sales
        const isAlcohol = (sale.chart_account as any)?.account_code === '4020' || 
                         sale.chart_account?.account_name?.toLowerCase().includes('alcohol');
        
        if (isAlcohol) {
          alcoholSales.push({
            price: sale.total_price,
            is_categorized: sale.is_categorized,
            has_account: !!sale.chart_account,
            account_type: sale.chart_account?.account_type,
            account_code: (sale.chart_account as any)?.account_code,
            item_type: sale.item_type,
            normalized_item_type: String(sale.item_type || 'sale').toLowerCase(),
          });
        }
        
        const saleDate = normalizeToLocalDate(sale.sale_date, 'sale_date');
        if (!saleDate) {
          return;
        }
        const monthKey = format(saleDate, 'yyyy-MM');

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
            pending_labor_cost: 0,
            actual_labor_cost: 0,
            has_data: false,
          });
        }

        const month = monthlyMap.get(monthKey)!;
        month.has_data = true;

        // Only process categorized sales (skip uncategorized to match useRevenueBreakdown logic)
        if (!sale.is_categorized || !sale.chart_account) {
          // Uncategorized sales are treated as revenue for reporting purposes
          // Match useRevenueBreakdown logic: normalize item_type to lowercase for comparison
          if (String(sale.item_type || 'sale').toLowerCase() === 'sale') {
            month.gross_revenue += Math.round(sale.total_price * 100);
            if (isAlcohol) {
              alcoholSalesProcessing.push({
                price: sale.total_price,
                path: 'uncategorized -> gross_revenue',
              });
            }
          } else {
            if (isAlcohol) {
              alcoholSalesProcessing.push({
                price: sale.total_price,
                path: 'uncategorized -> SKIPPED (not sale)',
              });
            }
          }
          return;
        }

        // Categorize based on account_type FIRST (to match useRevenueBreakdown logic)
        // Then use item_type to determine if it's a discount/refund
        // Use cents to avoid floating-point precision errors
        const normalizedItemType = String(sale.item_type || 'sale').toLowerCase();
        
        // Handle discounts and refunds first (regardless of account_type)
        if (normalizedItemType === 'discount') {
          month.discounts += Math.round(Math.abs(sale.total_price) * 100);
          if (isAlcohol) {
            alcoholSalesProcessing.push({
              price: sale.total_price,
              path: 'categorized -> discount',
            });
          }
          return;
        }
        
        if (normalizedItemType === 'refund') {
          month.refunds += Math.round(Math.abs(sale.total_price) * 100);
          if (isAlcohol) {
            alcoholSalesProcessing.push({
              price: sale.total_price,
              path: 'categorized -> refund',
            });
          }
          return;
        }
        
        // Now categorize by account_type (matching useRevenueBreakdown)
        if (sale.chart_account.account_type === 'revenue') {
          // All revenue account items go to gross_revenue (regardless of item_type)
          // This matches useRevenueBreakdown which includes all categorized revenue
          month.gross_revenue += Math.round(sale.total_price * 100);
          if (isAlcohol) {
            alcoholSalesProcessing.push({
              price: sale.total_price,
              path: `categorized -> revenue -> gross_revenue (item_type='${normalizedItemType}')`,
            });
          }
        } else if (sale.chart_account.account_type === 'liability') {
          // Categorize liabilities by checking BOTH subtype and account_name
          const subtype = sale.chart_account.account_subtype?.toLowerCase() || '';
          const accountName = sale.chart_account.account_name?.toLowerCase() || '';

          if ((subtype.includes('sales') && subtype.includes('tax')) ||
              (accountName.includes('sales') && accountName.includes('tax'))) {
            month.sales_tax += Math.round(sale.total_price * 100);
            if (isAlcohol) {
              alcoholSalesProcessing.push({
                price: sale.total_price,
                path: 'categorized -> liability -> sales_tax',
              });
            }
          } else if (subtype.includes('tip') || accountName.includes('tip')) {
            month.tips += Math.round(sale.total_price * 100);
            if (isAlcohol) {
              alcoholSalesProcessing.push({
                price: sale.total_price,
                path: 'categorized -> liability -> tips',
              });
            }
          } else {
            month.other_liabilities += Math.round(sale.total_price * 100);
            if (isAlcohol) {
              alcoholSalesProcessing.push({
                price: sale.total_price,
                path: 'categorized -> liability -> other_liabilities',
              });
            }
          }
        } else {
          // Account type is neither revenue nor liability - skip
          if (isAlcohol) {
            alcoholSalesProcessing.push({
              price: sale.total_price,
              path: `categorized -> SKIPPED (account_type='${sale.chart_account.account_type}')`,
            });
          }
        }
      });
      
      // Debug: Log alcohol sales
      if (alcoholSales.length > 0) {
        console.group('🍺 Alcohol Sales Debug (useMonthlyMetrics)');
        console.log('Raw alcohol sales found:');
        console.table(alcoholSales);
        console.log('Processing paths:');
        console.table(alcoholSalesProcessing);
        console.log('Total alcohol sales found:', alcoholSales.length);
        console.log('Total alcohol revenue:', alcoholSales.reduce((sum, s) => sum + s.price, 0));
        console.groupEnd();
      }

      // Process adjustments (Square/Clover pass-through items)
      adjustmentsData?.forEach((adjustment) => {
        const adjustmentDate = normalizeToLocalDate(adjustment.sale_date, 'adjustment.sale_date');
        if (!adjustmentDate) {
          return;
        }
        const monthKey = format(adjustmentDate, 'yyyy-MM');

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
            pending_labor_cost: 0,
            actual_labor_cost: 0,
            has_data: false,
          });
        }

        const month = monthlyMap.get(monthKey)!;
        month.has_data = true;

        // Categorize based on adjustment_type
        const priceInCents = Math.round(adjustment.total_price * 100);
        
        switch (adjustment.adjustment_type) {
          case 'tax':
            month.sales_tax += priceInCents;
            break;
          case 'tip':
            month.tips += priceInCents;
            break;
          case 'service_charge':
          case 'fee':
            month.other_liabilities += priceInCents;
            break;
          case 'discount':
            month.discounts += Math.abs(priceInCents);
            break;
        }
      });

      // Fetch COGS (Cost of Goods Used) from inventory_transactions (source of truth)
      // Use 'usage' type to track actual product consumption when recipes are sold
      const { data: foodCostsData, error: foodCostsError } = await supabase
        .from('inventory_transactions')
        .select('created_at, transaction_date, total_cost')
        .eq('restaurant_id', restaurantId)
        .eq('transaction_type', 'usage')
        .or(`transaction_date.gte.${format(dateFrom, 'yyyy-MM-dd')},and(transaction_date.is.null,created_at.gte.${format(dateFrom, 'yyyy-MM-dd')})`)
        .or(`transaction_date.lte.${format(dateTo, 'yyyy-MM-dd')},and(transaction_date.is.null,created_at.lte.${format(dateTo, 'yyyy-MM-dd')}T23:59:59.999Z)`);

      if (foodCostsError) throw foodCostsError;

      // Fetch labor costs from daily_labor_costs (pending - from time punches)
      const { data: laborCostsData, error: laborCostsError } = await supabase
        .from('daily_labor_costs')
        .select('date, total_labor_cost')
        .eq('restaurant_id', restaurantId)
        .gte('date', format(dateFrom, 'yyyy-MM-dd'))
        .lte('date', format(dateTo, 'yyyy-MM-dd'));

      if (laborCostsError) throw laborCostsError;

      // Fetch actual labor costs from bank transactions (actual - paid)
      const { data: bankLaborCosts, error: bankLaborError } = await supabase
        .from('bank_transactions')
        .select(`
          transaction_date,
          amount,
          status,
          chart_account:chart_of_accounts!category_id(
            account_subtype
          )
        `)
        .eq('restaurant_id', restaurantId)
        .gte('transaction_date', format(dateFrom, 'yyyy-MM-dd'))
        .lte('transaction_date', format(dateTo, 'yyyy-MM-dd'))
        .in('status', ['posted', 'pending'])
        .lt('amount', 0) // Only outflows
        .not('category_id', 'is', null); // Only categorized transactions

      // Don't throw - just log and continue without bank labor costs if query fails
      if (bankLaborError) {
        console.warn('Failed to fetch bank labor costs:', bankLaborError);
      }

      // Fetch actual labor costs from pending outflows (actual - paid)
      const { data: pendingLaborCosts, error: pendingLaborError } = await supabase
        .from('pending_outflows')
        .select(`
          issue_date,
          amount,
          status,
          chart_account:chart_of_accounts!category_id(
            account_subtype
          )
        `)
        .eq('restaurant_id', restaurantId)
        .gte('issue_date', format(dateFrom, 'yyyy-MM-dd'))
        .lte('issue_date', format(dateTo, 'yyyy-MM-dd'))
        .in('status', ['pending', 'stale_30', 'stale_60', 'stale_90']);

      // Don't throw - just log and continue without pending labor costs if query fails
      if (pendingLaborError) {
        console.warn('Failed to fetch pending labor costs:', pendingLaborError);
      }

      // Aggregate COGS (Cost of Goods Used) by month
      foodCostsData?.forEach((transaction) => {
        const transactionDate = transaction.transaction_date
          ? normalizeToLocalDate(transaction.transaction_date, 'inventory_transactions.transaction_date')
          : normalizeToLocalDate(transaction.created_at, 'inventory_transactions.created_at');
        if (!transactionDate) {
          return;
        }
        const monthKey = format(transactionDate, 'yyyy-MM');
        
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
            pending_labor_cost: 0,
            actual_labor_cost: 0,
            has_data: true,
          });
        }

        const month = monthlyMap.get(monthKey)!;
        // Use cents to avoid floating-point precision errors
        // Use Math.abs() because costs may be stored as negative (accounting convention)
        month.food_cost += Math.round(Math.abs(transaction.total_cost || 0) * 100);
      });

      // Aggregate labor costs by month (pending - from time punches)
      laborCostsData?.forEach((day) => {
        const laborDate = normalizeToLocalDate(day.date, 'daily_labor_costs.date');
        if (!laborDate) {
          return;
        }
        const monthKey = format(laborDate, 'yyyy-MM');
        
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
            pending_labor_cost: 0,
            actual_labor_cost: 0,
            has_data: true,
          });
        }

        const month = monthlyMap.get(monthKey)!;
        // Use cents to avoid floating-point precision errors
        // Use Math.abs() because costs may be stored as negative (accounting convention)
        const pendingCost = Math.round(Math.abs(day.total_labor_cost || 0) * 100);
        month.pending_labor_cost += pendingCost;
        month.labor_cost += pendingCost;
      });

      // Aggregate actual labor costs from bank transactions (actual - paid)
      bankLaborCosts?.forEach((txn: any) => {
        const account = txn.chart_account as { account_subtype?: string } | null;
        if (account?.account_subtype === 'labor') {
          const transactionDate = normalizeToLocalDate(txn.transaction_date, 'bank_transactions.transaction_date');
          if (!transactionDate) {
            return;
          }
          const monthKey = format(transactionDate, 'yyyy-MM');
          
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
              pending_labor_cost: 0,
              actual_labor_cost: 0,
              has_data: true,
            });
          }

          const month = monthlyMap.get(monthKey)!;
          const actualCost = Math.round(Math.abs(txn.amount || 0) * 100);
          month.actual_labor_cost += actualCost;
          month.labor_cost += actualCost;
        }
      });

      // Aggregate actual labor costs from pending outflows (actual - paid)
      pendingLaborCosts?.forEach((txn: any) => {
        const account = txn.chart_account as { account_subtype?: string } | null;
        if (account?.account_subtype === 'labor') {
          const issueDate = normalizeToLocalDate(txn.issue_date, 'pending_outflows.issue_date');
          if (!issueDate) {
            return;
          }
          const monthKey = format(issueDate, 'yyyy-MM');
          
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
              pending_labor_cost: 0,
              actual_labor_cost: 0,
              has_data: true,
            });
          }

          const month = monthlyMap.get(monthKey)!;
          const actualCost = Math.round(Math.abs(txn.amount || 0) * 100);
          month.actual_labor_cost += actualCost;
          month.labor_cost += actualCost;
        }
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
  pending_labor_cost: Math.round(month.pending_labor_cost) / 100,
  actual_labor_cost: Math.round(month.actual_labor_cost) / 100,
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
