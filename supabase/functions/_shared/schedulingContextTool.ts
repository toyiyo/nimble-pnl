// Loader for the get_scheduling_context connector tool.
// It loads the rows, then calls the pure builders. The edge entry file only dispatches here.
import { MAX_TOOL_TEXT_CHARS } from "./mcpHandler.ts";
import { restaurantDayBounds, ymdInTimeZone } from "./restaurantDate.ts";
import { addDaysToDateStr } from "./labor/restaurantClock.ts";
import { findShiftWarnings } from "./shiftWarnings.ts";
import { attachConflicts, buildConflictIndex, loadShiftConflicts } from "./shiftConflictFlags.ts";
import {
  hasEditSchedulingCapability,
  hasPayRatesCapability,
  hasPosSalesCapability,
} from "./tools-registry.ts";
import {
  buildAvailability,
  buildConflictList,
  buildCoverage,
  buildPending,
  buildPublishState,
  buildRoster,
  buildTimeOff,
  fitToLimit,
  localDate,
  NEEDS_EDIT_SCHEDULING,
  type EmployeeRow,
  type ExceptionRow,
  type Period,
  type RecurringRow,
  type ShiftRow,
  type StaffingSettingsRow,
  type TemplateRow,
  type TimeOffRow,
} from "./schedulingContext.ts";
import { loadLaborSection, type StaffingSettings } from "./schedulingContextLabor.ts";

const MAX_DAYS = 31;
// Row caps for each source. A source that returns this many rows can hold more.
// The result lists such a source in data_limits, so Claude never reads a cut list as a full list.
const CAPS = {
  employees: 500,
  availability: 2000,
  availability_exceptions: 2000,
  time_off: 1000,
  pending_time_off: 1000,
  trades: 200,
  claims: 200,
} as const;
const SHIFT_PAGE = 1000;
const SHIFT_PAGE_MAX = 10;
const YMD = /^\d{4}-\d{2}-\d{2}$/;

const SHIFT_COLUMNS =
  "id, employee_id, start_time, end_time, break_duration, position, status, is_published, shift_template_id";

function mondayOf(ymd: string): string {
  const dow = new Date(`${ymd}T00:00:00Z`).getUTCDay();
  return addDaysToDateStr(ymd, -((dow + 6) % 7));
}

/** The current restaurant week, Monday to Sunday, in the restaurant time zone. */
export function restaurantWeek(now: Date, tz: string): Period {
  const start = mondayOf(ymdInTimeZone(now, tz));
  return { start, end: addDaysToDateStr(start, 6) };
}

function isRealDate(s: unknown): s is string {
  return typeof s === "string" && YMD.test(s) &&
    !Number.isNaN(Date.parse(`${s}T00:00:00Z`)) &&
    new Date(`${s}T00:00:00Z`).toISOString().slice(0, 10) === s;
}

// An absent date is fine. A present date must be a real YYYY-MM-DD date.
function isBadDate(v: unknown): boolean {
  return v != null && !isRealDate(v);
}

function invalid(message: string) {
  return { ok: false, error: { code: "INVALID_ARGUMENTS", message } };
}

function resolvePeriod(
  args: { start_date?: unknown; end_date?: unknown },
  now: Date,
  tz: string,
): Period | { error: string } {
  const { start_date, end_date } = args;
  if (isBadDate(start_date)) return { error: "start_date must be YYYY-MM-DD." };
  if (isBadDate(end_date)) return { error: "end_date must be YYYY-MM-DD." };
  let start = start_date as string | undefined;
  let end = end_date as string | undefined;
  if (!start && !end) return restaurantWeek(now, tz);
  if (!start) start = addDaysToDateStr(end!, -6);
  if (!end) end = addDaysToDateStr(start, 6);
  if (end < start) return { error: "end_date must not be before start_date." };
  const days = Math.round(
    (new Date(`${end}T00:00:00Z`).getTime() - new Date(`${start}T00:00:00Z`).getTime()) / 86_400_000,
  ) + 1;
  if (days > MAX_DAYS) return { error: `The period must be ${MAX_DAYS} days or less.` };
  return { start, end };
}

function weeksIn(period: Period): string[] {
  const weeks: string[] = [];
  for (let w = mondayOf(period.start); w <= period.end; w = addDaysToDateStr(w, 7)) weeks.push(w);
  return weeks;
}

function must<T>(res: { data: T | null; error: { message: string } | null }, label: string): T {
  if (res.error) throw new Error(`Failed to fetch ${label}: ${res.error.message}`);
  return (res.data ?? []) as T;
}

/** Page through the shifts of the period. PostgREST cuts one response at max_rows. */
async function fetchShifts(
  // deno-lint-ignore no-explicit-any
  table: (name: string, columns: string) => any,
  startIso: string,
  endIso: string,
): Promise<{ data: ShiftRow[]; error: { message: string } | null; truncated: boolean }> {
  const rows: ShiftRow[] = [];
  for (let page = 0; page < SHIFT_PAGE_MAX; page++) {
    const res = await table("shifts", SHIFT_COLUMNS)
      .gte("start_time", startIso).lte("start_time", endIso)
      .order("start_time", { ascending: true }).order("id", { ascending: true })
      .range(page * SHIFT_PAGE, (page + 1) * SHIFT_PAGE - 1);
    if (res.error) return { data: [], error: res.error, truncated: false };
    const batch = (res.data ?? []) as ShiftRow[];
    rows.push(...batch);
    if (batch.length < SHIFT_PAGE) return { data: rows, error: null, truncated: false };
  }
  return { data: rows, error: null, truncated: true };
}

export async function runGetSchedulingContext(
  args: { start_date?: unknown; end_date?: unknown },
  restaurantId: string,
  // deno-lint-ignore no-explicit-any
  supabase: any,
  tz: string,
  now: Date,
  // deno-lint-ignore no-explicit-any
): Promise<any> {
  const resolved = resolvePeriod(args ?? {}, now, tz);
  if ("error" in resolved) return invalid(resolved.error);
  const period = resolved;
  const bounds = restaurantDayBounds(period.start, period.end, tz);
  const startIso = bounds.start.toISOString();
  const endIso = bounds.end.toISOString();
  const weeks = weeksIn(period);

  const [payRates, posSales, canEdit] = await Promise.all([
    hasPayRatesCapability(restaurantId, supabase),
    hasPosSalesCapability(restaurantId, supabase),
    hasEditSchedulingCapability(restaurantId, supabase),
  ]);

  const table = (name: string, columns: string) =>
    supabase.from(name).select(columns).eq("restaurant_id", restaurantId);

  // The labor section needs only the settings row and the gates. Start it now, so the
  // sales and cost loads run at the same time as the table fetches.
  // A PostgREST builder sends one request for each then(). Promise.resolve calls then() once,
  // so the labor load and the coverage load share one request.
  const settingsP: Promise<{ data: (StaffingSettingsRow & StaffingSettings) | null; error: { message: string } | null }> =
    Promise.resolve(
      table("staffing_settings",
        "min_staff, min_crew, open_shifts_enabled, target_splh, lookback_weeks, target_labor_pct")
        .maybeSingle(),
    );
  const laborP = settingsP.then((res) =>
    loadLaborSection(
      supabase, restaurantId,
      { start: period.start, end: period.end, today: ymdInTimeZone(now, tz), tz },
      { payRates, posSales },
      res.error ? must(res, "staffing settings") : res.data,
    )
  );

  const [
    employeesRes, shiftsRes, conflictRows, recurringRes, exceptionsRes, timeOffRes,
    pendingTimeOffRes, templatesRes, settingsRes, publicationsRes, tradesRes, claimsRes,
    labor,
  ] = await Promise.all([
    table("employees", "id, name, position, area, employment_type, is_minor, date_of_birth, status, is_active")
      .eq("is_active", true).order("id").limit(CAPS.employees),
    fetchShifts(table, startIso, endIso),
    loadShiftConflicts(supabase, restaurantId, startIso, new Date(bounds.end.getTime() + 1).toISOString()),
    table("employee_availability", "employee_id, day_of_week, is_available, start_time, end_time, notes").limit(CAPS.availability),
    table("availability_exceptions", "employee_id, date, is_available, start_time, end_time, reason")
      .gte("date", period.start).lte("date", period.end).limit(CAPS.availability_exceptions),
    table("time_off_requests", "employee_id, start_date, end_date, status, reason")
      .lte("start_date", period.end).gte("end_date", period.start)
      .in("status", ["approved", "pending"]).limit(CAPS.time_off),
    table("time_off_requests", "employee_id, start_date, end_date, status, reason")
      .eq("status", "pending").limit(CAPS.pending_time_off),
    table("shift_templates", "id, name, days, start_time, end_time, capacity, position, is_active")
      .eq("is_active", true),
    settingsP,
    table("schedule_publications", "week_start_date, published_at").in("week_start_date", weeks),
    canEdit
      ? table("shift_trades", "id, offered_shift_id, offered_by_employee_id, target_employee_id, status, reason, created_at")
        .eq("status", "pending_approval").limit(CAPS.trades)
      : Promise.resolve(null),
    canEdit
      ? table("open_shift_claims", "id, shift_template_id, shift_date, claimed_by_employee_id, status, created_at")
        .eq("status", "pending_approval").limit(CAPS.claims)
      : Promise.resolve(null),
    laborP,
  ]);

  const employees = must<EmployeeRow[]>(employeesRes, "employees");
  const shifts = must<ShiftRow[]>(shiftsRes, "shifts");
  const recurring = must<RecurringRow[]>(recurringRes, "availability");
  const exceptions = must<ExceptionRow[]>(exceptionsRes, "availability exceptions");
  const timeOff = must<TimeOffRow[]>(timeOffRes, "time off");
  const pendingTimeOff = must<TimeOffRow[]>(pendingTimeOffRes, "pending time off");
  const templates = must<TemplateRow[]>(templatesRes, "shift templates");
  const settings = must<StaffingSettingsRow | null>(settingsRes, "staffing settings");
  const publications = must<{ week_start_date: string }[]>(publicationsRes, "schedule publications");

  // A source with as many rows as its cap can hold more. Name it, so nobody reads a cut list as full.
  const dataLimits: string[] = [];
  const atCap = (name: string, n: number, cap: number) => { if (n >= cap) dataLimits.push(name); };
  atCap("employees", employees.length, CAPS.employees);
  atCap("employee_availability", recurring.length, CAPS.availability);
  atCap("availability_exceptions", exceptions.length, CAPS.availability_exceptions);
  atCap("time_off", timeOff.length, CAPS.time_off);
  atCap("pending_time_off", pendingTimeOff.length, CAPS.pending_time_off);
  if (shiftsRes.truncated) dataLimits.push("shifts");

  const conflictIndex = buildConflictIndex(conflictRows, findShiftWarnings(shifts));
  const { conflictedShiftCount } = attachConflicts(shifts, conflictIndex);

  const publicationWeeks = new Set<string>(publications.map((p) => p.week_start_date));
  const publishedShiftWeeks = new Set<string>();
  // One pass: group the live shifts by restaurant week, then check each week.
  const liveByWeek = new Map<string, ShiftRow[]>();
  for (const s of shifts) {
    if (s.status === "cancelled") continue;
    const w = mondayOf(localDate(s.start_time, tz));
    const list = liveByWeek.get(w);
    if (list) list.push(s);
    else liveByWeek.set(w, [s]);
  }
  for (const w of weeks) {
    const inWeek = liveByWeek.get(w) ?? [];
    if (inWeek.length > 0 && inWeek.every((s) => s.is_published)) publishedShiftWeeks.add(w);
  }
  const publishState = buildPublishState(weeks, publishedShiftWeeks, publicationWeeks);
  const weekPublished: Record<string, boolean> = {};
  for (const p of publishState) weekPublished[p.week_start] = p.state === "published";

  const hidden = NEEDS_EDIT_SCHEDULING;
  const trades = canEdit ? must<unknown[]>(tradesRes, "shift trades") : hidden;
  const claims = canEdit ? must<unknown[]>(claimsRes, "open shift claims") : hidden;
  if (Array.isArray(trades)) atCap("pending_trades", trades.length, CAPS.trades);
  if (Array.isArray(claims)) atCap("pending_claims", claims.length, CAPS.claims);

  const ctx = {
    period: { start: period.start, end: period.end, timezone: tz },
    roster: buildRoster(employees, shifts, new Set(recurring.map((r) => r.employee_id)), period),
    availability: buildAvailability(employees, recurring, exceptions, tz, period),
    conflicts: buildConflictList(shifts, conflictIndex, tz),
    conflicted_shift_count: conflictedShiftCount,
    time_off: buildTimeOff(timeOff),
    coverage: buildCoverage(templates, shifts, settings, weekPublished, period, tz),
    pending: buildPending(trades, claims, buildTimeOff(pendingTimeOff)),
    publish_state: publishState,
    labor: labor as unknown as Record<string, unknown>,
    ...(dataLimits.length > 0
      ? {
        data_limits: {
          sources: dataLimits,
          note: "These sources hit their row limit. The lists can be incomplete. Do not treat them as full.",
        },
      }
      : {}),
  };
  const data = fitToLimit(ctx, MAX_TOOL_TEXT_CHARS - 2000);

  return {
    ok: true,
    data,
    evidence: [
      { table: "employees", summary: `${employees.length} active employees` },
      { table: "shifts", summary: `${shifts.length} shifts from ${period.start} to ${period.end}` },
      { table: "shifts", summary: `${conflictedShiftCount} shifts with conflicts` },
    ],
  };
}
