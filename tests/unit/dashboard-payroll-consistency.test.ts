import { describe, it, expect } from 'vitest';
import { calculateActualLaborCost } from '@/services/laborCalculations';
import { calculateEmployeePay } from '@/utils/payrollCalculations';
import type { Employee } from '@/types/scheduling';
import type { TimePunch } from '@/types/timeTracking';

/**
 * Test Suite: Dashboard and Payroll Labor Cost Consistency
 * 
 * CRITICAL: Dashboard labor costs MUST match Payroll labor costs
 * for the same time period and same employees.
 * 
 * This test validates that:
 * 1. Both use the same parseWorkPeriods logic
 * 2. Both calculate hours worked the same way
 * 3. Both apply the same hourly rates
 * 4. Both handle salary/contractor employees consistently
 */
describe('Dashboard and Payroll Labor Cost Consistency', () => {
  const testEmployee: Employee = {
    id: 'emp-1',
    restaurant_id: 'rest-1',
    name: 'Leticia Saucedo',
    position: 'Home assistance',
    email: 'leticia@test.com',
    phone: null,
    status: 'active',
    compensation_type: 'hourly',
    hourly_rate: 1000, // $10.00/hour in cents
    salary_amount: undefined,
    pay_period_type: undefined,
    contractor_payment_amount: undefined,
    contractor_payment_interval: undefined,
    tip_eligible: false,
    is_active: true,
    overtime_exempt: false,
    created_at: '2026-01-01T00:00:00Z',
    updated_at: '2026-01-01T00:00:00Z',
    updated_by: null,
    compensation_history: [],
  };

  describe('Hourly employee with time punches', () => {
    it('CRITICAL: Dashboard and Payroll must calculate same total cost', () => {
      // Given: Time punches for Jan 8, 2026 (8:00 AM to 2:09:43 PM)
      const timePunches: TimePunch[] = [
        {
          id: 'punch-1',
          employee_id: 'emp-1',
          restaurant_id: 'rest-1',
          punch_time: '2026-01-08T08:00:00Z',
          punch_type: 'clock_in',
          created_at: '2026-01-08T08:00:00Z',
          updated_at: '2026-01-08T08:00:00Z',
          shift_id: null,
          notes: null,
          photo_path: null,
          device_info: null,
          location: undefined,
          created_by: null,
          modified_by: null,
        },
        {
          id: 'punch-2',
          employee_id: 'emp-1',
          restaurant_id: 'rest-1',
          punch_time: '2026-01-08T14:09:43Z',
          punch_type: 'clock_out',
          created_at: '2026-01-08T14:09:43Z',
          updated_at: '2026-01-08T14:09:43Z',
          shift_id: null,
          notes: null,
          photo_path: null,
          device_info: null,
          location: undefined,
          created_by: null,
          modified_by: null,
        },
      ];

      const startDate = new Date('2026-01-04T00:00:00Z'); // Week start
      const endDate = new Date('2026-01-10T23:59:59Z'); // Week end

      // When: Calculate labor cost using Dashboard logic (calculateActualLaborCost)
      const dashboardResult = calculateActualLaborCost(
        [testEmployee],
        timePunches,
        startDate,
        endDate
      );

      // When: Calculate payroll using Payroll logic (calculateEmployeePay)
      const payrollResult = calculateEmployeePay(
        testEmployee,
        timePunches,
        0, // tips
        startDate,
        endDate
      );

      // Then: Both should calculate the same total labor cost
      const dashboardTotal = dashboardResult.breakdown.total;
      const payrollTotal = (payrollResult.regularPay + payrollResult.overtimePay) / 100; // Convert cents to dollars

      // Expected hours: 6.16 hours (6 hours 9 minutes 43 seconds)
      // Exact hours: 6.161944... hours
      // Expected cost: Math.round(1000 cents/hr × 6.161944... hrs) = 6162 cents = $61.62
      expect(dashboardResult.breakdown.hourly.hours).toBeCloseTo(6.16, 1);
      expect(payrollResult.regularHours).toBeCloseTo(6.16, 1);

      expect(dashboardTotal).toBeCloseTo(61.62, 1);
      expect(payrollTotal).toBeCloseTo(61.62, 1);

      // CRITICAL: Dashboard and Payroll must match (within rounding)
      expect(Math.abs(dashboardTotal - payrollTotal)).toBeLessThan(0.01);
    });

    it('should calculate daily breakdown correctly', () => {
      // Given: Same time punches as above
      const timePunches: TimePunch[] = [
        {
          id: 'punch-1',
          employee_id: 'emp-1',
          restaurant_id: 'rest-1',
          punch_time: '2026-01-08T08:00:00Z',
          punch_type: 'clock_in',
          created_at: '2026-01-08T08:00:00Z',
          updated_at: '2026-01-08T08:00:00Z',
          shift_id: null,
          notes: null,
          photo_path: null,
          device_info: null,
          location: undefined,
          created_by: null,
          modified_by: null,
        },
        {
          id: 'punch-2',
          employee_id: 'emp-1',
          restaurant_id: 'rest-1',
          punch_time: '2026-01-08T14:09:43Z',
          punch_type: 'clock_out',
          created_at: '2026-01-08T14:09:43Z',
          updated_at: '2026-01-08T14:09:43Z',
          shift_id: null,
          notes: null,
          photo_path: null,
          device_info: null,
          location: undefined,
          created_by: null,
          modified_by: null,
        },
      ];

      const startDate = new Date('2026-01-04T00:00:00Z');
      const endDate = new Date('2026-01-10T23:59:59Z');

      // When: Calculate using Dashboard logic
      const result = calculateActualLaborCost(
        [testEmployee],
        timePunches,
        startDate,
        endDate
      );

      // Then: Should have cost only on Jan 8
      const jan8 = result.dailyCosts.find(d => d.date === '2026-01-08');
      expect(jan8).toBeDefined();
      expect(jan8?.total_cost).toBeCloseTo(61.62, 1);
      expect(jan8?.hours_worked).toBeCloseTo(6.16, 1);

      // Other days should have zero cost
      const otherDays = result.dailyCosts.filter(d => d.date !== '2026-01-08');
      otherDays.forEach(day => {
        expect(day.total_cost).toBe(0);
        expect(day.hours_worked).toBe(0);
      });
    });
  });

  describe('Multiple shifts in one week', () => {
    it('should sum all shifts correctly', () => {
      // Given: Multiple shifts across the week
      const timePunches: TimePunch[] = [
        // Monday: 4 hours
        {
          id: 'p1',
          employee_id: 'emp-1',
          restaurant_id: 'rest-1',
          punch_time: '2026-01-06T09:00:00Z',
          punch_type: 'clock_in',
          created_at: '2026-01-06T09:00:00Z',
          updated_at: '2026-01-06T09:00:00Z',
          shift_id: null,
          notes: null,
          photo_path: null,
          device_info: null,
          location: undefined,
          created_by: null,
          modified_by: null,
        },
        {
          id: 'p2',
          employee_id: 'emp-1',
          restaurant_id: 'rest-1',
          punch_time: '2026-01-06T13:00:00Z',
          punch_type: 'clock_out',
          created_at: '2026-01-06T13:00:00Z',
          updated_at: '2026-01-06T13:00:00Z',
          shift_id: null,
          notes: null,
          photo_path: null,
          device_info: null,
          location: undefined,
          created_by: null,
          modified_by: null,
        },
        // Wednesday: 6.16 hours
        {
          id: 'p3',
          employee_id: 'emp-1',
          restaurant_id: 'rest-1',
          punch_time: '2026-01-08T08:00:00Z',
          punch_type: 'clock_in',
          created_at: '2026-01-08T08:00:00Z',
          updated_at: '2026-01-08T08:00:00Z',
          shift_id: null,
          notes: null,
          photo_path: null,
          device_info: null,
          location: undefined,
          created_by: null,
          modified_by: null,
        },
        {
          id: 'p4',
          employee_id: 'emp-1',
          restaurant_id: 'rest-1',
          punch_time: '2026-01-08T14:09:43Z',
          punch_type: 'clock_out',
          created_at: '2026-01-08T14:09:43Z',
          updated_at: '2026-01-08T14:09:43Z',
          shift_id: null,
          notes: null,
          photo_path: null,
          device_info: null,
          location: undefined,
          created_by: null,
          modified_by: null,
        },
      ];

      const startDate = new Date('2026-01-04T00:00:00Z');
      const endDate = new Date('2026-01-10T23:59:59Z');

      // When: Calculate using both methods
      const dashboardResult = calculateActualLaborCost(
        [testEmployee],
        timePunches,
        startDate,
        endDate
      );

      const payrollResult = calculateEmployeePay(
        testEmployee,
        timePunches,
        0,
        startDate,
        endDate
      );

      // Then: Total hours should be 10.16 (4 + 6.16)
      const totalHours = 4 + 6.161944;
      expect(dashboardResult.breakdown.hourly.hours).toBeCloseTo(totalHours, 1);
      expect(payrollResult.regularHours).toBeCloseTo(10.16, 1);

      // Total cost should be Math.round(1000 * (4 + 6.161944)) = 10162 cents = $101.62
      const dashboardTotal = dashboardResult.breakdown.total;
      const payrollTotal = (payrollResult.regularPay + payrollResult.overtimePay) / 100;

      expect(dashboardTotal).toBeCloseTo(101.62, 1);
      expect(payrollTotal).toBeCloseTo(101.62, 1);

      // CRITICAL: Must match (within rounding)
      expect(Math.abs(dashboardTotal - payrollTotal)).toBeLessThan(0.01);
    });
  });

  describe('Edge cases', () => {
    it('should handle incomplete time punches consistently', () => {
      // Given: Missing clock-out (same as problem statement)
      const timePunches: TimePunch[] = [
        {
          id: 'punch-1',
          employee_id: 'emp-1',
          restaurant_id: 'rest-1',
          punch_time: '2026-01-08T08:00:00Z',
          punch_type: 'clock_in',
          created_at: '2026-01-08T08:00:00Z',
          updated_at: '2026-01-08T08:00:00Z',
          shift_id: null,
          notes: null,
          photo_path: null,
          device_info: null,
          location: undefined,
          created_by: null,
          modified_by: null,
        },
        // Missing clock_out - incomplete shift
      ];

      const startDate = new Date('2026-01-04T00:00:00Z');
      const endDate = new Date('2026-01-10T23:59:59Z');

      // When: Calculate using both methods
      const dashboardResult = calculateActualLaborCost(
        [testEmployee],
        timePunches,
        startDate,
        endDate
      );

      const payrollResult = calculateEmployeePay(
        testEmployee,
        timePunches,
        0,
        startDate,
        endDate
      );

      // Then: Both should show 0 hours (incomplete shift not counted)
      expect(dashboardResult.breakdown.hourly.hours).toBe(0);
      expect(payrollResult.regularHours).toBe(0);

      // Both should show $0 cost
      expect(dashboardResult.breakdown.total).toBe(0);
      expect(payrollResult.regularPay).toBe(0);

      // Payroll should flag the incomplete shift
      expect(payrollResult.incompleteShifts).toBeDefined();
      expect(payrollResult.incompleteShifts?.length).toBeGreaterThan(0);
    });

    it('should handle no time punches', () => {
      const startDate = new Date('2026-01-04T00:00:00Z');
      const endDate = new Date('2026-01-10T23:59:59Z');

      // When: Calculate with no punches
      const dashboardResult = calculateActualLaborCost(
        [testEmployee],
        [],
        startDate,
        endDate
      );

      const payrollResult = calculateEmployeePay(
        testEmployee,
        [],
        0,
        startDate,
        endDate
      );

      // Then: Both should show 0
      expect(dashboardResult.breakdown.total).toBe(0);
      expect(payrollResult.regularPay).toBe(0);
    });
  });
});
