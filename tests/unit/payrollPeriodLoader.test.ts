/**
 * loadPayrollPeriod (single labor engine, Task 9).
 *
 * Fixed UTC instants and calendar-day strings. The results do not depend on
 * the host timezone (TZ=America/Chicago, Pacific/Auckland and UTC).
 */
import { describe, it, expect, vi, afterEach } from 'vitest';

import { loadPayrollPeriod, TIP_SPLIT_ID_CHUNK } from '../../supabase/functions/_shared/labor/payrollPeriod';
import type { LaborEmployee } from '../../supabase/functions/_shared/labor/types';
import { filterValue, makeLaborStubClient, type Row } from './helpers/laborStubClient';

const REST = 'rest-1';
const CHICAGO = 'America/Chicago';

function hourly(id: string): LaborEmployee {
  return {
    id,
    restaurant_id: REST,
    name: id,
    position: 'Cook',
    status: 'active',
    is_active: true,
    compensation_type: 'hourly',
    hourly_rate: 2000, // $20.00 an hour
  };
}

function salaried(id: string): LaborEmployee {
  return {
    id,
    restaurant_id: REST,
    name: id,
    position: 'Manager',
    status: 'active',
    is_active: true,
    compensation_type: 'salary',
    hourly_rate: 0,
    salary_amount: 70000, // $700 a week = $100 a day
    pay_period_type: 'weekly',
  };
}

function punch(id: string, employeeId: string, time: string, type: string): Row {
  return {
    id,
    employee_id: employeeId,
    restaurant_id: REST,
    punch_time: time,
    punch_type: type,
    created_at: time,
    updated_at: time,
    shift_id: null,
    notes: null,
    photo_path: null,
    device_info: null,
    location: null,
    created_by: null,
    modified_by: null,
  };
}

const week = { restaurantId: REST, startDay: '2026-03-02', endDay: '2026-03-08', timeZone: CHICAGO };

const PAGED_TABLES = [
  'time_punches',
  'tip_splits',
  'tip_split_items',
  'daily_labor_allocations',
  'employee_tips',
  'tip_payouts',
  'overtime_adjustments',
];

describe('loadPayrollPeriod', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('throws on employeeId null', async () => {
    const client = makeLaborStubClient({});
    await expect(
      loadPayrollPeriod(client, {
        ...week,
        employees: [hourly('e1')],
        employeeId: null,
      }),
    ).rejects.toThrow(/employeeId is null/);
    expect(client.records).toHaveLength(0);
  });

  it('throws on an empty employeeId', async () => {
    // '' is falsy: a truthiness scope would read every employee.
    const client = makeLaborStubClient({});
    await expect(
      loadPayrollPeriod(client, { ...week, employees: [hourly('e1')], employeeId: '' }),
    ).rejects.toThrow(/employeeId/);
    expect(client.records).toHaveLength(0);
  });

  it('throws on a whitespace-only employeeId', async () => {
    const client = makeLaborStubClient({});
    await expect(
      loadPayrollPeriod(client, { ...week, employees: [hourly('e1')], employeeId: '   ' }),
    ).rejects.toThrow(/employeeId must be undefined or a non-empty string/);
    expect(client.records).toHaveLength(0);
  });

  it('pages the seven source reads with keyset pages ordered by (key, id)', async () => {
    const client = makeLaborStubClient({
      tip_splits: [{ id: 's1', restaurant_id: REST, status: 'approved', split_date: '2026-03-03', total_amount: 500 }],
    });
    await loadPayrollPeriod(client, { ...week, employees: [hourly('e1')] });

    for (const table of PAGED_TABLES) {
      const [record] = client.recordsFor(table);
      expect(record, table).toBeDefined();
      expect(record.range, table).toEqual([0, 999]);
      expect(record.orders[record.orders.length - 1], table).toEqual(['id', { ascending: true }]);
    }
    expect(client.recordsFor('time_punches')[0].orders).toEqual([
      ['punch_time', { ascending: true }],
      ['id', { ascending: true }],
    ]);
    // overtime_rules is one row, not paged.
    expect(client.recordsFor('overtime_rules')[0].single).toBe(true);
  });

  it('names the punch columns and gives each read its window', async () => {
    const client = makeLaborStubClient({});
    await loadPayrollPeriod(client, { ...week, employees: [hourly('e1')] });

    const [punches] = client.recordsFor('time_punches');
    expect(punches.select).toBe(
      'id, employee_id, restaurant_id, punch_time, punch_type, created_at, updated_at, shift_id, notes, photo_path, device_info, location, created_by, modified_by',
    );
    // Chicago Mon Mar 2 00:00 CST to Sun Mar 8 23:59:59.999 CDT, +/- 18 h.
    expect(filterValue(punches, 'gte', 'punch_time')).toBe('2026-03-01T12:00:00.000Z');
    expect(filterValue(punches, 'lte', 'punch_time')).toBe('2026-03-09T22:59:59.999Z');

    // Per-job payments: the same named columns as loadPeriodLaborCost.
    expect(client.recordsFor('daily_labor_allocations')[0].select).toBe(
      'id, employee_id, date, allocated_cost, notes',
    );

    const dayColumns: Array<[string, string]> = [
      ['tip_splits', 'split_date'],
      ['daily_labor_allocations', 'date'],
      ['employee_tips', 'tip_date'],
      ['tip_payouts', 'payout_date'],
      ['overtime_adjustments', 'punch_date'],
    ];
    for (const [table, column] of dayColumns) {
      const [record] = client.recordsFor(table);
      expect(filterValue(record, 'gte', column), table).toBe('2026-03-02');
      expect(filterValue(record, 'lte', column), table).toBe('2026-03-08');
    }
    // No split, so no tip_split_items read (an empty in() fails on PostgREST).
    expect(client.recordsFor('tip_split_items')).toHaveLength(0);
  });

  it('reads tip_split_items in chunks of split ids and keyset pages the splits', async () => {
    const splits = Array.from({ length: 1150 }, (_, i) => ({
      id: `s${String(i).padStart(5, '0')}`,
      restaurant_id: REST,
      status: 'approved',
      split_date: '2026-03-03',
      total_amount: 0,
    }));
    const client = makeLaborStubClient({ tip_splits: splits });
    await loadPayrollPeriod(client, { ...week, employees: [hourly('e1')] });

    const splitPages = client.recordsFor('tip_splits');
    expect(splitPages).toHaveLength(2);
    // A keyset on id alone uses gt, not the (key, id) or() cursor.
    expect(splitPages[1].or).toBeNull();
    expect(filterValue(splitPages[1], 'gt', 'id')).toBe('s00999');

    const itemReads = client.recordsFor('tip_split_items');
    expect(itemReads).toHaveLength(Math.ceil(1150 / TIP_SPLIT_ID_CHUNK));
    const ids = itemReads.flatMap((r) => filterValue(r, 'in', 'tip_split_id') as string[]);
    expect(ids).toEqual(splits.map((s) => s.id));
    expect(Math.max(...itemReads.map((r) => (filterValue(r, 'in', 'tip_split_id') as string[]).length))).toBe(
      TIP_SPLIT_ID_CHUNK,
    );
  });

  it('returns capped when a read hits the maxPages cap', async () => {
    let n = 0;
    const client = makeLaborStubClient({
      employee_tips: () =>
        Array.from({ length: 1000 }, () => {
          n += 1;
          return { id: `t${String(n).padStart(6, '0')}`, employee_id: 'e1', tip_amount: 0, tip_date: '2026-03-03' };
        }),
    });
    const { capped } = await loadPayrollPeriod(client, { ...week, employees: [hourly('e1')] });
    expect(capped).toBe(true);
    expect(client.recordsFor('employee_tips')).toHaveLength(20);

    const clean = await loadPayrollPeriod(makeLaborStubClient({}), { ...week, employees: [hourly('e1')] });
    expect(clean.capped).toBe(false);
  });

  it('scopes the per-employee reads to employeeId and keeps tip_splits and overtime_rules restaurant-wide', async () => {
    const client = makeLaborStubClient({
      tip_splits: [{ id: 's1', restaurant_id: REST, status: 'approved', split_date: '2026-03-03', total_amount: 500 }],
    });
    await loadPayrollPeriod(client, { ...week, employees: [hourly('e1')], employeeId: 'e1' });

    for (const table of PAGED_TABLES.filter((t) => t !== 'tip_splits')) {
      expect(filterValue(client.recordsFor(table)[0], 'eq', 'employee_id'), table).toBe('e1');
    }
    expect(filterValue(client.recordsFor('tip_splits')[0], 'eq', 'employee_id')).toBeUndefined();
    expect(filterValue(client.recordsFor('overtime_rules')[0], 'eq', 'employee_id')).toBeUndefined();
  });

  it('computes pay, tips owed and per-job payments from the rows', async () => {
    const client = makeLaborStubClient({
      time_punches: [
        punch('p1', 'e1', '2026-03-03T15:00:00.000Z', 'clock_in'), // Tue 09:00 CST
        punch('p2', 'e1', '2026-03-03T23:00:00.000Z', 'clock_out'), // Tue 17:00 CST
      ],
      tip_splits: [{ id: 's1', restaurant_id: REST, status: 'approved', split_date: '2026-03-03', total_amount: 1000 }],
      tip_split_items: [
        { id: 'i1', employee_id: 'e1', amount: 1000, tip_split_id: 's1', tip_splits: { split_date: '2026-03-03' } },
      ],
      employee_tips: [
        // Same day as the split: the split wins (no double count).
        { id: 'd1', restaurant_id: REST, employee_id: 'e1', tip_amount: 700, tip_date: '2026-03-03' },
        { id: 'd2', restaurant_id: REST, employee_id: 'e1', tip_amount: 300, tip_date: '2026-03-04' },
      ],
      tip_payouts: [{ id: 'o1', restaurant_id: REST, employee_id: 'e1', amount: 400, payout_date: '2026-03-05' }],
      daily_labor_allocations: [
        { id: 'j1', restaurant_id: REST, source: 'per-job', employee_id: 'c1', date: '2026-03-04', allocated_cost: 5000, notes: 'Deep clean' },
      ],
    });
    const contractor: LaborEmployee = {
      ...hourly('c1'),
      compensation_type: 'contractor',
      contractor_payment_interval: 'per-job',
      hourly_rate: 0,
    };

    const { period } = await loadPayrollPeriod(client, { ...week, employees: [hourly('e1'), contractor] });

    const e1 = period.employees.find((e) => e.employeeId === 'e1');
    expect(e1?.regularHours).toBeCloseTo(8, 6);
    expect(e1?.regularPay).toBe(16000);
    expect(e1?.totalTips).toBe(1300);
    expect(e1?.tipsPaidOut).toBe(400);
    expect(e1?.tipsOwed).toBe(900);
    const c1 = period.employees.find((e) => e.employeeId === 'c1');
    expect(c1?.manualPaymentsTotal).toBe(5000);
    expect(c1?.manualPayments).toEqual([{ id: 'j1', date: '2026-03-04', amount: 5000, description: 'Deep clean' }]);
  });

  it('logs an overtime_adjustments error and runs payroll without adjustments', async () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const client = makeLaborStubClient(
      {},
      { errorFor: (record) => (record.table === 'overtime_adjustments' ? { message: 'boom' } : null) },
    );
    const { period } = await loadPayrollPeriod(client, { ...week, employees: [hourly('e1')] });
    expect(period.employees).toHaveLength(1);
    expect(errorSpy).toHaveBeenCalledWith('Error fetching overtime adjustments:', { message: 'boom' });
  });

  it.each([
    ['America/Chicago'],
    ['Pacific/Auckland'],
  ])('pays one day of salary for one %s day on any host', async (timeZone) => {
    const { period } = await loadPayrollPeriod(makeLaborStubClient({}), {
      restaurantId: REST,
      startDay: '2026-07-22',
      endDay: '2026-07-22',
      timeZone,
      employees: [salaried('s1')],
    });
    expect(period.employees[0].salaryPay).toBe(10000);
    expect(period.startDate.getDate()).toBe(22);
    expect(period.endDate.getDate()).toBe(22);
  });
});
