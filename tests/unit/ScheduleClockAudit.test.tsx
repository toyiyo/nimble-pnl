/**
 * Behavioral tests for src/components/payroll/ScheduleClockAudit.tsx
 *
 * Pins the payroll schedule-vs-clock check:
 *   - A shift without punches shows as "No clock data" with an
 *     "Enter clock data" action.
 *   - The action opens RecordShiftClockDialog pre-filled with the
 *     scheduled times.
 *   - Save creates a clock_in/clock_out pair tagged with the shift id.
 *   - An empty issues list shows the all-clear message.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import React from 'react';
import { formatInTimeZone } from 'date-fns-tz';

import { ScheduleClockAudit } from '@/components/payroll/ScheduleClockAudit';
import type { AuditRow, AuditSummary } from '@/utils/scheduleClockAudit';
import type { Employee } from '@/types/scheduling';

const { useScheduleClockAuditMock, useEmployeesMock, bulkMutateMock } = vi.hoisted(() => ({
  useScheduleClockAuditMock: vi.fn(),
  useEmployeesMock: vi.fn(),
  bulkMutateMock: vi.fn(),
}));

vi.mock('@/hooks/useScheduleClockAudit', () => ({
  useScheduleClockAudit: (...args: unknown[]) => useScheduleClockAuditMock(...args),
}));

vi.mock('@/hooks/useEmployees', () => ({
  useEmployees: (...args: unknown[]) => useEmployeesMock(...args),
}));

vi.mock('@/hooks/useTimePunches', () => ({
  useBulkCreateTimePunches: () => ({ mutate: bulkMutateMock, isPending: false }),
}));

vi.mock('@/hooks/use-toast', () => ({
  useToast: () => ({ toast: vi.fn() }),
}));

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

const employees = [
  { id: 'emp1', name: 'Maria Lopez', position: 'Server' } as Employee,
];

const missingRow: AuditRow = {
  key: 'shift-s1',
  status: 'missing_clock',
  employeeId: 'emp1',
  shift: {
    id: 's1',
    employee_id: 'emp1',
    start_time: '2026-08-12T15:00:00Z',
    end_time: '2026-08-12T23:00:00Z',
    break_duration: 0,
    position: 'Server',
    status: 'scheduled',
    is_published: true,
  },
  scheduledMinutes: 480,
};

const emptySummary: AuditSummary = {
  missingClock: 0,
  openClock: 0,
  timeMismatch: 0,
  unscheduledClock: 0,
  matched: 0,
};

const renderPanel = () => {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(
    <QueryClientProvider client={queryClient}>
      <ScheduleClockAudit
        restaurantId="r1"
        start={new Date('2026-08-10T00:00:00Z')}
        end={new Date('2026-08-16T23:59:59Z')}
      />
    </QueryClientProvider>,
  );
};

// jsdom never runs layout, so every element's offsetHeight is 0.
// @tanstack/react-virtual measures its scroll container via `element.offsetHeight`
// and only computes a visible range when that size is > 0 — without this stub,
// `getVirtualItems()` always returns `[]` and no rows render at all. Same
// pattern already used in tests/unit/VirtualizedProductGrid.test.tsx.
let offsetHeightSpy: ReturnType<typeof vi.spyOn>;

describe('ScheduleClockAudit', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useEmployeesMock.mockReturnValue({ employees, loading: false, error: null });
    offsetHeightSpy = vi
      .spyOn(HTMLElement.prototype, 'offsetHeight', 'get')
      .mockReturnValue(600);
  });

  afterEach(() => {
    offsetHeightSpy.mockRestore();
  });

  it('shows a missed shift with the employee name and an action', () => {
    useScheduleClockAuditMock.mockReturnValue({
      rows: [missingRow],
      summary: { ...emptySummary, missingClock: 1 },
      loading: false,
      error: null,
    });
    renderPanel();

    expect(screen.getByText('Maria Lopez')).toBeInTheDocument();
    expect(screen.getByText('No clock data')).toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: 'Enter clock data for Maria Lopez' }),
    ).toBeInTheDocument();
  });

  it('opens the dialog pre-filled with the scheduled times and saves punches', () => {
    useScheduleClockAuditMock.mockReturnValue({
      rows: [missingRow],
      summary: { ...emptySummary, missingClock: 1 },
      loading: false,
      error: null,
    });
    renderPanel();

    fireEvent.click(screen.getByRole('button', { name: 'Enter clock data for Maria Lopez' }));

    const clockIn = screen.getByLabelText(/Clock in/) as HTMLInputElement;
    const clockOut = screen.getByLabelText(/Clock out/) as HTMLInputElement;
    expect(clockIn.value).toBe('2026-08-12T15:00');
    expect(clockOut.value).toBe('2026-08-12T23:00');

    fireEvent.click(screen.getByRole('button', { name: 'Save clock data' }));

    expect(bulkMutateMock).toHaveBeenCalledTimes(1);
    const [variables] = bulkMutateMock.mock.calls[0];
    expect(variables.restaurantId).toBe('r1');
    expect(variables.punches).toHaveLength(2);
    expect(variables.punches[0]).toMatchObject({
      punch_type: 'clock_in',
      punch_time: '2026-08-12T15:00:00.000Z',
      shift_id: 's1',
      employee_id: 'emp1',
    });
    expect(variables.punches[1]).toMatchObject({
      punch_type: 'clock_out',
      punch_time: '2026-08-12T23:00:00.000Z',
      shift_id: 's1',
    });
  });

  it('shows the all-clear message when there are no issues', () => {
    useScheduleClockAuditMock.mockReturnValue({
      rows: [],
      summary: emptySummary,
      loading: false,
      error: null,
    });
    renderPanel();

    expect(
      screen.getByText('Every scheduled shift has matching clock data.'),
    ).toBeInTheDocument();
  });

  it('shows matched rows under the Matched tab', () => {
    const matchedRow: AuditRow = {
      ...missingRow,
      key: 'shift-s2',
      status: 'matched',
      session: {
        employeeId: 'emp1',
        clockIn: '2026-08-12T14:58:00Z',
        clockOut: '2026-08-12T23:02:00Z',
        breakMinutes: 0,
        punchIds: ['p1', 'p2'],
      },
      workedMinutes: 484,
      inDeltaMinutes: -2,
      outDeltaMinutes: 2,
    };
    useScheduleClockAuditMock.mockReturnValue({
      rows: [matchedRow],
      summary: { ...emptySummary, matched: 1 },
      loading: false,
      error: null,
    });
    renderPanel();

    // The issues tab hides matched rows.
    expect(screen.queryByText('Maria Lopez')).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /Matched/ }));
    expect(screen.getByText('Maria Lopez')).toBeInTheDocument();
    // Worked 484 minutes shows as hours on the row.
    expect(screen.getByText(/8\.07 h/)).toBeInTheDocument();
  });

  it('blocks saving a clock-out that lands before the real clock-in on an open_clock row', () => {
    // The employee clocked in late, after the scheduled shift end, and never
    // clocked out. The dialog's clock-out input defaults to the scheduled
    // end time, which is now before the real clock-in already on record.
    const openRow: AuditRow = {
      ...missingRow,
      key: 'shift-s3',
      status: 'open_clock',
      session: {
        employeeId: 'emp1',
        clockIn: '2026-08-12T23:30:00Z',
        clockOut: null,
        breakMinutes: 0,
        punchIds: ['p1'],
      },
      inDeltaMinutes: 510,
    };
    useScheduleClockAuditMock.mockReturnValue({
      rows: [openRow],
      summary: { ...emptySummary, openClock: 1 },
      loading: false,
      error: null,
    });
    renderPanel();

    fireEvent.click(screen.getByRole('button', { name: 'Enter clock data for Maria Lopez' }));

    expect(
      screen.getByText('The clock-out time must be after the actual clock-in time.'),
    ).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Save clock data' })).toBeDisabled();

    fireEvent.click(screen.getByRole('button', { name: 'Save clock data' }));
    expect(bulkMutateMock).not.toHaveBeenCalled();
  });

  it('virtualizes a long row list and renders only a subset of the DOM', () => {
    const manyEmployees: Employee[] = Array.from({ length: 150 }, (_, i) => ({
      id: `emp${i}`,
      name: `Employee ${i}`,
      position: 'Server',
    } as Employee));
    useEmployeesMock.mockReturnValue({ employees: manyEmployees, loading: false, error: null });

    const manyRows: AuditRow[] = Array.from({ length: 150 }, (_, i) => ({
      ...missingRow,
      key: `shift-s${i}`,
      employeeId: `emp${i}`,
      shift: {
        ...missingRow.shift!,
        id: `s${i}`,
        employee_id: `emp${i}`,
      },
    }));
    useScheduleClockAuditMock.mockReturnValue({
      rows: manyRows,
      summary: { ...emptySummary, missingClock: 150 },
      loading: false,
      error: null,
    });
    renderPanel();

    const renderedNames = screen.getAllByText(/^Employee \d+$/);
    expect(renderedNames.length).toBeGreaterThan(0);
    expect(renderedNames.length).toBeLessThan(150);
  });
});
