// The rule that puts a shift in a template slot (template + local date).
// Pure, with no Deno imports, so Vitest can import this file.
//
// This copies the planner UI rule, so the MCP coverage agrees with the grid:
//   - src/hooks/useShiftPlanner.ts buildTemplateGridData (linked branch first,
//     then the time match on active templates only)
//   - src/lib/templateAreaMatch.ts findAreaAwareTemplate (time, position, day,
//     area; a same-area template wins)
// tests/unit/coverageParity.test.ts fails if the two rules drift apart.
import { localHms, localIso, ymdInTimeZone } from "./restaurantDate.ts";

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

/** Postgres gives 'HH:MM:SS'. Accept 'HH:MM' too. */
function hms(t: string): string {
  return t.length === 5 ? `${t}:00` : t;
}

function areaCompatible(templateArea: string | null | undefined, employeeArea: string | null | undefined): boolean {
  return !templateArea || !employeeArea || templateArea === employeeArea;
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
  const start = localHms(shift.start_time, tz);
  const end = localHms(shift.end_time, tz);
  const dow = new Date(`${date}T00:00:00Z`).getUTCDay();
  const candidates = templates.filter((t) =>
    t.is_active &&
    hms(t.start_time) === start &&
    hms(t.end_time) === end &&
    t.position === shift.position &&
    t.days.includes(dow) &&
    areaCompatible(t.area, employeeArea)
  );
  const match = employeeArea
    ? candidates.find((t) => t.area === employeeArea) ?? candidates[0]
    : candidates[0];
  return match ? `${match.id}|${date}` : null;
}

function norm(p: string | null | undefined): string {
  return (p ?? "").trim().toLowerCase();
}

/** The local wall-clock times of a shift and its IANA zone. The UTC times stay as they are. */
export function localTimeFields(startIso: string, endIso: string, tz: string): {
  start_time_local: string;
  end_time_local: string;
  tz: string;
} {
  return { start_time_local: localIso(startIso, tz), end_time_local: localIso(endIso, tz), tz };
}

export type PositionFields =
  | { position_mismatch: false }
  | { position_mismatch: true; shift_position: string; employee_position: string };

/**
 * position_mismatch for a shift row. The two values appear only on a mismatch,
 * so the rows stay small.
 */
export function positionFields(
  shiftPosition: string | null | undefined,
  employeePosition: string | null | undefined,
): PositionFields {
  return positionMismatch(shiftPosition, employeePosition)
    ? { position_mismatch: true, shift_position: shiftPosition!, employee_position: employeePosition! }
    : { position_mismatch: false };
}

/**
 * True when the shift position and the employee position are both set and
 * differ. Case and outer spaces do not count.
 */
export function positionMismatch(
  shiftPosition: string | null | undefined,
  employeePosition: string | null | undefined,
): boolean {
  const a = norm(shiftPosition);
  const b = norm(employeePosition);
  return a !== "" && b !== "" && a !== b;
}
