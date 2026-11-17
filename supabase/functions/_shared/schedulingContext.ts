// Pure section builders for the get_scheduling_context connector tool.
// No I/O. The tool loads the rows, then calls these functions.
import { toZonedTime } from "date-fns-tz";
import {
  convertExceptionsToLocal,
  convertRecurringToLocal,
  type LocalAvail,
  type RawExceptionAvail,
  type RawRecurringAvail,
} from "./availability-tz.ts";
import { computeHourBudget } from "./schedule-prompt-builder.ts";
import type { ShiftConflict } from "./shiftConflictFlags.ts";

export interface Hidden {
  hidden: true;
  reason: string;
}

export const NEEDS_EDIT_SCHEDULING: Hidden = {
  hidden: true,
  reason: "needs edit:scheduling",
};

export interface Period {
  start: string; // YYYY-MM-DD restaurant local
  end: string;
}

export interface EmployeeRow {
  id: string;
  name: string;
  position: string | null;
  area?: string | null;
  employment_type?: string | null;
  status: string;
  date_of_birth?: string | null;
  is_minor?: boolean | null;
}

export interface ShiftRow {
  id: string;
  employee_id: string;
  start_time: string;
  end_time: string;
  break_duration?: number | null;
  status: string;
  position?: string | null;
  shift_template_id?: string | null;
  is_published?: boolean | null;
}

export interface RosterEntry {
  id: string;
  name: string;
  position: string | null;
  area: string | null;
  employment_type: string | null;
  is_minor: boolean;
  scheduled_hours: number;
  shift_count: number;
  missing_availability: boolean;
  max_weekly_hours: number;
  max_weekly_hours_note: "stored, not enforced";
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

export function buildRoster(
  employees: EmployeeRow[],
  shifts: ShiftRow[],
  recurringByEmployee: { has(id: string): boolean },
  period: Period,
): RosterEntry[] {
  const hours = new Map<string, number>();
  const counts = new Map<string, number>();
  for (const s of shifts) {
    if (s.status === "cancelled") continue;
    const ms = new Date(s.end_time).getTime() - new Date(s.start_time).getTime();
    const h = Math.max(0, ms / 3_600_000 - (s.break_duration ?? 0) / 60);
    hours.set(s.employee_id, (hours.get(s.employee_id) ?? 0) + h);
    counts.set(s.employee_id, (counts.get(s.employee_id) ?? 0) + 1);
  }
  return employees
    .filter((e) => e.status === "active")
    .map((e) => {
      const budget = computeHourBudget(
        e.date_of_birth,
        period.start,
        e.is_minor === true,
      );
      return {
        id: e.id,
        name: e.name,
        position: e.position ?? null,
        area: e.area ?? null,
        employment_type: e.employment_type ?? null,
        is_minor: budget.is_minor,
        scheduled_hours: round2(hours.get(e.id) ?? 0),
        shift_count: counts.get(e.id) ?? 0,
        missing_availability: !recurringByEmployee.has(e.id),
        max_weekly_hours: budget.max_weekly_hours,
        max_weekly_hours_note: "stored, not enforced" as const,
      };
    });
}

export interface RecurringRow extends RawRecurringAvail {
  notes?: string | null;
}
export interface ExceptionRow extends RawExceptionAvail {
  reason?: string | null;
}

type Window = { start: string; end: string };
export interface AvailabilityEntry {
  employee_id: string;
  // A weekday with split availability holds a list of windows, not one merged window.
  weekly: Record<number, Window | Window[] | "unavailable"> | "not_set";
  notes?: string;
  exceptions: {
    date: string;
    start?: string;
    end?: string;
    available: boolean;
    reason?: string;
  }[];
}

function groupBy<T>(rows: T[], key: (r: T) => string): Map<string, T[]> {
  const m = new Map<string, T[]>();
  for (const r of rows) {
    const k = key(r);
    const list = m.get(k);
    if (list) list.push(r);
    else m.set(k, [r]);
  }
  return m;
}

const hhmm = (t: string | null): string => (t ?? "").slice(0, 5);

/** Sort the windows and join the ones that overlap or touch. A gap stays a gap. */
function mergeWindows(list: Window[]): Window[] {
  const sorted = [...list].sort((a, b) => a.start.localeCompare(b.start));
  const out: Window[] = [];
  // A close time of 00:00 means midnight at the end of the day, so it compares as 24:00.
  const endKey = (t: string) => (t === "00:00" ? "24:00" : t);
  for (const w of sorted) {
    const last = out[out.length - 1];
    if (last && w.start <= endKey(last.end)) {
      if (endKey(w.end) > endKey(last.end)) last.end = w.end;
    } else {
      out.push({ ...w });
    }
  }
  return out;
}

function toWindow(a: LocalAvail): Window | "unavailable" {
  if (!a.is_available) return "unavailable";
  if (a.start_time === null || a.end_time === null) {
    return { start: "00:00", end: "24:00" };
  }
  return { start: hhmm(a.start_time), end: hhmm(a.end_time) };
}

export function buildAvailability(
  employees: Pick<EmployeeRow, "id">[],
  recurringRows: RecurringRow[],
  exceptionRows: ExceptionRow[],
  tz: string,
  period: Period,
): AvailabilityEntry[] {
  const refWeek = period.start;
  const inPeriod = (d: string) => d >= period.start && d <= period.end;
  const recByEmployee = groupBy(recurringRows, (r) => r.employee_id);
  const excByEmployee = groupBy(exceptionRows, (r) => r.employee_id);
  return employees.map((emp) => {
    const rec = recByEmployee.get(emp.id) ?? [];
    const exc = (excByEmployee.get(emp.id) ?? []).filter((r) => inPeriod(r.date));
    const exceptions = exc.map((r) => {
      const [local] = convertExceptionsToLocal([r], tz);
      const out: AvailabilityEntry["exceptions"][number] = {
        date: r.date,
        available: r.is_available,
      };
      if (r.is_available && local?.start_time && local.end_time) {
        out.start = hhmm(local.start_time);
        out.end = hhmm(local.end_time);
      }
      if (r.reason) out.reason = r.reason;
      return out;
    });
    if (rec.length === 0 && exceptions.length === 0) {
      return { employee_id: emp.id, weekly: "not_set" as const, exceptions };
    }
    const windowsByDay = new Map<number, Window[]>();
    const dayRows = new Set<number>();
    for (const a of convertRecurringToLocal(rec, tz, refWeek)) {
      dayRows.add(a.day_of_week);
      const next = toWindow(a);
      if (next === "unavailable") continue;
      const list = windowsByDay.get(a.day_of_week) ?? [];
      list.push(next);
      windowsByDay.set(a.day_of_week, list);
    }
    const weekly: Record<number, Window | Window[] | "unavailable"> = {};
    for (const day of dayRows) {
      const merged = mergeWindows(windowsByDay.get(day) ?? []);
      if (merged.length === 0) weekly[day] = "unavailable";
      else if (merged.length === 1) weekly[day] = merged[0];
      else weekly[day] = merged;
    }
    const entry: AvailabilityEntry = {
      employee_id: emp.id,
      weekly: rec.length === 0 ? "not_set" : weekly,
      exceptions,
    };
    const notes = rec.find((r) => r.notes)?.notes;
    if (notes) entry.notes = notes;
    return entry;
  });
}

export interface ConflictListEntry {
  shift_id: string;
  employee_id: string;
  date: string;
  type: ShiftConflict["type"];
  rule: ShiftConflict["rule"];
  source?: string;
  status?: string;
  message: string;
}

// The cache lives for one isolate. It clears when full, so memory stays bounded.
const LOCAL_DATE_CACHE_MAX = 10_000;
const localDateCache = new Map<string, string>();

/** The restaurant-local YYYY-MM-DD date of an ISO timestamp. */
export function localDate(iso: string, tz: string): string {
  // toZonedTime uses Intl and is slow. The builders ask for the same shift many times.
  const key = `${tz}|${iso}`;
  const hit = localDateCache.get(key);
  if (hit !== undefined) return hit;
  const z = toZonedTime(new Date(iso), tz);
  const p = (n: number) => String(n).padStart(2, "0");
  const out = `${z.getFullYear()}-${p(z.getMonth() + 1)}-${p(z.getDate())}`;
  if (localDateCache.size >= LOCAL_DATE_CACHE_MAX) localDateCache.clear();
  localDateCache.set(key, out);
  return out;
}

export function buildConflictList(
  shifts: Pick<ShiftRow, "id" | "employee_id" | "start_time">[],
  index: Map<string, ShiftConflict[]>,
  tz: string,
): ConflictListEntry[] {
  const out: ConflictListEntry[] = [];
  for (const s of shifts) {
    for (const c of index.get(s.id) ?? []) {
      const e: ConflictListEntry = {
        shift_id: s.id,
        employee_id: s.employee_id,
        date: localDate(s.start_time, tz),
        type: c.type,
        rule: c.rule,
        message: c.message,
      };
      if (c.source) e.source = c.source;
      if (c.status) e.status = c.status;
      out.push(e);
    }
  }
  return out;
}

export interface TimeOffRow {
  employee_id: string;
  start_date: string;
  end_date: string;
  status: string;
  reason?: string | null;
}
export interface TimeOffEntry {
  employee_id: string;
  start_date: string;
  end_date: string;
  status: string;
  reason: string | null;
  blocks_scheduling: true;
}

export function buildTimeOff(requests: TimeOffRow[]): TimeOffEntry[] {
  return requests
    .filter((r) => r.status === "approved" || r.status === "pending")
    .map((r) => ({
      employee_id: r.employee_id,
      start_date: r.start_date,
      end_date: r.end_date,
      status: r.status,
      reason: r.reason ?? null,
      blocks_scheduling: true as const,
    }));
}

export interface TemplateRow {
  id: string;
  name: string;
  days: number[];
  start_time: string;
  end_time: string;
  capacity: number;
  position?: string | null;
  is_active: boolean;
}
export interface StaffingSettingsRow {
  min_staff?: number | null;
  min_crew?: Record<string, number> | null;
  open_shifts_enabled?: boolean | null;
}
export interface Coverage {
  templates: {
    id: string;
    name: string;
    days: number[];
    start_time: string;
    end_time: string;
    capacity: number;
  }[];
  open_spots: {
    template_id: string;
    date: string;
    capacity: number;
    assigned: number;
    open: number;
  }[];
  total_open_spots: number;
  staffing_minimums: {
    min_staff: number | null;
    min_crew: Record<string, number> | null;
  };
  open_shifts_enabled: boolean;
  can_broadcast_open_shifts: boolean;
}

function datesBetween(start: string, end: string): string[] {
  const out: string[] = [];
  const d = new Date(`${start}T00:00:00Z`);
  const stop = new Date(`${end}T00:00:00Z`).getTime();
  while (d.getTime() <= stop) {
    out.push(d.toISOString().slice(0, 10));
    d.setUTCDate(d.getUTCDate() + 1);
  }
  return out;
}

const capacityFloor = (c: number | null | undefined): number => {
  const n = Number(c);
  return Number.isFinite(n) && n >= 1 ? Math.floor(n) : 1;
};

function weekOf(date: string, weeks: string[]): string | undefined {
  const t = new Date(`${date}T00:00:00Z`).getTime();
  return weeks.find((w) => {
    const s = new Date(`${w}T00:00:00Z`).getTime();
    return t >= s && t < s + 7 * 86_400_000;
  });
}

export function buildCoverage(
  templates: TemplateRow[],
  shifts: ShiftRow[],
  settings: StaffingSettingsRow | null,
  weekPublished: Record<string, boolean>,
  period: Period,
  tz = "UTC",
): Coverage {
  const active = templates.filter((t) => t.is_active);
  const dates = datesBetween(period.start, period.end);
  const assigned = new Map<string, Set<string>>();
  for (const s of shifts) {
    if (s.status === "cancelled" || !s.shift_template_id) continue;
    const key = `${s.shift_template_id}|${localDate(s.start_time, tz)}`;
    if (!assigned.has(key)) assigned.set(key, new Set());
    assigned.get(key)!.add(s.employee_id);
  }
  const open_spots: Coverage["open_spots"] = [];
  let total = 0;
  for (const t of active) {
    for (const date of dates) {
      const dow = new Date(`${date}T00:00:00Z`).getUTCDay();
      if (!t.days.includes(dow)) continue;
      const cap = capacityFloor(t.capacity);
      const n = assigned.get(`${t.id}|${date}`)?.size ?? 0;
      const open = Math.max(0, cap - n);
      total += open;
      open_spots.push({ template_id: t.id, date, capacity: cap, assigned: n, open });
    }
  }
  const weeks = Object.keys(weekPublished);
  const periodWeeks = new Set(
    dates.map((d) => weekOf(d, weeks)).filter((w): w is string => !!w),
  );
  const allPublished =
    periodWeeks.size > 0 && [...periodWeeks].every((w) => weekPublished[w]);
  const enabled = settings?.open_shifts_enabled === true;
  return {
    templates: active.map((t) => ({
      id: t.id,
      name: t.name,
      days: t.days,
      start_time: t.start_time,
      end_time: t.end_time,
      capacity: capacityFloor(t.capacity),
    })),
    open_spots,
    total_open_spots: total,
    staffing_minimums: {
      min_staff: settings?.min_staff ?? null,
      min_crew: settings?.min_crew ?? null,
    },
    open_shifts_enabled: enabled,
    can_broadcast_open_shifts: enabled && allPublished,
  };
}

export interface Pending {
  trades: unknown[] | Hidden;
  claims: unknown[] | Hidden;
  time_off: { scope: string; requests: unknown[] };
}

export function buildPending(
  trades: unknown[] | Hidden,
  claims: unknown[] | Hidden,
  pendingTimeOff: unknown[],
): Pending {
  return {
    trades,
    claims,
    time_off: {
      scope: "all pending requests, not only this period",
      requests: pendingTimeOff,
    },
  };
}

export function buildPublishState(
  weeks: string[],
  publishedShiftWeeks: Set<string>,
  publicationWeeks: Set<string>,
): { week_start: string; state: "published" | "draft" }[] {
  return weeks.map((w) => ({
    week_start: w,
    state:
      publishedShiftWeeks.has(w) && publicationWeeks.has(w)
        ? ("published" as const)
        : ("draft" as const),
  }));
}

export const DROPPABLE_SECTIONS = [
  "labor.staffing_suggestions",
  "publish_state",
  "coverage",
  "pending",
  // Last resorts. The roster stays, so Claude can still name each employee.
  "availability",
  "time_off",
] as const;

export interface SchedulingContext {
  roster: unknown;
  availability: unknown;
  conflicts: unknown;
  time_off: unknown;
  coverage?: unknown;
  pending?: unknown;
  publish_state?: unknown;
  labor?: Record<string, unknown>;
  [key: string]: unknown;
}

/** The core lists that fitToLimit cuts last, in this order. */
const CUTTABLE_LISTS = ["conflicts", "availability", "time_off", "roster"] as const;

export function fitToLimit(
  ctx: SchedulingContext,
  limit: number,
): SchedulingContext & { truncated?: true; omitted_sections?: string[] } {
  const out: SchedulingContext & {
    truncated?: true;
    omitted_sections?: string[];
  } = { ...ctx, labor: ctx.labor ? { ...ctx.labor } : undefined };
  if (out.labor === undefined) delete out.labor;
  const omitted: string[] = [];
  for (const name of DROPPABLE_SECTIONS) {
    if (JSON.stringify(out).length < limit) break;
    if (name === "labor.staffing_suggestions") {
      if (!out.labor || !("staffing_suggestions" in out.labor)) continue;
      delete out.labor.staffing_suggestions;
    } else {
      if (!(name in out)) continue;
      delete out[name];
    }
    omitted.push(name);
    out.truncated = true;
    out.omitted_sections = [...omitted];
  }
  // Still over the limit: cut the core lists in this order, so the JSON stays valid and the
  // flag is true. The roster alone can pass the limit (CAPS.employees is 500).
  for (const name of CUTTABLE_LISTS) {
    if (JSON.stringify(out).length < limit) break;
    const list = out[name];
    if (!Array.isArray(list) || list.length === 0) continue;
    omitted.push(`${name} (partial)`);
    out.truncated = true;
    out.omitted_sections = [...omitted];
    let kept = list as unknown[];
    while (kept.length > 0 && JSON.stringify({ ...out, [name]: kept }).length >= limit) {
      kept = kept.slice(0, Math.floor(kept.length / 2));
    }
    out[name] = kept;
  }
  return out;
}
