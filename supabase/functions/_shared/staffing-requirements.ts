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

function lookupPriorPattern(
  priorPatterns: PriorPattern[],
  day: number,
  position: string,
): number | null {
  const norm = normalizePosition(position);
  for (const p of priorPatterns) {
    if (p.day_of_week === day && normalizePosition(p.position) === norm) {
      return Math.max(1, Math.round(p.avg_count));
    }
  }
  return null;
}

function isPeakHour(
  hourlySales: HourlySales[],
  day: number,
  hour: number,
): boolean {
  const dayEntries = hourlySales.filter((h) => h.day_of_week === day);
  if (dayEntries.length === 0) return false;
  const sorted = [...dayEntries].sort((a, b) => b.avg_sales - a.avg_sales);
  const quartileSize = Math.max(1, Math.ceil(sorted.length / 4));
  const topQuartile = sorted.slice(0, quartileSize);
  return topQuartile.some((h) => h.hour === hour);
}

export function computeRequiredStaff(
  input: ComputeInput,
): Map<string, Map<number, number>> {
  const out = new Map<string, Map<number, number>>();
  for (const tpl of input.templates) {
    const perDay = new Map<number, number>();
    const startHour = parseInt(tpl.start_time.split(":")[0], 10);
    for (const day of tpl.days) {
      const fromMinCrew = lookupMinCrew(input.minCrew, tpl.position);
      const fromPattern =
        fromMinCrew === null
          ? lookupPriorPattern(input.priorPatterns, day, tpl.position)
          : null;
      const base = fromMinCrew ?? fromPattern ?? 1;
      const peakBoost = isPeakHour(input.hourlySales, day, startHour) ? 1 : 0;
      const floor = input.minStaff ?? 0;
      perDay.set(day, Math.max(base + peakBoost, floor));
    }
    out.set(tpl.id, perDay);
  }
  return out;
}
