// Staffing-recommendation helpers for the `get_hourly_sales` connector tool.
//
// Design: docs/superpowers/specs/2026-09-27-connector-hourly-sales-design.md §4.3
// Plan:   docs/superpowers/plans/2026-09-27-connector-hourly-sales-plan.md
//
// The edge function runtime (Deno) cannot import from `@/lib/staffingCalculator`
// (a Vite `src/` alias), so this file re-implements the same math. A parity
// test (tests/unit/hourlyStaffing.test.ts) runs both implementations on the
// same input grid and asserts equal results, so the two cannot drift.

export interface MinCrew {
  [position: string]: number;
}

/** One hour's averaged sales, the shape the RPC returns at 60-minute width. */
export interface HourlySales {
  hour: number;
  avgSales: number;
}

/** One sub-hour slot, identified by its start offset in minutes from midnight. */
export interface StaffingSlot {
  startMinute: number;
}

export interface StaffingSettingsInput {
  targetSplh: number;
  minStaff: number;
  minCrew: MinCrew | null;
}

export interface SlotRecommendation {
  startMinute: number;
  hour: number;
  recommendedStaff: number;
}

/**
 * The effective minimum staff from position-based min_crew, falling back to
 * the global min_staff when min_crew is null, empty, or sums to 0.
 * Mirrors `computeMinStaffFromCrew` in src/lib/staffingCalculator.ts.
 */
export function minStaffFromCrew(minCrew: MinCrew | null, minStaff: number): number {
  if (!minCrew) return minStaff;
  const values = Object.values(minCrew);
  if (values.length === 0) return minStaff;
  const sum = values.reduce((total, v) => total + v, 0);
  return sum > 0 ? sum : minStaff;
}

/**
 * Recommended staff for one hour of sales: ceil(sales / targetSplh) staff to
 * cover demand, floored at minStaff. Demand is 0 when sales or targetSplh is
 * not positive. Mirrors the per-hour math inside `buildHourlyRecommendations`
 * in src/lib/staffingCalculator.ts.
 */
export function recommendStaffForHour(sales: number, targetSplh: number, minStaff: number): number {
  const demand = sales > 0 && targetSplh > 0 ? Math.ceil(sales / targetSplh) : 0;
  return Math.max(demand, minStaff);
}

/**
 * A recommendation for each sub-hour slot, using the sales of the 60-minute
 * hour that contains it (design §4.3 decision 4: the sub-hour recommendation
 * reads the hourly, not the sub-hour, sales average).
 */
export function recommendForSlots(
  slots: StaffingSlot[],
  hourly: HourlySales[],
  settings: StaffingSettingsInput,
): SlotRecommendation[] {
  const effectiveMinStaff = minStaffFromCrew(settings.minCrew, settings.minStaff);
  const salesByHour = new Map(hourly.map((h) => [h.hour, h.avgSales]));

  return slots.map((slot) => {
    const hour = Math.floor(slot.startMinute / 60);
    const sales = salesByHour.get(hour) ?? 0;
    return {
      startMinute: slot.startMinute,
      hour,
      recommendedStaff: recommendStaffForHour(sales, settings.targetSplh, effectiveMinStaff),
    };
  });
}
