/**
 * schedule-validator.ts
 *
 * Pure validation module for AI-generated shifts.
 * Takes a list of generated shifts and a validation context, then returns
 * which shifts are valid and which were dropped (with reasons).
 */

export interface GeneratedShift {
  employee_id: string;
  template_id: string;
  day: string; // YYYY-MM-DD
  start_time: string; // HH:MM:SS
  end_time: string; // HH:MM:SS
  position: string;
}

export interface AvailabilitySlot {
  isAvailable: boolean;
  startTime: string | null; // HH:MM:SS
  endTime: string | null; // HH:MM:SS
}

export interface ValidationContext {
  /** Employees keyed by id. Carries position (for POSITION_MISMATCH),
   *  is_minor (informational for the prompt; NOT the validator's
   *  dispatch predicate), and max_weekly_hours (used by the
   *  HOURS_EXCEED_WEEKLY_CAP / MINOR_HOURS_EXCEEDED step).
   *
   *  Promoted from `employeeIds: Set<string>` + `employeePositions:
   *  Map<string, string>`: one structure, one lookup, no drift risk.
   *  Existence check `employeeIds.has(id)` becomes `employees.has(id)`. */
  employees: Map<string, {
    position: string;
    is_minor: boolean;
    max_weekly_hours: number;
  }>;
  /** Templates keyed by id. `days` are the days-of-week (0=Sun..6=Sat) on
   *  which the template is active. `position` is the role the template
   *  requires — the validator drops shifts whose assigned employee does not
   *  hold that position, even when the LLM-emitted `shift.position` matches
   *  the employee (e.g. a Manager assigned onto a Server template). */
  templates: Map<string, { days: number[]; position: string }>;
  /** Key: "employeeId:dayOfWeek" (0=Sun..6=Sat) */
  availability: Map<string, AvailabilitySlot>;
  excludedEmployeeIds: Set<string>;
  /** Existing shifts on the target week (locked or otherwise) to check for overlaps */
  existingShifts: GeneratedShift[];
}

export type DropCode =
  | "EXCLUDED"
  | "UNKNOWN_EMPLOYEE"
  | "UNKNOWN_TEMPLATE"
  | "DAY_NOT_IN_TEMPLATE"
  | "POSITION_MISMATCH"
  | "UNAVAILABLE_DAY"
  | "OUTSIDE_WINDOW"
  | "DOUBLE_BOOKING"
  | "HOURS_EXCEED_WEEKLY_CAP"
  | "MINOR_HOURS_EXCEEDED"
  | "CONSECUTIVE_DAYS_EXCEEDED";

export interface DroppedShift {
  shift: GeneratedShift;
  code: DropCode;
  /** Human-readable message that MAY contain UUIDs for server-side debugging.
   *  Never include this verbatim in client-facing responses. */
  message: string;
}

export interface ValidationResult {
  valid: GeneratedShift[];
  dropped: DroppedShift[];
}

// ─── Helper Functions ─────────────────────────────────────────────────────────

/**
 * Parse YYYY-MM-DD and return day of week (0=Sun..6=Sat).
 * Parses date components explicitly and uses the local Date constructor
 * to avoid UTC offset issues that can shift the day by one.
 *
 * Do NOT compose with `_shared/schedule-prompt-builder.ts::buildWeekDates`,
 * which is UTC-anchored on a caller-supplied weekStart. Different inputs
 * (LLM-emitted shift.day strings vs caller-supplied weekStart) and
 * different anchor conventions (local-time vs UTC). Both helpers produce
 * the same 0=Sun..6=Sat for the same date string, but that's an output
 * coincidence — the helpers must not be mixed in new code.
 */
export function getDayOfWeek(dateStr: string): number {
  const [year, month, day] = dateStr.split('-').map(Number);
  // new Date(year, monthIndex, day) is always local time — no UTC offset shift
  return new Date(year, month - 1, day).getDay();
}

/**
 * UTC-anchored variant of getDayOfWeek. Parses YYYY-MM-DD as midnight UTC,
 * returns the UTC day-of-week. Use this in the solver and any new code that
 * derives a day-of-week from a date string. Existing call sites in this file
 * keep using getDayOfWeek to avoid changing drop semantics on shipped flows.
 */
export function getDayOfWeekUTC(dateStr: string): number {
  const ts = Date.parse(`${dateStr}T00:00:00Z`);
  if (Number.isNaN(ts)) {
    throw new Error(`getDayOfWeekUTC: invalid dateStr "${dateStr}" — expected YYYY-MM-DD`);
  }
  return new Date(ts).getUTCDay();
}

/**
 * Convert HH:MM:SS to total minutes from midnight.
 */
export function timeToMinutes(time: string): number {
  const [hours, minutes] = time.split(':').map(Number);
  return hours * 60 + minutes;
}

/**
 * Duration of a shift in hours, with overnight handling.
 *
 * 22:00→02:00 = 4h (not 24h). We anchor on the time-of-day diff, not
 * on (next-day − day), because `shift.day` is the calendar day the
 * shift nominally STARTS on; an overnight shift's `day` field never
 * shifts to the next day. Using a day-diff here would inflate every
 * overnight shift by ~24h and trigger spurious HOURS_EXCEED_WEEKLY_CAP
 * drops.
 */
export function shiftHours(s: GeneratedShift): number {
  const start = timeToMinutes(s.start_time);
  let end = timeToMinutes(s.end_time);
  if (end <= start) end += 1440; // overnight
  return (end - start) / 60;
}

/**
 * Longest run of consecutive calendar days in a set of YYYY-MM-DD strings.
 * Returns 0 for an empty set; returns 1 for any single day.
 *
 * UTC-anchored (matches `shiftsConflict` and `computeHourBudget` in
 * schedule-prompt-builder). Sorting by ms-since-epoch and stepping by
 * 86_400_000 is DST-safe — that's the point of using UTC. A local-time
 * implementation would see a 23h or 25h gap on DST transitions and
 * misreport the streak.
 */
export function longestConsecutiveRun(days: Set<string>): number {
  if (days.size === 0) return 0;
  const ms = Array.from(days)
    .map((d) => Date.parse(`${d}T00:00:00Z`))
    .filter((n) => !Number.isNaN(n))
    .sort((a, b) => a - b);
  if (ms.length === 0) return 0;

  let longest = 1;
  let current = 1;
  for (let i = 1; i < ms.length; i++) {
    const diff = Math.round((ms[i] - ms[i - 1]) / 86_400_000);
    if (diff === 1) {
      current++;
      if (current > longest) longest = current;
    } else if (diff > 1) {
      current = 1;
    }
    // diff === 0 (duplicate day): keep current; dedup-by-set means this
    // branch is unreachable from a Set<string> input, but kept for
    // defensive parity if callers ever pass a list.
  }
  return longest;
}

/**
 * Check if two shifts for the same employee on the same day overlap.
 * Overnight shifts (end <= start) are normalized by adding 1440 to end.
 * Adjacent shifts (end == start) do not overlap.
 *
 * When one shift is overnight and the other is a normal early-morning shift
 * (e.g. 01:00-05:00), we also check the early-morning shift shifted forward
 * by 1440 min so both are in the same "day frame".
 */
export function shiftsOverlap(a: GeneratedShift, b: GeneratedShift): boolean {
  const aStart = timeToMinutes(a.start_time);
  let aEnd = timeToMinutes(a.end_time);
  const aOvernight = aEnd <= aStart;
  if (aOvernight) aEnd += 1440;

  const bStart = timeToMinutes(b.start_time);
  let bEnd = timeToMinutes(b.end_time);
  const bOvernight = bEnd <= bStart;
  if (bOvernight) bEnd += 1440;

  // Primary check: do the (possibly normalized) intervals overlap?
  if (aStart < bEnd && bStart < aEnd) return true;

  // Secondary check: when one is overnight, the other's early-morning portion
  // may lie in the "next day frame" — shift b forward by 1440 and re-check.
  if (aOvernight && !bOvernight) {
    const bStart2 = bStart + 1440;
    const bEnd2 = bEnd + 1440;
    if (aStart < bEnd2 && bStart2 < aEnd) return true;
  }
  if (bOvernight && !aOvernight) {
    const aStart2 = aStart + 1440;
    const aEnd2 = aEnd + 1440;
    if (aStart2 < bEnd && bStart < aEnd2) return true;
  }

  return false;
}

/**
 * Day-aware conflict detection. Use this in the validator instead of
 * shiftsOverlap when the two shifts may sit on different calendar days.
 *
 * - Same day: delegates to shiftsOverlap (keeps existing semantics, including
 *   the early-morning heuristic).
 * - Consecutive days (|aDay - bDay| == 1) AND at least one is overnight:
 *   convert both to absolute minute intervals from a common reference and
 *   check intersection. Catches the case where one shift ends past midnight
 *   on day N and another starts in the morning of day N+1.
 * - Otherwise: no conflict (non-overnight shifts on different days cannot
 *   overlap, and shifts >1 day apart cannot overlap regardless).
 */
export function shiftsConflict(a: GeneratedShift, b: GeneratedShift): boolean {
  if (a.day === b.day) return shiftsOverlap(a, b);

  const aDayMs = Date.parse(`${a.day}T00:00:00Z`);
  const bDayMs = Date.parse(`${b.day}T00:00:00Z`);
  if (Number.isNaN(aDayMs) || Number.isNaN(bDayMs)) return false;
  const dayDiff = Math.round((bDayMs - aDayMs) / 86_400_000);
  if (Math.abs(dayDiff) !== 1) return false;

  const aStart = timeToMinutes(a.start_time);
  const aEnd = timeToMinutes(a.end_time);
  const bStart = timeToMinutes(b.start_time);
  const bEnd = timeToMinutes(b.end_time);
  const aOvernight = aEnd <= aStart;
  const bOvernight = bEnd <= bStart;
  if (!aOvernight && !bOvernight) return false;

  const aAbsStart = aStart;
  const aAbsEnd = aOvernight ? aEnd + 1440 : aEnd;
  const bAbsStart = bStart + dayDiff * 1440;
  const bAbsEnd = (bOvernight ? bEnd + 1440 : bEnd) + dayDiff * 1440;

  return aAbsStart < bAbsEnd && bAbsStart < aAbsEnd;
}

/**
 * Returns true if a shift [shiftStart, shiftEnd] (in minutes-from-midnight)
 * fits entirely within an availability window [windowStart, windowEnd].
 *
 * Overnight handling:
 * - A window where windowEnd < windowStart is treated as
 *   [windowStart, 24:00) ∪ [00:00, windowEnd] (crosses midnight).
 * - A shift where shiftEnd <= shiftStart is treated as overnight similarly.
 * - An overnight shift cannot fit inside a non-overnight window.
 * - A normal shift may fit inside either half of an overnight window.
 */
export function withinWindow(
  shiftStart: number,
  shiftEnd: number,
  windowStart: number,
  windowEnd: number,
): boolean {
  const shiftIsOvernight = shiftEnd <= shiftStart;
  const windowIsOvernight = windowEnd < windowStart;

  if (!windowIsOvernight) {
    if (shiftIsOvernight) return false;
    return shiftStart >= windowStart && shiftEnd <= windowEnd;
  }

  if (shiftIsOvernight) {
    return shiftStart >= windowStart && shiftEnd <= windowEnd;
  }
  const inEvening = shiftStart >= windowStart && shiftEnd <= 1440;
  const inMorning = shiftStart >= 0 && shiftEnd <= windowEnd;
  return inEvening || inMorning;
}

/**
 * Normalize a position string for matching. Lowercases, trims, collapses
 * internal whitespace, and strips a trailing -s plural unless the word ends
 * in -ss ("Hostess", "Buss") or is too short (stem <= 4 chars: "Bus", "Gas").
 *
 * Lets "Line Cook" / "line cook" / "Cooks" / "Cook" all match.
 */
export function normalizePosition(s: string | null | undefined): string {
  if (!s) return "";
  const lower = s.trim().toLowerCase().replace(/\s+/g, " ");
  if (lower.length > 4 && lower.endsWith("s") && !lower.endsWith("ss")) {
    return lower.slice(0, -1);
  }
  return lower;
}

// ─── Main Validation Function ─────────────────────────────────────────────────

/**
 * Validate a list of AI-generated shifts against the provided context.
 *
 * Validation checks (in order):
 * 1. Employee not excluded
 * 2. Employee exists
 * 3. Template exists
 * 4. Template is active on the shift's day-of-week
 * 5. Employee's assigned position AND the LLM-emitted shift.position both
 *    match the template's required position (case-insensitive, plural-aware)
 * 6. Employee is available on that day of week
 * 7. Shift times fall within availability time window (if specific hours set)
 * 8. No double-booking (same employee, overlapping times on same day)
 * 9. Weekly hour cap (HOURS_EXCEED_WEEKLY_CAP or MINOR_HOURS_EXCEEDED) —
 *    stateful; seeded from existingShifts. MUST run AFTER step 8 so a
 *    double-booked shift doesn't also consume the employee's hour budget.
 *10. Consecutive-day cap (>5 days in a row → CONSECUTIVE_DAYS_EXCEEDED) —
 *    stateful; uses the same per-employee state as step 9.
 *
 * For double-booking: first valid shift wins. Iteration order is
 * deterministic — input shifts are sorted by (day, start_time,
 * employee_id, template_id) at the top of the function so the valid
 * set is identical regardless of LLM emission order.
 */
export function validateGeneratedShifts(
  shifts: GeneratedShift[],
  ctx: ValidationContext,
): ValidationResult {
  const valid: GeneratedShift[] = [];
  const dropped: DroppedShift[] = [];

  // Order-independence guard: sort once at the boundary so the {valid,
  // dropped} set is deterministic regardless of LLM emission order.
  // Earlier-day / earlier-start shifts win contested resources (hour
  // budget remainder, double-booking tiebreak).
  const sortedShifts = [...shifts].sort((a, b) => {
    if (a.day !== b.day) return a.day < b.day ? -1 : 1;
    if (a.start_time !== b.start_time) {
      return a.start_time < b.start_time ? -1 : 1;
    }
    if (a.employee_id !== b.employee_id) {
      return a.employee_id < b.employee_id ? -1 : 1;
    }
    if (a.template_id !== b.template_id) {
      return a.template_id < b.template_id ? -1 : 1;
    }
    return 0;
  });

  // Per-employee accumulator for steps 9-10. Seeded from existingShifts
  // (locked shifts) so the LLM's new candidates "see" the running totals
  // already in place. Locked shifts that are themselves over cap are
  // NEVER retroactively dropped — we record the over-cap reality and let
  // new candidates drop if accepting them would push further.
  const employeeState = new Map<
    string,
    { totalMinutes: number; days: Set<string> }
  >();
  const stateFor = (empId: string) => {
    let st = employeeState.get(empId);
    if (!st) {
      st = { totalMinutes: 0, days: new Set<string>() };
      employeeState.set(empId, st);
    }
    return st;
  };
  for (const e of ctx.existingShifts) {
    const st = stateFor(e.employee_id);
    st.totalMinutes += shiftHours(e) * 60;
    st.days.add(e.day);
  }

  for (const shift of sortedShifts) {
    const drop = (code: DropCode, message: string) =>
      dropped.push({ shift, code, message });

    // 1. Excluded employee
    if (ctx.excludedEmployeeIds.has(shift.employee_id)) {
      drop("EXCLUDED", `Employee ${shift.employee_id} is excluded from scheduling`);
      continue;
    }

    // 2. Employee exists
    if (!ctx.employees.has(shift.employee_id)) {
      drop("UNKNOWN_EMPLOYEE", `Unknown employee ID: ${shift.employee_id}`);
      continue;
    }

    // 3. Template exists
    const template = ctx.templates.get(shift.template_id);
    if (!template) {
      drop("UNKNOWN_TEMPLATE", `Unknown template ID: ${shift.template_id}`);
      continue;
    }

    // 4. Template is active on this day-of-week. Catches the case where a
    //    weekend-only template gets assigned on a weekday, etc.
    const shiftDow = getDayOfWeek(shift.day);
    if (!template.days.includes(shiftDow)) {
      drop(
        "DAY_NOT_IN_TEMPLATE",
        `Template ${shift.template_id} is not active on day ${shiftDow} (${shift.day}); active days: [${template.days.join(",")}]`,
      );
      continue;
    }

    // 5. Position matches the template's required role (normalized: case,
    //    whitespace, trailing -s plural). The earlier check compared
    //    employee.position to shift.position only — both are LLM-controlled,
    //    so the LLM bypassed it by simply emitting shift.position equal to
    //    the employee's own position (e.g. setting "Manager" for a manager
    //    placed onto a Server template). Anchoring on template.position
    //    catches that. We also re-check shift.position so the LLM-emitted
    //    label can't disagree with what we persist downstream.
    const requiredPosition = template.position;
    const assignedPosition = ctx.employees.get(shift.employee_id)?.position;
    const normRequired = normalizePosition(requiredPosition);
    if (
      assignedPosition === undefined ||
      normalizePosition(assignedPosition) !== normRequired
    ) {
      drop(
        "POSITION_MISMATCH",
        `Employee ${shift.employee_id} (position "${assignedPosition}") does not match template ${shift.template_id} required position "${requiredPosition}"`,
      );
      continue;
    }
    if (normalizePosition(shift.position) !== normRequired) {
      drop(
        "POSITION_MISMATCH",
        `Shift position "${shift.position}" does not match template ${shift.template_id} required position "${requiredPosition}"`,
      );
      continue;
    }

    // 6. Availability on that day
    const dayOfWeek = getDayOfWeek(shift.day);
    const availKey = `${shift.employee_id}:${dayOfWeek}`;
    const slot = ctx.availability.get(availKey);

    if (!slot || !slot.isAvailable) {
      drop(
        "UNAVAILABLE_DAY",
        `Employee ${shift.employee_id} is not available on day ${dayOfWeek} (${shift.day})`,
      );
      continue;
    }

    // 7. Shift times within availability window (overnight-aware)
    if (slot.startTime !== null && slot.endTime !== null) {
      const shiftStart = timeToMinutes(shift.start_time);
      const shiftEnd = timeToMinutes(shift.end_time);
      const windowStart = timeToMinutes(slot.startTime);
      const windowEnd = timeToMinutes(slot.endTime);

      if (!withinWindow(shiftStart, shiftEnd, windowStart, windowEnd)) {
        drop(
          "OUTSIDE_WINDOW",
          `Shift time ${shift.start_time}-${shift.end_time} is outside availability window ` +
            `${slot.startTime}-${slot.endTime} for employee ${shift.employee_id}`,
        );
        continue;
      }
    }

    // 8. Double-booking check against already-valid shifts AND existing shifts.
    // shiftsConflict is day-aware: it catches overnight shifts that spill into
    // the next calendar day's morning (e.g. Mon 22:00-02:00 vs Tue 00:00-06:00).
    const hasOverlap =
      valid.some(
        (v) =>
          v.employee_id === shift.employee_id &&
          shiftsConflict(v, shift),
      ) ||
      ctx.existingShifts.some(
        (e) =>
          e.employee_id === shift.employee_id &&
          shiftsConflict(e, shift),
      );

    if (hasOverlap) {
      drop(
        "DOUBLE_BOOKING",
        `Double-booking: employee ${shift.employee_id} already has an overlapping shift on ${shift.day}`,
      );
      continue;
    }

    // 9. Weekly hour cap. Dispatch on max_weekly_hours === 18 (the
    //    under-16 floor) so the label is factually accurate: 16-17yo
    //    minors at 40h fall through to HOURS_EXCEED_WEEKLY_CAP, not
    //    MINOR_HOURS_EXCEEDED. Step 2 already proved the employee
    //    exists; the lookup is defensive against future refactors.
    const meta = ctx.employees.get(shift.employee_id);
    if (!meta) continue;
    const st = stateFor(shift.employee_id);
    const candidateMinutes = shiftHours(shift) * 60;
    const tentativeMinutes = st.totalMinutes + candidateMinutes;
    const capMinutes = meta.max_weekly_hours * 60;

    if (tentativeMinutes > capMinutes) {
      const code: DropCode = meta.max_weekly_hours === 18
        ? "MINOR_HOURS_EXCEEDED"
        : "HOURS_EXCEED_WEEKLY_CAP";
      drop(
        code,
        `Employee ${shift.employee_id} would reach ${(tentativeMinutes / 60).toFixed(1)}h on ${shift.day} (cap ${meta.max_weekly_hours}h)`,
      );
      continue;
    }

    // 10. Consecutive-day cap (>5 in a row drops). Tentative-set
    //     evaluation: build a candidate-included view and ask the helper.
    //     Set-based dedup means two shifts on the same calendar day
    //     (open+close) count once, not twice.
    const tentativeDays = new Set(st.days);
    tentativeDays.add(shift.day);
    if (longestConsecutiveRun(tentativeDays) > 5) {
      drop(
        "CONSECUTIVE_DAYS_EXCEEDED",
        `Employee ${shift.employee_id} would exceed 5 consecutive days with ${shift.day}`,
      );
      continue;
    }

    // Commit the candidate to state and the valid list.
    st.totalMinutes = tentativeMinutes;
    st.days.add(shift.day);
    valid.push(shift);
  }

  return { valid, dropped };
}
