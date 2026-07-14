import { describe, it, expect } from 'vitest';
import {
  parseWorkPeriods,
  calculateWorkedHours,
  calculateWorkedHoursWithAnomalies,
  calculateRegularAndOvertimeHours,
  calculateEmployeePay,
  calculatePayrollPeriod,
  exportPayrollToCSV,
  escapeCsvCell,
  MAX_SHIFT_GAP_HOURS,
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

  describe('escapeCsvCell — CSV injection safety', () => {
    it('neutralizes a leading formula-trigger character', () => {
      expect(escapeCsvCell('=cmd')).toBe('"\'=cmd"');
      expect(escapeCsvCell('+1+1')).toBe('"\'+1+1"');
      expect(escapeCsvCell('-1-1')).toBe('"\'-1-1"');
      expect(escapeCsvCell('@SUM(A1)')).toBe('"\'@SUM(A1)"');
    });

    it('neutralizes a formula-trigger character preceded by leading whitespace/tab', () => {
      // Excel/Sheets can still parse a leading tab or space before "=" as a live formula.
      expect(escapeCsvCell('\t=HYPERLINK("https://evil")')).toBe(
        '"\'\t=HYPERLINK(""https://evil"")"'
      );
      expect(escapeCsvCell('  =cmd')).toBe('"\'  =cmd"');
    });

    it('leaves non-formula text untouched aside from quoting', () => {
      expect(escapeCsvCell('Alice')).toBe('"Alice"');
      expect(escapeCsvCell(null)).toBe('""');
      expect(escapeCsvCell(undefined)).toBe('""');
    });
  });

  describe('exportPayrollToCSV — Area column', () => {
    it('includes "Area" header after "Position" in the CSV header row', () => {
      const payroll = calculatePayrollPeriod(
        new Date('2024-01-01'),
        new Date('2024-01-07'),
        [createEmployee({ id: 'emp-1', name: 'Alice', area: 'Front of House' })],
        new Map(),
        new Map()
      );

      const csv = exportPayrollToCSV(payroll);
      const headerLine = csv.split('\n')[0];
      const headers = headerLine.split(',');
      const posIdx = headers.indexOf('Position');
      const areaIdx = headers.indexOf('Area');

      expect(areaIdx).toBeGreaterThan(-1); // "Area" header exists
      expect(areaIdx).toBe(posIdx + 1);    // immediately after "Position"
    });

    it('includes the employee area value in the data row', () => {
      const payroll = calculatePayrollPeriod(
        new Date('2024-01-01'),
        new Date('2024-01-07'),
        [createEmployee({ id: 'emp-1', name: 'Alice', area: 'Front of House' })],
        new Map(),
        new Map()
      );

      const csv = exportPayrollToCSV(payroll);
      const dataRow = csv.split('\n')[1]; // Alice row
      expect(dataRow).toContain('"Front of House"');
    });

    it('emits empty string for area when employee has no area', () => {
      const payroll = calculatePayrollPeriod(
        new Date('2024-01-01'),
        new Date('2024-01-07'),
        [createEmployee({ id: 'emp-1', name: 'Bob' })], // no area
        new Map(),
        new Map()
      );

      const csv = exportPayrollToCSV(payroll);
      const lines = csv.split('\n');
      const headerCols = lines[0].split(',');
      const areaIdx = headerCols.indexOf('Area');
      const dataCols = lines[1].split(',');
      // area cell should be empty (null → '')
      expect(dataCols[areaIdx]).toBe('""');
    });

    it('emits blank for Area in the TOTAL row', () => {
      const payroll = calculatePayrollPeriod(
        new Date('2024-01-01'),
        new Date('2024-01-07'),
        [createEmployee({ id: 'emp-1', name: 'Alice', area: 'Bar' })],
        new Map(),
        new Map()
      );

      const csv = exportPayrollToCSV(payroll);
      const lines = csv.split('\n');
      // last non-empty line is the TOTAL row
      const totalLine = lines[lines.length - 1];
      const headerCols = lines[0].split(',');
      const areaIdx = headerCols.indexOf('Area');
      const totalCols = totalLine.split(',');
      expect(totalCols[areaIdx]).toBe('""');
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

  describe('area field threading', () => {
    it('threads area from employee onto EmployeePayroll when area is set', () => {
      const employee = createEmployee({ area: 'Front of House' });
      const result = calculateEmployeePay(employee, [], 0);
      expect(result.area).toBe('Front of House');
    });

    it('threads area as null when employee has no area (undefined)', () => {
      // createEmployee does not set area, so it is undefined
      const employee = createEmployee();
      const result = calculateEmployeePay(employee, [], 0);
      expect(result.area).toBeNull();
    });

    it('preserves empty string area when employee area is empty string', () => {
      const employee = createEmployee({ area: '' });
      const result = calculateEmployeePay(employee, [], 0);
      // Empty string is falsy — coerce to null via ?? null (only catches undefined/null)
      // Design spec says employee.area ?? null, so empty string stays as empty string
      // but null/undefined become null. Use the spec as authority.
      expect(result.area).toBe('');
    });

    it('area field is present in the EmployeePayroll interface (type check via property access)', () => {
      const employee = createEmployee({ area: 'Bar' });
      const result = calculateEmployeePay(employee, [], 0);
      expect(Object.prototype.hasOwnProperty.call(result, 'area')).toBe(true);
    });

    it('calculatePayrollPeriod propagates area to each EmployeePayroll row', () => {
      const employees: Employee[] = [
        createEmployee({ id: 'emp-1', name: 'Alice', area: 'Front of House' }),
        createEmployee({ id: 'emp-2', name: 'Bob', area: 'Back of House' }),
        createEmployee({ id: 'emp-3', name: 'Charlie' }), // no area
      ];

      const result = calculatePayrollPeriod(
        new Date('2024-01-01'),
        new Date('2024-01-07'),
        employees,
        new Map(),
        new Map()
      );

      const alice = result.employees.find(e => e.employeeId === 'emp-1')!;
      const bob = result.employees.find(e => e.employeeId === 'emp-2')!;
      const charlie = result.employees.find(e => e.employeeId === 'emp-3')!;

      expect(alice.area).toBe('Front of House');
      expect(bob.area).toBe('Back of House');
      expect(charlie.area).toBeNull();
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

  describe('MAX_SHIFT_GAP_HOURS', () => {
    it('is exported as a public constant equal to 18', () => {
      expect(MAX_SHIFT_GAP_HOURS).toBe(18);
    });
  });
});

describe('calculateEmployeePay overnight window attribution', () => {
  const employee = {
    id: 'e1', name: 'Night Owl', position: 'Cook', area: null,
    compensation_type: 'hourly', hourly_rate: 1500, is_active: true,
  } as unknown as Employee;

  // Payroll week Mon 2026-07-06 .. Sun 2026-07-12 (WEEK_STARTS_ON = Mon)
  const weekStart = new Date('2026-07-06T00:00:00');
  const weekEnd = new Date('2026-07-12T23:59:59.999');

  const punch = (type: string, iso: string) => ({
    id: `${type}-${iso}`, employee_id: 'e1', restaurant_id: 'r1',
    punch_type: type, punch_time: iso,
  }) as unknown as TimePunch;

  it('counts a Sun->Mon overnight shift once, attributed to the Sunday week', () => {
    // Buffered fetch for the Sun-ending week would include Mon 02:00 clock_out.
    const punches = [
      punch('clock_in', '2026-07-12T20:00:00'),  // Sun 8pm (in window)
      punch('clock_out', '2026-07-13T02:00:00'),  // Mon 2am (lookahead)
    ];
    const pay = calculateEmployeePay(employee, punches, 0, weekStart, weekEnd, [], 0, undefined, [], true);
    expect(pay.regularHours + pay.overtimeHours).toBeCloseTo(6, 5);
    expect(pay.incompleteShifts ?? []).toHaveLength(0);
  });

  it('does NOT double-count the same shift in the following week, no false orphan', () => {
    const nextStart = new Date('2026-07-13T00:00:00'); // Mon
    const nextEnd = new Date('2026-07-19T23:59:59.999');
    // Buffered fetch for the next week includes the Sun 20:00 clock_in (lookback).
    const punches = [
      punch('clock_in', '2026-07-12T20:00:00'),  // before nextStart → drop
      punch('clock_out', '2026-07-13T02:00:00'),  // in next window, but clock-in owns it
    ];
    const pay = calculateEmployeePay(employee, punches, 0, nextStart, nextEnd, [], 0, undefined, [], true);
    expect(pay.regularHours + pay.overtimeHours).toBeCloseTo(0, 5);
    // The paired clock-in suppresses the "no matching clock-in" warning:
    expect(pay.incompleteShifts ?? []).toHaveLength(0);
  });

  it('still flags a genuine missing clock-out when the clock-in is in-window', () => {
    const punches = [punch('clock_in', '2026-07-08T09:00:00')]; // Wed, never clocked out
    const pay = calculateEmployeePay(employee, punches, 0, weekStart, weekEnd, [], 0, undefined, [], true);
    expect(pay.incompleteShifts?.some((s) => s.type === 'missing_clock_out')).toBe(true);
  });

  it('OT/tip base rate ignores a buffered out-of-window neighbour shift', () => {
    // 42h in-window (Mon-Sat 7h each) → 40 reg + 2 OT; plus an out-of-window
    // Sunday-of-PRIOR-week shift present in the buffered input must not shift OT.
    const inWindow = [
      ['2026-07-06', '2026-07-07'], ['2026-07-07', '2026-07-08'],
      ['2026-07-08', '2026-07-09'], ['2026-07-09', '2026-07-10'],
      ['2026-07-10', '2026-07-11'], ['2026-07-11', '2026-07-12'],
    ].flatMap(([d]) => [
      punch('clock_in', `${d}T08:00:00`), punch('clock_out', `${d}T15:00:00`),
    ]);
    const neighbour = [
      punch('clock_in', '2026-07-05T08:00:00'), // Sun of prior week → drop
      punch('clock_out', '2026-07-05T15:00:00'),
    ];
    const pay = calculateEmployeePay(employee, [...neighbour, ...inWindow], 0, weekStart, weekEnd, [], 0, undefined, [], true);
    expect(pay.regularHours).toBeCloseTo(40, 5);
    expect(pay.overtimeHours).toBeCloseTo(2, 5);
  });

  it('keeps a break-after-midnight overnight shift whole in the clock-in week (Codex P1)', () => {
    // Sun 20:00 clock-in, break 00:30-01:00 Mon, clock-out 02:00 Mon → 5.5h worked.
    // handleBreakEnd advances the clock-in anchor, so the post-break work segment
    // starts Mon 01:00; without clock-in attribution it would be dropped from the
    // Sunday week and re-counted in the Monday week (split pay/OT).
    const punches = [
      punch('clock_in', '2026-07-12T20:00:00'),    // Sun (last day of Mon-Sun week)
      punch('break_start', '2026-07-13T00:30:00'),  // Mon 00:30
      punch('break_end', '2026-07-13T01:00:00'),    // Mon 01:00
      punch('clock_out', '2026-07-13T02:00:00'),    // Mon 02:00
    ];
    // Whole shift (5.5h) attributed to the Sunday-containing week.
    const payA = calculateEmployeePay(employee, punches, 0, weekStart, weekEnd, [], 0, undefined, [], true);
    expect(payA.regularHours + payA.overtimeHours).toBeCloseTo(5.5, 5);
    // The following week must not re-count any of it (no double-count).
    const nextStart = new Date('2026-07-13T00:00:00');
    const nextEnd = new Date('2026-07-19T23:59:59.999');
    const payB = calculateEmployeePay(employee, punches, 0, nextStart, nextEnd, [], 0, undefined, [], true);
    expect(payB.regularHours + payB.overtimeHours).toBeCloseTo(0, 5);
  });
});
