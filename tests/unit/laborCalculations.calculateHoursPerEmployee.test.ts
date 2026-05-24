import { describe, it, expect } from 'vitest';
import {
  calculateActualLaborCost,
  calculateHoursPerEmployee,
} from '@/services/laborCalculations';
import type { Employee } from '@/types/scheduling';
import type { TimePunch } from '@/types/timeTracking';

/**
 * Tests for calculateHoursPerEmployee — the per-employee rollup that powers
 * the AI chat's get_labor_costs.employee_breakdown and get_time_punches tools.
 *
 * Date convention (lesson [2026-05-03]): punch_time uses ISO strings without
 * a trailing Z so new Date(...) is interpreted in the host TZ. Punches sit
 * inside the day (9am-5pm), so the bucket date matches the string's date on
 * both CI (UTC) and local dev (PT) without setting process.env.TZ.
 */

function punch(
  employeeId: string,
  time: string,
  type: 'clock_in' | 'clock_out' | 'break_start' | 'break_end',
): TimePunch {
  return {
    id: `${employeeId}-${time}-${type}`,
    employee_id: employeeId,
    restaurant_id: 'r1',
    punch_type: type,
    punch_time: new Date(time).toISOString(),
    created_at: '2026-01-01T00:00:00Z',
    updated_at: '2026-01-01T00:00:00Z',
  } as TimePunch;
}

const hourlyEmployee: Employee = {
  id: 'emp-hourly',
  restaurant_id: 'r1',
  name: 'Hourly Hannah',
  position: 'Server',
  status: 'active',
  is_active: true,
  compensation_type: 'hourly',
  hourly_rate: 2000, // $20.00/hr
  is_exempt: false,
  created_at: '2026-01-01T00:00:00Z',
  updated_at: '2026-01-01T00:00:00Z',
} as Employee;

const salaryEmployee: Employee = {
  id: 'emp-salary',
  restaurant_id: 'r1',
  name: 'Salary Sam',
  position: 'Manager',
  status: 'active',
  is_active: true,
  compensation_type: 'salary',
  hourly_rate: 0,
  salary_amount: 100000, // $1,000/week
  pay_period_type: 'weekly',
  is_exempt: true,
  created_at: '2026-01-01T00:00:00Z',
  updated_at: '2026-01-01T00:00:00Z',
} as Employee;

const contractorEmployee: Employee = {
  id: 'emp-contractor',
  restaurant_id: 'r1',
  name: 'Contractor Chris',
  position: 'Cook',
  status: 'active',
  is_active: true,
  compensation_type: 'contractor',
  hourly_rate: 0,
  contractor_payment_amount: 300000, // $3,000/month
  contractor_payment_interval: 'monthly',
  is_exempt: true,
  created_at: '2026-01-01T00:00:00Z',
  updated_at: '2026-01-01T00:00:00Z',
} as Employee;

describe('calculateHoursPerEmployee', () => {
  describe('hourly employee with breaks', () => {
    it('subtracts break time and credits hours to the work-period start day', () => {
      const punches: TimePunch[] = [
        punch('emp-hourly', '2026-05-16T09:00:00', 'clock_in'),
        punch('emp-hourly', '2026-05-16T12:00:00', 'break_start'),
        punch('emp-hourly', '2026-05-16T12:30:00', 'break_end'),
        punch('emp-hourly', '2026-05-16T17:00:00', 'clock_out'),
      ];

      const start = new Date('2026-05-16T00:00:00');
      const end = new Date('2026-05-16T23:59:59');

      const summaries = calculateHoursPerEmployee([hourlyEmployee], punches, start, end);

      expect(summaries).toHaveLength(1);
      const row = summaries[0];
      expect(row.employee_id).toBe('emp-hourly');
      expect(row.compensation_type).toBe('hourly');

      // 9-12 = 3h, 12:30-17 = 4.5h → 7.5h. Break (12-12:30) is not counted.
      expect(row.total_hours).toBeCloseTo(7.5, 4);
      expect(row.days_worked).toBe(1);
      expect(Object.keys(row.hours_per_day)).toEqual(['2026-05-16']);
      expect(row.hours_per_day['2026-05-16']).toBeCloseTo(7.5, 4);

      // Hourly cost: $20/hr × 7.5h = $150 = 15000 cents
      expect(row.total_cost_cents).toBe(15000);
    });
  });

  describe('multi-day hourly', () => {
    it('sums hours and counts distinct days_worked', () => {
      const punches: TimePunch[] = [
        punch('emp-hourly', '2026-05-14T09:00:00', 'clock_in'),
        punch('emp-hourly', '2026-05-14T13:00:00', 'clock_out'),
        punch('emp-hourly', '2026-05-15T09:00:00', 'clock_in'),
        punch('emp-hourly', '2026-05-15T17:00:00', 'clock_out'),
        punch('emp-hourly', '2026-05-16T10:00:00', 'clock_in'),
        punch('emp-hourly', '2026-05-16T16:00:00', 'clock_out'),
      ];

      const start = new Date('2026-05-14T00:00:00');
      const end = new Date('2026-05-16T23:59:59');

      const [row] = calculateHoursPerEmployee([hourlyEmployee], punches, start, end);

      expect(row.total_hours).toBeCloseTo(4 + 8 + 6, 4);
      expect(row.days_worked).toBe(3);
      expect(Object.keys(row.hours_per_day).sort()).toEqual([
        '2026-05-14',
        '2026-05-15',
        '2026-05-16',
      ]);
      expect(row.hours_per_day['2026-05-14']).toBeCloseTo(4, 4);
      expect(row.hours_per_day['2026-05-15']).toBeCloseTo(8, 4);
      expect(row.hours_per_day['2026-05-16']).toBeCloseTo(6, 4);
      expect(row.total_cost_cents).toBe(2000 * 18); // 18h × $20/h
    });
  });

  describe('employee with no punches', () => {
    it('returns a row with zero hours rather than omitting the employee', () => {
      const start = new Date('2026-05-14T00:00:00');
      const end = new Date('2026-05-16T23:59:59');

      const summaries = calculateHoursPerEmployee([hourlyEmployee], [], start, end);

      expect(summaries).toHaveLength(1);
      const [row] = summaries;
      expect(row.employee_id).toBe('emp-hourly');
      expect(row.total_hours).toBe(0);
      expect(row.days_worked).toBe(0);
      expect(row.hours_per_day).toEqual({});
      expect(row.work_periods).toEqual([]);
      expect(row.total_cost_cents).toBe(0);
    });
  });

  describe('mixed compensation types', () => {
    it('produces a row for each employee and aggregates costs that sum back to the breakdown', () => {
      const punches: TimePunch[] = [
        // Hourly: 6h on May 14, 4h on May 15
        punch('emp-hourly', '2026-05-14T09:00:00', 'clock_in'),
        punch('emp-hourly', '2026-05-14T15:00:00', 'clock_out'),
        punch('emp-hourly', '2026-05-15T09:00:00', 'clock_in'),
        punch('emp-hourly', '2026-05-15T13:00:00', 'clock_out'),
        // Salary: punches in but cost is period-allocated
        punch('emp-salary', '2026-05-14T08:00:00', 'clock_in'),
        punch('emp-salary', '2026-05-14T17:00:00', 'clock_out'),
        // Contractor: punches in but cost is period-allocated
        punch('emp-contractor', '2026-05-16T10:00:00', 'clock_in'),
        punch('emp-contractor', '2026-05-16T18:00:00', 'clock_out'),
      ];

      const start = new Date('2026-05-14T00:00:00');
      const end = new Date('2026-05-20T23:59:59');

      const employees = [hourlyEmployee, salaryEmployee, contractorEmployee];
      const summaries = calculateHoursPerEmployee(employees, punches, start, end);

      expect(summaries).toHaveLength(3);
      const byId = new Map(summaries.map((s) => [s.employee_id, s]));

      const hourly = byId.get('emp-hourly')!;
      expect(hourly.total_hours).toBeCloseTo(10, 4);
      expect(hourly.days_worked).toBe(2);
      expect(hourly.total_cost_cents).toBe(2000 * 10); // 10h × $20 = 20000c

      const salary = byId.get('emp-salary')!;
      expect(salary.total_hours).toBeCloseTo(9, 4);
      expect(salary.days_worked).toBe(1);
      // Salary cost: 7-day window × ($1000/7) = $1000 = 100000 cents
      expect(salary.total_cost_cents).toBe(100000);

      const contractor = byId.get('emp-contractor')!;
      expect(contractor.total_hours).toBeCloseTo(8, 4);
      expect(contractor.days_worked).toBe(1);
      // Contractor: 7-day window × (300000/30.44 per day) = 68995c (rounded)
      expect(contractor.total_cost_cents).toBeGreaterThan(60000);
      expect(contractor.total_cost_cents).toBeLessThan(80000);

      // Invariant: per-employee totals sum back to the aggregate by comp type.
      const { breakdown } = calculateActualLaborCost(employees, punches, start, end);
      const hourlyTotalCents = summaries
        .filter((s) => s.compensation_type === 'hourly')
        .reduce((sum, s) => sum + s.total_cost_cents, 0);
      expect(hourlyTotalCents).toBe(Math.round(breakdown.hourly.cost * 100));

      const salaryTotalCents = summaries
        .filter((s) => s.compensation_type === 'salary')
        .reduce((sum, s) => sum + s.total_cost_cents, 0);
      expect(salaryTotalCents).toBe(Math.round(breakdown.salary.cost * 100));

      const contractorTotalCents = summaries
        .filter((s) => s.compensation_type === 'contractor')
        .reduce((sum, s) => sum + s.total_cost_cents, 0);
      expect(contractorTotalCents).toBe(Math.round(breakdown.contractor.cost * 100));
    });
  });

  describe('hours_per_day key alignment', () => {
    it('uses the same date-bucket format as calculateActualLaborCost.daily_costs', () => {
      const punches: TimePunch[] = [
        punch('emp-hourly', '2026-05-15T09:00:00', 'clock_in'),
        punch('emp-hourly', '2026-05-15T17:00:00', 'clock_out'),
      ];

      const start = new Date('2026-05-14T00:00:00');
      const end = new Date('2026-05-16T23:59:59');

      const [summary] = calculateHoursPerEmployee([hourlyEmployee], punches, start, end);
      const { dailyCosts } = calculateActualLaborCost([hourlyEmployee], punches, start, end);

      const summaryKeys = Object.keys(summary.hours_per_day);
      const dailyKeys = dailyCosts.map((d) => d.date);

      // Every key in hours_per_day must exist in dailyCosts (key shape contract).
      summaryKeys.forEach((k) => expect(dailyKeys).toContain(k));

      // For the day with hours, the value must match the aggregate hours_worked.
      const day = dailyCosts.find((d) => d.date === '2026-05-15');
      expect(day).toBeDefined();
      expect(summary.hours_per_day['2026-05-15']).toBeCloseTo(day!.hours_worked, 4);
    });
  });

  describe('work_periods passthrough', () => {
    it('returns parsed work periods for each employee with isBreak set correctly', () => {
      const punches: TimePunch[] = [
        punch('emp-hourly', '2026-05-15T09:00:00', 'clock_in'),
        punch('emp-hourly', '2026-05-15T12:00:00', 'break_start'),
        punch('emp-hourly', '2026-05-15T12:30:00', 'break_end'),
        punch('emp-hourly', '2026-05-15T17:00:00', 'clock_out'),
      ];

      const start = new Date('2026-05-15T00:00:00');
      const end = new Date('2026-05-15T23:59:59');

      const [summary] = calculateHoursPerEmployee([hourlyEmployee], punches, start, end);

      expect(summary.work_periods.length).toBeGreaterThan(0);
      const breakPeriods = summary.work_periods.filter((p) => p.isBreak);
      const workPeriods = summary.work_periods.filter((p) => !p.isBreak);

      expect(breakPeriods).toHaveLength(1);
      expect(breakPeriods[0].hours).toBeCloseTo(0.5, 4);

      const totalWorkHours = workPeriods.reduce((sum, p) => sum + p.hours, 0);
      expect(totalWorkHours).toBeCloseTo(summary.total_hours, 4);
    });
  });

  describe('mid-period compensation_history changes', () => {
    it('bills hourly days at the historical rate and salary days at the historical allocation', () => {
      // Employee starts hourly @ $20/hr through May 17, then converts to a
      // weekly $1,000 salary effective May 18. Window covers both segments.
      const employee: Employee = {
        ...hourlyEmployee,
        id: 'emp-converted',
        name: 'Converted Cara',
        compensation_type: 'salary', // current = salary
        salary_amount: 100000, // $1,000/week
        pay_period_type: 'weekly',
        hourly_rate: 0,
        compensation_history: [
          {
            id: 'h1',
            employee_id: 'emp-converted',
            restaurant_id: 'r1',
            compensation_type: 'hourly',
            amount_cents: 2000, // $20/hr
            effective_date: '2026-01-01',
            created_at: '2026-01-01T00:00:00Z',
          },
          {
            id: 'h2',
            employee_id: 'emp-converted',
            restaurant_id: 'r1',
            compensation_type: 'salary',
            amount_cents: 100000,
            pay_period_type: 'weekly',
            effective_date: '2026-05-18',
            created_at: '2026-05-18T00:00:00Z',
          },
        ],
      } as Employee;

      const punches: TimePunch[] = [
        // May 16 (hourly): 8h
        punch('emp-converted', '2026-05-16T09:00:00', 'clock_in'),
        punch('emp-converted', '2026-05-16T17:00:00', 'clock_out'),
        // May 17 (hourly): 6h
        punch('emp-converted', '2026-05-17T10:00:00', 'clock_in'),
        punch('emp-converted', '2026-05-17T16:00:00', 'clock_out'),
        // May 18 (salary): clock-ins recorded but cost is period-allocated
        punch('emp-converted', '2026-05-18T08:00:00', 'clock_in'),
        punch('emp-converted', '2026-05-18T16:00:00', 'clock_out'),
      ];

      const start = new Date('2026-05-16T00:00:00');
      const end = new Date('2026-05-22T23:59:59'); // 7-day window

      const [row] = calculateHoursPerEmployee([employee], punches, start, end);

      // Hourly portion: (8 + 6) h × $20/h = $280 = 28,000 cents
      const expectedHourlyCents = (8 + 6) * 2000;

      // Salary portion: 5 days in window (May 18-22) × ($1000 / 7) per day
      const dailySalary = 100000 / 7;
      const expectedSalaryCents = Math.round(5 * dailySalary);

      // Total must include both — the bug had only the current comp_type bucket
      // running, so 28,000 cents of hourly work would have been silently dropped.
      expect(row.total_cost_cents).toBe(expectedHourlyCents + expectedSalaryCents);
      expect(row.total_hours).toBeCloseTo(8 + 6 + 8, 4);
      expect(row.days_worked).toBe(3);
    });
  });

  describe('shift crossing midnight at window end', () => {
    it('drops periods whose clock_in starts after endDate (lookahead-window orphans)', () => {
      // Punches in a lookahead window (after endDate) should NOT contribute
      // hours or cost. This protects executeGetTimePunches which fetches
      // with an end-of-window lookahead and relies on this filter.
      const punches: TimePunch[] = [
        // In window: 8h
        punch('emp-hourly', '2026-05-16T09:00:00', 'clock_in'),
        punch('emp-hourly', '2026-05-16T17:00:00', 'clock_out'),
        // After endDate (in lookahead zone): should be dropped
        punch('emp-hourly', '2026-05-17T08:00:00', 'clock_in'),
        punch('emp-hourly', '2026-05-17T14:00:00', 'clock_out'),
      ];

      const start = new Date('2026-05-16T00:00:00');
      const end = new Date('2026-05-16T23:59:59');

      const [row] = calculateHoursPerEmployee([hourlyEmployee], punches, start, end);

      expect(row.total_hours).toBeCloseTo(8, 4);
      expect(row.days_worked).toBe(1);
      expect(Object.keys(row.hours_per_day)).toEqual(['2026-05-16']);
      expect(row.total_cost_cents).toBe(8 * 2000);
    });
  });
});
