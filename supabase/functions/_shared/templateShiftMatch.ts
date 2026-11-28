// The rule that puts a shift in a template slot (template + local date).
// Pure, with no Deno imports, so Vitest can import this file.
//
// This follows the planner UI rule, so the MCP coverage agrees with the grid:
//   - src/hooks/useShiftPlanner.ts buildTemplateGridData: the linked branch
//     first, then the time match on active templates only;
//   - findAreaAwareTemplate (templateAreaMatch.ts, shared with the UI): time,
//     position, day and area, and a same-area template wins.
// tests/unit/coverageParity.test.ts fails if the two rules drift apart.
import { localHms, ymdInTimeZone } from "./restaurantDate.ts";
import { findAreaAwareTemplate, type MatchableTemplate } from "./templateAreaMatch.ts";

export interface MatchShift {
  employee_id: string;
  start_time: string;
  end_time: string;
  status: string;
  position?: string | null;
  shift_template_id?: string | null;
}

export interface MatchTemplate {
  id: string;
  days: number[];
  start_time: string;
  end_time: string;
  position?: string | null;
  area?: string | null;
  is_active: boolean;
}

/**
 * The slot key `templateId|YYYY-MM-DD` of a shift, or null when the shift fills
 * no slot. Each shift gets one key at most, so one shift fills one slot only.
 *
 * `templates` must hold the templates in a fixed order: the first candidate
 * wins a tie, the same as the UI. A linked shift never falls back to the time
 * match, also when its template is not in the list.
 */
export function slotKeyForShift(
  shift: MatchShift,
  templates: MatchTemplate[],
  employeeArea: string | null | undefined,
  tz: string,
): string | null {
  if (shift.status === "cancelled") return null;
  const date = ymdInTimeZone(new Date(shift.start_time), tz);
  if (shift.shift_template_id) {
    return templates.some((t) => t.id === shift.shift_template_id)
      ? `${shift.shift_template_id}|${date}`
      : null;
  }
  // shift_templates.position is NOT NULL, so a shift with no position matches no template.
  const position = shift.position;
  if (!position) return null;
  const dow = new Date(`${date}T00:00:00Z`).getUTCDay();
  // The cheap filters first. Most shifts then need no time format.
  const pool = templates.filter((t): t is MatchTemplate & MatchableTemplate =>
    t.is_active && t.position === position && t.days.includes(dow)
  );
  if (pool.length === 0) return null;
  const match = findAreaAwareTemplate(pool, {
    shiftStart: localHms(shift.start_time, tz),
    shiftEnd: localHms(shift.end_time, tz),
    position,
    dayOfWeek: dow,
    employeeArea: employeeArea ?? null,
  });
  return match ? `${match.id}|${date}` : null;
}
