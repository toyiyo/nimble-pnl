// Loader for the get_scheduling_context connector tool.
// It loads the rows, then calls the pure builders. The edge entry file only dispatches here.
import { toZonedTime } from "date-fns-tz";
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
  NEEDS_EDIT_SCHEDULING,
  type Period,
} from "./schedulingContext.ts";
import { loadLaborSection } from "./schedulingContextLabor.ts";

const MAX_DAYS = 31;
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

function invalid(message: string) {
  return { ok: false, error: { code: "INVALID_ARGUMENTS", message } };
}

function resolvePeriod(
  args: { start_date?: unknown; end_date?: unknown },
  now: Date,
  tz: string,
): Period | { error: string } {
  const { start_date, end_date } = args;
  if (start_date != null && !isRealDate(start_date)) return { error: "start_date must be YYYY-MM-DD." };
  if (end_date != null && !isRealDate(end_date)) return { error: "end_date must be YYYY-MM-DD." };
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

function localYmd(iso: string, tz: string): string {
  const z = toZonedTime(new Date(iso), tz);
  const p = (n: number) => String(n).padStart(2, "0");
  return `${z.getFullYear()}-${p(z.getMonth() + 1)}-${p(z.getDate())}`;
}

function must<T>(res: { data: T | null; error: { message: string } | null }, label: string): T {
  if (res.error) throw new Error(`Failed to fetch ${label}: ${res.error.message}`);
  return (res.data ?? []) as T;
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

  const [
    employeesRes, shiftsRes, conflictRows, recurringRes, exceptionsRes, timeOffRes,
    pendingTimeOffRes, templatesRes, settingsRes, publicationsRes, tradesRes, claimsRes,
  ] = await Promise.all([
    table("employees", "id, name, position, area, employment_type, is_minor, date_of_birth, status, is_active")
      .eq("is_active", true).limit(500),
    table("shifts", SHIFT_COLUMNS).gte("start_time", startIso).lte("start_time", endIso)
      .order("start_time", { ascending: true }),
    loadShiftConflicts(supabase, restaurantId, startIso, new Date(bounds.end.getTime() + 1).toISOString()),
    table("employee_availability", "employee_id, day_of_week, is_available, start_time, end_time, notes").limit(2000),
    table("availability_exceptions", "employee_id, date, is_available, start_time, end_time, reason")
      .gte("date", period.start).lte("date", period.end).limit(2000),
    table("time_off_requests", "employee_id, start_date, end_date, status, reason")
      .lte("start_date", period.end).gte("end_date", period.start)
      .in("status", ["approved", "pending"]).limit(1000),
    table("time_off_requests", "employee_id, start_date, end_date, status, reason")
      .eq("status", "pending").limit(1000),
    table("shift_templates", "id, name, days, start_time, end_time, capacity, position, is_active")
      .eq("is_active", true),
    table("staffing_settings",
      "min_staff, min_crew, open_shifts_enabled, target_splh, lookback_weeks, target_labor_pct")
      .maybeSingle(),
    table("schedule_publications", "week_start_date, published_at").in("week_start_date", weeks),
    canEdit
      ? table("shift_trades", "id, offered_shift_id, offered_by_employee_id, target_employee_id, status, reason, created_at")
        .eq("status", "pending_approval").limit(200)
      : Promise.resolve(null),
    canEdit
      ? table("open_shift_claims", "id, shift_template_id, shift_date, claimed_by_employee_id, status, created_at")
        .eq("status", "pending_approval").limit(200)
      : Promise.resolve(null),
  ]);

  const employees = must(employeesRes, "employees") as any[];
  const shifts = must(shiftsRes, "shifts") as any[];
  const recurring = must(recurringRes, "availability") as any[];
  const exceptions = must(exceptionsRes, "availability exceptions") as any[];
  const timeOff = must(timeOffRes, "time off") as any[];
  const pendingTimeOff = must(pendingTimeOffRes, "pending time off") as any[];
  const templates = must(templatesRes, "shift templates") as any[];
  const settings = must(settingsRes, "staffing settings") as any;
  const publications = must(publicationsRes, "schedule publications") as any[];

  const conflictIndex = buildConflictIndex(conflictRows, findShiftWarnings(shifts));
  const { conflictedShiftCount } = attachConflicts(shifts, conflictIndex);

  const publicationWeeks = new Set<string>(publications.map((p) => p.week_start_date));
  const publishedShiftWeeks = new Set<string>();
  for (const w of weeks) {
    const inWeek = shifts.filter((s) =>
      s.status !== "cancelled" && mondayOf(localYmd(s.start_time, tz)) === w);
    if (inWeek.length > 0 && inWeek.every((s) => s.is_published)) publishedShiftWeeks.add(w);
  }
  const publishState = buildPublishState(weeks, publishedShiftWeeks, publicationWeeks);
  const weekPublished: Record<string, boolean> = {};
  for (const p of publishState) weekPublished[p.week_start] = p.state === "published";

  const hidden = NEEDS_EDIT_SCHEDULING;
  const trades = canEdit ? must(tradesRes, "shift trades") as unknown[] : hidden;
  const claims = canEdit ? must(claimsRes, "open shift claims") as unknown[] : hidden;

  const labor = await loadLaborSection(
    supabase, restaurantId,
    { start: period.start, end: period.end, today: ymdInTimeZone(now, tz), tz },
    { payRates, posSales },
    settings,
  );

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
