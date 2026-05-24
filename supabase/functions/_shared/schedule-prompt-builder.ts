/**
 * Shared types and pure helpers (computeHourBudget, buildWeekDates) for the
 * code-first scheduler.
 */

export interface ScheduleEmployee {
  id: string;
  name: string;
  position: string;
  area: string | null;
  hourly_rate: number; // cents
  employment_type: 'full_time' | 'part_time';
  /** Raw DOB string from the DB (YYYY-MM-DD or empty string). Carried through
   *  so the solver context can reference it without a second DB pass. */
  date_of_birth: string;
  /** Set by the edge function from `employees.date_of_birth` relative
   *  to `weekStart` via `computeHourBudget`. Null/missing DOB → false. */
  is_minor: boolean;
  /** Hard ceiling for weekly hours. Adults and 16-17yo minors: 40.
   *  Under-16 minors: 18 (FLSA school-week limit applied year-round as
   *  the conservative default). Validator dispatches MINOR_HOURS_EXCEEDED
   *  vs HOURS_EXCEED_WEEKLY_CAP on this value, NOT on `is_minor`. */
  max_weekly_hours: number;
}

export interface ScheduleTemplate {
  id: string;
  name: string;
  days: number[];
  start_time: string;
  end_time: string;
  position: string;
  area: string | null;
  /** Manager-stated headcount required per (template, day). The DB
   *  enforces `DEFAULT 1 CHECK (capacity >= 1)`. */
  capacity: number;
}

export interface AvailabilityDay {
  available: boolean;
  start?: string;
  end?: string;
}

export interface PriorPattern {
  day_of_week: number;
  position: string;
  avg_count: number;
}

export interface HourlySales {
  day_of_week: number;
  hour: number;
  avg_sales: number;
}

export interface LockedShift {
  id: string;
  employee_name: string;
  day: string;
  start_time: string;
  end_time: string;
  position: string;
}

export interface ScheduleContext {
  weekStart: string;
  employees: ScheduleEmployee[];
  templates: ScheduleTemplate[];
  availability: Record<string, Record<number, AvailabilityDay>>;
  staffingSettings: Record<string, { min: number }> | null;
  priorSchedulePatterns: PriorPattern[];
  hourlySalesPatterns: HourlySales[];
  weeklyBudgetTarget: number | null; // cents
  lockedShifts: LockedShift[];
  /** Per-(template, day-of-week) required headcount. Computed by
   *  staffing-requirements.computeRequiredStaff. Optional for backwards
   *  compatibility with any callers that haven't been updated. */
  requiredStaff?: Map<string, Map<number, number>> | null;
}

// Padded day labels for the Target Week date map. Each label is
// right-padded to 9 chars ("Wednesday" width) so a single space
// separator after the label still produces an aligned date column —
// the LLM reads the block as a table, not prose.
const DATE_MAP_LABELS = [
  'Monday   ',
  'Tuesday  ',
  'Wednesday',
  'Thursday ',
  'Friday   ',
  'Saturday ',
  'Sunday   ',
];

/**
 * Derive the seven calendar dates for the week from `weekStart`.
 *
 * @param weekStart YYYY-MM-DD; must be a Monday in restaurant-local
 *                  terms. Callers (edge function `generate-schedule`) are
 *                  responsible for that invariant.
 *
 * We parse `weekStart` as UTC midnight, add 86_400_000 ms per day, and
 * read back through UTC accessors — so the output is identical in any
 * process timezone (CI UTC, prod UTC, local dev PT). This is critical: a
 * host-TZ-dependent helper would emit different prompt text per
 * environment, masking Bug H–style drift in local testing while still
 * drifting in prod.
 *
 * Do NOT compose this helper with `schedule-validator.ts::getDayOfWeek`.
 * That helper uses the local-time `new Date(y, m-1, d)` constructor for
 * LLM-emitted day strings; the two have different anchor conventions
 * and operate on different inputs.
 *
 * @returns `rows` — the seven Monday-first labelled rows for the Target
 *          Week section, joined by '\n'.
 *          `byDayOfWeek` — array indexed 0=Sun..6=Sat → 'YYYY-MM-DD',
 *          matching the JS `Date.getDay()` convention used elsewhere
 *          (template.days, validator, availability) so callers can look
 *          up "the date for Monday" via `byDayOfWeek[1]`.
 *
 * @throws if `weekStart` does not parse to a valid Date. Without this
 *         guard, an `Invalid Date` would silently emit seven `NaN-NaN-NaN`
 *         rows into the prompt — the LLM would then either hallucinate
 *         dates or fail structured output, with no signal to the caller.
 */
export function buildWeekDates(weekStart: string): { rows: string; byDayOfWeek: string[] } {
  const base = new Date(`${weekStart}T00:00:00Z`);
  if (Number.isNaN(base.getTime())) {
    throw new Error(`buildWeekDates: invalid weekStart "${weekStart}" — expected YYYY-MM-DD`);
  }
  const formatted: string[] = [];
  for (let i = 0; i < 7; i++) {
    const d = new Date(base.getTime() + i * 86_400_000);
    const y = d.getUTCFullYear();
    const m = String(d.getUTCMonth() + 1).padStart(2, '0');
    const day = String(d.getUTCDate()).padStart(2, '0');
    formatted.push(`${y}-${m}-${day}`);
  }
  // formatted[0..6] is Monday..Sunday. byDayOfWeek remaps to the JS
  // Date.getDay() convention (0=Sun..6=Sat) so callers indexing by
  // template.days / availability day_of_week get the right date.
  const byDayOfWeek = [
    formatted[6], // Sun
    formatted[0], // Mon
    formatted[1], // Tue
    formatted[2], // Wed
    formatted[3], // Thu
    formatted[4], // Fri
    formatted[5], // Sat
  ];
  const rows = DATE_MAP_LABELS.map((label, i) => `  ${label} ${formatted[i]}`).join('\n');
  return { rows, byDayOfWeek };
}

/**
 * Returns the weekly hour cap and minor flag for an employee given
 * their date of birth and the first day of the schedule week.
 *
 * Both `dob` and `weekStart` are parsed as UTC midnight via
 * `new Date(\`${s}T00:00:00Z\`)` and compared with `.getUTC*()`
 * accessors so the result is identical across host TZs. Do NOT use
 * the local-time `new Date(year, monthIdx, day)` constructor —
 * see the TZ-portability test in
 * `tests/unit/schedule-hour-budget.test.ts`.
 *
 * Age is computed in full UTC years anchored on `weekStart` (the first
 * day of the schedule week). Birthday inclusive: an employee who turns
 * N on `weekStart` is age N — not N-1.
 *
 * | DOB             | Age on weekStart | Result                       |
 * | --------------- | ---------------- | ---------------------------- |
 * | null/bad string | n/a              | { is_minor: false, max: 40 } |
 * | future          | n/a              | { is_minor: false, max: 40 } |
 * | ≥ 18            | adult            | { is_minor: false, max: 40 } |
 * | 16-17           | minor 16+        | { is_minor: true,  max: 40 } |
 * | < 16            | minor < 16       | { is_minor: true,  max: 18 } |
 *
 * @throws if `weekStart` does not parse to a valid Date. Throwing here
 *   matches `buildWeekDates`'s behavior — an `Invalid Date` weekStart
 *   would silently propagate as NaN age and bypass every cap.
 */
export function computeHourBudget(
  dob: string | null | undefined,
  weekStart: string,
): { is_minor: boolean; max_weekly_hours: number } {
  const weekDate = new Date(`${weekStart}T00:00:00Z`);
  if (Number.isNaN(weekDate.getTime())) {
    throw new Error(
      `computeHourBudget: invalid weekStart "${weekStart}" — expected YYYY-MM-DD`,
    );
  }

  if (!dob) return { is_minor: false, max_weekly_hours: 40 };

  const dobDate = new Date(`${dob}T00:00:00Z`);
  if (Number.isNaN(dobDate.getTime())) {
    return { is_minor: false, max_weekly_hours: 40 };
  }

  // Future DOB → data error, treat as adult rather than blocking.
  if (dobDate.getTime() > weekDate.getTime()) {
    return { is_minor: false, max_weekly_hours: 40 };
  }

  // Age in full years, inclusive birthday. The employee has already had
  // their birthday this year if (dob.month, dob.day) is on or before
  // (weekStart.month, weekStart.day).
  let age = weekDate.getUTCFullYear() - dobDate.getUTCFullYear();
  const beforeBirthday =
    weekDate.getUTCMonth() < dobDate.getUTCMonth() ||
    (weekDate.getUTCMonth() === dobDate.getUTCMonth() &&
      weekDate.getUTCDate() < dobDate.getUTCDate());
  if (beforeBirthday) age--;

  if (age < 16) return { is_minor: true, max_weekly_hours: 18 };
  if (age < 18) return { is_minor: true, max_weekly_hours: 40 };
  return { is_minor: false, max_weekly_hours: 40 };
}

