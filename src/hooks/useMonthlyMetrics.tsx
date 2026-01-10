import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { format, startOfMonth, endOfMonth, eachMonthOfInterval } from 'date-fns';
import { normalizeAdjustmentsWithPassThrough, splitPassThroughSales } from './utils/passThroughAdjustments';
import { classifyAdjustmentIntoMonth } from '../../supabase/functions/_shared/monthlyMetrics';
import { calculateActualLaborCost } from '@/services/laborCalculations';
import type { TimePunch } from '@/types/timeTracking';

// Re-export types/functions from shared module for backwards compatibility
export { 
  classifyAdjustmentIntoMonth, 
  createEmptyMonth,
  type MonthlyMapMonth,
  type AdjustmentInput 
} from '../../supabase/functions/_shared/monthlyMetrics';

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

// RPC response type for get_monthly_sales_metrics
interface MonthlySalesMetricsRow {
  period: string;
  gross_revenue: number;
  sales_tax: number;
  tips: number;
  other_liabilities: number;
  discounts: number;
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

      const fromStr = format(dateFrom, 'yyyy-MM-dd');
      const toStr = format(dateTo, 'yyyy-MM-dd');

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

      // Try optimized RPC function first (no row limit issues)
      const { data: rpcMetrics, error: rpcError } = await supabase
        .rpc('get_monthly_sales_metrics', {
          p_restaurant_id: restaurantId,
          p_date_from: fromStr,
          p_date_to: toStr
        });

      // Build monthly map for combining with costs data
      const monthlyMap = new Map<string, {
        period: string;
        gross_revenue: number; // in cents
        total_collected_at_pos: number; // in cents
        net_revenue: number; // in cents
        discounts: number; // in cents
        refunds: number; // in cents
        sales_tax: number; // in cents
        tips: number; // in cents
        other_liabilities: number; // in cents
        food_cost: number; // in cents
        labor_cost: number; // in cents
        pending_labor_cost: number; // in cents
        actual_labor_cost: number; // in cents
        has_data: boolean;
      }>();

      if (!rpcError && rpcMetrics && rpcMetrics.length > 0) {
        // Use RPC data - it's already aggregated correctly
        // Values come in dollars, convert to cents for internal consistency
        const typedMetrics = rpcMetrics as MonthlySalesMetricsRow[];
        typedMetrics.forEach((row) => {
          const grossRevenueC = Math.round((Number(row.gross_revenue) || 0) * 100);
          const salesTaxC = Math.round((Number(row.sales_tax) || 0) * 100);
          const tipsC = Math.round((Number(row.tips) || 0) * 100);
          const otherLiabilitiesC = Math.round((Number(row.other_liabilities) || 0) * 100);
          const discountsC = Math.round((Number(row.discounts) || 0) * 100);

          monthlyMap.set(row.period, {
            period: row.period,
            gross_revenue: grossRevenueC,
            total_collected_at_pos: grossRevenueC + salesTaxC + tipsC + otherLiabilitiesC,
            net_revenue: grossRevenueC - discountsC,
            discounts: discountsC,
            refunds: 0, // Not tracked in RPC yet
            sales_tax: salesTaxC,
            tips: tipsC,
            other_liabilities: otherLiabilitiesC,
            food_cost: 0,
            labor_cost: 0,
            pending_labor_cost: 0,
            actual_labor_cost: 0,
            has_data: true,
          });
        });
      } else {
        // Fallback to original implementation if RPC not available
        if (rpcError) {
          console.warn('Failed to fetch monthly metrics via RPC, falling back to individual queries:', rpcError);
        }

        // Fetch sales excluding pass-through items (adjustment_type IS NOT NULL)
        // Pass-through items include: tips, sales tax, service charges, discounts, fees
        // Note: Supabase has a default limit of 1000 rows, so we need to set a higher limit
        const { data: salesData, error: salesError } = await supabase
          .from('unified_sales')
          .select(`
            id,
            sale_date,
            total_price,
            item_type,
            item_name,
            parent_sale_id,
            is_categorized,
            chart_account:chart_of_accounts!category_id(
              account_type,
              account_subtype,
              account_name
            )
          `)
          .eq('restaurant_id', restaurantId)
          .gte('sale_date', fromStr)
          .lte('sale_date', toStr)
          .is('adjustment_type', null)
          .limit(10000); // Override Supabase's default 1000 row limit

        if (salesError) throw salesError;

        // Fetch adjustments separately (Square/Clover pass-through items)
        // Include category/chart_account when present so categorized adjustments
        // can be classified by their chart account (sales_tax/tips/other liabilities).
        // Note: Supabase has a default limit of 1000 rows, so we need to set a higher limit
        const { data: adjustmentsData, error: adjustmentsError } = await supabase
          .from('unified_sales')
          .select(`
            sale_date,
            adjustment_type,
            total_price,
            item_name,
            is_categorized,
            category_id,
            chart_account:chart_of_accounts!category_id(
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
      const { revenue: revenueSales, passThrough: passThroughSales } = splitPassThroughSales(salesData);

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
      const allAdjustments = normalizeAdjustmentsWithPassThrough(adjustmentsData, passThroughSales as any);

      filteredSales?.forEach((sale) => {
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
          return;
        }
        
        if (normalizedItemType === 'refund') {
          month.refunds += Math.round(Math.abs(sale.total_price) * 100);
          return;
        }
        
        // Now categorize by account_type (matching useRevenueBreakdown)
        if (sale.chart_account.account_type === 'revenue') {
          // All revenue account items go to gross_revenue (regardless of item_type)
          // This matches useRevenueBreakdown which includes all categorized revenue
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
        // Account type is neither revenue nor liability - skip
      });

      // Process adjustments (Square/Clover pass-through items)
      allAdjustments?.forEach((adjustment) => {
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

          // Use shared helper to classify and add adjustment to the month object
          classifyAdjustmentIntoMonth(month as any, adjustment as any);
      });
      } // End of fallback else block

      // Fetch COGS (Cost of Goods Used) from inventory_transactions (source of truth)
      // Use 'usage' type to track actual product consumption when recipes are sold
      // Note: Supabase has a default limit of 1000 rows, so we need to set a higher limit
      const { data: foodCostsData, error: foodCostsError } = await supabase
        .from('inventory_transactions')
        .select('created_at, transaction_date, total_cost')
        .eq('restaurant_id', restaurantId)
        .eq('transaction_type', 'usage')
        .or(`transaction_date.gte.${format(dateFrom, 'yyyy-MM-dd')},and(transaction_date.is.null,created_at.gte.${format(dateFrom, 'yyyy-MM-dd')})`)
        .or(`transaction_date.lte.${format(dateTo, 'yyyy-MM-dd')},and(transaction_date.is.null,created_at.lte.${format(dateTo, 'yyyy-MM-dd')}T23:59:59.999Z)`)
        .limit(10000); // Override Supabase's default 1000 row limit

      if (foodCostsError) throw foodCostsError;

      // Fetch actual labor costs from bank transactions + pending outflows
      // Use same pattern as useLaborCostsFromTransactions (no alias)
      // Note: Supabase has a default limit of 1000 rows, so we need to set a higher limit
      const { data: bankLabor, error: bankLaborError } = await supabase
        .from('bank_transactions')
        .select(`
          transaction_date,
          amount,
          status,
          chart_of_accounts!category_id(
            account_subtype
          )
        `)
        .eq('restaurant_id', restaurantId)
        .gte('transaction_date', format(dateFrom, 'yyyy-MM-dd'))
        .lte('transaction_date', format(dateTo, 'yyyy-MM-dd'))
        .in('status', ['posted', 'pending'])
        .lt('amount', 0) // Only outflows
        .limit(10000); // Override Supabase's default 1000 row limit

      if (bankLaborError) {
        console.warn('Failed to fetch bank labor costs:', bankLaborError);
      }

      const { data: pendingLabor, error: pendingLaborError } = await supabase
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
        .in('status', ['pending', 'stale_30', 'stale_60', 'stale_90'])
        .limit(10000); // Override Supabase's default 1000 row limit

      if (pendingLaborError) {
        console.warn('Failed to fetch pending labor costs:', pendingLaborError);
      }

      // Fetch time punches and employees to calculate labor costs using the same logic as Payroll
      // This ensures Dashboard and Payroll show consistent labor numbers (DRY principle)
      const { data: timePunchesData, error: timePunchesError } = await supabase
        .from('time_punches')
        .select('*')
        .eq('restaurant_id', restaurantId)
        .gte('punch_time', dateFrom.toISOString())
        .lte('punch_time', dateTo.toISOString())
        .order('punch_time', { ascending: true });

      if (timePunchesError) {
        console.warn('Failed to fetch time punches for labor calculation:', timePunchesError);
      }

      const { data: employeesData, error: employeesError } = await supabase
        .from('employees')
        .select('*')
        .eq('restaurant_id', restaurantId);

      if (employeesError) {
        console.warn('Failed to fetch employees for labor calculation:', employeesError);
      }

      // Fetch per-job contractor payments (manual payments stored as source='per-job')
      const { data: manualPaymentsData, error: manualPaymentsError } = await supabase
        .from('daily_labor_allocations')
        .select('*')
        .eq('restaurant_id', restaurantId)
        .eq('source', 'per-job')
        .gte('date', format(dateFrom, 'yyyy-MM-dd'))
        .lte('date', format(dateTo, 'yyyy-MM-dd'));

      if (manualPaymentsError) {
        console.warn('Failed to fetch manual payments:', manualPaymentsError);
      }

      // Convert time punches to the expected format
      interface DBTimePunch {
        id: string;
        employee_id: string;
        restaurant_id: string;
        punch_time: string;
        punch_type: string;
        created_at: string;
        updated_at: string;
        shift_id: string | null;
        notes: string | null;
        photo_path: string | null;
        device_info: string | null;
        location: unknown;
        created_by: string | null;
        modified_by: string | null;
      }

      const typedPunches: TimePunch[] = (timePunchesData || []).map((punch: DBTimePunch) => ({
        ...punch,
        punch_type: punch.punch_type as TimePunch['punch_type'],
        location: punch.location && typeof punch.location === 'object' && 'latitude' in punch.location && 'longitude' in punch.location
          ? punch.location as { latitude: number; longitude: number }
          : undefined,
      }));

      // Cast employees to the correct type - the DB returns strings but we need union types
      type EmployeeStatus = 'active' | 'inactive' | 'terminated';
      type CompensationType = 'hourly' | 'salary' | 'contractor';
      type PayPeriodType = 'weekly' | 'bi-weekly' | 'semi-monthly' | 'monthly';
      type ContractorPaymentInterval = 'weekly' | 'bi-weekly' | 'monthly' | 'per-job';
      
      const typedEmployees = (employeesData || []).map(emp => ({
        ...emp,
        status: emp.status as EmployeeStatus,
        compensation_type: emp.compensation_type as CompensationType,
        pay_period_type: emp.pay_period_type as PayPeriodType | undefined,
        contractor_payment_interval: emp.contractor_payment_interval as ContractorPaymentInterval | undefined,
      }));

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

      // Calculate labor costs PER MONTH separately to match Payroll period-based calculations
      // This ensures salary/contractor employees get their proper monthly allocation
      // (not the entire range divided across all months)
      const monthsInRange = eachMonthOfInterval({ start: dateFrom, end: dateTo });
      
      for (const monthStart of monthsInRange) {
        const monthEnd = endOfMonth(monthStart);
        const monthKey = format(monthStart, 'yyyy-MM');
        
        // Filter time punches for this specific month
        const monthPunches = typedPunches.filter(punch => {
          const punchDate = new Date(punch.punch_time);
          return punchDate >= monthStart && punchDate <= monthEnd;
        });
        
        // Calculate labor for just this month (same logic as Payroll)
        const { dailyCosts: monthLaborCosts } = calculateActualLaborCost(
          typedEmployees,
          monthPunches,
          monthStart,
          monthEnd
        );
        
        // Build per-job payments map for this month only
        const monthPerJobPayments = new Map<string, number>();
        (manualPaymentsData || []).forEach((payment: { date: string; allocated_cost: number }) => {
          const paymentDate = new Date(payment.date);
          if (paymentDate >= monthStart && paymentDate <= monthEnd) {
            const current = monthPerJobPayments.get(payment.date) || 0;
            monthPerJobPayments.set(payment.date, current + (payment.allocated_cost / 100));
          }
        });
        
        // Aggregate labor for this month
        let monthPendingLabor = 0;
        
        monthLaborCosts.forEach((day) => {
          monthPendingLabor += day.total_cost;
          // Add per-job payments for this date (if any)
          const perJobAmount = monthPerJobPayments.get(day.date) || 0;
          monthPendingLabor += perJobAmount;
        });
        
        // Also add per-job payments for dates not in laborDailyCosts
        monthPerJobPayments.forEach((amount, dateStr) => {
          const alreadyProcessed = monthLaborCosts.some(d => d.date === dateStr);
          if (!alreadyProcessed) {
            monthPendingLabor += amount;
          }
        });
        
        // Ensure month exists in map
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
        const pendingCents = Math.round(monthPendingLabor * 100);
        month.pending_labor_cost += pendingCents;
        month.labor_cost += pendingCents;
      }

      // Aggregate actual labor costs from bank transactions
      bankLabor?.forEach((txn: any) => {
        const account = txn.chart_of_accounts as { account_subtype?: string } | null;
        if (account?.account_subtype === 'labor') {
          const transactionDate = normalizeToLocalDate(txn.transaction_date, 'bank_transactions.transaction_date');
          if (!transactionDate) return;
          
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

      // Aggregate actual labor costs from pending outflows
      pendingLabor?.forEach((txn: any) => {
        const account = txn.chart_account as { account_subtype?: string } | null;
        if (account?.account_subtype === 'labor') {
          const issueDate = normalizeToLocalDate(txn.issue_date, 'pending_outflows.issue_date');
          if (!issueDate) return;
          
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
