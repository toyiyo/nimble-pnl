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
  | 'unscheduled_clock'
  | 'in_progress';

export interface AuditRow {
  key: string;
  status: AuditRowStatus;
  employeeId: string;
  shift?: AuditShift;
  /** Every session assigned to this shift, sorted by clockIn. One element
   * for an unscheduled row. */
  sessions?: WorkSession[];
  /** Shift length minus the scheduled break. Minutes. */
  scheduledMinutes?: number;
  /** Sum of session durations minus break minutes. Minutes. Absent while
   * the last session is open. */
  workedMinutes?: number;
  /** Sum of the gaps between consecutive sessions (unpaid break time).
   * Minutes. Present only with two or more closed sessions. */
  gapMinutes?: number;
  /** First clockIn minus shift start. Positive = late. Minutes. */
  inDeltaMinutes?: number;
  /** Last clockOut minus shift end. Positive = late. Minutes. */
  outDeltaMinutes?: number;
}

export interface AuditSummary {
  missingClock: number;
  openClock: number;
  timeMismatch: number;
  unscheduledClock: number;
  matched: number;
  inProgress: number;
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
interface SessionBuildState {
  sessions: WorkSession[];
  current: WorkSession | null;
  breakStart: string | null;
}

const closeSession = (state: SessionBuildState): void => {
  if (state.current) state.sessions.push(state.current);
  state.current = null;
  state.breakStart = null;
};

const applyPunch = (state: SessionBuildState, punch: AuditPunch): void => {
  switch (punch.punch_type) {
    case 'clock_in':
      closeSession(state);
      state.current = {
        employeeId: punch.employee_id,
        clockIn: punch.punch_time,
        clockOut: null,
        breakMinutes: 0,
        punchIds: [punch.id],
      };
      break;
    case 'break_start':
      if (state.current) {
        state.current.punchIds.push(punch.id);
        state.breakStart = punch.punch_time;
      }
      break;
    case 'break_end':
      if (state.current && state.breakStart) {
        state.current.punchIds.push(punch.id);
        state.current.breakMinutes += minutesBetween(state.breakStart, punch.punch_time);
        state.breakStart = null;
      }
      break;
    case 'clock_out':
      if (state.current) {
        state.current.punchIds.push(punch.id);
        state.current.clockOut = punch.punch_time;
        closeSession(state);
      }
      break;
    default:
      break;
  }
};

export function buildWorkSessions(punches: AuditPunch[]): WorkSession[] {
  const ordered = [...punches].sort(
    (a, b) => new Date(a.punch_time).getTime() - new Date(b.punch_time).getTime(),
  );

  const state: SessionBuildState = { sessions: [], current: null, breakStart: null };
  for (const punch of ordered) applyPunch(state, punch);
  closeSession(state);

  return state.sessions;
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
const groupSessionsByEmployee = (punches: AuditPunch[]): Map<string, WorkSession[]> => {
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
  return sessionsByEmployee;
};

const filterAuditableShifts = (
  shifts: AuditShift[],
  rangeStart: Date,
  rangeEnd: Date,
  now: Date,
): AuditShift[] =>
  shifts
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

/** Pair shifts with sessions. The pair with the smallest clock-in delta
 * wins first, across ALL shifts. A first-come pick per shift would let an
 * earlier shift take a session that belongs to the next shift at a shared
 * boundary, and the next shift would then show a false missing_clock. A
 * shift can hold many sessions -- only "session already assigned" blocks a
 * pair, not "shift already has a session". */
const assignSessionsToShifts = (
  activeShifts: AuditShift[],
  sessionsByEmployee: Map<string, WorkSession[]>,
  now: Date,
): { sessionsByShift: Map<string, WorkSession[]>; matchedSessions: Set<WorkSession> } => {
  const pairs: Array<{ shift: AuditShift; session: WorkSession; deltaMinutes: number }> = [];
  for (const shift of activeShifts) {
    for (const session of sessionsByEmployee.get(shift.employee_id) ?? []) {
      if (sessionOverlapsShift(session, shift, now)) {
        pairs.push({
          shift,
          session,
          deltaMinutes: Math.abs(minutesBetween(shift.start_time, session.clockIn)),
        });
      }
    }
  }
  pairs.sort((a, b) => a.deltaMinutes - b.deltaMinutes);

  const sessionsByShift = new Map<string, WorkSession[]>();
  const matchedSessions = new Set<WorkSession>();
  for (const pair of pairs) {
    if (matchedSessions.has(pair.session)) continue;
    const list = sessionsByShift.get(pair.shift.id) ?? [];
    list.push(pair.session);
    sessionsByShift.set(pair.shift.id, list);
    matchedSessions.add(pair.session);
  }
  return { sessionsByShift, matchedSessions };
};

const buildShiftRow = (
  shift: AuditShift,
  sessions: WorkSession[] | undefined,
  tolerance: number,
  now: Date,
): AuditRow | null => {
  const scheduledMinutes =
    minutesBetween(shift.start_time, shift.end_time) - (shift.break_duration ?? 0);
  const base = { key: `shift-${shift.id}`, employeeId: shift.employee_id, shift, scheduledMinutes };
  const shiftEnded = new Date(shift.end_time).getTime() <= now.getTime();

  if (!sessions || sessions.length === 0) {
    // A shift that has not ended yet is still in progress -- the employee
    // may simply not have clocked in yet. Only a shift whose scheduled end
    // is already in the past, with no punches at all, counts as a missed
    // clock-in.
    if (!shiftEnded) return null;
    return { ...base, status: 'missing_clock' };
  }

  const ordered = [...sessions].sort(
    (a, b) => new Date(a.clockIn).getTime() - new Date(b.clockIn).getTime(),
  );
  const firstSession = ordered[0];
  const lastSession = ordered[ordered.length - 1];
  const inDeltaMinutes = minutesBetween(shift.start_time, firstSession.clockIn);

  // Sessions present, shift still running: neutral in-progress, whether the
  // last session is open or the employee clocked out mid-shift and may
  // return.
  if (!shiftEnded) {
    return { ...base, status: 'in_progress', sessions: ordered, inDeltaMinutes };
  }

  if (!lastSession.clockOut) {
    return { ...base, status: 'open_clock', sessions: ordered, inDeltaMinutes };
  }

  const outDeltaMinutes = minutesBetween(shift.end_time, lastSession.clockOut);
  const workedMinutes = ordered.reduce(
    (sum, session) =>
      sum + minutesBetween(session.clockIn, session.clockOut as string) - session.breakMinutes,
    0,
  );
  let gapMinutes: number | undefined;
  if (ordered.length > 1) {
    gapMinutes = 0;
    for (let i = 1; i < ordered.length; i++) {
      gapMinutes += minutesBetween(
        ordered[i - 1].clockOut as string,
        ordered[i].clockIn,
      );
    }
  }
  const mismatch =
    Math.abs(inDeltaMinutes) > tolerance || Math.abs(outDeltaMinutes) > tolerance;

  return {
    ...base,
    status: mismatch ? 'time_mismatch' : 'matched',
    sessions: ordered,
    workedMinutes,
    gapMinutes,
    inDeltaMinutes,
    outDeltaMinutes,
  };
};

/** Sessions with no shift: report only the ones that start inside the range. */
const buildUnscheduledRows = (
  sessionsByEmployee: Map<string, WorkSession[]>,
  matchedSessions: Set<WorkSession>,
  rangeStart: Date,
  rangeEnd: Date,
): AuditRow[] => {
  const rows: AuditRow[] = [];
  for (const sessions of sessionsByEmployee.values()) {
    for (const session of sessions) {
      if (matchedSessions.has(session)) continue;
      const clockInMs = new Date(session.clockIn).getTime();
      if (clockInMs < rangeStart.getTime() || clockInMs > rangeEnd.getTime()) continue;
      rows.push({
        key: `session-${session.punchIds[0]}`,
        status: 'unscheduled_clock',
        employeeId: session.employeeId,
        sessions: [session],
        workedMinutes: session.clockOut
          ? minutesBetween(session.clockIn, session.clockOut) - session.breakMinutes
          : undefined,
      });
    }
  }
  return rows;
};

const SUMMARY_KEY: Record<AuditRowStatus, keyof AuditSummary> = {
  missing_clock: 'missingClock',
  open_clock: 'openClock',
  time_mismatch: 'timeMismatch',
  unscheduled_clock: 'unscheduledClock',
  matched: 'matched',
  in_progress: 'inProgress',
};

const summarizeRows = (rows: AuditRow[]): AuditSummary => {
  const summary: AuditSummary = {
    missingClock: 0,
    openClock: 0,
    timeMismatch: 0,
    unscheduledClock: 0,
    matched: 0,
    inProgress: 0,
  };
  for (const row of rows) summary[SUMMARY_KEY[row.status]] += 1;
  return summary;
};

/** Per-employee rollup of audit rows, for the row chip and the summary bar. */
export interface EmployeeAuditRollup {
  rows: AuditRow[];
  /** missing_clock + time_mismatch count. */
  toFix: number;
  /** open_clock count. */
  open: number;
  /** unscheduled_clock + in_progress count. */
  info: number;
  /** Sum of scheduledMinutes over missing_clock rows. */
  missingMinutes: number;
}

export function rollupAuditRowsByEmployee(rows: AuditRow[]): Map<string, EmployeeAuditRollup> {
  const rollup = new Map<string, EmployeeAuditRollup>();
  for (const row of rows) {
    const entry = rollup.get(row.employeeId) ?? {
      rows: [],
      toFix: 0,
      open: 0,
      info: 0,
      missingMinutes: 0,
    };
    entry.rows.push(row);
    if (row.status === 'missing_clock' || row.status === 'time_mismatch') entry.toFix += 1;
    if (row.status === 'open_clock') entry.open += 1;
    if (row.status === 'unscheduled_clock' || row.status === 'in_progress') entry.info += 1;
    if (row.status === 'missing_clock') entry.missingMinutes += row.scheduledMinutes ?? 0;
    rollup.set(row.employeeId, entry);
  }
  return rollup;
}

export function auditScheduleAgainstClocks(
  shifts: AuditShift[],
  punches: AuditPunch[],
  rangeStart: Date,
  rangeEnd: Date,
  options: AuditOptions = {},
): AuditResult {
  const tolerance = options.toleranceMinutes ?? DEFAULT_TOLERANCE_MINUTES;
  const now = options.now ?? new Date();

  const sessionsByEmployee = groupSessionsByEmployee(punches);
  const activeShifts = filterAuditableShifts(shifts, rangeStart, rangeEnd, now);

  const { sessionsByShift, matchedSessions } = assignSessionsToShifts(
    activeShifts,
    sessionsByEmployee,
    now,
  );
  const rows: AuditRow[] = [];

  for (const shift of activeShifts) {
    const row = buildShiftRow(shift, sessionsByShift.get(shift.id), tolerance, now);
    if (row) rows.push(row);
  }

  rows.push(...buildUnscheduledRows(sessionsByEmployee, matchedSessions, rangeStart, rangeEnd));

  rows.sort((a, b) => {
    const aTime = a.shift?.start_time ?? a.sessions?.[0]?.clockIn ?? '';
    const bTime = b.shift?.start_time ?? b.sessions?.[0]?.clockIn ?? '';
    return new Date(aTime).getTime() - new Date(bTime).getTime();
  });

  return { rows, summary: summarizeRows(rows) };
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
  return `${parseFloat((minutes / 60).toFixed(2))} h`;
}
