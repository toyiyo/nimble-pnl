import { describe, it, expect } from 'vitest';
import {
  computeScheduleWarnings,
  type ScheduleWarning,
  type Employee,
} from '@/lib/scheduleWarnings';
import type { ShiftTemplate, EmployeeAvailability } from '@/types/scheduling';

// --- Factory helpers ---

let idCounter = 0;
function uid(): string {
  return `id-${++idCounter}`;
}

function makeEmployee(overrides: Partial<Employee> = {}): Employee {
  const id = overrides.id ?? uid();
  return {
    id,
    name: overrides.name ?? `Employee ${id}`,
    position: overrides.position ?? 'Server',
  };
}

function makeTemplate(overrides: Partial<ShiftTemplate> = {}): ShiftTemplate {
  return {
    id: overrides.id ?? uid(),
    restaurant_id: overrides.restaurant_id ?? 'rest-1',
    name: overrides.name ?? 'Morning Shift',
    days: overrides.days ?? [0, 1, 2, 3, 4, 5, 6],
    start_time: overrides.start_time ?? '08:00:00',
    end_time: overrides.end_time ?? '16:00:00',
    break_duration: overrides.break_duration ?? 30,
    position: overrides.position ?? 'Server',
    capacity: overrides.capacity ?? 2,
    area: overrides.area ?? null,
    is_active: overrides.is_active ?? true,
    created_at: '2026-01-01T00:00:00Z',
    updated_at: '2026-01-01T00:00:00Z',
  };
}

function makeAvailability(
  employeeId: string,
  dayOfWeek: number,
  overrides: Partial<EmployeeAvailability> = {},
): EmployeeAvailability {
  return {
    id: overrides.id ?? uid(),
    restaurant_id: overrides.restaurant_id ?? 'rest-1',
    employee_id: employeeId,
    day_of_week: dayOfWeek,
    start_time: overrides.start_time ?? '06:00:00',
    end_time: overrides.end_time ?? '22:00:00',
    is_available: overrides.is_available ?? true,
    created_at: '2026-01-01T00:00:00Z',
    updated_at: '2026-01-01T00:00:00Z',
  };
}

/** Create availability for every day of the week */
function makeFullAvailability(employeeId: string): EmployeeAvailability[] {
  return [0, 1, 2, 3, 4, 5, 6].map((day) => makeAvailability(employeeId, day));
}

// --- Tests ---

describe('computeScheduleWarnings', () => {
  it('returns no warnings when employees have full availability and matching templates', () => {
    const emp = makeEmployee();
    const templates = [makeTemplate({ position: 'Server' })];
    const availability = makeFullAvailability(emp.id);

    const warnings = computeScheduleWarnings([emp], templates, availability);

    expect(warnings).toEqual([]);
  });

  it('warns when employee has no availability records (no_availability)', () => {
    const emp = makeEmployee();
    const templates = [makeTemplate({ position: 'Server' })];

    const warnings = computeScheduleWarnings([emp], templates, []);

    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toMatchObject({
      type: 'no_availability',
      employeeId: emp.id,
      employeeName: emp.name,
      detail: 'No availability set — AI will assume available all week',
    });
  });

  it('warns when employee has only is_available=false records (no_availability)', () => {
    const emp = makeEmployee();
    const templates = [makeTemplate({ position: 'Server' })];
    const availability = [
      makeAvailability(emp.id, 0, { is_available: false }),
      makeAvailability(emp.id, 1, { is_available: false }),
    ];

    const warnings = computeScheduleWarnings([emp], templates, availability);

    expect(warnings).toHaveLength(1);
    expect(warnings[0].type).toBe('no_availability');
  });

  it('warns when employee has limited availability -- fewer than 3 days (limited_availability)', () => {
    const emp = makeEmployee();
    const templates = [makeTemplate({ position: 'Server' })];
    const availability = [
      makeAvailability(emp.id, 1), // Monday
      makeAvailability(emp.id, 3), // Wednesday
    ];

    const warnings = computeScheduleWarnings([emp], templates, availability);

    const limited = warnings.find((w) => w.type === 'limited_availability');
    expect(limited).toBeDefined();
    expect(limited!.detail).toBe('Only available 2 day(s) this week');
  });

  it('does NOT warn about limited availability when employee has 3+ days', () => {
    const emp = makeEmployee();
    const templates = [makeTemplate({ position: 'Server' })];
    const availability = [
      makeAvailability(emp.id, 1),
      makeAvailability(emp.id, 2),
      makeAvailability(emp.id, 3),
    ];

    const warnings = computeScheduleWarnings([emp], templates, availability);

    expect(warnings.find((w) => w.type === 'limited_availability')).toBeUndefined();
  });

  it('warns when employee position has no matching templates (position_mismatch)', () => {
    const emp = makeEmployee({ position: 'Bartender' });
    const templates = [makeTemplate({ position: 'Server' })];
    const availability = makeFullAvailability(emp.id);

    const warnings = computeScheduleWarnings([emp], templates, availability);

    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toMatchObject({
      type: 'position_mismatch',
      employeeId: emp.id,
      detail: 'No Bartender shift templates exist',
    });
  });

  it('warns when available times do not overlap any template (no_time_overlap)', () => {
    const emp = makeEmployee();
    // Template is 08:00-16:00 on all days
    const templates = [makeTemplate({ position: 'Server' })];
    // Employee available 18:00-22:00 (after shift ends)
    const availability = makeFullAvailability(emp.id).map((a) => ({
      ...a,
      start_time: '18:00:00',
      end_time: '22:00:00',
    }));

    const warnings = computeScheduleWarnings([emp], templates, availability);

    const overlap = warnings.find((w) => w.type === 'no_time_overlap');
    expect(overlap).toBeDefined();
    expect(overlap!.detail).toBe("Available times don't overlap with any shift templates");
  });

  it('does NOT warn about time overlap when at least one day overlaps', () => {
    const emp = makeEmployee();
    const templates = [makeTemplate({ position: 'Server', days: [1] })]; // Monday only
    // Available on Monday 06:00-22:00 (overlaps 08:00-16:00 template)
    const availability = [makeAvailability(emp.id, 1)];

    const warnings = computeScheduleWarnings([emp], templates, availability);

    expect(warnings.find((w) => w.type === 'no_time_overlap')).toBeUndefined();
  });

  it('handles overnight shifts correctly for time overlap', () => {
    const emp = makeEmployee();
    // Overnight template 22:00-06:00 on Monday
    const templates = [
      makeTemplate({ position: 'Server', start_time: '22:00:00', end_time: '06:00:00', days: [1] }),
    ];
    // Employee available 20:00-23:59 on Monday (overlaps with 22:00-06:00)
    const availability = [
      makeAvailability(emp.id, 1, { start_time: '20:00:00', end_time: '23:59:00' }),
    ];

    const warnings = computeScheduleWarnings([emp], templates, availability);

    expect(warnings.find((w) => w.type === 'no_time_overlap')).toBeUndefined();
  });

  it('skips position_mismatch and time_overlap checks for employees with no_availability', () => {
    const emp = makeEmployee({ position: 'Bartender' }); // No matching templates either
    const templates = [makeTemplate({ position: 'Server' })];

    const warnings = computeScheduleWarnings([emp], templates, []);

    // Should only have no_availability, not position_mismatch or no_time_overlap
    expect(warnings).toHaveLength(1);
    expect(warnings[0].type).toBe('no_availability');
  });

  it('handles multiple employees with different issues simultaneously', () => {
    const emp1 = makeEmployee({ id: 'e1', name: 'Alice', position: 'Server' });
    const emp2 = makeEmployee({ id: 'e2', name: 'Bob', position: 'Bartender' });
    const emp3 = makeEmployee({ id: 'e3', name: 'Carol', position: 'Server' });

    const templates = [makeTemplate({ position: 'Server' })];

    const availability = [
      // Alice: no availability at all
      // Bob: full availability but wrong position
      ...makeFullAvailability('e2'),
      // Carol: available but times don't overlap (only late night)
      ...makeFullAvailability('e3').map((a) => ({
        ...a,
        start_time: '23:00:00',
        end_time: '23:59:00',
      })),
    ];

    const warnings = computeScheduleWarnings([emp1, emp2, emp3], templates, availability);

    // Alice: no_availability (skip others)
    expect(warnings.filter((w) => w.employeeId === 'e1')).toHaveLength(1);
    expect(warnings.find((w) => w.employeeId === 'e1')!.type).toBe('no_availability');

    // Bob: position_mismatch (skip time overlap)
    expect(warnings.filter((w) => w.employeeId === 'e2').map((w) => w.type)).toContain(
      'position_mismatch',
    );
    expect(
      warnings.filter((w) => w.employeeId === 'e2').map((w) => w.type),
    ).not.toContain('no_time_overlap');

    // Carol: no_time_overlap
    expect(warnings.filter((w) => w.employeeId === 'e3').map((w) => w.type)).toContain(
      'no_time_overlap',
    );
  });

  it('ignores inactive templates for position matching', () => {
    const emp = makeEmployee({ position: 'Server' });
    const templates = [makeTemplate({ position: 'Server', is_active: false })];
    const availability = makeFullAvailability(emp.id);

    const warnings = computeScheduleWarnings([emp], templates, availability);

    expect(warnings.find((w) => w.type === 'position_mismatch')).toBeDefined();
  });
});
