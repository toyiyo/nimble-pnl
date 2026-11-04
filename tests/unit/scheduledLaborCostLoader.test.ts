/**
 * loadScheduledLaborCost (single labor engine, Task 10).
 *
 * The Scheduling page passes a Monday week (currentWeekStart and
 * endOfWeek(currentWeekStart, { weekStartsOn: 1 })) and its shifts to
 * useScheduledLaborCosts. The loader reads the same week by day strings.
 * Fixed UTC instants: the results do not depend on the host timezone.
 */
import { renderHook } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import { endOfWeek } from 'date-fns';

import { loadScheduledLaborCost } from '../../supabase/functions/_shared/labor/scheduledLaborCost';
import { LABOR_EMPLOYEE_KEYS } from '../../supabase/functions/_shared/labor/types';
import { filterValue, makeLaborStubClient, type Row } from './helpers/laborStubClient';

const REST = 'rest-1';

const { employees } = vi.hoisted(() => ({
  employees: [
    {
      id: 'e1',
      restaurant_id: 'rest-1',
      name: 'Alma',
      position: 'Cook',
      status: 'active',
      is_active: true,
      compensation_type: 'hourly',
      hourly_rate: 2000, // $20.00 an hour
    },
    {
      id: 's1',
      restaurant_id: 'rest-1',
      name: 'Bea',
      position: 'Manager',
      status: 'active',
      is_active: true,
      compensation_type: 'salary',
      hourly_rate: 0,
      salary_amount: 70000, // $700 a week
      pay_period_type: 'weekly',
    },
    {
      id: 'x1',
      restaurant_id: 'rest-1',
      name: 'Cy',
      position: 'Server',
      status: 'inactive',
      is_active: false,
      compensation_type: 'hourly',
      hourly_rate: 1500,
    },
  ],
}));

vi.mock('@/hooks/useEmployees', () => ({
  useEmployees: () => ({ employees, loading: false }),
}));

vi.mock('@/contexts/RestaurantContext', () => ({
  useRestaurantContext: () => ({
    selectedRestaurant: { restaurant: { timezone: 'America/Chicago' } },
  }),
}));

function shift(id: string, employeeId: string, start: string, end: string, breakMinutes = 0): Row {
  return {
    id,
    restaurant_id: REST,
    employee_id: employeeId,
    start_time: start,
    end_time: end,
    break_duration: breakMinutes,
  };
}

const shifts = [
  // Mon Jul 20 09:00 to 17:00 CDT, 30 min break: 7.5 h.
  shift('sh1', 'e1', '2026-07-20T14:00:00.000Z', '2026-07-20T22:00:00.000Z', 30),
  // Sun Jul 26 22:00 CDT to Mon 02:00 CDT: 4 h on the Chicago Sunday.
  shift('sh2', 'e1', '2026-07-27T03:00:00.000Z', '2026-07-27T07:00:00.000Z'),
  // Mon Jul 27 10:00 CDT: the next week, outside the window.
  shift('sh3', 'e1', '2026-07-27T15:00:00.000Z', '2026-07-27T23:00:00.000Z'),
];

const tables = {
  shifts,
  employees_secure: employees.map((e) => ({ ...e, compensation_history: [] })),
};

const week = { restaurantId: REST, startDay: '2026-07-20', endDay: '2026-07-26', timeZone: 'America/Chicago' };

describe('loadScheduledLaborCost', () => {
  it('reads the shifts of the Monday week by restaurant instants and all employees', async () => {
    const client = makeLaborStubClient(tables);
    await loadScheduledLaborCost(client, week);

    const [shiftRead] = client.recordsFor('shifts');
    expect(shiftRead.select).toBe('id, employee_id, start_time, end_time, break_duration');
    expect(filterValue(shiftRead, 'eq', 'restaurant_id')).toBe(REST);
    expect(filterValue(shiftRead, 'gte', 'start_time')).toBe('2026-07-20T05:00:00.000Z');
    expect(filterValue(shiftRead, 'lte', 'start_time')).toBe('2026-07-27T04:59:59.999Z');
    expect(shiftRead.orders).toEqual([
      ['start_time', { ascending: true }],
      ['id', { ascending: true }],
    ]);
    expect(shiftRead.range).toEqual([0, 999]);

    const [employeeRead] = client.recordsFor('employees_secure');
    expect(filterValue(employeeRead, 'eq', 'restaurant_id')).toBe(REST);
    // Named columns, no '*': every LABOR_EMPLOYEE_KEYS column, and the
    // history embed with the fields that getSortedHistory and
    // resolveCompensationForDate read, plus created_at (the tie-break).
    const select = (employeeRead.select ?? '').replace(/\s+/g, ' ').trim();
    expect(select).not.toContain('*');
    const bare = select.split('compensation_history:')[0].split(',').map((c) => c.trim()).filter(Boolean);
    expect(bare).toEqual(LABOR_EMPLOYEE_KEYS.filter((k) => k !== 'compensation_history'));
    expect(select).toContain(
      'compensation_history:employee_compensation_history(effective_date, compensation_type, amount_cents, pay_period_type, created_at)',
    );
    // status 'all': no is_active filter.
    expect(employeeRead.filters.map((f) => f.column)).toEqual(['restaurant_id']);
    expect(employeeRead.orders).toEqual([
      ['effective_date', { referencedTable: 'employee_compensation_history', ascending: false }],
      ['name', { ascending: true }],
      ['id', { ascending: true }],
    ]);
  });

  it('puts each shift on its restaurant day and prices the week', async () => {
    const result = await loadScheduledLaborCost(makeLaborStubClient(tables), week);

    expect(result.dailyCosts.map((d) => d.date)).toEqual([
      '2026-07-20', '2026-07-21', '2026-07-22', '2026-07-23', '2026-07-24', '2026-07-25', '2026-07-26',
    ]);
    const monday = result.dailyCosts[0];
    const sunday = result.dailyCosts[6];
    expect(monday.hourly_wages).toBeCloseTo(150, 6); // 7.5 h at $20
    expect(sunday.hourly_wages).toBeCloseTo(80, 6); // 4 h at $20
    expect(result.breakdown.hourly.hours).toBeCloseTo(11.5, 6);
    // $700 of salary over the 7 days.
    expect(result.breakdown.salary.cost).toBeCloseTo(700, 6);
    expect(result.totalCost).toBeCloseTo(930, 6);
    expect(result.capped).toBe(false);
  });

  it('pages the shifts with the keyset loop', async () => {
    const many = Array.from({ length: 1001 }, (_, i) =>
      shift(`sh${String(i).padStart(5, '0')}`, 'x1', '2026-07-21T15:00:00.000Z', '2026-07-21T16:00:00.000Z'),
    );
    const client = makeLaborStubClient({ ...tables, shifts: many });
    await loadScheduledLaborCost(client, week);
    const pages = client.recordsFor('shifts');
    expect(pages).toHaveLength(2);
    expect(pages[1].or).toContain('start_time.gt.');
  });

  it('gives the Scheduling page result of useScheduledLaborCosts for the same week', async () => {
    const { useScheduledLaborCosts } = await import('@/hooks/useScheduledLaborCosts');
    // The Scheduling page: currentWeekStart (a local Monday) and
    // endOfWeek(currentWeekStart, { weekStartsOn: 1 }).
    const weekStart = new Date(2026, 6, 20);
    const weekEnd = endOfWeek(weekStart, { weekStartsOn: 1 });
    const inWindow = shifts.slice(0, 2);
    const { result } = renderHook(() =>
      useScheduledLaborCosts(inWindow as never, weekStart, weekEnd, REST),
    );

    const { capped, ...loaded } = await loadScheduledLaborCost(makeLaborStubClient(tables), week);
    expect(capped).toBe(false);
    expect(loaded).toEqual(result.current);
  });
});
