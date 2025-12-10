import { describe, it, expect } from 'vitest';
import { calculateActualLaborCost } from '@/services/laborCalculations';
import { calculateWorkedHours, parseWorkPeriods } from '@/utils/payrollCalculations';
import type { TimePunch } from '@/types/timeTracking';
import type { Employee } from '@/types/scheduling';

/**
 * Cross-validation tests: Ensure laborCalculations.ts uses the same
 * clock-in/out logic as payrollCalculations.ts (via parseWorkPeriods)
 * 
 * These tests verify that:
 * 1. Overnight shifts are calculated correctly (same hours)
 * 2. Break handling matches between systems
 * 3. Edge cases (multiple shifts, partial hours) are consistent
 */

describe('LaborCalculations - Clock In/Out Cross-Validation', () => {
  // Helper to create time punches
  function createPunch(
    type: 'clock_in' | 'clock_out' | 'break_start' | 'break_end',
    time: string,
    employeeId: string = 'emp-hourly-1'
  ): TimePunch {
    return {
      id: `punch-${Math.random()}`,
      restaurant_id: 'rest-1',
      employee_id: employeeId,
      punch_type: type,
      punch_time: time,
      created_at: time,
      updated_at: time,
    };
  }

  function createShift(
    clockIn: string,
    clockOut: string,
    employeeId: string = 'emp-hourly-1'
  ): TimePunch[] {
    return [
      createPunch('clock_in', clockIn, employeeId),
      createPunch('clock_out', clockOut, employeeId),
    ];
  }

  const hourlyEmployee: Employee = {
    id: 'emp-hourly-1',
    restaurant_id: 'rest-1',
    name: 'Hourly Worker',
    position: 'Server',
    status: 'active',
    is_active: true,
    compensation_type: 'hourly',
    hourly_rate: 1500, // $15/hr in cents
    created_at: '2024-01-01T00:00:00Z',
    updated_at: '2024-01-01T00:00:00Z',
  };

  describe('Overnight Shifts - Cross-validation', () => {
    it('8 PM - 4 AM overnight shift: same hours in both systems', () => {
      const punches = createShift(
        '2025-12-09T20:00:00Z', // 8 PM Monday
        '2025-12-10T04:00:00Z' // 4 AM Tuesday
      );

      // Calculate using payroll system
      const payrollHours = calculateWorkedHours(punches);

      // Calculate using labor cost system
      const { breakdown } = calculateActualLaborCost(
        [hourlyEmployee],
        punches,
        new Date('2025-12-09'),
        new Date('2025-12-10')
      );

      // Both should report 8 hours
      expect(payrollHours).toBe(8);
      expect(breakdown.hourly.hours).toBe(8);

      // Cost should be 8 × $15 = $120
      expect(breakdown.hourly.cost).toBe(120);
    });

    it('10 PM - 6 AM overnight shift: same hours in both systems', () => {
      const punches = createShift(
        '2025-12-09T22:00:00Z', // 10 PM
        '2025-12-10T06:00:00Z' // 6 AM next day
      );

      const payrollHours = calculateWorkedHours(punches);
      const { breakdown } = calculateActualLaborCost(
        [hourlyEmployee],
        punches,
        new Date('2025-12-09'),
        new Date('2025-12-10')
      );

      expect(payrollHours).toBe(8);
      expect(breakdown.hourly.hours).toBe(8);
      expect(breakdown.hourly.cost).toBe(120);
    });

    it('6 PM - 6 AM long overnight shift: same hours in both systems', () => {
      const punches = createShift(
        '2025-12-09T18:00:00Z', // 6 PM
        '2025-12-10T06:00:00Z' // 6 AM next day (12 hours)
      );

      const payrollHours = calculateWorkedHours(punches);
      const { breakdown } = calculateActualLaborCost(
        [hourlyEmployee],
        punches,
        new Date('2025-12-09'),
        new Date('2025-12-10')
      );

      expect(payrollHours).toBe(12);
      expect(breakdown.hourly.hours).toBe(12);
      expect(breakdown.hourly.cost).toBe(180); // 12 × $15
    });
  });

  describe('Break Handling - Cross-validation', () => {
    it('single 30-minute break: same hours in both systems', () => {
      const punches = [
        createPunch('clock_in', '2025-12-09T09:00:00Z'),
        createPunch('break_start', '2025-12-09T12:00:00Z'),
        createPunch('break_end', '2025-12-09T12:30:00Z'),
        createPunch('clock_out', '2025-12-09T17:00:00Z'),
      ];

      // 8 hours total - 0.5 break = 7.5 hours
      const payrollHours = calculateWorkedHours(punches);
      const { breakdown } = calculateActualLaborCost(
        [hourlyEmployee],
        punches,
        new Date('2025-12-09T00:00:00Z'),
        new Date('2025-12-09T23:59:59Z')
      );

      expect(payrollHours).toBe(7.5);
      expect(breakdown.hourly.hours).toBe(7.5);
      expect(breakdown.hourly.cost).toBe(112.5); // 7.5 × $15
    });

    it('multiple breaks: same hours in both systems', () => {
      const punches = [
        createPunch('clock_in', '2025-12-09T08:00:00Z'),
        createPunch('break_start', '2025-12-09T10:00:00Z'),
        createPunch('break_end', '2025-12-09T10:15:00Z'), // 15 min
        createPunch('break_start', '2025-12-09T12:00:00Z'),
        createPunch('break_end', '2025-12-09T12:30:00Z'), // 30 min
        createPunch('break_start', '2025-12-09T15:00:00Z'),
        createPunch('break_end', '2025-12-09T15:15:00Z'), // 15 min
        createPunch('clock_out', '2025-12-09T17:00:00Z'),
      ];

      // 9 hours total - 1 hour breaks = 8 hours
      const payrollHours = calculateWorkedHours(punches);
      const { breakdown } = calculateActualLaborCost(
        [hourlyEmployee],
        punches,
        new Date('2025-12-09T00:00:00Z'),
        new Date('2025-12-09T23:59:59Z')
      );

      expect(payrollHours).toBe(8);
      expect(breakdown.hourly.hours).toBe(8);
      expect(breakdown.hourly.cost).toBe(120); // 8 × $15
    });

    it('break spanning overnight: same hours in both systems', () => {
      const punches = [
        createPunch('clock_in', '2025-12-09T18:00:00Z'), // 6 PM
        createPunch('break_start', '2025-12-09T23:30:00Z'), // 11:30 PM
        createPunch('break_end', '2025-12-10T00:30:00Z'), // 12:30 AM next day
        createPunch('clock_out', '2025-12-10T06:00:00Z'), // 6 AM
      ];

      // 12 hours total - 1 hour break = 11 hours
      const payrollHours = calculateWorkedHours(punches);
      const { breakdown } = calculateActualLaborCost(
        [hourlyEmployee],
        punches,
        new Date('2025-12-09'),
        new Date('2025-12-10')
      );

      expect(payrollHours).toBe(11);
      expect(breakdown.hourly.hours).toBe(11);
      expect(breakdown.hourly.cost).toBe(165); // 11 × $15
    });
  });

  describe('Multiple Shifts - Cross-validation', () => {
    it('two shifts same day: same hours in both systems', () => {
      const punches = [
        ...createShift('2025-12-09T09:00:00Z', '2025-12-09T13:00:00Z'), // 4 hours morning
        ...createShift('2025-12-09T18:00:00Z', '2025-12-09T22:00:00Z'), // 4 hours evening
      ];

      const payrollHours = calculateWorkedHours(punches);
      const { breakdown } = calculateActualLaborCost(
        [hourlyEmployee],
        punches,
        new Date('2025-12-09T00:00:00Z'),
        new Date('2025-12-09T23:59:59Z')
      );

      expect(payrollHours).toBe(8);
      expect(breakdown.hourly.hours).toBe(8);
      expect(breakdown.hourly.cost).toBe(120); // 8 × $15
    });

    it('shifts across multiple days: hours distributed correctly', () => {
      const punches = [
        ...createShift('2025-12-09T09:00:00Z', '2025-12-09T17:00:00Z'), // Mon: 8 hours
        ...createShift('2025-12-10T09:00:00Z', '2025-12-10T17:00:00Z'), // Tue: 8 hours
        ...createShift('2025-12-11T09:00:00Z', '2025-12-11T13:00:00Z'), // Wed: 4 hours
      ];

      const payrollHours = calculateWorkedHours(punches);
      const { breakdown } = calculateActualLaborCost(
        [hourlyEmployee],
        punches,
        new Date('2025-12-09T00:00:00Z'),
        new Date('2025-12-11T23:59:59Z')
      );

      // Total hours match
      expect(payrollHours).toBe(20);
      expect(breakdown.hourly.hours).toBe(20);
      expect(breakdown.hourly.cost).toBe(300); // 20 × $15
    });
  });

  describe('Fractional Hours - Cross-validation', () => {
    it('7:30 AM to 4:15 PM (8.75 hours): same in both systems', () => {
      const punches = createShift(
        '2025-12-09T07:30:00Z',
        '2025-12-09T16:15:00Z'
      );

      const payrollHours = calculateWorkedHours(punches);
      const { breakdown } = calculateActualLaborCost(
        [hourlyEmployee],
        punches,
        new Date('2025-12-09T00:00:00Z'),
        new Date('2025-12-09T23:59:59Z')
      );

      expect(payrollHours).toBe(8.75);
      expect(breakdown.hourly.hours).toBe(8.75);
      expect(breakdown.hourly.cost).toBe(131.25); // 8.75 × $15
    });

    it('30-minute shift: same in both systems', () => {
      const punches = createShift(
        '2025-12-09T14:00:00Z',
        '2025-12-09T14:30:00Z'
      );

      const payrollHours = calculateWorkedHours(punches);
      const { breakdown } = calculateActualLaborCost(
        [hourlyEmployee],
        punches,
        new Date('2025-12-09T00:00:00Z'),
        new Date('2025-12-09T23:59:59Z')
      );

      expect(payrollHours).toBe(0.5);
      expect(breakdown.hourly.hours).toBe(0.5);
      expect(breakdown.hourly.cost).toBe(7.5); // 0.5 × $15
    });
  });

  describe('Edge Cases - Cross-validation', () => {
    it('punch at exactly midnight: same in both systems', () => {
      const punches = createShift(
        '2025-12-09T16:00:00Z', // 4 PM
        '2025-12-10T00:00:00Z' // Exactly midnight
      );

      const payrollHours = calculateWorkedHours(punches);
      const { breakdown } = calculateActualLaborCost(
        [hourlyEmployee],
        punches,
        new Date('2025-12-09'),
        new Date('2025-12-10')
      );

      expect(payrollHours).toBe(8);
      expect(breakdown.hourly.hours).toBe(8);
      expect(breakdown.hourly.cost).toBe(120);
    });

    it('parseWorkPeriods output directly matches calculateActualLaborCost hours', () => {
      const punches = [
        createPunch('clock_in', '2025-12-09T09:00:00Z'),
        createPunch('break_start', '2025-12-09T12:00:00Z'),
        createPunch('break_end', '2025-12-09T12:30:00Z'),
        createPunch('clock_out', '2025-12-09T17:00:00Z'),
      ];

      // Get periods directly from parseWorkPeriods
      const { periods } = parseWorkPeriods(punches);
      const workPeriods = periods.filter(p => !p.isBreak);
      const manualSum = workPeriods.reduce((sum, p) => sum + p.hours, 0);

      // Get hours from calculateActualLaborCost (which uses parseWorkPeriods internally)
      const { breakdown } = calculateActualLaborCost(
        [hourlyEmployee],
        punches,
        new Date('2025-12-09T00:00:00Z'),
        new Date('2025-12-09T23:59:59Z')
      );

      // All three methods should match
      expect(manualSum).toBe(7.5);
      expect(calculateWorkedHours(punches)).toBe(7.5);
      expect(breakdown.hourly.hours).toBe(7.5);
    });
  });

  describe('Multiple Employees - Cross-validation', () => {
    it('two employees with different rates: both calculated correctly', () => {
      const employee1: Employee = {
        ...hourlyEmployee,
        id: 'emp-1',
        hourly_rate: 1500, // $15/hr
        is_active: true,
      };

      const employee2: Employee = {
        ...hourlyEmployee,
        id: 'emp-2',
        name: 'Higher Paid Worker',
        hourly_rate: 2000, // $20/hr
        is_active: true,
      };

      const punches = [
        ...createShift('2025-12-09T09:00:00Z', '2025-12-09T17:00:00Z', 'emp-1'), // 8h @ $15
        ...createShift('2025-12-09T09:00:00Z', '2025-12-09T13:00:00Z', 'emp-2'), // 4h @ $20
      ];

      const emp1Punches = punches.filter(p => p.employee_id === 'emp-1');
      const emp2Punches = punches.filter(p => p.employee_id === 'emp-2');

      const emp1Hours = calculateWorkedHours(emp1Punches);
      const emp2Hours = calculateWorkedHours(emp2Punches);

      const { breakdown } = calculateActualLaborCost(
        [employee1, employee2],
        punches,
        new Date('2025-12-09T00:00:00Z'),
        new Date('2025-12-09T23:59:59Z')
      );

      // Verify individual employee hours match
      expect(emp1Hours).toBe(8);
      expect(emp2Hours).toBe(4);

      // Total hours should match
      expect(breakdown.hourly.hours).toBe(12);

      // Total cost: (8 × $15) + (4 × $20) = $120 + $80 = $200
      expect(breakdown.hourly.cost).toBe(200);
    });
  });
});
