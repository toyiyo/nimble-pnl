import { describe, it, expect } from 'vitest';
import {
  auditScheduleAgainstClocks,
  buildWorkSessions,
  formatDeltaMinutes,
  formatMinutesAsHours,
  rollupAuditRowsByEmployee,
  type AuditPunch,
  type AuditRow,
  type AuditShift,
} from '@/utils/scheduleClockAudit';

const NOW = new Date('2026-08-15T12:00:00Z');
const RANGE_START = new Date('2026-08-10T00:00:00Z');
const RANGE_END = new Date('2026-08-16T23:59:59Z');

let punchSeq = 0;
const punch = (
  employeeId: string,
  type: AuditPunch['punch_type'],
  time: string,
): AuditPunch => ({
  id: `p${++punchSeq}`,
  employee_id: employeeId,
  punch_type: type,
  punch_time: time,
});

const shift = (overrides: Partial<AuditShift> & { id: string }): AuditShift => ({
  employee_id: 'emp1',
  start_time: '2026-08-12T15:00:00Z',
  end_time: '2026-08-12T23:00:00Z',
  break_duration: 0,
  position: 'Server',
  status: 'scheduled',
  is_published: true,
  ...overrides,
});

const audit = (shifts: AuditShift[], punches: AuditPunch[], toleranceMinutes = 10) =>
  auditScheduleAgainstClocks(shifts, punches, RANGE_START, RANGE_END, {
    toleranceMinutes,
    now: NOW,
  });

describe('buildWorkSessions', () => {
  it('pairs clock_in and clock_out and folds break punches in', () => {
    const sessions = buildWorkSessions([
      punch('emp1', 'clock_in', '2026-08-12T15:00:00Z'),
      punch('emp1', 'break_start', '2026-08-12T18:00:00Z'),
      punch('emp1', 'break_end', '2026-08-12T18:30:00Z'),
      punch('emp1', 'clock_out', '2026-08-12T23:00:00Z'),
    ]);
    expect(sessions).toHaveLength(1);
    expect(sessions[0].clockOut).toBe('2026-08-12T23:00:00Z');
    expect(sessions[0].breakMinutes).toBe(30);
    expect(sessions[0].punchIds).toHaveLength(4);
  });

  it('closes an unfinished session when a new clock_in arrives', () => {
    const sessions = buildWorkSessions([
      punch('emp1', 'clock_in', '2026-08-12T15:00:00Z'),
      punch('emp1', 'clock_in', '2026-08-13T15:00:00Z'),
      punch('emp1', 'clock_out', '2026-08-13T22:00:00Z'),
    ]);
    expect(sessions).toHaveLength(2);
    expect(sessions[0].clockOut).toBeNull();
    expect(sessions[1].clockOut).toBe('2026-08-13T22:00:00Z');
  });

  it('drops orphan clock_out punches', () => {
    const sessions = buildWorkSessions([
      punch('emp1', 'clock_out', '2026-08-12T23:00:00Z'),
    ]);
    expect(sessions).toHaveLength(0);
  });
});

describe('auditScheduleAgainstClocks', () => {
  it('reports a past shift with no punches as missing_clock', () => {
    const result = audit([shift({ id: 's1' })], []);
    expect(result.rows).toHaveLength(1);
    expect(result.rows[0].status).toBe('missing_clock');
    expect(result.rows[0].scheduledMinutes).toBe(480);
    expect(result.summary.missingClock).toBe(1);
  });

  it('subtracts the scheduled break from scheduledMinutes', () => {
    const result = audit([shift({ id: 's1', break_duration: 30 })], []);
    expect(result.rows[0].scheduledMinutes).toBe(450);
  });

  it('reports a close match as matched', () => {
    const result = audit(
      [shift({ id: 's1' })],
      [
        punch('emp1', 'clock_in', '2026-08-12T14:55:00Z'),
        punch('emp1', 'clock_out', '2026-08-12T23:05:00Z'),
      ],
    );
    expect(result.rows[0].status).toBe('matched');
    expect(result.rows[0].inDeltaMinutes).toBe(-5);
    expect(result.rows[0].outDeltaMinutes).toBe(5);
    expect(result.summary.matched).toBe(1);
  });

  it('reports a large deviation as time_mismatch', () => {
    const result = audit(
      [shift({ id: 's1' })],
      [
        punch('emp1', 'clock_in', '2026-08-12T15:45:00Z'),
        punch('emp1', 'clock_out', '2026-08-12T23:00:00Z'),
      ],
    );
    expect(result.rows[0].status).toBe('time_mismatch');
    expect(result.rows[0].inDeltaMinutes).toBe(45);
    expect(result.summary.timeMismatch).toBe(1);
  });

  it('assigns a boundary session to the shift with the closest clock-in, not the first shift in time order', () => {
    // Back-to-back shifts. The session covers the second shift exactly.
    // A first-come pick would give the session to the first shift and
    // report the second shift as missing_clock — a double-pay trap when
    // the manager then enters punches for the second shift.
    const result = audit(
      [
        shift({ id: 'a', start_time: '2026-08-12T14:00:00Z', end_time: '2026-08-12T15:00:00Z' }),
        shift({ id: 'b', start_time: '2026-08-12T15:00:00Z', end_time: '2026-08-12T16:00:00Z' }),
      ],
      [
        punch('emp1', 'clock_in', '2026-08-12T15:00:00Z'),
        punch('emp1', 'clock_out', '2026-08-12T16:00:00Z'),
      ],
    );
    const byKey = new Map(result.rows.map((row) => [row.key, row]));
    expect(byKey.get('shift-b')?.status).toBe('matched');
    expect(byKey.get('shift-a')?.status).toBe('missing_clock');
  });

  it('assigns a split-shift session by overlap, not by clock-in delta', () => {
    // Codex review case: punches exist only for the first of two
    // back-to-back shifts, split by an unpaid lunch. The 13:30 clock-in
    // sits nearer to the 17:00 start (210 min) than to its own 09:00
    // start (270 min). A delta rule sends the lunch-return session to
    // the wrong shift and hides the second shift's real missing_clock.
    const result = audit(
      [
        shift({ id: 'a', start_time: '2026-08-12T09:00:00Z', end_time: '2026-08-12T17:00:00Z' }),
        shift({ id: 'b', start_time: '2026-08-12T17:00:00Z', end_time: '2026-08-12T21:00:00Z' }),
      ],
      [
        punch('emp1', 'clock_in', '2026-08-12T09:00:00Z'),
        punch('emp1', 'clock_out', '2026-08-12T12:00:00Z'),
        punch('emp1', 'clock_in', '2026-08-12T13:30:00Z'),
        punch('emp1', 'clock_out', '2026-08-12T17:00:00Z'),
      ],
    );
    const byKey = new Map(result.rows.map((row) => [row.key, row]));
    expect(byKey.get('shift-a')?.status).toBe('matched');
    expect(byKey.get('shift-a')?.workedMinutes).toBe(390);
    expect(byKey.get('shift-a')?.gapMinutes).toBe(90);
    expect(byKey.get('shift-b')?.status).toBe('missing_clock');
  });

  it('assigns an open session by clock-in delta, not by a reach to now', () => {
    // Sound-logic review case: a 12:30 open clock-in on a short
    // 12:00-12:35 shift, with a later 16:00-22:00 shift the same day.
    // A score that extends the open session to `now` credits the later
    // shift with its full 360-minute window and steals the session.
    // An open session must earn zero overlap; the clock-in delta
    // (30 min against 210 min) keeps it on the short shift.
    const result = audit(
      [
        shift({ id: 'a', start_time: '2026-08-12T12:00:00Z', end_time: '2026-08-12T12:35:00Z' }),
        shift({ id: 'b', start_time: '2026-08-12T16:00:00Z', end_time: '2026-08-12T22:00:00Z' }),
      ],
      [punch('emp1', 'clock_in', '2026-08-12T12:30:00Z')],
    );
    const byKey = new Map(result.rows.map((row) => [row.key, row]));
    expect(byKey.get('shift-a')?.status).toBe('open_clock');
    expect(byKey.get('shift-b')?.status).toBe('missing_clock');
  });

  it('respects a custom tolerance', () => {
    const result = audit(
      [shift({ id: 's1' })],
      [
        punch('emp1', 'clock_in', '2026-08-12T15:45:00Z'),
        punch('emp1', 'clock_out', '2026-08-12T23:00:00Z'),
      ],
      60,
    );
    expect(result.rows[0].status).toBe('matched');
  });

  it('reports a session without clock_out as open_clock', () => {
    const result = audit(
      [shift({ id: 's1' })],
      [punch('emp1', 'clock_in', '2026-08-12T15:00:00Z')],
    );
    expect(result.rows[0].status).toBe('open_clock');
    expect(result.summary.openClock).toBe(1);
  });

  it('reports a session with no shift as unscheduled_clock', () => {
    const result = audit(
      [],
      [
        punch('emp1', 'clock_in', '2026-08-12T15:00:00Z'),
        punch('emp1', 'clock_out', '2026-08-12T20:00:00Z'),
      ],
    );
    expect(result.rows[0].status).toBe('unscheduled_clock');
    expect(result.rows[0].workedMinutes).toBe(300);
  });

  it('ignores sessions that start outside the range on the unscheduled side', () => {
    const result = audit(
      [],
      [
        punch('emp1', 'clock_in', '2026-08-01T15:00:00Z'),
        punch('emp1', 'clock_out', '2026-08-01T20:00:00Z'),
      ],
    );
    expect(result.rows).toHaveLength(0);
  });

  it('ignores cancelled shifts and shifts that did not start yet', () => {
    const result = audit(
      [
        shift({ id: 's1', status: 'cancelled' }),
        shift({
          id: 's2',
          start_time: '2026-08-16T15:00:00Z',
          end_time: '2026-08-16T23:00:00Z',
        }),
      ],
      [],
    );
    expect(result.rows).toHaveLength(0);
  });

  it('audits an overnight shift that starts before the range but overlaps into it', () => {
    // The shift starts before RANGE_START (2026-08-10T00:00:00Z) but ends
    // inside the range, so it must still produce a row.
    const result = audit(
      [
        shift({
          id: 's1',
          start_time: '2026-08-09T22:00:00Z',
          end_time: '2026-08-10T06:00:00Z',
        }),
      ],
      [],
    );
    expect(result.rows).toHaveLength(1);
    expect(result.rows[0].status).toBe('missing_clock');
  });

  it('ignores a shift that ends before the range starts', () => {
    // The whole shift sits before RANGE_START, so it does not overlap the
    // range and must not count, even though it is not cancelled or draft.
    const result = audit(
      [
        shift({
          id: 's1',
          start_time: '2026-08-08T15:00:00Z',
          end_time: '2026-08-08T23:00:00Z',
        }),
      ],
      [],
    );
    expect(result.rows).toHaveLength(0);
  });

  it('ignores a draft shift (is_published: false) with no punches', () => {
    const result = audit([shift({ id: 's1', is_published: false })], []);
    expect(result.rows).toHaveLength(0);
  });

  it('still audits a legacy shift with is_published: null', () => {
    const result = audit([shift({ id: 's1', is_published: null })], []);
    expect(result.rows).toHaveLength(1);
    expect(result.rows[0].status).toBe('missing_clock');
  });

  it('does not match one session to two shifts', () => {
    const result = audit(
      [
        shift({ id: 's1' }),
        shift({
          id: 's2',
          start_time: '2026-08-12T23:30:00Z',
          end_time: '2026-08-13T03:00:00Z',
        }),
      ],
      [
        punch('emp1', 'clock_in', '2026-08-12T15:00:00Z'),
        punch('emp1', 'clock_out', '2026-08-12T23:00:00Z'),
      ],
    );
    const statuses = result.rows.map((r) => r.status).sort();
    expect(statuses).toEqual(['matched', 'missing_clock']);
  });

  it('matches an overnight shift to punches across midnight', () => {
    const result = audit(
      [
        shift({
          id: 's1',
          start_time: '2026-08-12T22:00:00Z',
          end_time: '2026-08-13T06:00:00Z',
        }),
      ],
      [
        punch('emp1', 'clock_in', '2026-08-12T21:58:00Z'),
        punch('emp1', 'clock_out', '2026-08-13T06:02:00Z'),
      ],
    );
    expect(result.rows[0].status).toBe('matched');
  });

  it('keeps employees separate', () => {
    const result = audit(
      [shift({ id: 's1', employee_id: 'emp2' })],
      [
        punch('emp1', 'clock_in', '2026-08-12T15:00:00Z'),
        punch('emp1', 'clock_out', '2026-08-12T23:00:00Z'),
      ],
    );
    const statuses = result.rows.map((r) => r.status).sort();
    expect(statuses).toEqual(['missing_clock', 'unscheduled_clock']);
  });

  it('does not let a stale open clock-in from an earlier day reach forward and match a later, unrelated shift', () => {
    // The employee clocked in on 2026-08-11 and never clocked out. The shift
    // is the default fixture, 2026-08-12T15:00-23:00Z. The stale clock-in
    // sits more than the 4-hour match pad before the shift start, so it must
    // not match -- an open session's unknown true end must not "reach
    // forward" to now and swallow this later shift.
    const result = audit(
      [shift({ id: 's1' })],
      [punch('emp1', 'clock_in', '2026-08-11T08:00:00Z')],
    );
    const statuses = result.rows.map((r) => r.status).sort();
    expect(statuses).toEqual(['missing_clock', 'unscheduled_clock']);
  });

  it('does not report an in-progress shift (started, not yet ended) with no punches as missing_clock', () => {
    // NOW is 2026-08-15T12:00:00Z. The shift starts before NOW and ends
    // after NOW, so it is still in progress -- the employee may simply not
    // have clocked in yet. This must not surface as a missed clock-in.
    const result = audit(
      [
        shift({
          id: 's1',
          start_time: '2026-08-15T08:00:00Z',
          end_time: '2026-08-15T20:00:00Z',
        }),
      ],
      [],
    );
    expect(result.rows).toHaveLength(0);
  });

  it('rolls up two closed sessions into one row: first-in, last-out, zero unscheduled rows', () => {
    // Oscar case: the employee clocked out for a break and back in. Both
    // punches belong to the same shift.
    const result = audit(
      [
        shift({
          id: 's1',
          start_time: '2026-08-12T17:30:00Z',
          end_time: '2026-08-12T23:00:00Z',
        }),
      ],
      [
        punch('emp1', 'clock_in', '2026-08-12T17:29:00Z'),
        punch('emp1', 'clock_out', '2026-08-12T19:32:00Z'),
        punch('emp1', 'clock_in', '2026-08-12T20:03:00Z'),
        punch('emp1', 'clock_out', '2026-08-12T23:02:00Z'),
      ],
    );
    expect(result.rows).toHaveLength(1);
    expect(result.rows[0].status).toBe('matched');
    expect(result.rows[0].sessions).toHaveLength(2);
    expect(result.rows[0].inDeltaMinutes).toBe(-1);
    expect(result.rows[0].outDeltaMinutes).toBe(2);
    expect(result.summary.unscheduledClock).toBe(0);
  });

  it('computes gapMinutes as the gap between sessions and excludes it, and the break punches, from workedMinutes', () => {
    const result = audit(
      [shift({ id: 's1' })],
      [
        punch('emp1', 'clock_in', '2026-08-12T15:00:00Z'),
        punch('emp1', 'break_start', '2026-08-12T16:00:00Z'),
        punch('emp1', 'break_end', '2026-08-12T16:15:00Z'),
        punch('emp1', 'clock_out', '2026-08-12T18:00:00Z'),
        punch('emp1', 'clock_in', '2026-08-12T18:30:00Z'),
        punch('emp1', 'clock_out', '2026-08-12T23:00:00Z'),
      ],
    );
    expect(result.rows).toHaveLength(1);
    expect(result.rows[0].gapMinutes).toBe(30);
    expect(result.rows[0].workedMinutes).toBe(435);
  });

  it('reports an open last session as in_progress when the shift end is still in the future', () => {
    const result = audit(
      [
        shift({
          id: 's1',
          start_time: '2026-08-15T08:00:00Z',
          end_time: '2026-08-15T20:00:00Z',
        }),
      ],
      [punch('emp1', 'clock_in', '2026-08-15T08:05:00Z')],
    );
    expect(result.rows[0].status).toBe('in_progress');
    expect(result.summary.inProgress).toBe(1);
  });

  it('reports an open last session as open_clock when the shift end is in the past', () => {
    const result = audit(
      [shift({ id: 's1' })],
      [
        punch('emp1', 'clock_in', '2026-08-12T15:00:00Z'),
        punch('emp1', 'clock_out', '2026-08-12T18:00:00Z'),
        punch('emp1', 'clock_in', '2026-08-12T18:30:00Z'),
      ],
    );
    expect(result.rows[0].status).toBe('open_clock');
    expect(result.summary.openClock).toBe(1);
  });

  it('reports closed sessions as in_progress when the shift end is still in the future', () => {
    const result = audit(
      [
        shift({
          id: 's1',
          start_time: '2026-08-15T08:00:00Z',
          end_time: '2026-08-15T20:00:00Z',
        }),
      ],
      [
        punch('emp1', 'clock_in', '2026-08-15T08:00:00Z'),
        punch('emp1', 'clock_out', '2026-08-15T10:00:00Z'),
      ],
    );
    expect(result.rows[0].status).toBe('in_progress');
    expect(result.summary.inProgress).toBe(1);
  });
});

describe('rollupAuditRowsByEmployee', () => {
  const row = (overrides: Partial<AuditRow> & { employeeId: string }): AuditRow => ({
    key: `row-${overrides.employeeId}-${Math.random()}`,
    status: 'matched',
    ...overrides,
  });

  it('counts toFix, open, info, and sums missingMinutes per employee', () => {
    const rows: AuditRow[] = [
      row({ employeeId: 'emp1', status: 'missing_clock', scheduledMinutes: 480 }),
      row({ employeeId: 'emp1', status: 'time_mismatch' }),
      row({ employeeId: 'emp1', status: 'open_clock' }),
      row({ employeeId: 'emp1', status: 'unscheduled_clock' }),
      row({ employeeId: 'emp1', status: 'in_progress' }),
      row({ employeeId: 'emp1', status: 'matched' }),
      row({ employeeId: 'emp2', status: 'missing_clock', scheduledMinutes: 300 }),
    ];
    const rollup = rollupAuditRowsByEmployee(rows);

    const emp1 = rollup.get('emp1');
    expect(emp1?.toFix).toBe(2);
    expect(emp1?.open).toBe(1);
    expect(emp1?.info).toBe(2);
    expect(emp1?.missingMinutes).toBe(480);
    expect(emp1?.rows).toHaveLength(6);

    const emp2 = rollup.get('emp2');
    expect(emp2?.toFix).toBe(1);
    expect(emp2?.missingMinutes).toBe(300);
  });
});

describe('formatters', () => {
  it('formats deltas', () => {
    expect(formatDeltaMinutes(0)).toBe('on time');
    expect(formatDeltaMinutes(12)).toBe('+12 min');
    expect(formatDeltaMinutes(-5)).toBe('−5 min');
    expect(formatDeltaMinutes(75)).toBe('+1h 15m');
    expect(formatDeltaMinutes(-120)).toBe('−2h');
    expect(formatDeltaMinutes(undefined)).toBe('—');
  });

  it('formats minutes as hours', () => {
    expect(formatMinutesAsHours(450)).toBe('7.5 h');
    expect(formatMinutesAsHours(480)).toBe('8 h');
    expect(formatMinutesAsHours(undefined)).toBe('—');
  });
});
