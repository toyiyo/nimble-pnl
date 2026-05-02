import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { format, startOfMonth, endOfMonth, eachMonthOfInterval } from 'date-fns';
import { calculateActualLaborCostForMonth } from '@/services/laborCalculations';
import {
  aggregateInventoryCOGSByDate,
  aggregateFinancialCOGSByDate,
  type BankTransactionRow,
  type PendingOutflowRow,
} from '@/services/cogsCalculations';
import type { TimePunch } from '@/types/timeTracking';
import type { SupabaseClient } from '@supabase/supabase-js';

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

const PASS_THROUGH_OTHER_LIABILITY_TYPES = new Set(['service_charge', 'fee']);

export interface MonthRevenueTotals {
  grossRevenueCents: number;
  discountsCents: number;
  netRevenueCents: number;
  salesTaxCents: number;
  tipsCents: number;
  otherLiabilitiesCents: number;
  posCollectedCents: number;
}

const toC = (n: number): number =>
  Number.isFinite(n) ? Math.sign(n) * Math.round(Math.abs(n) * 100) : 0;

/**
 * Pull revenue + pass-through totals for the period from the same RPCs that
 * useRevenueBreakdown uses, so the summary cards equal the breakdown panel
 * by construction.
 *
 * Inputs are dollars (numeric). All math is in integer cents.
 */
export async function fetchMonthRevenueTotals(
  client: SupabaseClient,
  restaurantId: string,
  fromStr: string,
  toStr: string
): Promise<MonthRevenueTotals> {
  const [{ data: revRows, error: revErr }, { data: passRows, error: passErr }] = await Promise.all([
    client.rpc('get_revenue_by_account', {
      p_restaurant_id: restaurantId,
      p_date_from: fromStr,
      p_date_to: toStr,
    }),
    client.rpc('get_pass_through_totals', {
      p_restaurant_id: restaurantId,
      p_date_from: fromStr,
      p_date_to: toStr,
    }),
  ]);

  if (revErr) throw revErr;
  if (passErr) throw passErr;

  let categorizedCents = 0;
  let uncategorizedCents = 0;
  for (const r of revRows ?? []) {
    if (r.is_categorized) categorizedCents += toC(Number(r.total_amount ?? 0));
    else uncategorizedCents += toC(Number(r.total_amount ?? 0));
  }
  const grossRevenueCents = categorizedCents + uncategorizedCents;

  let salesTaxCents = 0;
  let tipsCents = 0;
  let otherLiabilitiesCents = 0;
  let discountsCents = 0;
  for (const p of passRows ?? []) {
    const amt = toC(Number(p.total_amount ?? 0));
    if (p.adjustment_type === 'tax') salesTaxCents += amt;
    else if (p.adjustment_type === 'tip') tipsCents += amt;
    else if (p.adjustment_type === 'discount') discountsCents += Math.abs(amt);
    else if (PASS_THROUGH_OTHER_LIABILITY_TYPES.has(p.adjustment_type)) {
      otherLiabilitiesCents += amt;
    }
    // unknown types ignored: Migration A guarantees only tax/tip/service_charge/discount/fee here.
  }

  const netRevenueCents = grossRevenueCents - discountsCents;
  const posCollectedCents =
    grossRevenueCents + salesTaxCents + tipsCents + otherLiabilitiesCents;

  return {
    grossRevenueCents,
    discountsCents,
    netRevenueCents,
    salesTaxCents,
    tipsCents,
    otherLiabilitiesCents,
    posCollectedCents,
  };
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

      // Build monthly map (cents-based) for combining with COGS + labor below.
      const monthlyMap = new Map<string, {
        period: string;
        gross_revenue: number; // cents
        total_collected_at_pos: number; // cents
        net_revenue: number; // cents
        discounts: number; // cents
        refunds: number; // cents
        sales_tax: number; // cents
        tips: number; // cents
        other_liabilities: number; // cents
        food_cost: number; // cents
        labor_cost: number; // cents
        pending_labor_cost: number; // cents
        actual_labor_cost: number; // cents
        has_data: boolean;
      }>();

      const ensureMonth = (monthKey: string) => {
        if (!monthlyMap.has(monthKey)) {
          monthlyMap.set(monthKey, {
            period: monthKey,
            gross_revenue: 0, total_collected_at_pos: 0, net_revenue: 0,
            discounts: 0, refunds: 0, sales_tax: 0, tips: 0, other_liabilities: 0,
            food_cost: 0, labor_cost: 0, pending_labor_cost: 0, actual_labor_cost: 0,
            has_data: false,
          });
        }
        return monthlyMap.get(monthKey)!;
      };

      // Source revenue + POS from the same RPCs useRevenueBreakdown uses.
      // Per month so we can clamp the first and last partial months to the query window.
      const monthsInRange = eachMonthOfInterval({ start: dateFrom, end: dateTo });
      for (const rawMonthStart of monthsInRange) {
        const monthStart = startOfMonth(rawMonthStart);
        const monthEndFull = endOfMonth(monthStart);
        const clampedStart = monthStart < dateFrom ? dateFrom : monthStart;
        const clampedEnd = monthEndFull > dateTo ? dateTo : monthEndFull;
        if (clampedStart > clampedEnd) continue;

        const monthKey = format(monthStart, 'yyyy-MM');
        const totals = await fetchMonthRevenueTotals(
          supabase,
          restaurantId,
          format(clampedStart, 'yyyy-MM-dd'),
          format(clampedEnd, 'yyyy-MM-dd')
        );

        const month = ensureMonth(monthKey);
        month.gross_revenue          = totals.grossRevenueCents;
        month.discounts              = totals.discountsCents;
        month.net_revenue            = totals.netRevenueCents;
        month.sales_tax              = totals.salesTaxCents;
        month.tips                   = totals.tipsCents;
        month.other_liabilities      = totals.otherLiabilitiesCents;
        month.total_collected_at_pos = totals.posCollectedCents;
        month.has_data               = true;
      }

      // Fetch COGS preference setting
      const { data: settingsData } = await supabase
        .from('restaurant_financial_settings')
        .select('cogs_calculation_method')
        .eq('restaurant_id', restaurantId)
        .maybeSingle();
      const cogsMethod = (settingsData?.cogs_calculation_method as string) || 'inventory';

      // Fetch inventory COGS when method uses inventory data
      let foodCostsData: { created_at: string; transaction_date: string | null; total_cost: number }[] | null = null;
      if (cogsMethod === 'inventory' || cogsMethod === 'combined') {
        const { data, error: foodCostsError } = await supabase
          .from('inventory_transactions')
          .select('created_at, transaction_date, total_cost')
          .eq('restaurant_id', restaurantId)
          .eq('transaction_type', 'usage')
          .or(`transaction_date.gte.${format(dateFrom, 'yyyy-MM-dd')},and(transaction_date.is.null,created_at.gte.${format(dateFrom, 'yyyy-MM-dd')})`)
          .or(`transaction_date.lte.${format(dateTo, 'yyyy-MM-dd')},and(transaction_date.is.null,created_at.lte.${format(dateTo, 'yyyy-MM-dd')}T23:59:59.999Z)`)
          .limit(10000);
        if (foodCostsError) throw foodCostsError;
        foodCostsData = data;
      }

      // Fetch financial COGS when method uses financial data
      // financialCOGSByDay: yyyy-MM-dd → dollars (produced by shared pure helper)
      let financialCOGSByDay: Map<string, number> = new Map();
      if (cogsMethod === 'financials' || cogsMethod === 'combined') {
        // Non-split bank transactions with COGS subtypes
        const { data: cogsTxns, error: cogsTxnsError } = await supabase
          .from('bank_transactions')
          .select('transaction_date, amount, chart_of_accounts!category_id(account_subtype)')
          .eq('restaurant_id', restaurantId)
          .in('status', ['posted', 'pending'])
          .eq('is_transfer', false)
          .eq('is_split', false)
          .lt('amount', 0)
          .gte('transaction_date', fromStr)
          .lte('transaction_date', toStr)
          .limit(10000);
        if (cogsTxnsError) throw cogsTxnsError;

        // Split line items with COGS subtypes
        const { data: splitParents } = await supabase
          .from('bank_transactions')
          .select('id, transaction_date')
          .eq('restaurant_id', restaurantId)
          .eq('is_split', true)
          .in('status', ['posted', 'pending'])
          .eq('is_transfer', false)
          .gte('transaction_date', fromStr)
          .lte('transaction_date', toStr)
          .limit(10000);

        type SplitParentRow = { id: string; transaction_date: string };
        const splitParentIds = (splitParents || []).map((p: SplitParentRow) => p.id);
        let splitItems: Array<{
          transaction_id: string;
          amount: number;
          chart_of_accounts: { account_subtype?: string } | null;
        }> = [];
        // Day-keyed parentDateMap (yyyy-MM-dd) — required by shared helper
        const parentDateMap = new Map<string, string>();
        (splitParents || []).forEach((p: SplitParentRow) =>
          parentDateMap.set(p.id, format(new Date(p.transaction_date), 'yyyy-MM-dd'))
        );

        if (splitParentIds.length > 0) {
          const { data: splits } = await supabase
            .from('bank_transaction_splits')
            .select('transaction_id, amount, chart_of_accounts!category_id(account_subtype)')
            .in('transaction_id', splitParentIds)
            .limit(10000);

          splitItems = (splits || []) as typeof splitItems;
        }

        // Pending outflows with COGS subtypes
        const { data: cogsPending } = await supabase
          .from('pending_outflows')
          .select('issue_date, amount, chart_of_accounts!category_id(account_subtype)')
          .eq('restaurant_id', restaurantId)
          .in('status', ['pending', 'stale_30', 'stale_60', 'stale_90'])
          .is('linked_bank_transaction_id', null)
          .gte('issue_date', fromStr)
          .lte('issue_date', toStr)
          .limit(10000);

        // Aggregate all financial sources into a per-day dollar map via shared pure helper.
        // COGS_SUBTYPES filtering happens inside the helper.
        financialCOGSByDay = aggregateFinancialCOGSByDate({
          bankTxns: (cogsTxns || []) as BankTransactionRow[],
          splitItems,
          parentDateMap,
          pendingTxns: (cogsPending || []) as PendingOutflowRow[],
        });
      }

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

      // Tip splits within the query window (joined parent for restaurant_id + split_date)
      const { data: tipSplitItems, error: tipSplitItemsError } = await supabase
        .from('tip_split_items')
        .select('amount, employee_id, tip_splits!inner(restaurant_id, split_date)')
        .eq('tip_splits.restaurant_id', restaurantId)
        .gte('tip_splits.split_date', fromStr)
        .lte('tip_splits.split_date', toStr);

      if (tipSplitItemsError) {
        console.warn('Failed to fetch tip split items:', tipSplitItemsError);
      }

      type TipSplitRow = {
        amount: number;
        employee_id: string;
        tip_splits: { restaurant_id: string; split_date: string };
      };
      const typedTipSplits = (tipSplitItems ?? []) as TipSplitRow[];

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

      // Inventory COGS (when method is 'inventory' or 'combined')
      // Inventory COGS: use shared helper to get day→dollars map, then bucket to months (cents).
      if (cogsMethod === 'inventory' || cogsMethod === 'combined') {
        const invDaily = aggregateInventoryCOGSByDate(foodCostsData ?? []);
        for (const [dateKey, dollars] of invDaily) {
          const monthKey = dateKey.slice(0, 7); // yyyy-MM-dd → yyyy-MM
          const cents = Math.round(Math.abs(dollars) * 100);
          ensureMonth(monthKey).food_cost += cents;
        }
      }

      // Financial COGS: financialCOGSByDay is day→dollars; bucket to months (cents).
      if (cogsMethod === 'financials' || cogsMethod === 'combined') {
        for (const [dateKey, dollars] of financialCOGSByDay) {
          const monthKey = dateKey.slice(0, 7); // yyyy-MM-dd → yyyy-MM
          const cents = Math.round(Math.abs(dollars) * 100);
          ensureMonth(monthKey).food_cost += cents;
        }
      }

      // Calculate labor costs PER MONTH separately using ISO-week OT banding + tipsOwed.
      // For the *current* month, we clamp the month end to the query's dateTo (month-to-date)
      // so Monthly Performance matches Payroll/Performance Overview for in-progress months.
      for (const rawMonthStart of monthsInRange) {
        const monthStart = startOfMonth(rawMonthStart);
        const monthEndFull = endOfMonth(monthStart);
        const monthKey = format(monthStart, 'yyyy-MM');

        // Clamp to the overall query window (first/last month can be partial).
        const clampedStart = monthStart < dateFrom ? dateFrom : monthStart;
        const clampedEnd = monthEndFull > dateTo ? dateTo : monthEndFull;
        if (clampedStart > clampedEnd) continue;

        // Build per-employee tipsOwed for *this* month from typedTipSplits.
        // amount is stored as integer cents in the DB (tip_split_items.amount -- cents).
        const tipsOwedByEmployee = new Map<string, number>();
        for (const row of typedTipSplits) {
          const splitDate = new Date(row.tip_splits.split_date + 'T12:00:00');
          if (splitDate < clampedStart || splitDate > clampedEnd) continue;
          // amount is already in integer cents — no conversion needed.
          tipsOwedByEmployee.set(
            row.employee_id,
            (tipsOwedByEmployee.get(row.employee_id) ?? 0) + row.amount
          );
        }

        // OT-D labor for this month (ISO-week banding + tipsOwed).
        const { actualLaborCents } = calculateActualLaborCostForMonth({
          employees: typedEmployees as any,
          timePunches: typedPunches,
          tipsOwedByEmployee,
          monthStart: clampedStart,
          monthEnd: clampedEnd,
        });

        // Per-job manual payments for this month window.
        let monthPerJobCents = 0;
        (manualPaymentsData ?? []).forEach(
          (payment: { date: string; allocated_cost: number }) => {
            const paymentDate = new Date(payment.date);
            if (paymentDate >= clampedStart && paymentDate <= clampedEnd) {
              monthPerJobCents += payment.allocated_cost; // already in cents
            }
          }
        );

        const month = ensureMonth(monthKey);
        month.pending_labor_cost += actualLaborCents + monthPerJobCents;
        month.labor_cost += actualLaborCents + monthPerJobCents;
      }

      // Aggregate actual labor costs from bank transactions
      bankLabor?.forEach((txn: any) => {
        const account = txn.chart_of_accounts as { account_subtype?: string } | null;
        if (account?.account_subtype === 'labor') {
          const transactionDate = normalizeToLocalDate(txn.transaction_date, 'bank_transactions.transaction_date');
          if (!transactionDate) return;
          const monthKey = format(transactionDate, 'yyyy-MM');
          const month = ensureMonth(monthKey);
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
          const month = ensureMonth(monthKey);
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
        net_revenue: Math.round(month.net_revenue) / 100,
        total_collected_at_pos: Math.round(month.total_collected_at_pos) / 100,
      }));

      // Sort by period descending (most recent first)
      return result.sort((a, b) => b.period.localeCompare(a.period));
    },
    enabled: !!restaurantId,
    staleTime: 30000,
    refetchOnWindowFocus: true,
  });
}
