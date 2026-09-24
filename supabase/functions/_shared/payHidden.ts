/**
 * payHidden.ts
 *
 * Pure helpers for the AI labor tools when the caller lacks view:pay_rates.
 *
 * employees_secure returns NULL pay for such a caller, and RLS drops the
 * compensation history rows (see EMPLOYEE_LABOR_SOURCE). The labor engine
 * then computes $0 for every employee. These helpers set each pay-derived
 * field to null, so the AI never reports that $0 as a real figure. Hours and
 * employee counts stay: they do not come from pay rates.
 *
 * Contract: the helpers only redact. Each tool adds
 * `pay_hidden: payHidden()` to its result data itself.
 */

export const PAY_HIDDEN_REASON =
  'Pay rates are hidden for your role, so labor cost figures are not available.';

/** The sentence each labor tool description ends with. */
export const PAY_HIDDEN_TOOL_HINT =
  'If the result has pay_hidden, tell the user that cost figures are hidden for their role. Do not report them as $0.';

export interface PayHidden {
  reason: string;
}

export const payHidden = (): PayHidden => ({ reason: PAY_HIDDEN_REASON });

interface CostBucket {
  cost: number;
  /** Days with a cost above zero. It comes from pay, so it is redacted too. */
  daysScheduled?: number;
}

type RedactedBucket<B extends CostBucket> = Omit<B, 'cost' | 'daysScheduled'> & {
  cost: null;
  daysScheduled?: null;
};

interface CompensationBuckets<H extends CostBucket, O extends CostBucket> {
  hourly: H;
  salary: O;
  contractor: O;
  daily_rate: O;
}

function redactBucket<B extends CostBucket>(bucket: B): RedactedBucket<B> {
  const redacted: RedactedBucket<B> = { ...bucket, cost: null };
  // daysScheduled counts days with cost > 0 (laborCalculations.ts), so a
  // masked $0 cost gives a false 0.
  if ('daysScheduled' in bucket) redacted.daysScheduled = null;
  return redacted;
}

function redactBuckets<H extends CostBucket, O extends CostBucket>(buckets: CompensationBuckets<H, O>) {
  return {
    hourly: redactBucket(buckets.hourly),
    salary: redactBucket(buckets.salary),
    contractor: redactBucket(buckets.contractor),
    daily_rate: redactBucket(buckets.daily_rate),
  };
}

interface DailyCost {
  date: string;
  hourly_cost: number;
  salary_cost: number;
  contractor_cost: number;
  daily_rate_cost: number;
  total_cost: number;
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
  breakdown: CompensationBuckets<H, O> & { total: number };
  daily_costs: D[] | undefined;
  employee_breakdown: E[] | null;
}) {
  return {
    breakdown: { ...redactBuckets(result.breakdown), total: null },
    daily_costs: result.daily_costs?.map((day) => ({
      ...day,
      hourly_cost: null,
      salary_cost: null,
      contractor_cost: null,
      daily_rate_cost: null,
      total_cost: null,
    })),
    employee_breakdown:
      result.employee_breakdown?.map((row) => ({ ...row, total_cost_cents: null })) ?? null,
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
  by_compensation_type: CompensationBuckets<H, O>;
}) {
  return {
    ...summary,
    total_gross_pay: null,
    total_manual_payments: null,
    total_payroll: null,
    by_compensation_type: redactBuckets(summary.by_compensation_type),
  };
}
