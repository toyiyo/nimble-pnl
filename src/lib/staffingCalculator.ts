import type { Employee, HourlySalesData, HourlyStaffingRecommendation, MinCrew, ShiftBlock } from '@/types/scheduling';

const MAX_SHIFT_HOURS = 8;
const DEFAULT_HOURLY_RATE_CENTS = 1500; // $15/hr

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
function paidHourlyEmployees(employees: Employee[] | undefined): Employee[] {
  return (
    employees?.filter(
      (e) => e.compensation_type === 'hourly' && e.is_active && e.hourly_rate > 0,
    ) ?? []
  );
}

export function computeAvgHourlyRateCents(employees: Employee[] | undefined): number {
  const paid = paidHourlyEmployees(employees);
  if (paid.length === 0) return DEFAULT_HOURLY_RATE_CENTS;
  return Math.round(paid.reduce((sum, e) => sum + e.hourly_rate, 0) / paid.length);
}

/**
 * True when the roster has at least one active hourly employee with a real,
 * positive rate — i.e. the wage from `computeAvgHourlyRateCents` is derived
 * from real data rather than its `DEFAULT_HOURLY_RATE_CENTS` ($15/hr) fallback.
 * Surfaces use this to suppress an implied-labor readout that would otherwise
 * be presented as fact while resting on a wage nobody is paid.
 */
export function hasHourlyWageData(employees: Employee[] | undefined): boolean {
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

/**
 * The SPLH target that exactly hits `targetLaborPct` at `wage` — the value
 * the slider's track notch is drawn at, so a manager can see where their own
 * labor goal puts the knob.
 */
export function laborConsistentSplh(params: { wage: number; targetLaborPct: number }): number {
  const { wage, targetLaborPct } = params;
  // Guard against a 0 targetLaborPct (would otherwise divide to Infinity) —
  // settings-form input clamps this above 0 today, but the notch position
  // should degrade to 0 rather than Infinity if that invariant ever slips.
  return targetLaborPct > 0 ? wage / (targetLaborPct / 100) : 0;
}

export interface SplhHint extends ImpliedLaborResult {
  /** SPLH value that would exactly hit `targetLaborPct` at `wageCents`. */
  consistent: number;
}

/**
 * The "≈ X% labor at current wage" hint shown next to the SPLH/labor-%
 * inputs in both the on-chart config panel (`StaffingConfigPanel`) and the
 * Labor Planning settings page (`RestaurantSettings`) — same guard and math
 * in both places, centralized here so they can't drift.
 *
 * Null when there's no real wage, or when either input is blank/non-finite/
 * non-positive (a cleared field parses to NaN, and `NaN > 0` is false —
 * design §4).
 */
export function deriveSplhHint(params: {
  splh: number;
  targetLaborPct: number;
  hasWageData: boolean;
  wageCents: number;
}): SplhHint | null {
  const { splh, targetLaborPct, hasWageData, wageCents } = params;
  const positive = (n: number) => Number.isFinite(n) && n > 0;
  if (!hasWageData || !positive(wageCents) || !positive(splh) || !positive(targetLaborPct)) return null;
  const wage = wageCents / 100;
  const { pct, overTarget } = impliedLabor({ wage, splh, targetLaborPct });
  return { pct, overTarget, consistent: laborConsistentSplh({ wage, targetLaborPct }) };
}

/**
 * Compute the effective minimum staff from position-based min_crew.
 * Falls back to the global min_staff when min_crew is null or empty.
 */
export function computeMinStaffFromCrew(minCrew: MinCrew | null, fallbackMinStaff: number): number {
  if (!minCrew) return fallbackMinStaff;
  const values = Object.values(minCrew);
  if (values.length === 0) return fallbackMinStaff;
  const sum = values.reduce((total, v) => total + v, 0);
  return sum > 0 ? sum : fallbackMinStaff;
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

export function buildHourlyRecommendations(
  hourlySales: HourlySalesData[],
  params: {
    targetSplh: number;
    minStaff: number;
    avgHourlyRateCents: number;
    targetLaborPct: number;
  },
): HourlyStaffingRecommendation[] {
  return hourlySales.map(({ hour, avgSales }) => {
    const demand =
      avgSales > 0 && params.targetSplh > 0 ? Math.ceil(avgSales / params.targetSplh) : 0;
    const recommendedStaff = Math.max(demand, params.minStaff);
    const estimatedLaborCost = recommendedStaff * (params.avgHourlyRateCents / 100);
    const laborPct = avgSales > 0 ? (estimatedLaborCost / avgSales) * 100 : 0;
    const overTarget = checkLaborGuardrail(
      recommendedStaff,
      params.avgHourlyRateCents,
      avgSales,
      params.targetLaborPct,
    );
    return {
      hour,
      projectedSales: avgSales,
      demand,
      recommendedStaff,
      estimatedLaborCost,
      laborPct,
      overTarget,
    };
  });
}

export function consolidateIntoShiftBlocks(
  recommendations: Pick<HourlyStaffingRecommendation, 'hour' | 'recommendedStaff'>[],
  day: string,
): ShiftBlock[] {
  if (recommendations.length === 0) return [];

  const sorted = [...recommendations].sort((a, b) => a.hour - b.hour);
  const rawBlocks: ShiftBlock[] = [];

  let blockStart = sorted[0].hour;
  let blockHeadcount = sorted[0].recommendedStaff;

  for (let i = 1; i <= sorted.length; i++) {
    const current = sorted[i];
    const isEnd = !current;
    const isDifferent = current && current.recommendedStaff !== blockHeadcount;
    const isGap = current && current.hour !== sorted[i - 1].hour + 1;

    if (isEnd || isDifferent || isGap) {
      rawBlocks.push({
        startHour: blockStart,
        endHour: sorted[i - 1].hour + 1,
        headcount: blockHeadcount,
        day,
      });
      if (current) {
        blockStart = current.hour;
        blockHeadcount = current.recommendedStaff;
      }
    }
  }

  // Split any blocks longer than MAX_SHIFT_HOURS
  const result: ShiftBlock[] = [];
  for (const block of rawBlocks) {
    const duration = block.endHour - block.startHour;
    if (duration > MAX_SHIFT_HOURS) {
      result.push({ ...block, endHour: block.startHour + MAX_SHIFT_HOURS });
      result.push({ ...block, startHour: block.startHour + MAX_SHIFT_HOURS });
    } else {
      result.push(block);
    }
  }

  return result;
}
