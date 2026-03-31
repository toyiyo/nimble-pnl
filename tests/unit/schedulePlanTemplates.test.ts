import { describe, it, expect } from 'vitest';
import { buildTemplateSnapshot, buildShiftsFromTemplate } from '@/lib/schedulePlanTemplates';
import type { Shift, TemplateShiftSnapshot } from '@/types/scheduling';

function makeShift(overrides: Partial<Shift> & { start_time: string; end_time: string }): Shift {
  return {
    id: 'shift-1',
    restaurant_id: 'rest-1',
    employee_id: 'emp-1',
    break_duration: 30,
    position: 'Server',
    notes: null,
    status: 'scheduled',
    is_published: false,
    locked: false,
    created_at: '2026-03-30T00:00:00Z',
    updated_at: '2026-03-30T00:00:00Z',
    employee: { id: 'emp-1', restaurant_id: 'rest-1', name: 'Alice', position: 'Server', status: 'active', hourly_rate: 15, created_at: '', updated_at: '' } as Shift['employee'],
    ...overrides,
  };
}

describe('buildTemplateSnapshot', () => {
  const weekStart = new Date(2026, 2, 30); // Monday March 30, 2026

  it('computes correct day_offset from Monday', () => {
    const shift = makeShift({
      start_time: new Date(2026, 3, 1, 9, 0, 0).toISOString(),  // Wed Apr 1
      end_time: new Date(2026, 3, 1, 17, 0, 0).toISOString(),
    });

    const result = buildTemplateSnapshot([shift], weekStart);
    expect(result).toHaveLength(1);
    expect(result[0].day_offset).toBe(2);
  });

  it('extracts local time strings', () => {
    const shift = makeShift({
      start_time: new Date(2026, 2, 30, 9, 30, 0).toISOString(),
      end_time: new Date(2026, 2, 30, 17, 0, 0).toISOString(),
    });

    const result = buildTemplateSnapshot([shift], weekStart);
    expect(result[0].start_time).toBe('09:30:00');
    expect(result[0].end_time).toBe('17:00:00');
  });

  it('includes employee info', () => {
    const shift = makeShift({
      start_time: new Date(2026, 2, 30, 9, 0, 0).toISOString(),
      end_time: new Date(2026, 2, 30, 17, 0, 0).toISOString(),
    });

    const result = buildTemplateSnapshot([shift], weekStart);
    expect(result[0].employee_id).toBe('emp-1');
    expect(result[0].employee_name).toBe('Alice');
    expect(result[0].position).toBe('Server');
    expect(result[0].break_duration).toBe(30);
  });

  it('filters out cancelled shifts', () => {
    const shift = makeShift({
      status: 'cancelled',
      start_time: new Date(2026, 2, 30, 9, 0, 0).toISOString(),
      end_time: new Date(2026, 2, 30, 17, 0, 0).toISOString(),
    });

    const result = buildTemplateSnapshot([shift], weekStart);
    expect(result).toHaveLength(0);
  });

  it('handles Sunday (day_offset = 6)', () => {
    const shift = makeShift({
      start_time: new Date(2026, 3, 5, 10, 0, 0).toISOString(),  // Sunday Apr 5
      end_time: new Date(2026, 3, 5, 18, 0, 0).toISOString(),
    });

    const result = buildTemplateSnapshot([shift], weekStart);
    expect(result[0].day_offset).toBe(6);
  });
});

describe('buildShiftsFromTemplate', () => {
  const targetMonday = new Date(2026, 3, 6); // Monday April 6, 2026

  const snapshot: TemplateShiftSnapshot[] = [
    {
      day_offset: 0,
      start_time: '09:00:00',
      end_time: '17:00:00',
      break_duration: 30,
      position: 'Server',
      employee_id: 'emp-1',
      employee_name: 'Alice',
      notes: null,
    },
    {
      day_offset: 2,
      start_time: '18:00:00',
      end_time: '23:00:00',
      break_duration: 15,
      position: 'Cook',
      employee_id: 'emp-2',
      employee_name: 'Bob',
      notes: 'Evening shift',
    },
  ];

  it('maps day_offset to correct target dates', () => {
    const result = buildShiftsFromTemplate(snapshot, targetMonday, 'rest-1');
    expect(result).toHaveLength(2);

    const monStart = new Date(result[0].start_time);
    expect(monStart.getDate()).toBe(6);
    expect(monStart.getHours()).toBe(9);
    expect(monStart.getMinutes()).toBe(0);

    const wedStart = new Date(result[1].start_time);
    expect(wedStart.getDate()).toBe(8);
    expect(wedStart.getHours()).toBe(18);
  });

  it('produces BulkShiftInsert-compatible objects', () => {
    const result = buildShiftsFromTemplate(snapshot, targetMonday, 'rest-1');

    expect(result[0]).toMatchObject({
      restaurant_id: 'rest-1',
      employee_id: 'emp-1',
      break_duration: 30,
      position: 'Server',
      notes: null,
      status: 'scheduled',
      is_published: false,
      locked: false,
    });
  });

  it('preserves notes', () => {
    const result = buildShiftsFromTemplate(snapshot, targetMonday, 'rest-1');
    expect(result[1].notes).toBe('Evening shift');
  });
});
