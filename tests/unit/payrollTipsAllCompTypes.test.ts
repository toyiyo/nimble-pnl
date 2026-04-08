import { describe, it, expect } from 'vitest';
import { calculateEmployeePay } from '@/utils/payrollCalculations';
import type { Employee } from '@/types/scheduling';
import type { TimePunch } from '@/types/timeTracking';

/**
 * Tests that tips and tip payouts are correctly included in calculateEmployeePay
 * for ALL compensation types (hourly, daily_rate, salary, contractor).
 *
 * Regression: Staff users saw $0 tips because RLS blocked tip_splits queries,
 * and the Employee Pay page was hardcoded for hourly employees only.
 * This test suite ensures the calculation layer handles tips independently of
 * compensation type.
 */

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeEmployee(overrides: Partial<Employee> = {}): Employee {
  return {
    id: '11111111-1111-1111-1111-111111111111',
    restaurant_id: 'aaaa0000-0000-0000-0000-000000000001',
    name: 'Test Employee',
    email: 'test@example.com',
    position: 'Server',
    status: 'active',
    hire_date: '2025-01-01',
    created_at: '2025-01-01T00:00:00Z',
    updated_at: '2025-01-01T00:00:00Z',
    is_active: true,
    compensation_type: 'hourly',
    hourly_rate: 1500, // $15.00/hr in cents
    ...overrides,
  } as Employee;
}

function makePunches(date: string): TimePunch[] {
  return [
    {
      id: 'p1',
      employee_id: '11111111-1111-1111-1111-111111111111',
      restaurant_id: 'aaaa0000-0000-0000-0000-000000000001',
      punch_time: `${date}T09:00:00Z`,
      punch_type: 'clock_in',
      source: 'manual',
      created_at: `${date}T09:00:00Z`,
    },
    {
      id: 'p2',
      employee_id: '11111111-1111-1111-1111-111111111111',
      restaurant_id: 'aaaa0000-0000-0000-0000-000000000001',
      punch_time: `${date}T17:00:00Z`,
      punch_type: 'clock_out',
      source: 'manual',
      created_at: `${date}T17:00:00Z`,
    },
  ] as TimePunch[];
}

const periodStart = new Date('2026-02-15');
const periodEnd = new Date('2026-02-21');

// ---------------------------------------------------------------------------
// Test Suite
// ---------------------------------------------------------------------------

describe('calculateEmployeePay - Tips for All Compensation Types', () => {
  describe('Scenario: Server gets $60 card tips + $20 cash, manager pays $60 cash same day', () => {
    // Real-world scenario from user report:
    // - Server gets $500 in orders ($100 cash, $400 card)
    // - $60 in credit card tips + $20 cash tips
    // - Manager pays out $60 in cash from the register on the same day
    // - Payroll should show: totalTips=$80, tipsPaidOut=$60, tipsOwed=$20

    const tipsCents = 8000; // $80 total tips (cash + card) in cents
    const tipsPaidOutCents = 6000; // $60 already paid in cash

    it('hourly employee: tips and payouts are correct', () => {
      const employee = makeEmployee({ compensation_type: 'hourly', hourly_rate: 1500 });
      const punches = makePunches('2026-02-17');

      const result = calculateEmployeePay(
        employee,
        punches,
        tipsCents,
        periodStart,
        periodEnd,
        [],
        tipsPaidOutCents,
      );

      expect(result.totalTips).toBe(8000);
      expect(result.tipsPaidOut).toBe(6000);
      expect(result.tipsOwed).toBe(2000); // $80 - $60 = $20
      expect(result.totalPay).toBe(result.grossPay + 2000);
    });

    it('daily_rate employee: tips and payouts are correct', () => {
      const employee = makeEmployee({
        compensation_type: 'daily_rate',
        hourly_rate: 0,
        daily_rate_amount: 15000, // $150/day in cents
      } as Partial<Employee>);
      const punches = makePunches('2026-02-17');

      const result = calculateEmployeePay(
        employee,
        punches,
        tipsCents,
        periodStart,
        periodEnd,
        [],
        tipsPaidOutCents,
      );

      expect(result.totalTips).toBe(8000);
      expect(result.tipsPaidOut).toBe(6000);
      expect(result.tipsOwed).toBe(2000);
      expect(result.compensationType).toBe('daily_rate');
      expect(result.daysWorked).toBe(1);
      expect(result.dailyRatePay).toBeGreaterThan(0);
      expect(result.totalPay).toBe(result.grossPay + 2000);
    });

    it('salary employee: tips and payouts are correct', () => {
      const employee = makeEmployee({
        compensation_type: 'salary',
        hourly_rate: 0,
        salary_amount: 5200000, // $52,000/year in cents
        salary_period: 'yearly',
      } as Partial<Employee>);

      const result = calculateEmployeePay(
        employee,
        [], // Salary employees may have no punches
        tipsCents,
        periodStart,
        periodEnd,
        [],
        tipsPaidOutCents,
      );

      expect(result.totalTips).toBe(8000);
      expect(result.tipsPaidOut).toBe(6000);
      expect(result.tipsOwed).toBe(2000);
      expect(result.compensationType).toBe('salary');
      expect(result.totalPay).toBe(result.grossPay + 2000);
    });

    it('contractor employee: tips and payouts are correct', () => {
      const employee = makeEmployee({
        compensation_type: 'contractor',
        hourly_rate: 0,
        salary_amount: 5200000,
        salary_period: 'yearly',
      } as Partial<Employee>);

      const result = calculateEmployeePay(
        employee,
        [],
        tipsCents,
        periodStart,
        periodEnd,
        [],
        tipsPaidOutCents,
      );

      expect(result.totalTips).toBe(8000);
      expect(result.tipsPaidOut).toBe(6000);
      expect(result.tipsOwed).toBe(2000);
      expect(result.compensationType).toBe('contractor');
      expect(result.totalPay).toBe(result.grossPay + 2000);
    });
  });

  describe('Edge cases for tipsOwed calculation', () => {
    it('tipsOwed is zero when all tips have been paid out', () => {
      const employee = makeEmployee({
        compensation_type: 'daily_rate',
        hourly_rate: 0,
        daily_rate_amount: 10000,
      } as Partial<Employee>);
      const punches = makePunches('2026-02-17');

      const result = calculateEmployeePay(
        employee,
        punches,
        6000, // $60 total tips
        periodStart,
        periodEnd,
        [],
        6000, // $60 already paid
      );

      expect(result.totalTips).toBe(6000);
      expect(result.tipsPaidOut).toBe(6000);
      expect(result.tipsOwed).toBe(0);
    });

    it('tipsOwed cannot go negative (tipsPaidOut > tips)', () => {
      const employee = makeEmployee({ compensation_type: 'hourly', hourly_rate: 1500 });
      const punches = makePunches('2026-02-17');

      const result = calculateEmployeePay(
        employee,
        punches,
        4000, // $40 total tips
        periodStart,
        periodEnd,
        [],
        6000, // $60 already paid (overpaid)
      );

      expect(result.totalTips).toBe(4000);
      expect(result.tipsPaidOut).toBe(6000);
      expect(result.tipsOwed).toBe(0); // Math.max(0, 4000 - 6000) = 0
    });

    it('tips are included even when employee has zero hours/punches', () => {
      const employee = makeEmployee({ compensation_type: 'hourly', hourly_rate: 1500 });

      const result = calculateEmployeePay(
        employee,
        [], // No punches at all
        8000, // $80 tips
        periodStart,
        periodEnd,
        [],
        3000, // $30 paid out
      );

      expect(result.totalTips).toBe(8000);
      expect(result.tipsPaidOut).toBe(3000);
      expect(result.tipsOwed).toBe(5000);
      expect(result.regularHours).toBe(0);
      expect(result.grossPay).toBe(0);
      expect(result.totalPay).toBe(5000); // grossPay(0) + tipsOwed(5000)
    });

    it('no tips scenario returns zero for all tip fields', () => {
      const employee = makeEmployee({
        compensation_type: 'daily_rate',
        hourly_rate: 0,
        daily_rate_amount: 10000,
      } as Partial<Employee>);
      const punches = makePunches('2026-02-17');

      const result = calculateEmployeePay(
        employee,
        punches,
        0, // No tips
        periodStart,
        periodEnd,
        [],
        0, // No payouts
      );

      expect(result.totalTips).toBe(0);
      expect(result.tipsPaidOut).toBe(0);
      expect(result.tipsOwed).toBe(0);
      expect(result.totalPay).toBe(result.grossPay);
    });
  });
});
