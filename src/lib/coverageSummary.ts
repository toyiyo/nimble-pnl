/**
 * Pure hourly coverage summary.
 *
 * Demand is only hourly-resolution, so we aggregate 15-min coverage samples to
 * hours for a clean, honest comparison.  All functions are timezone-agnostic:
 * they consume pre-computed minute values, not wall-clock times.
 */

export interface CoverageHour {
  /** 0–23 clock hour (use Math.floor(startMin / 60) % 24 for the display label) */
  hour: number;
  /** Absolute minute offset where the hour begins (e.g. 600 = 10:00 AM) */
  startMin: number;
  /** Per-hour minimum headcount (conservative: mid-hour dip counts as short) */
  scheduled: number;
  /** Hourly demand target, or null when no demand is configured */
  needed: number | null;
  /** scheduled − needed, or null when needed is null */
  delta: number | null;
}

export interface CoverageVerdict {
  /** True when at least one hour has a demand target */
  hasDemand: boolean;
  /** True only when demand exists and every hour meets or exceeds it */
  metAll: boolean;
  /** Count of hours where delta < 0 */
  shortHours: number;
  /** Total hours in the window */
  totalHours: number;
  /** Hour with the most-negative delta (null when no shorts or no demand) */
  worst: { hour: number; delta: number } | null;
}

const HOUR = 60;

/**
 * Aggregate 15-min coverage samples into per-hour summaries aligned with
 * the hourly demand targets.
 *
 * @param coverage  Array of { min, count } — one entry per 15-min slot.
 * @param demand    Array of { min, target } — one entry per demand hour start,
 *                  or null if no demand is configured.
 * @param window    { startMin, endMin } — the visible day window in minutes.
 */
export function summarizeCoverageHours(
  coverage: { min: number; count: number }[],
  demand: { min: number; target: number }[] | null,
  window: { startMin: number; endMin: number },
): CoverageHour[] {
  if (coverage.length === 0) return [];

  // Build a lookup: hourStart → demand target
  const demandMap: Map<number, number> | null = demand
    ? new Map(demand.map((d) => [d.min, d.target]))
    : null;

  /**
   * Returns the demand target for the hour that contains `min`.
   * Demand entries are keyed by their hour's start minute.
   * Falls back to 0 if the map exists but has no entry for this hour
   * (meaning "demand configured but not for this hour").
   */
  const needForHourStart = (hourStart: number): number | null => {
    if (!demandMap) return null;
    return demandMap.get(hourStart) ?? 0;
  };

  const out: CoverageHour[] = [];

  // Iterate over each complete hour bucket within the window
  const firstHourStart = Math.floor(window.startMin / HOUR) * HOUR;
  for (let start = firstHourStart; start < window.endMin; start += HOUR) {
    // All 15-min samples whose minute falls within [start, start+60)
    const inHour = coverage.filter((c) => c.min >= start && c.min < start + HOUR);
    if (inHour.length === 0) continue;

    const scheduled = Math.min(...inHour.map((c) => c.count));
    const needed = needForHourStart(start);

    out.push({
      hour: Math.floor(start / HOUR) % 24,
      startMin: start,
      scheduled,
      needed,
      delta: needed === null ? null : scheduled - needed,
    });
  }

  return out;
}

/**
 * Derive a plain-language verdict from the hourly summary.
 */
export function buildVerdict(hours: CoverageHour[]): CoverageVerdict {
  const hasDemand = hours.some((h) => h.needed !== null);
  const shortHours = hours.filter((h) => h.delta !== null && h.delta < 0);

  let worst: { hour: number; delta: number } | null = null;
  for (const h of shortHours) {
    if (worst === null || (h.delta as number) < worst.delta) {
      worst = { hour: h.hour, delta: h.delta as number };
    }
  }

  return {
    hasDemand,
    metAll: hasDemand && shortHours.length === 0,
    shortHours: shortHours.length,
    totalHours: hours.length,
    worst,
  };
}
