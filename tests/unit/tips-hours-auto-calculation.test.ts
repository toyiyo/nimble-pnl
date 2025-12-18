import { describe, it, expect } from 'vitest';
import { calculateWorkedHours } from '@/utils/payrollCalculations';
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
