/**
 * Pure presentation helpers for the coverage chart's demand/floor split.
 *
 * These are intentionally decoupled from `CoverageHour.needed` (which is
 * computed upstream from live staffing-recommendation state and can reflect
 * an in-progress SPLH-slider preview). `classifyHour` instead derives its
 * own `needed = max(demand, minStaff)` from the two primitives the chart
 * actually needs to draw a column, so it stays correct even if a caller
 * passes a hypothetical `minStaff` that hasn't round-tripped through the
 * recommendation pipeline yet (e.g. a settings-form preview).
 */

import type { CoverageHour } from '@/lib/coverageSummary';

export type HourClassification = 'crit' | 'floor' | 'spare' | 'ok' | 'nodata';

/**
 * Classify an hour's coverage column for the chart/receipt.
 *
 * - `nodata` — no demand target for this hour (`h.demand === null`): no
 *   sales history / no recommendation, excluded from every shortfall count.
 * - Otherwise `needed = max(h.demand, minStaff)`:
 *   - `crit`  — `scheduled < demand` (short even of the raw sales-driven demand)
 *   - `floor` — `demand <= scheduled < needed` (demand is met, but the
 *     minimum-staff floor still isn't)
 *   - `ok`    — `scheduled === needed`
 *   - `spare` — `scheduled > needed`
 */
export function classifyHour(h: CoverageHour, minStaff: number): HourClassification {
  if (h.demand === null) return 'nodata';

  const demand = h.demand;
  const needed = Math.max(demand, minStaff);
  const scheduled = h.scheduled;

  if (scheduled < demand) return 'crit';
  if (scheduled < needed) return 'floor';
  if (scheduled > needed) return 'spare';
  return 'ok';
}
