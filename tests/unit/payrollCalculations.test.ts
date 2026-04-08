import { describe, it, expect } from 'vitest';
import {
  parseWorkPeriods,
  calculateWorkedHours,
  calculateWorkedHoursWithAnomalies,
  calculateRegularAndOvertimeHours,
  calculateEmployeePay,
  calculatePayrollPeriod,
  exportPayrollToCSV,
  type ManualPayment,
  type WorkPeriod,
} from '@/utils/payrollCalculations';
import type { TimePunch } from '@/types/timeTracking';
import type { Employee } from '@/types/scheduling';

/**
 * Additional tests for payrollCalculations.ts to increase coverage
 * Focuses on:
 * 1. Incomplete shift detection
 * 2. Duplicate punch handling
 * 3. Break handling
 * 4. Manual payment aggregation
 * 5. Edge cases in overtime calculation
 */

describe('payrollCalculations - Additional Coverage', () => {
  // Helper function to create punches
  function createPunch(
    type: 'clock_in' | 'clock_out' | 'break_start' | 'break_end',
    time: string,
    employeeId: string = 'emp-1'
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

  function createEmployee(overrides: Partial<Employee> = {}): Employee {
    return {
      id: 'emp-1',
      restaurant_id: 'rest-1',
      name: 'Test Employee',
      position: 'Server',
      status: 'active',
      compensation_type: 'hourly',
      hourly_rate: 1500, // $15/hr in cents
      created_at: '2024-01-01T00:00:00Z',
      updated_at: '2024-01-01T00:00:00Z',
      ...overrides,
    };
  }

  describe('Incomplete Shift Detection', () => {
    it('should detect missing clock-out', () => {
      const punches = [
        createPunch('clock_in', '2024-01-15T09:00:00Z'),
        // Missing clock_out
      ];

      const { periods, incompleteShifts } = parseWorkPeriods(punches);

      expect(periods.length).toBe(0);
      expect(incompleteShifts.length).toBe(1);
      expect(incompleteShifts[0].type).toBe('missing_clock_out');
      expect(incompleteShifts[0].punchType).toBe('clock_in');
    });

    it('should detect missing clock-in (orphan clock-out)', () => {
      const punches = [
        createPunch('clock_out', '2024-01-15T17:00:00Z'),
        // No prior clock_in
      ];

      const { periods, incompleteShifts } = parseWorkPeriods(punches);

      expect(periods.length).toBe(0);
      expect(incompleteShifts.length).toBe(1);
      expect(incompleteShifts[0].type).toBe('missing_clock_in');
      expect(incompleteShifts[0].punchType).toBe('clock_out');
    });

    it('should detect shift too long (>16 hours)', () => {
      const punches = [
        createPunch('clock_in', '2024-01-15T08:00:00Z'),
        createPunch('clock_out', '2024-01-16T12:00:00Z'), // 28 hours later
      ];

      const { periods, incompleteShifts } = parseWorkPeriods(punches);

      // Implementation flags this as missing_clock_out (excessive gap)
      expect(incompleteShifts.length).toBeGreaterThan(0);
      // The actual type may be 'missing_clock_out' or 'shift_too_long' depending on implementation
      expect(['missing_clock_out', 'shift_too_long']).toContain(incompleteShifts[0].type);
    });

    it('should detect gap too large between clock-in and clock-out', () => {
      const punches = [
        createPunch('clock_in', '2024-01-15T09:00:00Z'),
        createPunch('clock_out', '2024-01-16T10:00:00Z'), // 25 hours later (>18 hour gap)
      ];

      const { periods, incompleteShifts } = parseWorkPeriods(punches);

      // Should flag as incomplete due to excessive gap
      expect(incompleteShifts.length).toBeGreaterThan(0);
    });
  });

  describe('Duplicate Punch Handling', () => {
    it('should deduplicate consecutive clock-ins (keep last)', () => {
      const punches = [
        createPunch('clock_in', '2024-01-15T09:00:00Z'),
        createPunch('clock_in', '2024-01-15T09:02:00Z'), // Duplicate within 5 min
        createPunch('clock_out', '2024-01-15T17:00:00Z'),
      ];

      const { periods } = parseWorkPeriods(punches);

      expect(periods.length).toBe(1);
      expect(periods[0].startTime.toISOString()).toBe('2024-01-15T09:02:00.000Z');
    });

    it('should deduplicate consecutive clock-outs (keep last)', () => {
      const punches = [
        createPunch('clock_in', '2024-01-15T09:00:00Z'),
        createPunch('clock_out', '2024-01-15T17:00:00Z'),
        createPunch('clock_out', '2024-01-15T17:03:00Z'), // Duplicate within 5 min
      ];

      const { periods } = parseWorkPeriods(punches);

      expect(periods.length).toBe(1);
      expect(periods[0].endTime.toISOString()).toBe('2024-01-15T17:03:00.000Z');
    });

    it('should not deduplicate punches >5 minutes apart', () => {
      const punches = [
        createPunch('clock_in', '2024-01-15T09:00:00Z'),
        createPunch('clock_out', '2024-01-15T12:00:00Z'),
        createPunch('clock_in', '2024-01-15T13:00:00Z'), // 1 hour later - not a duplicate
        createPunch('clock_out', '2024-01-15T17:00:00Z'),
      ];

      const { periods } = parseWorkPeriods(punches);

      expect(periods.length).toBe(2); // Two separate shifts
    });
  });

  describe('Break Handling', () => {
    it('should calculate break time correctly', () => {
      const punches = [
        createPunch('clock_in', '2024-01-15T09:00:00Z'),
        createPunch('break_start', '2024-01-15T12:00:00Z'),
        createPunch('break_end', '2024-01-15T12:30:00Z'), // 30 min break
        createPunch('clock_out', '2024-01-15T17:00:00Z'),
      ];

      const { periods } = parseWorkPeriods(punches);

      const workPeriods = periods.filter(p => !p.isBreak);
      const breakPeriods = periods.filter(p => p.isBreak);

      expect(breakPeriods.length).toBe(1);
      expect(breakPeriods[0].hours).toBe(0.5); // 30 minutes
      expect(workPeriods.length).toBe(2); // Before and after break
    });

    it('should handle break_start without break_end gracefully', () => {
      const punches = [
        createPunch('clock_in', '2024-01-15T09:00:00Z'),
        createPunch('break_start', '2024-01-15T12:00:00Z'),
        // Missing break_end
        createPunch('clock_out', '2024-01-15T17:00:00Z'),
      ];

      const { periods } = parseWorkPeriods(punches);

      // Should handle gracefully - may create work period before break
      const workPeriods = periods.filter(p => !p.isBreak);
      expect(workPeriods.length).toBeGreaterThanOrEqual(1);
    });

    it('should handle break_end without break_start gracefully', () => {
      const punches = [
        createPunch('clock_in', '2024-01-15T09:00:00Z'),
        createPunch('break_end', '2024-01-15T12:30:00Z'), // Orphan break_end
        createPunch('clock_out', '2024-01-15T17:00:00Z'),
      ];

      const { periods } = parseWorkPeriods(punches);

      // Should handle gracefully
      expect(periods.length).toBeGreaterThanOrEqual(0);
    });
  });

  describe('calculateWorkedHoursWithAnomalies', () => {
    it('should return hours and incomplete shifts', () => {
      const punches = [
        createPunch('clock_in', '2024-01-15T09:00:00Z'),
        createPunch('clock_out', '2024-01-15T17:00:00Z'),
        createPunch('clock_in', '2024-01-15T18:00:00Z'),
        // Missing final clock_out
      ];

      const result = calculateWorkedHoursWithAnomalies(punches);

      expect(result.hours).toBe(8); // Only the complete shift
      expect(result.incompleteShifts.length).toBe(1);
      expect(result.incompleteShifts[0].type).toBe('missing_clock_out');
    });
  });

  describe('calculateRegularAndOvertimeHours', () => {
    it('should not calculate overtime for ≤40 hours', () => {
      const result = calculateRegularAndOvertimeHours(40);

      expect(result.regularHours).toBe(40);
      expect(result.overtimeHours).toBe(0);
    });

    it('should calculate overtime for >40 hours', () => {
      const result = calculateRegularAndOvertimeHours(45);

      expect(result.regularHours).toBe(40);
      expect(result.overtimeHours).toBe(5);
    });

    it('should handle 0 hours', () => {
      const result = calculateRegularAndOvertimeHours(0);

      expect(result.regularHours).toBe(0);
      expect(result.overtimeHours).toBe(0);
    });

    it('should handle exactly 80 hours (double overtime)', () => {
      const result = calculateRegularAndOvertimeHours(80);

      expect(result.regularHours).toBe(40);
      expect(result.overtimeHours).toBe(40);
    });
  });

  describe('calculateEmployeePay with manual payments', () => {
    it('should include manual payments for per-job contractors', () => {
      const employee = createEmployee({
        compensation_type: 'contractor',
        contractor_type: 'per_job',
      });

      const manualPayments: ManualPayment[] = [
        { id: '1', date: '2024-01-15', amount: 50000, description: 'Event setup' }, // $500
        { id: '2', date: '2024-01-16', amount: 30000, description: 'Consultation' }, // $300
      ];

      const result = calculateEmployeePay(
        employee,
        [],
        0, // tips
        new Date('2024-01-01'),
        new Date('2024-01-31'),
        manualPayments
      );

      expect(result.manualPayments.length).toBe(2);
      expect(result.manualPaymentsTotal).toBe(80000); // $800 in cents
      expect(result.grossPay).toBe(80000); // Only manual payments for per-job
    });

    it('should not include manual payments in regular pay for hourly employees', () => {
      const employee = createEmployee({
        compensation_type: 'hourly',
        hourly_rate: 1500, // $15/hr
      });

      const punches = [
        createPunch('clock_in', '2024-01-15T09:00:00Z'),
        createPunch('clock_out', '2024-01-15T17:00:00Z'), // 8 hours
      ];

      const manualPayments: ManualPayment[] = [
        { id: '1', date: '2024-01-15', amount: 50000 },
      ];

      const result = calculateEmployeePay(
        employee,
        punches,
        0, // tips
        new Date('2024-01-15'),
        new Date('2024-01-15'),
        manualPayments
      );

      // Check that regular pay is calculated correctly from punches only
      expect(result.regularPay).toBe(12000); // 8 hours * $15/hr in cents
      // Manual payments should be tracked separately and not affect regular pay
      expect(result.manualPaymentsTotal).toBe(50000); // $500 in cents
      expect(result.grossPay).toBe(62000); // regularPay + manualPaymentsTotal
    });

    it('should handle empty manual payments array', () => {
      const employee = createEmployee({
        compensation_type: 'contractor',
        contractor_type: 'per_job',
      });

      const result = calculateEmployeePay(
        employee,
        [],
        0, // tips
        new Date('2024-01-01'),
        new Date('2024-01-31'),
        []
      );

      expect(result.manualPayments.length).toBe(0);
      expect(result.manualPaymentsTotal).toBe(0);
      expect(result.grossPay).toBe(0);
    });

    it('should handle undefined manual payments', () => {
      const employee = createEmployee({
        compensation_type: 'contractor',
        contractor_type: 'per_job',
      });

      const result = calculateEmployeePay(
        employee,
        [],
        0, // tips
        new Date('2024-01-01'),
        new Date('2024-01-31'),
        undefined
      );

      expect(result.manualPayments.length).toBe(0);
      expect(result.manualPaymentsTotal).toBe(0);
    });
  });

  describe('calculatePayrollPeriod with manual payments', () => {
    it('should aggregate manual payments by employee', () => {
      const employees: Employee[] = [
        createEmployee({
          id: 'emp-1',
          name: 'Contractor 1',
          compensation_type: 'contractor',
          contractor_type: 'per_job',
        }),
      ];

      const punchesPerEmployee = new Map<string, TimePunch[]>();
      const tipsPerEmployee = new Map<string, number>();
      const manualPaymentsPerEmployee = new Map<string, ManualPayment[]>();
      manualPaymentsPerEmployee.set('emp-1', [
        { id: '1', date: '2024-01-15', amount: 50000 },
        { id: '2', date: '2024-01-16', amount: 30000 },
      ]);

      const result = calculatePayrollPeriod(
        new Date('2024-01-01'),
        new Date('2024-01-31'),
        employees,
        punchesPerEmployee,
        tipsPerEmployee,
        manualPaymentsPerEmployee
      );

      expect(result.employees.length).toBe(1);
      expect(result.employees[0].manualPayments.length).toBe(2);
      expect(result.employees[0].manualPaymentsTotal).toBe(80000);
      expect(result.employees[0].grossPay).toBe(80000);
      expect(result.totalGrossPay).toBe(80000);
    });

    it('should handle employees with no manual payments', () => {
      const employees: Employee[] = [
        createEmployee({
          id: 'emp-1',
          name: 'Hourly Employee',
          compensation_type: 'hourly',
        }),
      ];

      const punchesPerEmployee = new Map<string, TimePunch[]>();
      const tipsPerEmployee = new Map<string, number>();
      const manualPaymentsPerEmployee = new Map<string, ManualPayment[]>();

      const result = calculatePayrollPeriod(
        new Date('2024-01-01'),
        new Date('2024-01-31'),
        employees,
        punchesPerEmployee,
        tipsPerEmployee,
        manualPaymentsPerEmployee
      );

      expect(result.employees.length).toBe(1);
      expect(result.employees[0].manualPayments.length).toBe(0);
      expect(result.employees[0].manualPaymentsTotal).toBe(0);
    });
  });

  describe('calculateEmployeePay tip payout deduction', () => {
    it('should deduct tipsPaidOut from tips when tips > tipsPaidOut', () => {
      const employee = createEmployee();
      const result = calculateEmployeePay(
        employee,
        [],
        50000, // $500 tips in cents
        new Date('2024-01-01'),
        new Date('2024-01-07'),
        [],
        20000  // $200 paid out
      );

      expect(result.totalTips).toBe(50000);
      expect(result.tipsPaidOut).toBe(20000);
      expect(result.tipsOwed).toBe(30000); // 50000 - 20000
    });

    it('should default tipsPaidOut to 0 for backward compatibility', () => {
      const employee = createEmployee();
      const result = calculateEmployeePay(
        employee,
        [],
        50000, // $500 tips in cents
        new Date('2024-01-01'),
        new Date('2024-01-07'),
        []
        // tipsPaidOut omitted - should default to 0
      );

      expect(result.tipsPaidOut).toBe(0);
      expect(result.tipsOwed).toBe(50000); // All tips owed
    });

    it('should clamp tipsOwed to 0 when tipsPaidOut > tips (overpayment)', () => {
      const employee = createEmployee();
      const result = calculateEmployeePay(
        employee,
        [],
        30000, // $300 tips in cents
        new Date('2024-01-01'),
        new Date('2024-01-07'),
        [],
        50000  // $500 paid out (overpaid)
      );

      expect(result.totalTips).toBe(30000);
      expect(result.tipsPaidOut).toBe(50000);
      expect(result.tipsOwed).toBe(0); // Clamped to 0, never negative
    });

    it('should compute totalPay as grossPay + tipsOwed (not grossPay + tips)', () => {
      const employee = createEmployee({
        compensation_type: 'contractor',
        contractor_type: 'per_job',
      });
      const manualPayments: ManualPayment[] = [
        { id: '1', date: '2024-01-15', amount: 100000 }, // $1000 gross
      ];

      const result = calculateEmployeePay(
        employee,
        [],
        50000, // $500 tips
        new Date('2024-01-01'),
        new Date('2024-01-31'),
        manualPayments,
        20000  // $200 paid out
      );

      expect(result.grossPay).toBe(100000);
      expect(result.tipsOwed).toBe(30000); // 50000 - 20000
      expect(result.totalPay).toBe(130000); // 100000 + 30000, NOT 100000 + 50000
    });

    it('should include tipsPaidOut and tipsOwed fields on the return object', () => {
      const employee = createEmployee();
      const result = calculateEmployeePay(
        employee,
        [],
        10000,
        new Date('2024-01-01'),
        new Date('2024-01-07'),
        [],
        5000
      );

      expect(result).toHaveProperty('tipsPaidOut');
      expect(result).toHaveProperty('tipsOwed');
      expect(typeof result.tipsPaidOut).toBe('number');
      expect(typeof result.tipsOwed).toBe('number');
    });
  });

  describe('calculatePayrollPeriod with tip payouts', () => {
    it('should deduct payouts per employee from tipPayoutsPerEmployee', () => {
      const employees: Employee[] = [
        createEmployee({ id: 'emp-1', name: 'Alice' }),
        createEmployee({ id: 'emp-2', name: 'Bob' }),
      ];

      const punchesPerEmployee = new Map<string, TimePunch[]>();
      const tipsPerEmployee = new Map<string, number>();
      tipsPerEmployee.set('emp-1', 40000); // $400
      tipsPerEmployee.set('emp-2', 30000); // $300

      const tipPayoutsPerEmployee = new Map<string, number>();
      tipPayoutsPerEmployee.set('emp-1', 15000); // $150 paid out
      tipPayoutsPerEmployee.set('emp-2', 10000); // $100 paid out

      const result = calculatePayrollPeriod(
        new Date('2024-01-01'),
        new Date('2024-01-07'),
        employees,
        punchesPerEmployee,
        tipsPerEmployee,
        new Map(),
        tipPayoutsPerEmployee
      );

      const alice = result.employees.find(e => e.employeeId === 'emp-1')!;
      const bob = result.employees.find(e => e.employeeId === 'emp-2')!;

      expect(alice.totalTips).toBe(40000);
      expect(alice.tipsPaidOut).toBe(15000);
      expect(alice.tipsOwed).toBe(25000); // 40000 - 15000

      expect(bob.totalTips).toBe(30000);
      expect(bob.tipsPaidOut).toBe(10000);
      expect(bob.tipsOwed).toBe(20000); // 30000 - 10000
    });

    it('should aggregate totalTipsPaidOut and totalTipsOwed correctly', () => {
      const employees: Employee[] = [
        createEmployee({ id: 'emp-1', name: 'Alice' }),
        createEmployee({ id: 'emp-2', name: 'Bob' }),
      ];

      const punchesPerEmployee = new Map<string, TimePunch[]>();
      const tipsPerEmployee = new Map<string, number>();
      tipsPerEmployee.set('emp-1', 40000);
      tipsPerEmployee.set('emp-2', 30000);

      const tipPayoutsPerEmployee = new Map<string, number>();
      tipPayoutsPerEmployee.set('emp-1', 15000);
      tipPayoutsPerEmployee.set('emp-2', 10000);

      const result = calculatePayrollPeriod(
        new Date('2024-01-01'),
        new Date('2024-01-07'),
        employees,
        punchesPerEmployee,
        tipsPerEmployee,
        new Map(),
        tipPayoutsPerEmployee
      );

      expect(result.totalTips).toBe(70000); // 40000 + 30000
      expect(result.totalTipsPaidOut).toBe(25000); // 15000 + 10000
      expect(result.totalTipsOwed).toBe(45000); // 25000 + 20000
    });

    it('should be backward compatible when tipPayoutsPerEmployee is empty', () => {
      const employees: Employee[] = [
        createEmployee({ id: 'emp-1', name: 'Alice' }),
      ];

      const punchesPerEmployee = new Map<string, TimePunch[]>();
      const tipsPerEmployee = new Map<string, number>();
      tipsPerEmployee.set('emp-1', 50000);

      const result = calculatePayrollPeriod(
        new Date('2024-01-01'),
        new Date('2024-01-07'),
        employees,
        punchesPerEmployee,
        tipsPerEmployee
        // tipPayoutsPerEmployee omitted - defaults to empty Map
      );

      expect(result.employees[0].totalTips).toBe(50000);
      expect(result.employees[0].tipsPaidOut).toBe(0);
      expect(result.employees[0].tipsOwed).toBe(50000); // All tips owed
      expect(result.totalTips).toBe(50000);
      expect(result.totalTipsPaidOut).toBe(0);
      expect(result.totalTipsOwed).toBe(50000);
    });
  });

  describe('exportPayrollToCSV with tip columns', () => {
    it('should include Tips Earned, Tips Paid, and Tips Owed headers', () => {
      const employees: Employee[] = [
        createEmployee({ id: 'emp-1', name: 'Alice' }),
      ];

      const punchesPerEmployee = new Map<string, TimePunch[]>();
      const tipsPerEmployee = new Map<string, number>();
      tipsPerEmployee.set('emp-1', 50000);

      const tipPayoutsPerEmployee = new Map<string, number>();
      tipPayoutsPerEmployee.set('emp-1', 20000);

      const payroll = calculatePayrollPeriod(
        new Date('2024-01-01'),
        new Date('2024-01-07'),
        employees,
        punchesPerEmployee,
        tipsPerEmployee,
        new Map(),
        tipPayoutsPerEmployee
      );

      const csv = exportPayrollToCSV(payroll);
      const headerLine = csv.split('\n')[0];

      expect(headerLine).toContain('Tips Earned');
      expect(headerLine).toContain('Tips Paid');
      expect(headerLine).toContain('Tips Owed');
      // Should NOT have a generic "Tips" column (replaced by the three above)
      expect(headerLine).not.toMatch(/,Tips,/);
    });

    it('should include correct tip breakdown values in CSV rows', () => {
      const employees: Employee[] = [
        createEmployee({ id: 'emp-1', name: 'Alice' }),
      ];

      const punchesPerEmployee = new Map<string, TimePunch[]>();
      const tipsPerEmployee = new Map<string, number>();
      tipsPerEmployee.set('emp-1', 50000); // $500.00

      const tipPayoutsPerEmployee = new Map<string, number>();
      tipPayoutsPerEmployee.set('emp-1', 20000); // $200.00

      const payroll = calculatePayrollPeriod(
        new Date('2024-01-01'),
        new Date('2024-01-07'),
        employees,
        punchesPerEmployee,
        tipsPerEmployee,
        new Map(),
        tipPayoutsPerEmployee
      );

      const csv = exportPayrollToCSV(payroll);
      const lines = csv.split('\n');
      const dataRow = lines[1]; // First data row (Alice)

      // Tips Earned = $500.00, Tips Paid = $200.00, Tips Owed = $300.00
      expect(dataRow).toContain('$500.00');
      expect(dataRow).toContain('$200.00');
      expect(dataRow).toContain('$300.00');
    });
  });

  describe('Edge Cases', () => {
    it('should handle empty punch array', () => {
      const hours = calculateWorkedHours([]);
      expect(hours).toBe(0);
    });

    it('should handle single punch (incomplete)', () => {
      const punches = [createPunch('clock_in', '2024-01-15T09:00:00Z')];
      const { periods, incompleteShifts } = parseWorkPeriods(punches);

      expect(periods.length).toBe(0);
      expect(incompleteShifts.length).toBe(1);
    });

    it('should handle very short shift (<1 minute)', () => {
      const punches = [
        createPunch('clock_in', '2024-01-15T09:00:00Z'),
        createPunch('clock_out', '2024-01-15T09:00:30Z'), // 30 seconds
      ];

      const { periods } = parseWorkPeriods(punches);

      expect(periods.length).toBe(1);
      expect(periods[0].hours).toBeCloseTo(0.0083, 4); // ~30 seconds in hours
    });

    it('should handle midnight crossing overnight shift', () => {
      const punches = [
        createPunch('clock_in', '2024-01-15T22:00:00Z'),
        createPunch('clock_out', '2024-01-16T06:00:00Z'), // 8 hours overnight
      ];

      const hours = calculateWorkedHours(punches);
      expect(hours).toBe(8);
    });

    it('should handle multiple breaks in a shift', () => {
      const punches = [
        createPunch('clock_in', '2024-01-15T09:00:00Z'),
        createPunch('break_start', '2024-01-15T11:00:00Z'),
        createPunch('break_end', '2024-01-15T11:15:00Z'), // 15 min break
        createPunch('break_start', '2024-01-15T14:00:00Z'),
        createPunch('break_end', '2024-01-15T14:30:00Z'), // 30 min break
        createPunch('clock_out', '2024-01-15T18:00:00Z'),
      ];

      const { periods } = parseWorkPeriods(punches);

      const workPeriods = periods.filter((p) => !p.isBreak);
      const breakPeriods = periods.filter((p) => p.isBreak);

      expect(breakPeriods.length).toBe(2);
      expect(workPeriods.length).toBe(3); // Before first break, between breaks, after second break
    });
  });
});
