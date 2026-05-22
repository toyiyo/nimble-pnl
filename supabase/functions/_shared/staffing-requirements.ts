/**
 * staffing-requirements.ts
 *
 * Pure utility: for each (template, day) combination, compute the required
 * employee headcount. Output is consumed by the prompt builder so the AI
 * can be told how many staff each slot needs.
 *
 * Inputs:
 * - minCrew: per-position minimum from staffing_settings.min_crew JSONB.
 * - minStaff: a global floor from staffing_settings.min_staff.
 * - priorPatterns: historical avg shift counts per (day, position).
 * - hourlySales: per-(day, hour) avg sales used for peak boost.
 */
import type {
  ScheduleTemplate,
  PriorPattern,
  HourlySales,
} from "./schedule-prompt-builder.ts";

export interface ComputeInput {
  templates: ScheduleTemplate[];
  minCrew: Record<string, number> | null;
  minStaff: number | null;
  priorPatterns: PriorPattern[];
  hourlySales: HourlySales[];
}

/** Mirror of validator's normalizePosition so prompt strings can stay natural. */
function normalizePosition(s: string | null | undefined): string {
  if (!s) return "";
  const lower = s.trim().toLowerCase().replace(/\s+/g, " ");
  if (lower.length > 4 && lower.endsWith("s") && !lower.endsWith("ss")) {
    return lower.slice(0, -1);
  }
  return lower;
}

function lookupMinCrew(
  minCrew: Record<string, number> | null,
  position: string,
): number | null {
  if (!minCrew) return null;
  const norm = normalizePosition(position);
  for (const [k, v] of Object.entries(minCrew)) {
    if (normalizePosition(k) === norm && typeof v === "number" && v > 0) {
      return v;
    }
  }
  return null;
}

/** Build a lookup of (day, normalized position) → headcount from prior patterns. */
function indexPriorPatterns(
  priorPatterns: PriorPattern[],
): Map<string, number> {
  const out = new Map<string, number>();
  for (const p of priorPatterns) {
    out.set(`${p.day_of_week}:${normalizePosition(p.position)}`, Math.max(1, Math.round(p.avg_count)));
  }
  return out;
}

/** Build a lookup of day → set of peak hours (top quartile by avg_sales). */
function indexPeakHours(
  hourlySales: HourlySales[],
): Map<number, Set<number>> {
  const byDay = new Map<number, HourlySales[]>();
  for (const h of hourlySales) {
    let entries = byDay.get(h.day_of_week);
    if (!entries) {
      entries = [];
      byDay.set(h.day_of_week, entries);
    }
    entries.push(h);
  }
  const out = new Map<number, Set<number>>();
  for (const [day, entries] of byDay) {
    const sorted = [...entries].sort((a, b) => b.avg_sales - a.avg_sales);
    const quartileSize = Math.max(1, Math.ceil(sorted.length / 4));
    out.set(day, new Set(sorted.slice(0, quartileSize).map((h) => h.hour)));
  }
  return out;
}

export function computeRequiredStaff(
  input: ComputeInput,
): Map<string, Map<number, number>> {
  const priorIndex = indexPriorPatterns(input.priorPatterns);
  const peakIndex = indexPeakHours(input.hourlySales);
  const floor = input.minStaff ?? 0;

  const out = new Map<string, Map<number, number>>();
  for (const tpl of input.templates) {
    const perDay = new Map<number, number>();
    const startHour = parseInt(tpl.start_time.split(":")[0], 10);
    const normPos = normalizePosition(tpl.position);
    // Per-template lookups that don't depend on day are hoisted out of the inner loop.
    const fromMinCrew = lookupMinCrew(input.minCrew, tpl.position);
    for (const day of tpl.days) {
      const fromPattern =
        fromMinCrew === null ? (priorIndex.get(`${day}:${normPos}`) ?? null) : null;
      // Fallback chain: explicit min_crew → historical pattern → template
      // capacity → 1. Capacity restores the manager's stated headcount
      // when neither staffing settings nor prior schedules exist.
      const base = fromMinCrew ?? fromPattern ?? tpl.capacity ?? 1;
      const peakBoost = peakIndex.get(day)?.has(startHour) ? 1 : 0;
      perDay.set(day, Math.max(base + peakBoost, floor));
    }
    out.set(tpl.id, perDay);
  }
  return out;
}
