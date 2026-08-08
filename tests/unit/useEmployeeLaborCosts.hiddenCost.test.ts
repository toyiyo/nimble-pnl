import { describe, it, expect } from 'vitest';
import { renderHook } from '@testing-library/react';
import { useEmployeeLaborCosts } from '@/hooks/useEmployeeLaborCosts';
import { Employee, Shift } from '@/types/scheduling';

// A masked pay column arrives as null (the row policy strips it, not the
// caller). A $0 cost for that row would understate labor and feed a wrong
// P&L. The hook must mark the row unknown and leave it out of the totals.

const shiftFor = (employeeId: string, id: string): Shift =>
  ({
    id,
    employee_id: employeeId,
    start_time: '2026-01-05T09:00:00Z',
    end_time: '2026-01-05T17:00:00Z',
  } as unknown as Shift);

const visibleHourly = {
  id: 'emp-visible',
  name: 'Ann Lee',
  position: 'Server',
  compensation_type: 'hourly',
  hourly_rate: 2000, // $20.00/hr in cents
} as unknown as Employee;

const maskedHourly = {
  id: 'emp-hourly-masked',
  name: 'Bo Ray',
  position: 'Server',
  compensation_type: 'hourly',
  hourly_rate: null,
} as unknown as Employee;

const maskedSalary = {
  id: 'emp-salary-masked',
  name: 'Cy Doe',
  position: 'Manager',
  compensation_type: 'salary',
  salary_amount: null,
  pay_period_type: 'bi-weekly',
} as unknown as Employee;

const maskedDailyRate = {
  id: 'emp-daily-masked',
  name: 'Di Fox',
  position: 'Cook',
  compensation_type: 'daily_rate',
  daily_rate_amount: null,
} as unknown as Employee;

const maskedContractor = {
  id: 'emp-contractor-masked',
  name: 'Ed Kim',
  position: 'Consultant',
  compensation_type: 'contractor',
  contractor_payment_amount: null,
  contractor_payment_interval: 'weekly',
} as unknown as Employee;

describe('useEmployeeLaborCosts — masked pay handling', () => {
  it('marks each masked compensation type as hidden with hours intact and rate/cost at 0', () => {
    const employees = [maskedHourly, maskedSalary, maskedDailyRate, maskedContractor];
    const shifts = employees.map(e => shiftFor(e.id, `shift-${e.id}`));

    const { result } = renderHook(() => useEmployeeLaborCosts(shifts, employees));

    for (const row of result.current.employeeCosts) {
      expect(row.costIsHidden).toBe(true);
      expect(row.cost).toBe(0);
      expect(row.rate).toBe(0);
      expect(row.hours).toBeGreaterThan(0);
      expect(row.outlierLevel).toBe('none');
    }
  });

  it('excludes masked rows from totalCost, totalHours and averageHourlyRate, and counts them', () => {
    const employees = [visibleHourly, maskedHourly];
    const shifts = employees.map(e => shiftFor(e.id, `shift-${e.id}`));

    const { result } = renderHook(() => useEmployeeLaborCosts(shifts, employees));

    // 8 hours * $20/hr = $160 for the one visible employee only.
    expect(result.current.totalCost).toBe(160);
    expect(result.current.totalHours).toBe(8);
    expect(result.current.averageHourlyRate).toBe(20);
    expect(result.current.hiddenCostCount).toBe(1);
  });

  it('reports hiddenCostCount 0 when the employee list is empty', () => {
    const { result } = renderHook(() => useEmployeeLaborCosts([], []));
    expect(result.current.hiddenCostCount).toBe(0);
  });

  it('keeps a fully visible hourly employee unaffected (costIsHidden false)', () => {
    const shifts = [shiftFor(visibleHourly.id, 'shift-visible')];
    const { result } = renderHook(() => useEmployeeLaborCosts(shifts, [visibleHourly]));

    expect(result.current.employeeCosts[0].costIsHidden).toBe(false);
    expect(result.current.hiddenCostCount).toBe(0);
  });
});
