/**
 * The payroll loader: the body of the `usePayroll` query. The Payroll page,
 * the employee pay page (self-scoped) and (in PR 2) the AI payroll tool use
 * it, so the figures cannot drift apart.
 *
 * - Fetch windows are instants (`windowStart` / `windowEnd`) from the day
 *   strings and the restaurant timezone. The punch fetch adds the +/- 18 h
 *   overnight buffer to them. The DATE columns take the day strings.
 * - Engine period arguments are day tokens (`dayStart` / `dayEnd`).
 * - Every read pages with `fetchAllRowsKeyset` on `(order key, id)`.
 */
import { fetchAllRowsKeyset, type PagedResult } from './fetchAllRows.ts';
import { chunk, fromTable, keysetPage, type LoaderQuery } from './loaderQuery.ts';
import {
  calculatePayrollPeriod,
  shouldIncludeEmployeeInPayroll,
  type ManualPayment,
  type PayrollPeriod,
} from './payrollCalculations.ts';
import type { OvertimeAdjustment, OvertimeRules } from './overtimeCalculations.ts';
import {
  computeTipTotalsWithFiltering,
  type EmployeeTip,
  type TipSplitItem,
} from './tipAggregation.ts';
import { bufferPunchFetchRange } from './punchWindow.ts';
import { businessDayRangeToInstants } from './restaurantClock.ts';
import { assertDayRange } from './dateOnly.ts';
import { dayTokens, TIME_PUNCH_COLUMNS, toLaborPunch, type TimePunchRow } from './periodLaborCost.ts';
import type { LaborEmployee, LaborQueryClient, LaborTimePunch } from './types.ts';

/** The most tip split ids in one `.in()` filter, so the URL stays short. */
export const TIP_SPLIT_ID_CHUNK = 100;

/** Split statuses that payroll counts: approved and archived (locked). */
const PAYROLL_TIP_SPLIT_STATUSES = ['approved', 'archived'];

export interface PayrollPeriodInput {
  restaurantId: string;
  /** First restaurant day of the pay period, `YYYY-MM-DD`. */
  startDay: string;
  /** Last restaurant day of the pay period (inclusive), `YYYY-MM-DD`. */
  endDay: string;
  /** Restaurant IANA timezone. */
  timeZone: string;
  employees: LaborEmployee[];
  /**
   * `undefined`: all employees (admin). A non-empty string: one employee
   * (self-scoped). `null` and `''` are not valid: the loader throws, and the
   * caller must wait for the id. The type allows `null`, so a caller that
   * holds the hook's `string | null` gets the check at runtime.
   */
  employeeId?: string | null;
}

export interface PayrollPeriodResult {
  period: PayrollPeriod;
  /** True when a paged read hit the `maxPages` cap. */
  capped: boolean;
}

interface TipSplitRow {
  id: string;
  total_amount: number;
}

interface TipSplitItemRow {
  id: string;
  employee_id: string;
  amount: number;
  tip_split_id: string;
  tip_splits?: { split_date: string } | null;
}

interface PerJobAllocationRow {
  id: string;
  employee_id: string;
  date: string;
  allocated_cost: number;
  notes: string | null;
}

interface EmployeeTipRow {
  id: string;
  employee_id: string;
  tip_amount: number;
  tip_date: string;
}

interface TipPayoutRow {
  id: string;
  employee_id: string;
  amount: number;
}

interface OvertimeRulesRow {
  weekly_threshold_hours: number | string;
  weekly_ot_multiplier: number | string;
  daily_threshold_hours: number | string | null;
  daily_ot_multiplier: number | string;
  daily_double_threshold_hours: number | string | null;
  daily_double_multiplier: number | string;
  exclude_tips_from_ot_rate: boolean;
}

interface OvertimeAdjustmentRow {
  id: string;
  employee_id: string;
  punch_date: string;
  adjustment_type: string;
  hours: number | string;
  reason: string | null;
}

/**
 * Payroll of a pay period of whole restaurant days.
 *
 * Throws on `employeeId: null` and on `employeeId: ''`. The hook uses `null`
 * for "self-scoped, the id is not known yet", and a missing filter would read
 * every employee.
 */
export async function loadPayrollPeriod(
  client: LaborQueryClient,
  input: PayrollPeriodInput,
): Promise<PayrollPeriodResult> {
  const { restaurantId, startDay, endDay, timeZone, employees } = input;
  assertDayRange('loadPayrollPeriod', startDay, endDay);
  const { employeeId } = input;
  if (employeeId === null) {
    throw new Error('loadPayrollPeriod: employeeId is null. Pass undefined for all employees, or wait for the id.');
  }
  if (employeeId !== undefined && (typeof employeeId !== 'string' || employeeId === '')) {
    throw new Error('loadPayrollPeriod: employeeId must be undefined or a non-empty string.');
  }

  // Self-scoped: narrow a per-employee read to the one employee.
  const scope = (query: LoaderQuery): LoaderQuery =>
    employeeId !== undefined ? query.eq('employee_id', employeeId) : query;

  // Fetch windows (instants). The +/- 18 h buffer on the restaurant-day
  // bounds fetches an overnight shift that crosses the period edge whole.
  // calculateEmployeePay then keeps each shift by its clock-in day.
  const { start: windowStart, end: windowEnd } = businessDayRangeToInstants(startDay, endDay, timeZone);
  const { fetchStart, fetchEnd } = bufferPunchFetchRange(windowStart, windowEnd);

  // Engine period arguments (day tokens).
  const { dayStart, dayEnd } = dayTokens(startDay, endDay);

  const byId = <T extends { id: string }>(build: () => LoaderQuery): Promise<PagedResult<T>> =>
    fetchAllRowsKeyset<T, 'id'>((after, pageSize) => keysetPage<T>(build(), 'id', undefined, after, pageSize), 'id');

  const [punchesRead, splitsRead, perJobRead, employeeTipsRead, payoutsRead, otRulesRead, otAdjustmentsRead] =
    await Promise.all([
      fetchAllRowsKeyset<TimePunchRow, 'punch_time'>(
        (after, pageSize) =>
          keysetPage<TimePunchRow>(
            scope(
              fromTable(client, 'time_punches')
                .select(TIME_PUNCH_COLUMNS)
                .eq('restaurant_id', restaurantId)
                .gte('punch_time', fetchStart.toISOString())
                .lte('punch_time', fetchEnd.toISOString()),
            ),
            'punch_time',
            { ascending: true },
            after,
            pageSize,
          ),
        'punch_time',
      ),
      // Approved and archived (locked) splits count in payroll. Restaurant
      // scoped: the self-scoped filter goes on the items.
      byId<TipSplitRow>(() =>
        fromTable(client, 'tip_splits')
          .select('id, total_amount')
          .eq('restaurant_id', restaurantId)
          .in('status', PAYROLL_TIP_SPLIT_STATUSES)
          .gte('split_date', startDay)
          .lte('split_date', endDay),
      ),
      // Manual payments (per-job contractor payments).
      byId<PerJobAllocationRow>(() =>
        scope(
          fromTable(client, 'daily_labor_allocations')
            .select('*')
            .eq('restaurant_id', restaurantId)
            .eq('source', 'per-job')
            .gte('date', startDay)
            .lte('date', endDay),
        ),
      ),
      byId<EmployeeTipRow>(() =>
        scope(
          fromTable(client, 'employee_tips')
            .select('id, employee_id, tip_amount, tip_date')
            .eq('restaurant_id', restaurantId)
            .gte('tip_date', startDay)
            .lte('tip_date', endDay),
        ),
      ),
      // Tip payouts (cash already paid out).
      byId<TipPayoutRow>(() =>
        scope(
          fromTable(client, 'tip_payouts')
            .select('id, employee_id, amount')
            .eq('restaurant_id', restaurantId)
            .gte('payout_date', startDay)
            .lte('payout_date', endDay),
        ),
      ),
      fromTable(client, 'overtime_rules')
        .select('weekly_threshold_hours, weekly_ot_multiplier, daily_threshold_hours, daily_ot_multiplier, daily_double_threshold_hours, daily_double_multiplier, exclude_tips_from_ot_rate')
        .eq('restaurant_id', restaurantId)
        .maybeSingle(),
      // An error here only logs, as before: payroll runs with no adjustments.
      byId<OvertimeAdjustmentRow>(() =>
        scope(
          fromTable(client, 'overtime_adjustments')
            .select('id, employee_id, punch_date, adjustment_type, hours, reason')
            .eq('restaurant_id', restaurantId)
            .gte('punch_date', startDay)
            .lte('punch_date', endDay),
        ),
      ).catch((error: unknown): PagedResult<OvertimeAdjustmentRow> => {
        console.error('Error fetching overtime adjustments:', error);
        return { rows: [], capped: false };
      }),
    ]);

  // Tip split items of those splits, in chunks of ids. An empty `.in()`
  // sends `in.()`, which PostgREST rejects on a uuid column, so no chunk
  // means no read.
  const splitIds = splitsRead.rows.map((split) => split.id);
  const itemReads = await Promise.all(
    chunk(splitIds, TIP_SPLIT_ID_CHUNK).map((ids) =>
      byId<TipSplitItemRow>(() =>
        scope(
          fromTable(client, 'tip_split_items')
            .select('id, employee_id, amount, tip_split_id, tip_splits(split_date)')
            .in('tip_split_id', ids),
        ),
      ),
    ),
  );
  const tipItemRows = itemReads.flatMap((read) => read.rows);

  // Group punches by employee.
  const punchesPerEmployee = new Map<string, LaborTimePunch[]>();
  punchesRead.rows.forEach((row) => {
    const list = punchesPerEmployee.get(row.employee_id);
    if (list) list.push(toLaborPunch(row));
    else punchesPerEmployee.set(row.employee_id, [toLaborPunch(row)]);
  });

  // Tips from split items and employee declarations, with the date filter
  // that stops a double count.
  const tipItems: TipSplitItem[] = tipItemRows.map((item) => ({
    employee_id: item.employee_id,
    amount: item.amount,
    split_date: item.tip_splits?.split_date,
  }));
  const employeeTipItems: EmployeeTip[] = employeeTipsRead.rows.map((tip) => ({
    employee_id: tip.employee_id,
    amount: tip.tip_amount,
    tip_date: tip.tip_date,
  }));
  const tipsPerEmployee = computeTipTotalsWithFiltering(tipItems, employeeTipItems, undefined);

  const manualPaymentsPerEmployee = new Map<string, ManualPayment[]>();
  perJobRead.rows.forEach((payment) => {
    const list = manualPaymentsPerEmployee.get(payment.employee_id) ?? [];
    list.push({
      id: payment.id,
      date: payment.date,
      amount: payment.allocated_cost,
      description: payment.notes || undefined,
    });
    manualPaymentsPerEmployee.set(payment.employee_id, list);
  });

  const tipPayoutsPerEmployee = new Map<string, number>();
  payoutsRead.rows.forEach((payout) => {
    tipPayoutsPerEmployee.set(payout.employee_id, (tipPayoutsPerEmployee.get(payout.employee_id) || 0) + payout.amount);
  });

  if (otRulesRead.error) {
    console.error('Error fetching overtime rules:', otRulesRead.error);
  }
  const otRulesData = otRulesRead.data as OvertimeRulesRow | null;
  const overtimeRules: OvertimeRules | undefined = otRulesData
    ? {
        weeklyThresholdHours: Number(otRulesData.weekly_threshold_hours),
        weeklyOtMultiplier: Number(otRulesData.weekly_ot_multiplier),
        dailyThresholdHours: otRulesData.daily_threshold_hours != null ? Number(otRulesData.daily_threshold_hours) : null,
        dailyOtMultiplier: Number(otRulesData.daily_ot_multiplier),
        dailyDoubleThresholdHours:
          otRulesData.daily_double_threshold_hours != null ? Number(otRulesData.daily_double_threshold_hours) : null,
        dailyDoubleMultiplier: Number(otRulesData.daily_double_multiplier),
        excludeTipsFromOtRate: otRulesData.exclude_tips_from_ot_rate,
      }
    : undefined;

  const overtimeAdjustments: OvertimeAdjustment[] = otAdjustmentsRead.rows.map((adj) => ({
    employeeId: adj.employee_id,
    punchDate: adj.punch_date,
    adjustmentType: adj.adjustment_type as OvertimeAdjustment['adjustmentType'],
    hours: Number(adj.hours),
    reason: adj.reason ?? '',
  }));

  // An inactive employee is in payroll only through the week of the
  // deactivation.
  const eligibleEmployees = employees.filter((employee) =>
    shouldIncludeEmployeeInPayroll(employee, dayStart, timeZone),
  );

  const period = calculatePayrollPeriod(
    dayStart,
    dayEnd,
    eligibleEmployees,
    punchesPerEmployee,
    tipsPerEmployee,
    timeZone,
    manualPaymentsPerEmployee,
    tipPayoutsPerEmployee,
    overtimeRules,
    overtimeAdjustments,
  );

  const capped =
    punchesRead.capped ||
    splitsRead.capped ||
    itemReads.some((read) => read.capped) ||
    perJobRead.capped ||
    employeeTipsRead.capped ||
    payoutsRead.capped ||
    otAdjustmentsRead.capped;

  return { period, capped };
}
