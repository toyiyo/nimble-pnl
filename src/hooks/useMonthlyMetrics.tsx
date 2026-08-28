import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { format, startOfMonth, endOfMonth, eachMonthOfInterval } from 'date-fns';
import { calculateActualLaborCostForMonth } from '@/services/laborCalculations';
import { resolveLaborBasis } from '@/lib/combineCosts';
import {
  aggregateInventoryCOGSByDate,
  aggregateFinancialCOGSByDate,
  toUtcDayKey,
  type InventoryTransactionRow,
} from '@/services/cogsCalculations';
import type { TimePunch, DBTimePunch } from '@/types/timeTracking';
import type { SupabaseClient } from '@supabase/supabase-js';
import { lookaheadPunchFetchRange } from '@/utils/punchWindow';
import { fetchAllRows } from '@/utils/fetchAllRows';
import { fetchFinancialCOGSRows, COGS_MAX_PAGES } from '@/services/cogsFetch';
import { useRestaurantClock } from './useRestaurantClock';
import { toDateOnlyString } from '@/lib/dateOnly';
import { isCompensationHidden } from '@/lib/employeeMaskedFields';

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
  /** True when at least one employee row is masked (no view:pay_rates), so labor_cost is unknown, not zero. */
  labor_cost_hidden: boolean;
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
 * True when an employee's employment window overlaps a month. Scopes the
 * `labor_cost_hidden` check below to employees who could actually book cost
 * in that month — a masked employee hired last week must not blank out a
 * year of earlier months, and a masked employee gone since last year must
 * not blank out this month.
 */
const isEmployedDuringMonth = (
  emp: { hire_date?: string | null; termination_date?: string | null },
  monthStart: Date,
  monthEnd: Date
): boolean => {
  const hireDate = emp.hire_date ? new Date(`${emp.hire_date}T12:00:00`) : null;
  if (hireDate && hireDate > monthEnd) return false;
  const terminationDate = emp.termination_date ? new Date(`${emp.termination_date}T12:00:00`) : null;
  if (terminationDate && terminationDate < monthStart) return false;
  return true;
};

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
  const [
    { data: revRows, error: revErr },
    { data: passRows, error: passErr },
    { data: unifiedRows, error: unifiedErr },
  ] = await Promise.all([
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
    // Source of truth for "Collected at POS" — matches the deposit and the
    // POS Sales page filter total. The legacy `gross + tax + tips + other`
    // formula excludes void/discount offset rows in unified_sales.total_price
    // and disagrees with both. See useUnifiedSalesTotals for the same call.
    client.rpc('get_unified_sales_totals', {
      p_restaurant_id: restaurantId,
      p_start_date: fromStr,
      p_end_date: toStr,
    }),
  ]);

  if (revErr) throw revErr;
  if (passErr) throw passErr;
  // Soft-fail on the unified RPC: if it errors, fall back to the legacy
  // `gross + tax + tips + other` formula below rather than tank the whole
  // monthly metrics query. Matches useRevenueBreakdown's behavior.
  if (unifiedErr) {
    console.warn('Failed to fetch unified sales totals, falling back to legacy posCollected formula:', unifiedErr);
  }

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
  const posCollectedCents = unifiedErr
    ? grossRevenueCents + salesTaxCents + tipsCents + otherLiabilitiesCents
    : toC(Number(unifiedRows?.[0]?.collected_at_pos ?? 0));

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
 * and source tables (inventory_transactions, time_punches, daily_labor_allocations,
 * bank_transactions, and pending_outflows for costs).
 *
 * ✅ Use this hook for monthly performance tables
 * ❌ Don't use getMonthlyData() from useDailyPnL (incorrect/outdated)
 */

export function useMonthlyMetrics(
  restaurantId: string | null,
  dateFrom: Date,
  dateTo: Date
) {
  const { tz: timezone } = useRestaurantClock();

  const query = useQuery({
    queryKey: ['monthly-metrics', restaurantId, toDateOnlyString(dateFrom), toDateOnlyString(dateTo), timezone],
    queryFn: async () => {
      if (!restaurantId) return { months: [], warnings: [] };

      const fromStr = toDateOnlyString(dateFrom);
      const toStr = toDateOnlyString(dateTo);
      const warnings: string[] = [];

      // bank_transactions.transaction_date is TIMESTAMPTZ; pending_outflows.issue_date
      // is DATE. Slice to yyyy-MM-dd then take first 7 chars for the month bucket.
      // See toUtcDayKey for the TZ rationale.
      const monthKeyFor = (raw: string | null | undefined): string | null =>
        raw ? toUtcDayKey(raw).slice(0, 7) : null;

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
        /** True when a masked employee's window overlaps this month. Per-month, not roster-wide — see isEmployedDuringMonth. */
        labor_cost_hidden: boolean;
      }>();

      const ensureMonth = (monthKey: string) => {
        if (!monthlyMap.has(monthKey)) {
          monthlyMap.set(monthKey, {
            period: monthKey,
            gross_revenue: 0, total_collected_at_pos: 0, net_revenue: 0,
            discounts: 0, refunds: 0, sales_tax: 0, tips: 0, other_liabilities: 0,
            food_cost: 0, labor_cost: 0, pending_labor_cost: 0, actual_labor_cost: 0,
            has_data: false, labor_cost_hidden: false,
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
          toDateOnlyString(clampedStart),
          toDateOnlyString(clampedEnd)
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
      let foodCostsData: InventoryTransactionRow[] = [];
      if (cogsMethod === 'inventory' || cogsMethod === 'combined') {
        const { rows, capped: inventoryCapped } = await fetchAllRows<InventoryTransactionRow>(
          (from, to) =>
            supabase
              .from('inventory_transactions')
              .select('created_at, transaction_date, total_cost')
              .eq('restaurant_id', restaurantId)
              .eq('transaction_type', 'usage')
              .or(`transaction_date.gte.${fromStr},and(transaction_date.is.null,created_at.gte.${fromStr})`)
              .or(`transaction_date.lte.${toStr},and(transaction_date.is.null,created_at.lte.${toStr}T23:59:59.999Z)`)
              .order('created_at', { ascending: true })
              .order('id')
              .range(from, to),
          { maxPages: COGS_MAX_PAGES }
        );
        foodCostsData = rows;

        if (inventoryCapped) {
          console.warn('inventory COGS fetch hit the page limit; the food cost figure is incomplete.');
          warnings.push('The inventory COGS rows hit the fetch limit. The food cost figure is incomplete.');
        }
      }

      // Fetch financial COGS when method uses financial data
      // financialCOGSByDay: yyyy-MM-dd → dollars (produced by shared pure helper)
      let financialCOGSByDay: Map<string, number> = new Map();
      if (cogsMethod === 'financials' || cogsMethod === 'combined') {
        const { bankTxns, splitItems, parentDateMap, pendingTxns, capped: financialCapped } =
          await fetchFinancialCOGSRows(supabase, restaurantId, fromStr, toStr);

        if (financialCapped) {
          console.warn('financial COGS fetch hit the page limit; the food cost figure is incomplete.');
          warnings.push('The financial COGS rows hit the fetch limit. The food cost figure is incomplete.');
        }

        // Aggregate all financial sources into a per-day dollar map via shared pure helper.
        // COGS_SUBTYPES filtering happens inside the helper.
        financialCOGSByDay = aggregateFinancialCOGSByDate({ bankTxns, splitItems, parentDateMap, pendingTxns });
      }

      // Fetch actual labor costs from bank transactions + pending outflows
      // Use same pattern as useLaborCostsFromTransactions (no alias)
      const { rows: bankLabor, capped: bankLaborCapped } = await fetchAllRows(
        (from, to) =>
          supabase
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
            .gte('transaction_date', fromStr)
            .lte('transaction_date', toStr)
            .in('status', ['posted', 'pending'])
            .lt('amount', 0) // Only outflows
            .order('transaction_date', { ascending: true })
            .order('id')
            .range(from, to)
      );

      if (bankLaborCapped) {
        console.warn('bank labor fetch hit the page limit; the labor cost figure is incomplete.');
        warnings.push('The bank labor rows hit the fetch limit. The labor cost figure is incomplete.');
      }

      const { rows: pendingLabor, capped: pendingLaborCapped } = await fetchAllRows(
        (from, to) =>
          supabase
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
            .gte('issue_date', fromStr)
            .lte('issue_date', toStr)
            .in('status', ['pending', 'stale_30', 'stale_60', 'stale_90'])
            .order('issue_date', { ascending: true })
            .order('id')
            .range(from, to)
      );

      if (pendingLaborCapped) {
        console.warn('pending labor fetch hit the page limit; the labor cost figure is incomplete.');
        warnings.push('The pending labor rows hit the fetch limit. The labor cost figure is incomplete.');
      }

      // Fetch time punches and employees to calculate labor costs using the same logic as Payroll
      // This ensures Dashboard and Payroll show consistent labor numbers (DRY principle)
      // Look-ahead buffer so an overnight shift clocking out just after the range
      // end (e.g. the 1st of the next month) is fetched whole; the per-month
      // clock-in-day clip drops shifts whose clock-in belongs outside the window.
      //
      // Paginated via `fetchAllRows` (not a single unbounded `.select()`):
      // PostgREST caps an unpaginated response at 1,000 rows, which would
      // silently drop the newest punches (the query orders `punch_time asc`)
      // once the window's punches cross that threshold. The `.order('id')`
      // tiebreaker makes each page boundary deterministic when multiple
      // punches share a `punch_time`. Errors stay non-fatal (console.warn)
      // to match this hook's existing behavior for the labor calculation.
      let timePunchesData: DBTimePunch[] | null = null;
      try {
        const { rows, capped } = await fetchAllRows<DBTimePunch>((from, to) =>
          supabase
            .from('time_punches')
            .select('*')
            .eq('restaurant_id', restaurantId)
            .gte('punch_time', dateFrom.toISOString())
            .lte('punch_time', lookaheadPunchFetchRange(dateFrom, dateTo).fetchEnd.toISOString())
            .order('punch_time', { ascending: true })
            .order('id')
            .range(from, to),
        );
        timePunchesData = rows;
        if (capped) {
          console.warn(
            '[useMonthlyMetrics] time_punches fetch hit the pagination cap (maxPages); monthly labor may be missing punches',
            { restaurantId, dateFrom: dateFrom.toISOString(), dateTo: dateTo.toISOString() },
          );
          warnings.push('The time punch rows hit the fetch limit. The labor cost figure is incomplete.');
        }
      } catch (timePunchesError) {
        console.warn('Failed to fetch time punches for labor calculation:', timePunchesError);
      }

      const { data: employeesData, error: employeesError } = await supabase
        .from('employees_secure')
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
        .gte('date', toDateOnlyString(dateFrom))
        .lte('date', toDateOnlyString(dateTo));

      if (manualPaymentsError) {
        console.warn('Failed to fetch manual payments:', manualPaymentsError);
      }

      // Tip splits within the query window (joined parent for restaurant_id + split_date)
      type TipSplitRow = {
        amount: number;
        employee_id: string;
        tip_splits: { restaurant_id: string; split_date: string };
      };
      const { rows: tipSplitsData, capped: tipsCapped } = await fetchAllRows<TipSplitRow>(
        (from, to) =>
          supabase
            .from('tip_split_items')
            .select('amount, employee_id, tip_splits!inner(restaurant_id, split_date)')
            .eq('tip_splits.restaurant_id', restaurantId)
            .gte('tip_splits.split_date', fromStr)
            .lte('tip_splits.split_date', toStr)
            .order('id')
            .range(from, to)
      );

      if (tipsCapped) {
        console.warn('tips fetch hit the page limit; the labor cost figure is incomplete.');
        warnings.push('The tip rows hit the fetch limit. The labor cost figure is incomplete.');
      }

      // Convert time punches to the expected format: cast punch_type to the union
      // and narrow location from the DB's JSON to the typed shape.
      type RawPunch = Omit<TimePunch, 'punch_type' | 'location'> & {
        punch_type: string;
        location: unknown;
      };
      const typedPunches: TimePunch[] = (timePunchesData || []).map((p) => {
        const punch = p as RawPunch;
        return {
          ...punch,
          punch_type: punch.punch_type as TimePunch['punch_type'],
          location:
            punch.location &&
            typeof punch.location === 'object' &&
            'latitude' in punch.location &&
            'longitude' in punch.location
              ? (punch.location as { latitude: number; longitude: number })
              : undefined,
        };
      });

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
          ensureMonth(monthKey).food_cost += toC(dollars);
        }
      }

      // Financial COGS: financialCOGSByDay is day→dollars; bucket to months (cents).
      if (cogsMethod === 'financials' || cogsMethod === 'combined') {
        for (const [dateKey, dollars] of financialCOGSByDay) {
          const monthKey = dateKey.slice(0, 7); // yyyy-MM-dd → yyyy-MM
          ensureMonth(monthKey).food_cost += toC(dollars);
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

        // Build per-employee tipsOwed for *this* month from tipSplitsData.
        // amount is stored as integer cents in the DB (tip_split_items.amount -- cents).
        const tipsOwedByEmployee = new Map<string, number>();
        for (const row of tipSplitsData) {
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
          timezone,
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

        // A masked pay column arrives as null from employees_secure, and a
        // null rate computes as a $0 cost — a wrong number, not a hidden
        // one. Scoped to employees whose employment window overlaps this
        // month, so a masked hire last week does not blank out last year.
        month.labor_cost_hidden = typedEmployees.some(
          (emp) => isEmployedDuringMonth(emp, clampedStart, clampedEnd) && isCompensationHidden(emp)
        );
      }

      // Aggregate actual labor costs from bank transactions
      bankLabor?.forEach((txn: any) => {
        const account = txn.chart_of_accounts as { account_subtype?: string } | null;
        if (account?.account_subtype === 'labor') {
          const monthKey = monthKeyFor(txn.transaction_date);
          if (!monthKey) return;
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
          const monthKey = monthKeyFor(txn.issue_date);
          if (!monthKey) return;
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
        labor_cost:
          resolveLaborBasis(month.pending_labor_cost) === 'accrued'
            ? Math.round(month.pending_labor_cost) / 100
            : Math.round(month.actual_labor_cost) / 100,
        pending_labor_cost: Math.round(month.pending_labor_cost) / 100,
        actual_labor_cost: Math.round(month.actual_labor_cost) / 100,
        has_data: month.has_data,
        labor_cost_hidden: month.labor_cost_hidden,
        net_revenue: Math.round(month.net_revenue) / 100,
        total_collected_at_pos: Math.round(month.total_collected_at_pos) / 100,
      }));

      // Sort by period descending (most recent first)
      return {
        months: result.sort((a, b) => b.period.localeCompare(a.period)),
        warnings,
      };
    },
    enabled: !!restaurantId,
    staleTime: 30000,
    refetchOnWindowFocus: true,
  });

  return {
    data: query.data?.months ?? null,
    warnings: query.data?.warnings ?? [],
    isLoading: query.isLoading,
    error: (query.error as Error | null) ?? null,
    refetch: query.refetch,
  };
}
