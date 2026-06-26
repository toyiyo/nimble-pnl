import { describe, it, expect, vi, beforeEach } from 'vitest';

const { mockText, mockSave, mockAutoTable } = vi.hoisted(() => ({
  mockText: vi.fn(),
  mockSave: vi.fn(),
  mockAutoTable: vi.fn(),
}));

vi.mock('jspdf', () => ({
  default: class {
    internal = { pageSize: { getWidth: () => 612, getHeight: () => 792 } };
    setFontSize = vi.fn();
    setFont = vi.fn();
    setTextColor = vi.fn();
    text = mockText;
    save = mockSave;
    lastAutoTable = { finalY: 200 };
  },
}));
vi.mock('jspdf-autotable', () => ({ default: mockAutoTable }));

import { generateRosterPDF } from '@/utils/scheduleExport';
import type { Employee, Shift } from '@/types/scheduling';

function makeEmployee(overrides: Partial<Employee> & { name: string; position: string }): Employee {
  return {
    id: overrides.name.toLowerCase(),
    restaurant_id: 'rest-1',
    status: 'active',
    created_at: '',
    updated_at: '',
    is_active: true,
    compensation_type: 'hourly',
    hourly_rate: 1500,
    ...overrides,
  } as Employee;
}

function makeShift(employee: Employee, start: string, end: string, breakMin = 0): Shift {
  return {
    id: `${employee.id}-${start}`,
    restaurant_id: 'rest-1',
    employee_id: employee.id,
    start_time: start,
    end_time: end,
    break_duration: breakMin,
    position: employee.position,
    status: 'scheduled',
    is_published: true,
    locked: false,
    source: 'manual',
    created_at: '',
    updated_at: '',
    employee,
  } as Shift;
}

const DAY = new Date(2026, 5, 25);

const alice = makeEmployee({ name: 'Alice', position: 'Server', area: 'Front Store' });
const bob = makeEmployee({ name: 'Bob', position: 'Cook', area: 'Back Store' });
const carol = makeEmployee({ name: 'Carol', position: 'Server', area: 'Front Store' });
const dave = makeEmployee({ name: 'Dave', position: 'Prep' });
const employees = [alice, bob, carol, dave];

const thuShifts = [
  makeShift(carol, '2026-06-25T16:00:00', '2026-06-25T21:00:00'),
  makeShift(alice, '2026-06-25T06:00:00', '2026-06-25T14:00:00'),
  makeShift(dave, '2026-06-25T08:00:00', '2026-06-25T16:00:00'),
  makeShift(bob, '2026-06-25T07:00:00', '2026-06-25T15:00:00'),
];

const base = { shifts: thuShifts, employees, weekStart: DAY, weekEnd: DAY, restaurantName: 'Test' };

beforeEach(() => {
  mockAutoTable.mockClear();
  mockText.mockClear();
  mockSave.mockClear();
});

describe('generateRosterPDF', () => {
  it('renders one table for a single day with rows sorted by start time', () => {
    generateRosterPDF({ ...base, days: [DAY], sortBy: 'startTime', groupBy: 'none' });
    expect(mockAutoTable).toHaveBeenCalledTimes(1);
    const body = mockAutoTable.mock.calls[0][1].body;
    expect(body.map((r: any[]) => r[1])).toEqual(['Alice', 'Bob', 'Dave', 'Carol']);
  });

  it('inserts area section header rows when groupBy is area', () => {
    generateRosterPDF({ ...base, days: [DAY], sortBy: 'startTime', groupBy: 'area' });
    const body = mockAutoTable.mock.calls[0][1].body;
    const headerLabels = body
      .filter((r: any[]) => r.length === 1 && r[0].colSpan)
      .map((r: any[]) => r[0].content as string);
    expect(headerLabels.some(l => l.startsWith('Back Store'))).toBe(true);
    expect(headerLabels.some(l => l.startsWith('Front Store'))).toBe(true);
    expect(headerLabels.some(l => l.startsWith('Unassigned'))).toBe(true);
  });

  it('renders one table per day across a multi-day range', () => {
    const days = [DAY, new Date(2026, 5, 26), new Date(2026, 5, 27)];
    generateRosterPDF({ ...base, weekStart: days[0], weekEnd: days[2], days, sortBy: 'startTime', groupBy: 'none' });
    expect(mockAutoTable).toHaveBeenCalledTimes(3);
  });

  it('shows "No one scheduled" for an empty day', () => {
    generateRosterPDF({ ...base, shifts: [], days: [DAY], sortBy: 'startTime', groupBy: 'none' });
    const body = mockAutoTable.mock.calls[0][1].body;
    expect(body).toHaveLength(1);
    expect(body[0][0].content).toBe('No one scheduled');
  });

  it('emits a "Filtered: <area>" subtitle and narrows rows when areaFilter is active', () => {
    generateRosterPDF({ ...base, days: [DAY], sortBy: 'startTime', groupBy: 'none', areaFilter: 'Front Store' });
    const filtered = mockText.mock.calls.find(
      (c: any[]) => typeof c[0] === 'string' && c[0].startsWith('Filtered:'),
    );
    expect(filtered).toBeDefined();
    expect(filtered![0]).toContain('Front Store');
    const body = mockAutoTable.mock.calls[0][1].body;
    expect(body.map((r: any[]) => r[1])).toEqual(['Alice', 'Carol']);
  });

  it('includes an Hours column value when includeHoursSummary is set', () => {
    generateRosterPDF({
      ...base,
      days: [DAY],
      sortBy: 'startTime',
      groupBy: 'none',
      includePositions: false,
      includeHoursSummary: true,
    });
    const body = mockAutoTable.mock.calls[0][1].body;
    const aliceRow = body.find((r: any[]) => r[1] === 'Alice');
    expect(aliceRow[2]).toBe('8.0'); // columns: [time, name, hours]
  });
});
