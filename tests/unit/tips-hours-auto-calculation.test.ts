import { describe, it, expect } from 'vitest';
import { calculateWorkedHours, calculateWorkedHoursForClockInDay } from '@/utils/payrollCalculations';
import type { TimePunch } from '@/types/timeTracking';

describe('Tips: Auto-calculate hours from time punches', () => {
  it('should calculate hours for a simple shift', () => {
    const punches: TimePunch[] = [
      {
        id: '1',
        employee_id: 'emp1',
        restaurant_id: 'rest1',
        punch_time: '2025-12-17T09:00:00Z',
        punch_type: 'clock_in',
        created_at: '2025-12-17T09:00:00Z',
        updated_at: '2025-12-17T09:00:00Z',
      },
      {
        id: '2',
        employee_id: 'emp1',
        restaurant_id: 'rest1',
        punch_time: '2025-12-17T17:00:00Z',
        punch_type: 'clock_out',
        created_at: '2025-12-17T17:00:00Z',
        updated_at: '2025-12-17T17:00:00Z',
      },
    ];

    const hours = calculateWorkedHours(punches);
    expect(hours).toBe(8); // 8 hour shift
  });

  it('should calculate hours excluding breaks', () => {
    const punches: TimePunch[] = [
      {
        id: '1',
        employee_id: 'emp1',
        restaurant_id: 'rest1',
        punch_time: '2025-12-17T09:00:00Z',
        punch_type: 'clock_in',
        created_at: '2025-12-17T09:00:00Z',
        updated_at: '2025-12-17T09:00:00Z',
      },
      {
        id: '2',
        employee_id: 'emp1',
        restaurant_id: 'rest1',
        punch_time: '2025-12-17T12:00:00Z',
        punch_type: 'break_start',
        created_at: '2025-12-17T12:00:00Z',
        updated_at: '2025-12-17T12:00:00Z',
      },
      {
        id: '3',
        employee_id: 'emp1',
        restaurant_id: 'rest1',
        punch_time: '2025-12-17T12:30:00Z',
        punch_type: 'break_end',
        created_at: '2025-12-17T12:30:00Z',
        updated_at: '2025-12-17T12:30:00Z',
      },
      {
        id: '4',
        employee_id: 'emp1',
        restaurant_id: 'rest1',
        punch_time: '2025-12-17T17:00:00Z',
        punch_type: 'clock_out',
        created_at: '2025-12-17T17:00:00Z',
        updated_at: '2025-12-17T17:00:00Z',
      },
    ];

    const hours = calculateWorkedHours(punches);
    // 8 hours total - 0.5 hour break = 7.5 hours
    expect(hours).toBe(7.5);
  });

  it('should handle split shift (clock out and back in)', () => {
    const punches: TimePunch[] = [
      // Morning shift: 9am - 1pm (4 hours)
      {
        id: '1',
        employee_id: 'emp1',
        restaurant_id: 'rest1',
        punch_time: '2025-12-17T09:00:00Z',
        punch_type: 'clock_in',
        created_at: '2025-12-17T09:00:00Z',
        updated_at: '2025-12-17T09:00:00Z',
      },
      {
        id: '2',
        employee_id: 'emp1',
        restaurant_id: 'rest1',
        punch_time: '2025-12-17T13:00:00Z',
        punch_type: 'clock_out',
        created_at: '2025-12-17T13:00:00Z',
        updated_at: '2025-12-17T13:00:00Z',
      },
      // Evening shift: 5pm - 10pm (5 hours)
      {
        id: '3',
        employee_id: 'emp1',
        restaurant_id: 'rest1',
        punch_time: '2025-12-17T17:00:00Z',
        punch_type: 'clock_in',
        created_at: '2025-12-17T17:00:00Z',
        updated_at: '2025-12-17T17:00:00Z',
      },
      {
        id: '4',
        employee_id: 'emp1',
        restaurant_id: 'rest1',
        punch_time: '2025-12-17T22:00:00Z',
        punch_type: 'clock_out',
        created_at: '2025-12-17T22:00:00Z',
        updated_at: '2025-12-17T22:00:00Z',
      },
    ];

    const hours = calculateWorkedHours(punches);
    expect(hours).toBe(9); // 4 hours morning + 5 hours evening
  });

  it('should handle multiple short breaks', () => {
    const punches: TimePunch[] = [
      {
        id: '1',
        employee_id: 'emp1',
        restaurant_id: 'rest1',
        punch_time: '2025-12-17T09:00:00Z',
        punch_type: 'clock_in',
        created_at: '2025-12-17T09:00:00Z',
        updated_at: '2025-12-17T09:00:00Z',
      },
      // First break: 10:00-10:15 (0.25 hours)
      {
        id: '2',
        employee_id: 'emp1',
        restaurant_id: 'rest1',
        punch_time: '2025-12-17T10:00:00Z',
        punch_type: 'break_start',
        created_at: '2025-12-17T10:00:00Z',
        updated_at: '2025-12-17T10:00:00Z',
      },
      {
        id: '3',
        employee_id: 'emp1',
        restaurant_id: 'rest1',
        punch_time: '2025-12-17T10:15:00Z',
        punch_type: 'break_end',
        created_at: '2025-12-17T10:15:00Z',
        updated_at: '2025-12-17T10:15:00Z',
      },
      // Second break: 12:00-12:30 (0.5 hours)
      {
        id: '4',
        employee_id: 'emp1',
        restaurant_id: 'rest1',
        punch_time: '2025-12-17T12:00:00Z',
        punch_type: 'break_start',
        created_at: '2025-12-17T12:00:00Z',
        updated_at: '2025-12-17T12:00:00Z',
      },
      {
        id: '5',
        employee_id: 'emp1',
        restaurant_id: 'rest1',
        punch_time: '2025-12-17T12:30:00Z',
        punch_type: 'break_end',
        created_at: '2025-12-17T12:30:00Z',
        updated_at: '2025-12-17T12:30:00Z',
      },
      {
        id: '6',
        employee_id: 'emp1',
        restaurant_id: 'rest1',
        punch_time: '2025-12-17T17:00:00Z',
        punch_type: 'clock_out',
        created_at: '2025-12-17T17:00:00Z',
        updated_at: '2025-12-17T17:00:00Z',
      },
    ];

    const hours = calculateWorkedHours(punches);
    // 8 hours total - 0.25 hour break - 0.5 hour break = 7.25 hours
    expect(hours).toBe(7.25);
  });

  it('should return 0 for empty punches array', () => {
    const hours = calculateWorkedHours([]);
    expect(hours).toBe(0);
  });

  it('should handle partial shift (only clock in, no clock out)', () => {
    const punches: TimePunch[] = [
      {
        id: '1',
        employee_id: 'emp1',
        restaurant_id: 'rest1',
        punch_time: '2025-12-17T09:00:00Z',
        punch_type: 'clock_in',
        created_at: '2025-12-17T09:00:00Z',
        updated_at: '2025-12-17T09:00:00Z',
      },
    ];

    const hours = calculateWorkedHours(punches);
    // Incomplete shift should return 0 hours
    expect(hours).toBe(0);
  });

  it('should round hours to 1 decimal place for tip splitting', () => {
    // Test the rounding logic used in Tips.tsx
    const hours = 7.48;
    const rounded = Math.round(hours * 10) / 10;
    expect(rounded).toBe(7.5);

    const hours2 = 7.44;
    const rounded2 = Math.round(hours2 * 10) / 10;
    expect(rounded2).toBe(7.4);
  });

  it('should filter punches by employee ID for multi-employee scenarios', () => {
    const allPunches: TimePunch[] = [
      // Employee 1: 8am - 4pm (8 hours)
      {
        id: '1',
        employee_id: 'emp1',
        restaurant_id: 'rest1',
        punch_time: '2025-12-17T08:00:00Z',
        punch_type: 'clock_in',
        created_at: '2025-12-17T08:00:00Z',
        updated_at: '2025-12-17T08:00:00Z',
      },
      {
        id: '2',
        employee_id: 'emp1',
        restaurant_id: 'rest1',
        punch_time: '2025-12-17T16:00:00Z',
        punch_type: 'clock_out',
        created_at: '2025-12-17T16:00:00Z',
        updated_at: '2025-12-17T16:00:00Z',
      },
      // Employee 2: 10am - 6pm (8 hours)
      {
        id: '3',
        employee_id: 'emp2',
        restaurant_id: 'rest1',
        punch_time: '2025-12-17T10:00:00Z',
        punch_type: 'clock_in',
        created_at: '2025-12-17T10:00:00Z',
        updated_at: '2025-12-17T10:00:00Z',
      },
      {
        id: '4',
        employee_id: 'emp2',
        restaurant_id: 'rest1',
        punch_time: '2025-12-17T18:00:00Z',
        punch_type: 'clock_out',
        created_at: '2025-12-17T18:00:00Z',
        updated_at: '2025-12-17T18:00:00Z',
      },
    ];

    // Filter for employee 1
    const emp1Punches = allPunches.filter(p => p.employee_id === 'emp1');
    const emp1Hours = calculateWorkedHours(emp1Punches);
    expect(emp1Hours).toBe(8);

    // Filter for employee 2
    const emp2Punches = allPunches.filter(p => p.employee_id === 'emp2');
    const emp2Hours = calculateWorkedHours(emp2Punches);
    expect(emp2Hours).toBe(8);

    // Both employees worked 8 hours each
    expect(emp1Hours).toBe(emp2Hours);
  });
});

describe('Tips: overnight-safe hours via calculateWorkedHoursForClockInDay', () => {
  // Service day = 2025-12-17 (UTC bounds for deterministic, TZ-independent test).
  const dayStart = new Date('2025-12-17T00:00:00.000Z');
  const dayEnd = new Date('2025-12-17T23:59:59.999Z');
  const p = (type: string, iso: string, emp = 'emp1'): TimePunch => ({
    id: `${type}-${iso}`, employee_id: emp, restaurant_id: 'rest1',
    punch_type: type as TimePunch['punch_type'], punch_time: iso,
    created_at: iso, updated_at: iso,
  });

  it('counts an overnight shift (clock-out after midnight) on its clock-in day', () => {
    // Wed 8pm -> Thu 1am. Buffered fetch supplies both punches; hours land on Wed.
    const punches = [
      p('clock_in', '2025-12-17T20:00:00Z'),
      p('clock_out', '2025-12-18T01:00:00Z'),
    ];
    expect(calculateWorkedHoursForClockInDay(punches, dayStart, dayEnd)).toBeCloseTo(5, 5);
  });

  it('excludes a shift that clocked in the PREVIOUS night (pulled in by the buffer)', () => {
    const punches = [
      p('clock_in', '2025-12-16T20:00:00Z'),  // Tue night
      p('clock_out', '2025-12-17T01:00:00Z'),  // Wed 1am → belongs to Tue
    ];
    expect(calculateWorkedHoursForClockInDay(punches, dayStart, dayEnd)).toBeCloseTo(0, 5);
  });

  it('keeps the whole break-after-midnight shift on the clock-in day, minus breaks', () => {
    const punches = [
      p('clock_in', '2025-12-17T18:00:00Z'),
      p('break_start', '2025-12-18T00:00:00Z'),
      p('break_end', '2025-12-18T00:30:00Z'),
      p('clock_out', '2025-12-18T02:00:00Z'),
    ];
    // 8h span - 0.5h break = 7.5h, all on 2025-12-17.
    expect(calculateWorkedHoursForClockInDay(punches, dayStart, dayEnd)).toBeCloseTo(7.5, 5);
  });

  it('regression: the old per-day-window path returned 0 for these overnight hours', () => {
    // What Tips.tsx did before: filter punches to the calendar day, then
    // calculateWorkedHours. The clock-out lands next day, so only a lone
    // clock-in remained in-window → 0 hours (the reported bug).
    const punches = [
      p('clock_in', '2025-12-17T20:00:00Z'),
      p('clock_out', '2025-12-18T01:00:00Z'),
    ];
    const dayOnly = punches.filter(
      (x) => x.punch_time >= dayStart.toISOString() && x.punch_time <= dayEnd.toISOString(),
    );
    expect(calculateWorkedHours(dayOnly)).toBe(0); // old behaviour (bug)
    expect(calculateWorkedHoursForClockInDay(punches, dayStart, dayEnd)).toBeCloseTo(5, 5); // fixed
  });
});
