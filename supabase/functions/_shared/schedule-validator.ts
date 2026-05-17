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
  employeeIds: Set<string>;
  employeePositions: Map<string, string>;
  templateIds: Set<string>;
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
  | "POSITION_MISMATCH"
  | "UNAVAILABLE_DAY"
  | "OUTSIDE_WINDOW"
  | "DOUBLE_BOOKING";

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
 */
export function getDayOfWeek(dateStr: string): number {
  const [year, month, day] = dateStr.split('-').map(Number);
  // new Date(year, monthIndex, day) is always local time — no UTC offset shift
  return new Date(year, month - 1, day).getDay();
}

/**
 * Convert HH:MM:SS to total minutes from midnight.
 */
export function timeToMinutes(time: string): number {
  const [hours, minutes] = time.split(':').map(Number);
  return hours * 60 + minutes;
}

/**
 * Check if two shifts for the same employee on the same day overlap.
 * Overlap is defined as [start, end) intervals intersecting.
 * Adjacent shifts (end == start) do not overlap.
 */
export function shiftsOverlap(a: GeneratedShift, b: GeneratedShift): boolean {
  const aStart = timeToMinutes(a.start_time);
  const aEnd = timeToMinutes(a.end_time);
  const bStart = timeToMinutes(b.start_time);
  const bEnd = timeToMinutes(b.end_time);
  // Overlaps if one starts before the other ends (exclusive)
  return aStart < bEnd && bStart < aEnd;
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
 * 4. Position matches employee's assigned position (case-insensitive)
 * 5. Employee is available on that day of week
 * 6. Shift times fall within availability time window (if specific hours set)
 * 7. No double-booking (same employee, overlapping times on same day)
 *
 * For double-booking: first valid shift wins.
 */
export function validateGeneratedShifts(
  shifts: GeneratedShift[],
  ctx: ValidationContext,
): ValidationResult {
  const valid: GeneratedShift[] = [];
  const dropped: DroppedShift[] = [];

  for (const shift of shifts) {
    const drop = (code: DropCode, message: string) =>
      dropped.push({ shift, code, message });

    // 1. Excluded employee
    if (ctx.excludedEmployeeIds.has(shift.employee_id)) {
      drop("EXCLUDED", `Employee ${shift.employee_id} is excluded from scheduling`);
      continue;
    }

    // 2. Employee exists
    if (!ctx.employeeIds.has(shift.employee_id)) {
      drop("UNKNOWN_EMPLOYEE", `Unknown employee ID: ${shift.employee_id}`);
      continue;
    }

    // 3. Template exists
    if (!ctx.templateIds.has(shift.template_id)) {
      drop("UNKNOWN_TEMPLATE", `Unknown template ID: ${shift.template_id}`);
      continue;
    }

    // 4. Position matches (normalized: case, whitespace, trailing -s plural)
    const assignedPosition = ctx.employeePositions.get(shift.employee_id);
    if (
      assignedPosition === undefined ||
      normalizePosition(assignedPosition) !== normalizePosition(shift.position)
    ) {
      drop(
        "POSITION_MISMATCH",
        `Position mismatch for employee ${shift.employee_id}: assigned "${assignedPosition}", shift requests "${shift.position}"`,
      );
      continue;
    }

    // 5. Availability on that day
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

    // 6. Shift times within availability window (if specific hours set)
    if (slot.startTime !== null && slot.endTime !== null) {
      const shiftStart = timeToMinutes(shift.start_time);
      const shiftEnd = timeToMinutes(shift.end_time);
      const windowStart = timeToMinutes(slot.startTime);
      const windowEnd = timeToMinutes(slot.endTime);

      if (shiftStart < windowStart || shiftEnd > windowEnd) {
        drop(
          "OUTSIDE_WINDOW",
          `Shift time ${shift.start_time}-${shift.end_time} is outside availability window ` +
            `${slot.startTime}-${slot.endTime} for employee ${shift.employee_id}`,
        );
        continue;
      }
    }

    // 7. Double-booking check against already-valid shifts AND existing shifts
    const hasOverlap =
      valid.some(
        (v) =>
          v.employee_id === shift.employee_id &&
          v.day === shift.day &&
          shiftsOverlap(v, shift),
      ) ||
      ctx.existingShifts.some(
        (e) =>
          e.employee_id === shift.employee_id &&
          e.day === shift.day &&
          shiftsOverlap(e, shift),
      );

    if (hasOverlap) {
      drop(
        "DOUBLE_BOOKING",
        `Double-booking: employee ${shift.employee_id} already has an overlapping shift on ${shift.day}`,
      );
      continue;
    }

    valid.push(shift);
  }

  return { valid, dropped };
}
