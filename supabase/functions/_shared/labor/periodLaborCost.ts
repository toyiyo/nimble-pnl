/**
 * Period labor loaders: the data assembly behind the dashboard labor pills,
 * the Labor page and the AI labor tools.
 *
 * - `loadPeriodLaborCost` is the body of the `useLaborCostsFromTimeTracking`
 *   query (time punches, per-job payments, tips owed).
 * - `loadPeriodBankLabor` is the body of the `useLaborCostsFromTransactions`
 *   query (bank transactions and pending outflows on labor accounts).
 *
 * Two kinds of `Date` go into the engine, and they must not mix:
 * - Fetch windows are instants (`windowStart` / `windowEnd`). They come from
 *   the day strings and the timezone (`businessDayRangeToInstants` and the
 *   week-aligned helpers). They go only to the `gte` / `lte` filters and to
 *   the in-memory punch window filter.
 * - Engine period arguments are day tokens (`dayStart` / `dayEnd`): local
 *   midnight of `startDay` and the local end of `endDay`. The engine reads
 *   their local fields.
 *
 * Every read pages with `fetchAllRowsKeyset` on `(order key, id)`.
 */
import {
  fetchAllKeyset,
  fromTable,
  PER_JOB_ALLOCATION_COLUMNS,
  TIME_PUNCH_COLUMNS,
  type PerJobAllocationRow,
  type TimePunchRow,
} from './loaderQuery.ts';
import {
  calculateActualLaborCost,
  calculateActualLaborCostForRange,
  type LaborCostBreakdown,
} from './laborCalculations.ts';
import {
  lookaheadPunchFetchRange,
  weekAlignedFetchEnd,
  weekAlignedFetchStart,
} from './punchWindow.ts';
import { appendOpenShiftClockOuts } from './openShiftPunches.ts';
import {
  fetchTipPayoutRowsKeyset,
  fetchTipSplitRowsKeyset,
  netTipsOwedByEmployee,
} from './tipsFetch.ts';
import { businessDayRangeToInstants } from './restaurantClock.ts';
import { assertDayRange, dayTokens } from './dateOnly.ts';
import type { LaborEmployee, LaborQueryClient } from './types.ts';

// ============================================================================
// loadPeriodLaborCost
// ============================================================================

/** One day of the straight-time labor series (dollars). */
export interface LaborCostData {
  date: string;
  total_labor_cost: number;
  hourly_wages: number;
  salary_wages: number;
  contractor_payments: number;
  total_hours: number;
}

export interface PeriodLaborCostInput {
  restaurantId: string;
  /** First restaurant day of the period, `YYYY-MM-DD`. */
  startDay: string;
  /** Last restaurant day of the period (inclusive), `YYYY-MM-DD`. */
  endDay: string;
  /** Restaurant IANA timezone. */
  timeZone: string;
  employees: LaborEmployee[];
  /** Close a still-open shift at `now`, so a live view counts its hours. */
  throughNow: boolean;
  /** A real instant (`new Date()` read by the caller). Read only for `throughNow`. */
  now: Date;
}

export interface PeriodLaborCostResult {
  /** Straight-time daily series plus per-job payments (dollars). */
  dailyCosts: LaborCostData[];
  /** The `calculateActualLaborCost` breakdown of the straight-time series. */
  breakdown: LaborCostBreakdown;
  /** Wages with OT banding + tips owed + per-job payments (dollars). */
  totalCost: number;
  /** Wages + per-job payments, tips owed excluded (dollars). */
  wageCost: number;
  /** True when a paged read hit the `maxPages` cap. */
  capped: boolean;
}

/**
 * Labor cost of a period of whole restaurant days, from time punches,
 * employee pay settings, per-job payments and tips owed.
 */
export async function loadPeriodLaborCost(
  client: LaborQueryClient,
  input: PeriodLaborCostInput,
): Promise<PeriodLaborCostResult> {
  const { restaurantId, startDay, endDay, timeZone, employees, throughNow, now } = input;
  assertDayRange('loadPeriodLaborCost', startDay, endDay);

  // Fetch windows (instants). Look-AHEAD only, not symmetric:
  // calculateActualLaborCost attributes hours to every day a shift touches and
  // does not drop a shift whose clock-in is before the window. A look-back
  // would pull a prior-period Sunday-night shift into the first day. The
  // look-ahead completes an in-range shift whose clock-out is after the window.
  const { start: windowStart, end: windowEnd } = businessDayRangeToInstants(startDay, endDay, timeZone);
  const { fetchStart, fetchEnd } = lookaheadPunchFetchRange(windowStart, windowEnd);

  // calculateActualLaborCostForRange bands overtime over the FULL
  // restaurant-local week. Widen the fetch to both edge weeks whole. The
  // straight-time series must not see these extra days (see below).
  const otFetchStart = weekAlignedFetchStart(startDay, fetchStart, timeZone);
  const otFetchEnd = weekAlignedFetchEnd(endDay, fetchEnd, timeZone);

  // Engine period arguments (day tokens).
  const { dayStart, dayEnd } = dayTokens(startDay, endDay);

  // The four reads are independent. Run them together.
  const [
    { rows: punchRows, capped: punchesCapped },
    { rows: perJobRows, capped: perJobCapped },
    { rows: tipRows, capped: tipsCapped },
    { rows: tipPayoutRows, capped: tipPayoutsCapped },
  ] = await Promise.all([
    fetchAllKeyset<TimePunchRow, 'punch_time'>(
      () =>
        fromTable(client, 'time_punches')
          .select(TIME_PUNCH_COLUMNS)
          .eq('restaurant_id', restaurantId)
          .gte('punch_time', otFetchStart.toISOString())
          .lte('punch_time', otFetchEnd.toISOString()),
      'punch_time',
    ),
    // Per-job contractor payments (source records only).
    fetchAllKeyset<PerJobAllocationRow>(
      () =>
        fromTable(client, 'daily_labor_allocations')
          .select(PER_JOB_ALLOCATION_COLUMNS)
          .eq('restaurant_id', restaurantId)
          .eq('source', 'per-job') // Only per-job source records, not auto-generated
          .gte('date', startDay)
          .lte('date', endDay),
      'id',
    ),
    // Tips owed in the period (integer cents). Same source and filters as
    // useMonthlyMetrics, so the two surfaces agree.
    fetchTipSplitRowsKeyset(client, restaurantId, startDay, endDay),
    // Payouts in the same period reduce tips owed (the Payroll netting).
    fetchTipPayoutRowsKeyset(client, restaurantId, startDay, endDay),
  ]);

  const tipsOwedByEmployee = netTipsOwedByEmployee(tipRows, tipPayoutRows);

  // A live view closes a still-open shift at `now` (a real instant), so its
  // in-progress hours count.
  const punchesForCost = throughNow ? appendOpenShiftClockOuts(punchRows, now) : punchRows;

  // The straight-time series must not see the week look-back / look-ahead
  // days. Keep the punches of the un-widened fetch window only.
  const punchesForDailyCost = punchesForCost.filter((punch) => {
    const t = new Date(punch.punch_time).getTime();
    return t >= fetchStart.getTime() && t <= fetchEnd.getTime();
  });

  const { breakdown, dailyCosts: laborDailyCosts } = calculateActualLaborCost(
    employees,
    punchesForDailyCost,
    dayStart,
    dayEnd,
    timeZone,
  );

  // Add the per-job payments to the daily series (not in the punch calc).
  const dateMap = new Map<string, LaborCostData>();
  laborDailyCosts.forEach((day) => {
    dateMap.set(day.date, {
      date: day.date,
      total_labor_cost: day.total_cost,
      hourly_wages: day.hourly_cost,
      salary_wages: day.salary_cost,
      contractor_payments: day.contractor_cost,
      total_hours: day.hours_worked,
    });
  });
  perJobRows.forEach((payment) => {
    const paymentDollars = payment.allocated_cost / 100;
    const dayData = dateMap.get(payment.date);
    if (dayData) {
      dayData.contractor_payments += paymentDollars;
      dayData.total_labor_cost += paymentDollars;
    } else {
      dateMap.set(payment.date, {
        date: payment.date,
        total_labor_cost: paymentDollars,
        hourly_wages: 0,
        salary_wages: 0,
        contractor_payments: paymentDollars,
        total_hours: 0,
      });
    }
  });
  const dailyCosts = Array.from(dateMap.values()).sort((a, b) => a.date.localeCompare(b.date));

  // totalCost uses the payroll formula (OT banding + tips owed), so the
  // dashboard pills equal Monthly Performance and Payroll.
  const { wagesCents, actualLaborCents } = calculateActualLaborCostForRange({
    employees,
    timePunches: punchesForCost,
    tipsOwedByEmployee,
    rangeStart: dayStart,
    rangeEnd: dayEnd,
    timezone: timeZone,
  });

  const perJobDollars = perJobRows.reduce((sum, payment) => sum + payment.allocated_cost / 100, 0);

  return {
    dailyCosts,
    breakdown,
    totalCost: actualLaborCents / 100 + perJobDollars,
    wageCost: wagesCents / 100 + perJobDollars,
    capped: punchesCapped || perJobCapped || tipsCapped || tipPayoutsCapped,
  };
}

// ============================================================================
// loadPeriodBankLabor
// ============================================================================

/** One day of paid (bank) labor (dollars). */
export interface TransactionLaborCostData {
  date: string;
  labor_cost: number;
  transaction_count: number;
}

export interface PeriodBankLaborInput {
  restaurantId: string;
  /** First day, `YYYY-MM-DD`. */
  startDay: string;
  /** Last day (inclusive), `YYYY-MM-DD`. */
  endDay: string;
}

export interface PeriodBankLaborResult {
  dailyCosts: TransactionLaborCostData[];
  totalCost: number;
  /** True when a paged read hit the `maxPages` cap. */
  capped: boolean;
}

type AccountSubtype = { account_subtype?: string } | null;

interface BankTxnRow {
  id: string;
  transaction_date: string;
  amount: number;
  status: string;
  chart_of_accounts: AccountSubtype;
}

interface PendingOutflowRow {
  id: string;
  issue_date: string;
  amount: number;
  status: string;
  chart_account: AccountSubtype;
}

/**
 * Paid labor of a day range: bank transactions (outflows) and pending
 * outflows on chart-of-accounts rows with `account_subtype = 'labor'`.
 * The date columns are calendar days, so the filters take the day strings.
 */
export async function loadPeriodBankLabor(
  client: LaborQueryClient,
  input: PeriodBankLaborInput,
): Promise<PeriodBankLaborResult> {
  const { restaurantId, startDay, endDay } = input;
  assertDayRange('loadPeriodBankLabor', startDay, endDay);

  const [{ rows: bankTxns, capped: bankCapped }, { rows: pendingTxns, capped: pendingCapped }] =
    await Promise.all([
      fetchAllKeyset<BankTxnRow>(
        () =>
          fromTable(client, 'bank_transactions')
            .select(`
              id,
              transaction_date,
              amount,
              status,
              chart_of_accounts!category_id(
                account_subtype
              )
            `)
            .eq('restaurant_id', restaurantId)
            .gte('transaction_date', startDay)
            .lte('transaction_date', endDay)
            .in('status', ['posted', 'pending'])
            .lt('amount', 0), // Only outflows
        'id',
      ),
      fetchAllKeyset<PendingOutflowRow>(
        () =>
          fromTable(client, 'pending_outflows')
            .select(`
              id,
              issue_date,
              amount,
              status,
              chart_account:chart_of_accounts!category_id(
                account_subtype
              )
            `)
            .eq('restaurant_id', restaurantId)
            .gte('issue_date', startDay)
            .lte('issue_date', endDay)
            .in('status', ['pending', 'stale_30', 'stale_60', 'stale_90']),
        'id',
      ),
    ]);

  const dateMap = new Map<string, { cost: number; count: number }>();
  const add = (date: string, amount: number) => {
    const cost = Math.abs(amount);
    const existing = dateMap.get(date);
    if (existing) {
      existing.cost += cost;
      existing.count += 1;
    } else {
      dateMap.set(date, { cost, count: 1 });
    }
  };

  bankTxns.forEach((txn) => {
    if (txn.chart_of_accounts?.account_subtype === 'labor') add(txn.transaction_date, txn.amount);
  });
  pendingTxns.forEach((txn) => {
    if (txn.chart_account?.account_subtype === 'labor') add(txn.issue_date, txn.amount);
  });

  const dailyCosts: TransactionLaborCostData[] = Array.from(dateMap.entries())
    .map(([date, data]) => ({ date, labor_cost: data.cost, transaction_count: data.count }))
    .sort((a, b) => a.date.localeCompare(b.date));

  const totalCost = dailyCosts.reduce((sum, day) => sum + day.labor_cost, 0);

  return { dailyCosts, totalCost, capped: bankCapped || pendingCapped };
}
