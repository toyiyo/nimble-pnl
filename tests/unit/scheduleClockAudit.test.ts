import { describe, it, expect } from 'vitest';
import {
  auditScheduleAgainstClocks,
  buildWorkSessions,
  formatDeltaMinutes,
  formatMinutesAsHours,
  type AuditPunch,
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
