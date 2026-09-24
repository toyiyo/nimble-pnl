/**
 * payHidden.ts
 *
 * Pure helpers for the AI labor tools when the caller lacks view:pay_rates.
 *
 * employees_secure returns NULL pay for such a caller
 * (20260806110000_employee_column_gating.sql), and the compensation history
 * rows are dropped by RLS. The labor engine then computes $0 for every
 * employee. These helpers set each money field to null and add a
 * `pay_hidden` reason, so the AI never reports that $0 as a real figure.
 * Hours and counts stay: they do not come from pay rates.
 */

export const PAY_HIDDEN_REASON =
  'Pay rates are hidden for your role, so labor cost figures are not available.';

export interface PayHidden {
  reason: string;
}

export const payHidden = (): PayHidden => ({ reason: PAY_HIDDEN_REASON });

type Nullable<T, K extends keyof T> = Omit<T, K> & { [P in K]: null };

interface CostBucket {
  cost: number;
}

interface LaborBreakdown<H extends CostBucket, O extends CostBucket> {
  hourly: H;
  salary: O;
  contractor: O;
  daily_rate: O;
  total: number;
}

const nullCost = <B extends CostBucket>(bucket: B): Nullable<B, 'cost'> => ({ ...bucket, cost: null });

const DAILY_MONEY_FIELDS = [
  'hourly_cost',
  'salary_cost',
  'contractor_cost',
  'daily_rate_cost',
  'total_cost',
] as const;

type DailyMoneyField = (typeof DAILY_MONEY_FIELDS)[number];

interface DailyCost extends Record<DailyMoneyField, number> {
  date: string;
  hours_worked: number;
}

interface EmployeeCost {
  total_cost_cents: number | null;
}

/** get_labor_costs: null every cost, keep hours, counts and dates. */
export function redactLaborCostsResult<
  H extends CostBucket,
  O extends CostBucket,
  D extends DailyCost,
  E extends EmployeeCost,
>(result: {
  breakdown: LaborBreakdown<H, O>;
  daily_costs: D[] | undefined;
  employee_breakdown: E[] | null;
}) {
  const { breakdown } = result;
  return {
    breakdown: {
      hourly: nullCost(breakdown.hourly),
      salary: nullCost(breakdown.salary),
      contractor: nullCost(breakdown.contractor),
      daily_rate: nullCost(breakdown.daily_rate),
      total: null,
    },
    daily_costs: result.daily_costs?.map((day) => {
      const redacted = { ...day } as Record<string, unknown>;
      for (const field of DAILY_MONEY_FIELDS) redacted[field] = null;
      return redacted as Nullable<D, DailyMoneyField>;
    }),
    employee_breakdown:
      result.employee_breakdown?.map((row) => ({ ...row, total_cost_cents: null })) ?? null,
    pay_hidden: payHidden(),
  };
}

/** get_time_punches: null the per-shift cost, keep hours and times. */
export function redactTimePunchShifts<S extends { cost_cents: number | null }>(shifts: S[]) {
  return shifts.map((shift) => ({ ...shift, cost_cents: null }));
}

/**
 * get_payroll_summary: null gross pay, manual (contractor) payments and the
 * payroll total. Keep the tips: they come from tip_splits, not pay rates.
 * The total is null, never tips plus manual payments, which would read as a
 * complete payroll.
 */
export function redactPayrollSummary<H extends CostBucket, O extends CostBucket>(summary: {
  total_gross_pay: number;
  total_tips: number;
  total_manual_payments: number;
  total_payroll: number;
  by_compensation_type: Omit<LaborBreakdown<H, O>, 'total'>;
}) {
  const types = summary.by_compensation_type;
  return {
    ...summary,
    total_gross_pay: null,
    total_manual_payments: null,
    total_payroll: null,
    by_compensation_type: {
      hourly: nullCost(types.hourly),
      salary: nullCost(types.salary),
      contractor: nullCost(types.contractor),
      daily_rate: nullCost(types.daily_rate),
    },
  };
}
