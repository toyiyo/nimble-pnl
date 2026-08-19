/**
 * Behavioral tests for src/components/payroll/EmployeeAuditDetail.tsx
 *
 * Pins the expandable per-employee detail row:
 *   - one line per audit row with the scheduled and clocked times,
 *   - the status label, and in/out deltas for a time mismatch,
 *   - an action button for missing_clock and open_clock only.
 */
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { formatInTimeZone } from 'date-fns-tz';

import { EmployeeAuditDetail } from '@/components/payroll/EmployeeAuditDetail';
import type { AuditRow } from '@/utils/scheduleClockAudit';

vi.mock('@/hooks/useRestaurantClock', () => ({
  useRestaurantClock: () => ({
    tz: 'UTC',
    tzAbbrev: 'UTC',
    viewerTzDiffers: false,
    today: '2026-08-15',
    formatInstant: (value: string | Date, pattern: string) =>
      formatInTimeZone(value, 'UTC', pattern),
    toBusinessDay: (value: string | Date) => formatInTimeZone(value, 'UTC', 'yyyy-MM-dd'),
    toWallClockInput: (value: string | Date) =>
      formatInTimeZone(value, 'UTC', "yyyy-MM-dd'T'HH:mm"),
    parseWallClock: (wallClock: string) => new Date(`${wallClock}:00Z`).toISOString(),
  }),
}));

const baseShift = {
  id: 's1',
  employee_id: 'emp1',
  start_time: '2026-08-12T21:30:00Z',
  end_time: '2026-08-13T03:00:00Z',
  break_duration: 0,
  position: 'Server',
  status: 'scheduled',
  is_published: true,
};

const missingRow: AuditRow = {
  key: 'shift-s1',
  status: 'missing_clock',
  employeeId: 'emp1',
  shift: baseShift,
  scheduledMinutes: 330,
};

const openClockRow: AuditRow = {
  key: 'shift-s2',
  status: 'open_clock',
  employeeId: 'emp1',
  shift: { ...baseShift, id: 's2' },
  scheduledMinutes: 330,
  sessions: [{ employeeId: 'emp1', clockIn: '2026-08-12T21:29:00Z', clockOut: null, breakMinutes: 0, punchIds: ['p1'] }],
};

const mismatchRow: AuditRow = {
  key: 'shift-s3',
  status: 'time_mismatch',
  employeeId: 'emp1',
  shift: { ...baseShift, id: 's3' },
  scheduledMinutes: 330,
  workedMinutes: 300,
  inDeltaMinutes: -1,
  outDeltaMinutes: -208,
  sessions: [
    {
      employeeId: 'emp1',
      clockIn: '2026-08-12T21:29:00Z',
      clockOut: '2026-08-12T23:32:00Z',
      breakMinutes: 0,
      punchIds: ['p2', 'p3'],
    },
  ],
};

const inProgressRow: AuditRow = {
  key: 'shift-s4',
  status: 'in_progress',
  employeeId: 'emp1',
  shift: { ...baseShift, id: 's4' },
  scheduledMinutes: 330,
  sessions: [{ employeeId: 'emp1', clockIn: '2026-08-12T21:29:00Z', clockOut: null, breakMinutes: 0, punchIds: ['p4'] }],
};

const unscheduledRow: AuditRow = {
  key: 'session-p5',
  status: 'unscheduled_clock',
  employeeId: 'emp1',
  sessions: [{ employeeId: 'emp1', clockIn: '2026-08-14T21:29:00Z', clockOut: '2026-08-14T23:29:00Z', breakMinutes: 0, punchIds: ['p5'] }],
};

const matchedRow: AuditRow = {
  key: 'shift-s6',
  status: 'matched',
  employeeId: 'emp1',
  shift: { ...baseShift, id: 's6' },
  scheduledMinutes: 330,
  workedMinutes: 328,
  inDeltaMinutes: 1,
  outDeltaMinutes: -1,
  sessions: [{ employeeId: 'emp1', clockIn: '2026-08-12T21:29:00Z', clockOut: '2026-08-13T02:59:00Z', breakMinutes: 0, punchIds: ['p6'] }],
};

describe('EmployeeAuditDetail', () => {
  it('shows the scheduled time and the missing_clock status line', () => {
    render(
      <EmployeeAuditDetail rows={[missingRow]} employeeName="Maria Lopez" onEnterClock={vi.fn()} />,
    );
    expect(screen.getByText(/Scheduled/)).toBeInTheDocument();
    expect(screen.getByText(/5:30.*PM.*3:00.*AM/)).toBeInTheDocument();
    expect(screen.getByText('No clock data')).toBeInTheDocument();
  });

  it('shows the open clock-out line with a partial clock reading', () => {
    render(
      <EmployeeAuditDetail rows={[openClockRow]} employeeName="Maria Lopez" onEnterClock={vi.fn()} />,
    );
    expect(screen.getByText(/9:29.*PM.*open/)).toBeInTheDocument();
    expect(screen.getByText('No clock-out')).toBeInTheDocument();
  });

  it('shows the in/out deltas for a time mismatch', () => {
    render(
      <EmployeeAuditDetail rows={[mismatchRow]} employeeName="Maria Lopez" onEnterClock={vi.fn()} />,
    );
    expect(screen.getByText('Time difference')).toBeInTheDocument();
    expect(screen.getByText(/in −1 min/)).toBeInTheDocument();
    expect(screen.getByText(/out −3h 28m/)).toBeInTheDocument();
  });

  it('shows the gap line when the row carries a gap', () => {
    const gapRow: AuditRow = { ...mismatchRow, gapMinutes: 31 };
    render(<EmployeeAuditDetail rows={[gapRow]} employeeName="Maria Lopez" onEnterClock={vi.fn()} />);
    expect(screen.getByText(/gap 31 min/)).toBeInTheDocument();
  });

  it('renders an Enter clock data button for missing_clock and calls back with the row', () => {
    const onEnterClock = vi.fn();
    render(
      <EmployeeAuditDetail rows={[missingRow]} employeeName="Maria Lopez" onEnterClock={onEnterClock} />,
    );
    const button = screen.getByRole('button', { name: /Enter clock data for Maria Lopez/ });
    fireEvent.click(button);
    expect(onEnterClock).toHaveBeenCalledWith(missingRow);
  });

  it('renders an Enter clock-out button for open_clock', () => {
    render(
      <EmployeeAuditDetail rows={[openClockRow]} employeeName="Maria Lopez" onEnterClock={vi.fn()} />,
    );
    expect(screen.getByRole('button', { name: /Enter clock-out for Maria Lopez/ })).toBeInTheDocument();
  });

  it.each([
    ['in_progress', inProgressRow],
    ['unscheduled_clock', unscheduledRow],
    ['matched', matchedRow],
  ])('renders no action button for %s', (_status, row) => {
    render(<EmployeeAuditDetail rows={[row]} employeeName="Maria Lopez" onEnterClock={vi.fn()} />);
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
  });
});
