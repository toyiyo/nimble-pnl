import { describe, it, expect } from 'vitest';
import { buildRosterDay, buildRoster, calculateShiftHours } from '@/lib/scheduleRoster';
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

const DAY = new Date(2026, 5, 25);       // Thu Jun 25 2026 (local)
const OTHER_DAY = new Date(2026, 5, 26); // Fri Jun 26 2026

const alice = makeEmployee({ name: 'Alice', position: 'Server', area: 'Front Store' });
const bob = makeEmployee({ name: 'Bob', position: 'Cook', area: 'Back Store' });
const carol = makeEmployee({ name: 'Carol', position: 'Server', area: 'Front Store' });
const dave = makeEmployee({ name: 'Dave', position: 'Prep' }); // no area
const employees = [alice, bob, carol, dave];

// Thursday: Alice opens 6A, Bob 7A, Dave 8A, Carol closes 4P
const thuShifts = [
  makeShift(carol, '2026-06-25T16:00:00', '2026-06-25T21:00:00'), // 4P-9P (5h)
  makeShift(alice, '2026-06-25T06:00:00', '2026-06-25T14:00:00'), // 6A-2P (8h)
  makeShift(dave, '2026-06-25T08:00:00', '2026-06-25T16:00:00'),  // 8A-4P (8h)
  makeShift(bob, '2026-06-25T07:00:00', '2026-06-25T15:00:00'),   // 7A-3P (8h)
];

describe('buildRosterDay', () => {
  it('sorts by start time within a single ungrouped list (morning before afternoon)', () => {
    const result = buildRosterDay(thuShifts, employees, DAY, 'startTime', 'none');
    expect(result.sections).toHaveLength(1);
    expect(result.sections[0].label).toBe('');
    expect(result.sections[0].rows.map(r => r.employee.name)).toEqual(['Alice', 'Bob', 'Dave', 'Carol']);
  });

  it('groups by area with Unassigned last, each section sorted by start time', () => {
    const result = buildRosterDay(thuShifts, employees, DAY, 'startTime', 'area');
    expect(result.sections.map(s => s.label)).toEqual(['Back Store', 'Front Store', 'Unassigned']);
    expect(result.sections[0].rows.map(r => r.employee.name)).toEqual(['Bob']);
    expect(result.sections[1].rows.map(r => r.employee.name)).toEqual(['Alice', 'Carol']);
    expect(result.sections[2].rows.map(r => r.employee.name)).toEqual(['Dave']);
  });

  it('groups by position', () => {
    const result = buildRosterDay(thuShifts, employees, DAY, 'startTime', 'position');
    expect(result.sections.map(s => s.label)).toEqual(['Cook', 'Prep', 'Server']);
    expect(result.sections[2].rows.map(r => r.employee.name)).toEqual(['Alice', 'Carol']);
  });

  it('sorts by name (A-Z) when sortBy is name', () => {
    const result = buildRosterDay(thuShifts, employees, DAY, 'name', 'none');
    expect(result.sections[0].rows.map(r => r.employee.name)).toEqual(['Alice', 'Bob', 'Carol', 'Dave']);
  });

  it('sorts by hours (most first) when sortBy is hours', () => {
    const shortEarly = makeShift(alice, '2026-06-25T06:00:00', '2026-06-25T08:00:00'); // 6A, 2h
    const longLate = makeShift(bob, '2026-06-25T10:00:00', '2026-06-25T18:00:00');     // 10A, 8h
    const result = buildRosterDay([shortEarly, longLate], [alice, bob], DAY, 'hours', 'none');
    // Bob (8h) before Alice (2h), even though Alice starts earlier
    expect(result.sections[0].rows.map(r => r.employee.name)).toEqual(['Bob', 'Alice']);
  });

  it('breaks start-time ties by name', () => {
    const zoe = makeEmployee({ name: 'Zoe', position: 'Server', area: 'Front Store' });
    const amy = makeEmployee({ name: 'Amy', position: 'Server', area: 'Front Store' });
    const shifts = [
      makeShift(zoe, '2026-06-25T09:00:00', '2026-06-25T17:00:00'),
      makeShift(amy, '2026-06-25T09:00:00', '2026-06-25T17:00:00'),
    ];
    const result = buildRosterDay(shifts, [zoe, amy], DAY, 'startTime', 'none');
    expect(result.sections[0].rows.map(r => r.employee.name)).toEqual(['Amy', 'Zoe']);
  });

  it('renders a split shift as two rows but counts the employee once in totalStaff', () => {
    const split = [
      makeShift(alice, '2026-06-25T06:00:00', '2026-06-25T10:00:00'), // 6A-10A (4h)
      makeShift(alice, '2026-06-25T17:00:00', '2026-06-25T21:00:00'), // 5P-9P (4h)
    ];
    const result = buildRosterDay(split, [alice], DAY, 'startTime', 'none');
    expect(result.sections[0].rows).toHaveLength(2);
    expect(result.totalStaff).toBe(1);
    expect(result.totalHours).toBe(8);
  });

  it('excludes shifts on other days', () => {
    const result = buildRosterDay(thuShifts, employees, OTHER_DAY, 'startTime', 'none');
    expect(result.sections).toEqual([]);
    expect(result.totalStaff).toBe(0);
    expect(result.totalHours).toBe(0);
  });

  it('sums net hours excluding break in totalHours', () => {
    const shifts = [makeShift(alice, '2026-06-25T08:00:00', '2026-06-25T16:00:00', 30)]; // 7.5h
    const result = buildRosterDay(shifts, [alice], DAY, 'startTime', 'none');
    expect(result.totalHours).toBe(7.5);
  });

  it('skips shifts whose employee is not in the employees list', () => {
    const ghost = makeShift(
      makeEmployee({ name: 'Ghost', position: 'Server' }),
      '2026-06-25T09:00:00', '2026-06-25T17:00:00',
    );
    const result = buildRosterDay([ghost], employees, DAY, 'startTime', 'none');
    expect(result.sections).toEqual([]);
    expect(result.totalStaff).toBe(0);
  });
});

describe('buildRoster', () => {
  it('builds one RosterDay per day, preserving order', () => {
    const result = buildRoster(thuShifts, employees, [DAY, OTHER_DAY], 'startTime', 'none');
    expect(result).toHaveLength(2);
    expect(result[0].day).toBe(DAY);
    expect(result[0].totalStaff).toBe(4);
    expect(result[1].day).toBe(OTHER_DAY);
    expect(result[1].totalStaff).toBe(0);
  });
});

describe('calculateShiftHours (re-homed)', () => {
  it('subtracts break duration', () => {
    const shift = {
      start_time: '2026-06-25T08:00:00',
      end_time: '2026-06-25T16:00:00',
      break_duration: 30,
    } as Shift;
    expect(calculateShiftHours(shift)).toBe(7.5);
  });
});
