/**
 * Schedule-vs-clock audit for payroll review.
 *
 * Payroll pays only from `time_punches`. A scheduled shift with no punches
 * pays nothing. This module compares the shifts in a pay period with the
 * punch sessions in the same period and classifies each pair.
 *
 * Pure logic, no I/O. `useScheduleClockAudit` feeds it and the Payroll page
 * shows the result.
 */

import { differenceInMinutes } from 'date-fns';

export interface AuditShift {
  id: string;
  employee_id: string;
  /** ISO instant (timestamptz). */
  start_time: string;
  /** ISO instant (timestamptz). */
  end_time: string;
  /** Minutes. */
  break_duration?: number | null;
  position?: string | null;
  status: string;
  is_published?: boolean | null;
}

export interface AuditPunch {
  id: string;
  employee_id: string;
  punch_type: string;
  /** ISO instant (timestamptz). */
  punch_time: string;
  shift_id?: string | null;
}

/** One clock_in..clock_out pair, with break punches folded in. */
export interface WorkSession {
  employeeId: string;
  clockIn: string;
  /** Null while the session is still open (no clock_out yet). */
  clockOut: string | null;
  breakMinutes: number;
  punchIds: string[];
}

export type AuditRowStatus =
  | 'missing_clock'
  | 'open_clock'
  | 'time_mismatch'
  | 'matched'
  | 'unscheduled_clock';

export interface AuditRow {
  key: string;
  status: AuditRowStatus;
  employeeId: string;
  shift?: AuditShift;
  session?: WorkSession;
  /** Shift length minus the scheduled break. Minutes. */
  scheduledMinutes?: number;
  /** Session length minus the break punches. Minutes. Absent while open. */
  workedMinutes?: number;
  /** clockIn minus shift start. Positive = late. Minutes. */
  inDeltaMinutes?: number;
  /** clockOut minus shift end. Positive = late. Minutes. */
  outDeltaMinutes?: number;
}

export interface AuditSummary {
  missingClock: number;
  openClock: number;
  timeMismatch: number;
  unscheduledClock: number;
  matched: number;
}

export interface AuditResult {
  rows: AuditRow[];
  summary: AuditSummary;
}

export interface AuditOptions {
  /** Largest in/out deviation that still counts as a match. Default 10. */
  toleranceMinutes?: number;
  /** "Now" for in-progress checks. Injected for tests. */
  now?: Date;
}

export const DEFAULT_TOLERANCE_MINUTES = 10;

/**
 * A session matches a shift when the two intervals overlap after the shift
 * grows by this pad on both sides. The pad accepts early and late punches.
 */
const MATCH_PAD_MINUTES = 4 * 60;

const MINUTE_MS = 60_000;

const minutesBetween = (fromIso: string, toIso: string): number =>
  differenceInMinutes(toIso, fromIso, { roundingMethod: 'round' });

/**
 * Fold an employee's punches into clock_in..clock_out sessions.
 *
 * Punches must belong to one employee. A clock_in opens a session. A
 * clock_out closes it. Break punches add to `breakMinutes`. A second
 * clock_in before a clock_out closes the first session as open. Orphan
 * clock_out / break punches without an open session are dropped — the
 * payroll pairing engine already reports those as incomplete punches.
 */
export function buildWorkSessions(punches: AuditPunch[]): WorkSession[] {
  const ordered = [...punches].sort(
    (a, b) => new Date(a.punch_time).getTime() - new Date(b.punch_time).getTime(),
  );

  const sessions: WorkSession[] = [];
  let current: WorkSession | null = null;
  let breakStart: string | null = null;

  const close = () => {
    if (current) sessions.push(current);
    current = null;
    breakStart = null;
  };

  for (const punch of ordered) {
    switch (punch.punch_type) {
      case 'clock_in':
        if (current) close();
        current = {
          employeeId: punch.employee_id,
          clockIn: punch.punch_time,
          clockOut: null,
          breakMinutes: 0,
          punchIds: [punch.id],
        };
        break;
      case 'break_start':
        if (current) {
          current.punchIds.push(punch.id);
          breakStart = punch.punch_time;
        }
        break;
      case 'break_end':
        if (current && breakStart) {
          current.punchIds.push(punch.id);
          current.breakMinutes += minutesBetween(breakStart, punch.punch_time);
          breakStart = null;
        }
        break;
      case 'clock_out':
        if (current) {
          current.punchIds.push(punch.id);
          current.clockOut = punch.punch_time;
          close();
        }
        break;
      default:
        break;
    }
  }
  close();

  return sessions;
}

const sessionOverlapsShift = (session: WorkSession, shift: AuditShift, now: Date): boolean => {
  const padMs = MATCH_PAD_MINUTES * MINUTE_MS;
  const shiftStart = new Date(shift.start_time).getTime() - padMs;
  const shiftEnd = new Date(shift.end_time).getTime() + padMs;
  const sessionStart = new Date(session.clockIn).getTime();

  if (!session.clockOut) {
    // An open session's true end is unknown. Do not treat it as reaching to
    // `now` for overlap purposes -- that would let a stale, unrelated open
    // clock-in from an earlier day "reach forward" and swallow every later
    // shift up to the present. Require the clock-in itself to land inside
    // the shift's padded window instead.
    return sessionStart >= shiftStart && sessionStart <= shiftEnd;
  }

  const sessionEnd = new Date(session.clockOut).getTime();
  return sessionStart <= shiftEnd && sessionEnd >= shiftStart;
};

/**
 * Compare the shifts with the punch sessions for one restaurant and range.
 *
 * The caller must pass shifts that start inside the pay period, and every
 * punch near that period (use the overnight fetch buffer). Cancelled shifts
 * and shifts that did not start yet are ignored. Sessions that start outside
 * [rangeStart, rangeEnd] are ignored on the unscheduled side.
 */
export function auditScheduleAgainstClocks(
  shifts: AuditShift[],
  punches: AuditPunch[],
  rangeStart: Date,
  rangeEnd: Date,
  options: AuditOptions = {},
): AuditResult {
  const tolerance = options.toleranceMinutes ?? DEFAULT_TOLERANCE_MINUTES;
  const now = options.now ?? new Date();

  const punchesByEmployee = new Map<string, AuditPunch[]>();
  for (const punch of punches) {
    const list = punchesByEmployee.get(punch.employee_id) ?? [];
    list.push(punch);
    punchesByEmployee.set(punch.employee_id, list);
  }

  const sessionsByEmployee = new Map<string, WorkSession[]>();
  for (const [employeeId, list] of punchesByEmployee) {
    sessionsByEmployee.set(employeeId, buildWorkSessions(list));
  }

  const activeShifts = shifts
    .filter((shift) => shift.status !== 'cancelled')
    .filter((shift) => shift.is_published !== false)
    .filter((shift) => new Date(shift.start_time).getTime() <= now.getTime())
    // Only shifts that overlap [rangeStart, rangeEnd] count (inclusive bounds,
    // matching Supabase .gte/.lte semantics). This also guards a shift the
    // caller over-fetched from a widened query window (e.g. an overnight
    // shift that starts the day before the period).
    .filter((shift) => new Date(shift.start_time).getTime() <= rangeEnd.getTime())
    .filter((shift) => new Date(shift.end_time).getTime() >= rangeStart.getTime())
    .sort((a, b) => new Date(a.start_time).getTime() - new Date(b.start_time).getTime());

  const matchedSessions = new Set<WorkSession>();
  const rows: AuditRow[] = [];

  for (const shift of activeShifts) {
    const candidates = (sessionsByEmployee.get(shift.employee_id) ?? []).filter(
      (session) => !matchedSessions.has(session) && sessionOverlapsShift(session, shift, now),
    );

    // Nearest clock_in to the scheduled start wins.
    candidates.sort(
      (a, b) =>
        Math.abs(minutesBetween(shift.start_time, a.clockIn)) -
        Math.abs(minutesBetween(shift.start_time, b.clockIn)),
    );
    const session = candidates[0];

    const scheduledMinutes =
      minutesBetween(shift.start_time, shift.end_time) - (shift.break_duration ?? 0);

    if (!session) {
      // A shift that has not ended yet is still in progress -- the employee
      // may simply not have clocked in yet. Only a shift whose scheduled end
      // is already in the past, with no punches at all, counts as a missed
      // clock-in.
      if (new Date(shift.end_time).getTime() > now.getTime()) continue;
      rows.push({
        key: `shift-${shift.id}`,
        status: 'missing_clock',
        employeeId: shift.employee_id,
        shift,
        scheduledMinutes,
      });
      continue;
    }

    matchedSessions.add(session);
    const inDeltaMinutes = minutesBetween(shift.start_time, session.clockIn);

    if (!session.clockOut) {
      rows.push({
        key: `shift-${shift.id}`,
        status: 'open_clock',
        employeeId: shift.employee_id,
        shift,
        session,
        scheduledMinutes,
        inDeltaMinutes,
      });
      continue;
    }

    const outDeltaMinutes = minutesBetween(shift.end_time, session.clockOut);
    const workedMinutes =
      minutesBetween(session.clockIn, session.clockOut) - session.breakMinutes;
    const mismatch =
      Math.abs(inDeltaMinutes) > tolerance || Math.abs(outDeltaMinutes) > tolerance;

    rows.push({
      key: `shift-${shift.id}`,
      status: mismatch ? 'time_mismatch' : 'matched',
      employeeId: shift.employee_id,
      shift,
      session,
      scheduledMinutes,
      workedMinutes,
      inDeltaMinutes,
      outDeltaMinutes,
    });
  }

  // Sessions with no shift: report only the ones that start inside the range.
  for (const sessions of sessionsByEmployee.values()) {
    for (const session of sessions) {
      if (matchedSessions.has(session)) continue;
      const clockInMs = new Date(session.clockIn).getTime();
      if (clockInMs < rangeStart.getTime() || clockInMs > rangeEnd.getTime()) continue;
      rows.push({
        key: `session-${session.punchIds[0]}`,
        status: 'unscheduled_clock',
        employeeId: session.employeeId,
        session,
        workedMinutes: session.clockOut
          ? minutesBetween(session.clockIn, session.clockOut) - session.breakMinutes
          : undefined,
      });
    }
  }

  rows.sort((a, b) => {
    const aTime = a.shift?.start_time ?? a.session?.clockIn ?? '';
    const bTime = b.shift?.start_time ?? b.session?.clockIn ?? '';
    return new Date(aTime).getTime() - new Date(bTime).getTime();
  });

  const summary: AuditSummary = {
    missingClock: 0,
    openClock: 0,
    timeMismatch: 0,
    unscheduledClock: 0,
    matched: 0,
  };
  for (const row of rows) {
    if (row.status === 'missing_clock') summary.missingClock += 1;
    else if (row.status === 'open_clock') summary.openClock += 1;
    else if (row.status === 'time_mismatch') summary.timeMismatch += 1;
    else if (row.status === 'unscheduled_clock') summary.unscheduledClock += 1;
    else summary.matched += 1;
  }

  return { rows, summary };
}

/** Format a signed minute delta: "+12 min" / "-5 min" / "on time". */
export function formatDeltaMinutes(delta: number | undefined): string {
  if (delta === undefined) return '—';
  if (delta === 0) return 'on time';
  const sign = delta > 0 ? '+' : '−';
  const abs = Math.abs(delta);
  if (abs >= 60) {
    const hours = Math.floor(abs / 60);
    const minutes = abs % 60;
    return minutes === 0 ? `${sign}${hours}h` : `${sign}${hours}h ${minutes}m`;
  }
  return `${sign}${abs} min`;
}

/** Format minutes as "7.5 h". */
export function formatMinutesAsHours(minutes: number | undefined): string {
  if (minutes === undefined) return '—';
  return `${(minutes / 60).toFixed(2).replace(/\.?0+$/, '')} h`;
}
