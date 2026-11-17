// Minimal employee shape. Only the fields that the functions read.
export interface GuardrailEmployee {
  status?: string;
  compensation_type?: string;
  hourly_rate?: number | null;
  is_active?: boolean;
}

export const DEFAULT_HOURLY_RATE_CENTS = 1500; // $15/hr

/**
 * The employees whose wages are real: active, hourly, and actually paid a
 * positive rate. `EmployeeDialog` stores a blank hourly-rate field as `0`
 * cents, so an unset rate is indistinguishable from a genuine `$0/hr` and must
 * be excluded from both the blended average and the has-real-wage predicate.
 *
 * Both `computeAvgHourlyRateCents` and `hasHourlyWageData` derive from this one
 * set so they cannot disagree: if they used different filters, a roster mixing
 * one employee at $20/hr with one unset rate would report "wage data is real"
 * while advertising a blended $10/hr that nobody is paid, and every implied-labor
 * readout downstream would inherit that error.
 */
function paidHourlyEmployees(employees: GuardrailEmployee[] | undefined): GuardrailEmployee[] {
  return (
    employees?.filter(
      (e) => e.compensation_type === 'hourly' && e.is_active && (e.hourly_rate ?? 0) > 0,
    ) ?? []
  );
}

export function computeAvgHourlyRateCents(employees: GuardrailEmployee[] | undefined): number {
  const paid = paidHourlyEmployees(employees);
  if (paid.length === 0) return DEFAULT_HOURLY_RATE_CENTS;
  return Math.round(paid.reduce((sum, e) => sum + (e.hourly_rate ?? 0), 0) / paid.length);
}

/**
 * True when the roster has at least one active hourly employee with a real,
 * positive rate — i.e. the wage from `computeAvgHourlyRateCents` is derived
 * from real data rather than its `DEFAULT_HOURLY_RATE_CENTS` ($15/hr) fallback.
 * Surfaces use this to suppress an implied-labor readout that would otherwise
 * be presented as fact while resting on a wage nobody is paid.
 */
export function hasHourlyWageData(employees: GuardrailEmployee[] | undefined): boolean {
  return paidHourlyEmployees(employees).length > 0;
}

export interface ImpliedLaborResult {
  pct: number;
  overTarget: boolean;
}

/**
 * Implied labor % of a given SPLH target at a given average hourly wage —
 * the on-chart slider's live readout (`→ X% labor at $W/hr`).
 *
 * `overTarget` flags the readout as "over budget" once `pct` clears
 * `targetLaborPct` by more than a 0.05-point tolerance (so a target hit to
 * within float/rounding noise doesn't flash red).
 */
export function impliedLabor(params: {
  wage: number;
  splh: number;
  targetLaborPct: number;
}): ImpliedLaborResult {
  const { wage, splh, targetLaborPct } = params;
  // Guard against a 0 splh (would otherwise divide to Infinity) — the slider's
  // own bounds keep this out of reach today, but the readout should degrade to
  // a plain 0% rather than a nonsensical Infinity if that ever changes.
  const pct = splh > 0 ? (wage / splh) * 100 : 0;
  const overTarget = pct > targetLaborPct + 0.05;
  return { pct, overTarget };
}

export function checkLaborGuardrail(
  staffCount: number,
  avgHourlyRateCents: number,
  projectedSales: number,
  targetLaborPct: number,
): boolean {
  if (projectedSales <= 0) return false;
  const laborCost = staffCount * (avgHourlyRateCents / 100);
  const laborPct = (laborCost / projectedSales) * 100;
  return laborPct > targetLaborPct;
}
