import { describe, expect, it } from 'vitest';

import {
  PAY_HIDDEN_REASON,
  PAY_HIDDEN_TOOL_HINT,
  payHidden,
  redactLaborCostsResult,
  redactPayrollSummary,
  redactTimePunchShifts,
} from '../../supabase/functions/_shared/payHidden.ts';

/**
 * A Chef-shaped caller holds view:scheduling but not view:pay_rates. The
 * employees_secure view then returns NULL pay, and the labor engine computes
 * $0. These helpers set each money field to null, so the AI never reports
 * that $0 as a real figure. Hours and counts stay.
 */

// What the engine returns for a masked caller: every cost is $0, and
// daysScheduled (days with cost > 0) is 0 too, although staff worked.
const breakdown = {
  hourly: { cost: 0, hours: 32.5 },
  salary: { cost: 0, employees: 2, daysScheduled: 0 },
  contractor: { cost: 0, employees: 1, daysScheduled: 0 },
  daily_rate: { cost: 0, employees: 1, daysScheduled: 0 },
  total: 0,
};

describe('PAY_HIDDEN_REASON', () => {
  it('tells the user the figures are hidden for their role', () => {
    expect(PAY_HIDDEN_REASON).toBe(
      'Pay rates are hidden for your role, so labor cost figures are not available.',
    );
  });
});

describe('PAY_HIDDEN_TOOL_HINT', () => {
  it('names pay_hidden and forbids a $0 report', () => {
    expect(PAY_HIDDEN_TOOL_HINT).toContain('pay_hidden');
    // Only labor costs are hidden: get_kpis still returns a real food cost.
    expect(PAY_HIDDEN_TOOL_HINT).toContain('labor cost figures');
    expect(PAY_HIDDEN_TOOL_HINT).toMatch(/not \$0/i);
    // Directory review rejects tool descriptions that tell Claude how to behave.
    expect(PAY_HIDDEN_TOOL_HINT).not.toMatch(/\b(tell the user|do not report)\b/i);
  });
});

describe('redactLaborCostsResult (get_labor_costs)', () => {
  const result = redactLaborCostsResult({
    breakdown,
    daily_costs: [
      {
        date: '2026-09-24',
        hourly_cost: 0,
        salary_cost: 0,
        contractor_cost: 0,
        daily_rate_cost: 0,
        total_cost: 0,
        hours_worked: 8,
      },
    ],
    employee_breakdown: [
      {
        employee_id: 'e1',
        employee_name: 'A',
        position: 'Cook',
        compensation_type: 'hourly',
        total_hours: 8,
        total_cost_cents: 0,
        days_worked: 1,
        hours_per_day: { '2026-09-24': 8 },
      },
    ],
  });

  it('sets every breakdown cost and the total to null', () => {
    expect(result.breakdown.hourly.cost).toBeNull();
    expect(result.breakdown.salary.cost).toBeNull();
    expect(result.breakdown.contractor.cost).toBeNull();
    expect(result.breakdown.daily_rate.cost).toBeNull();
    expect(result.breakdown.total).toBeNull();
  });

  it('keeps the hours and the employee counts in the breakdown', () => {
    expect(result.breakdown.hourly.hours).toBe(32.5);
    expect(result.breakdown.salary.employees).toBe(2);
    expect(result.breakdown.daily_rate.employees).toBe(1);
  });

  it('sets daysScheduled to null, because it counts days with a cost above zero', () => {
    expect(result.breakdown.salary.daysScheduled).toBeNull();
    expect(result.breakdown.contractor.daysScheduled).toBeNull();
    expect(result.breakdown.daily_rate.daysScheduled).toBeNull();
    expect(result.breakdown.hourly).not.toHaveProperty('daysScheduled');
  });

  it('sets each daily money field to null and keeps date and hours', () => {
    expect(result.daily_costs).toEqual([
      {
        date: '2026-09-24',
        hourly_cost: null,
        salary_cost: null,
        contractor_cost: null,
        daily_rate_cost: null,
        total_cost: null,
        hours_worked: 8,
      },
    ]);
  });

  it('sets each employee cost to null and keeps the hours', () => {
    expect(result.employee_breakdown?.[0].total_cost_cents).toBeNull();
    expect(result.employee_breakdown?.[0].total_hours).toBe(8);
  });

  it('only redacts: the tool adds pay_hidden itself', () => {
    expect(result).not.toHaveProperty('pay_hidden');
    expect(payHidden()).toEqual({ reason: PAY_HIDDEN_REASON });
  });

  it('keeps an omitted daily breakdown and a null employee breakdown as they are', () => {
    const bare = redactLaborCostsResult({ breakdown, daily_costs: undefined, employee_breakdown: null });
    expect(bare.daily_costs).toBeUndefined();
    expect(bare.employee_breakdown).toBeNull();
  });
});

describe('redactTimePunchShifts (get_time_punches)', () => {
  it('sets cost_cents to null on each shift and keeps the hours', () => {
    const shifts = redactTimePunchShifts([
      { employee_id: 'e1', hours: 6, cost_cents: 0, date: '2026-09-24' },
      { employee_id: 'e2', hours: 4, cost_cents: null, date: '2026-09-24' },
    ]);
    expect(shifts.map((s) => s.cost_cents)).toEqual([null, null]);
    expect(shifts.map((s) => s.hours)).toEqual([6, 4]);
  });
});

describe('redactPayrollSummary (get_payroll_summary)', () => {
  const summary = redactPayrollSummary({
    total_gross_pay: 0,
    total_tips: 120.5,
    total_manual_payments: 300,
    total_payroll: 420.5,
    by_compensation_type: {
      hourly: breakdown.hourly,
      salary: breakdown.salary,
      contractor: breakdown.contractor,
      daily_rate: breakdown.daily_rate,
    },
  });

  it('sets gross pay, manual payments and the payroll total to null', () => {
    expect(summary.total_gross_pay).toBeNull();
    expect(summary.total_manual_payments).toBeNull();
    // Never tips plus manual payments: that would read as a real total.
    expect(summary.total_payroll).toBeNull();
  });

  it('keeps the tips, which do not come from pay rates', () => {
    expect(summary.total_tips).toBe(120.5);
  });

  it('sets each compensation type cost to null and keeps the hours and counts', () => {
    expect(summary.by_compensation_type.hourly).toEqual({ cost: null, hours: 32.5 });
    expect(summary.by_compensation_type.salary).toEqual({ cost: null, employees: 2, daysScheduled: null });
    expect(summary.by_compensation_type.contractor.cost).toBeNull();
    expect(summary.by_compensation_type.daily_rate.cost).toBeNull();
  });
});
