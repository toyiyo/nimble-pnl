/**
 * loadPeriodLaborCost and loadPeriodBankLabor (single labor engine, Task 7).
 *
 * The loaders take calendar days and the restaurant timezone. The tests use
 * fixed UTC instants and pass under TZ=America/Chicago, Pacific/Auckland and
 * UTC: no expected value depends on the host timezone.
 */
import { describe, it, expect } from 'vitest';

import {
  loadPeriodBankLabor,
  loadPeriodLaborCost,
} from '../../supabase/functions/_shared/labor/periodLaborCost';
import { keysetAfterFilter } from '../../supabase/functions/_shared/labor/fetchAllRows';
import type { LaborEmployee } from '../../supabase/functions/_shared/labor/types';
import { filterValue, makeLaborStubClient, type Row } from './helpers/laborStubClient';

const REST = 'rest-1';
const CHICAGO = 'America/Chicago';
const AUCKLAND = 'Pacific/Auckland';
const NOW = new Date('2026-07-22T19:00:00.000Z');

function hourly(id: string, rateCents = 1000): LaborEmployee {
  return {
    id,
    restaurant_id: REST,
    name: id,
    position: 'Server',
    status: 'active',
    is_active: true,
    compensation_type: 'hourly',
    hourly_rate: rateCents,
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

const base = {
  restaurantId: REST,
  timeZone: CHICAGO,
  throughNow: false,
  now: NOW,
};

describe('loadPeriodLaborCost', () => {
  it('gives each query the windows from the day strings and the restaurant timezone', async () => {
    const client = makeLaborStubClient({});
    await loadPeriodLaborCost(client, {
      ...base,
      startDay: '2026-07-22',
      endDay: '2026-07-22',
      employees: [hourly('e1')],
    });

    const [punches] = client.recordsFor('time_punches');
    // Wed Jul 22 (Chicago). The OT fetch widens to the Chicago week Mon Jul 20
    // 00:00 CDT to Sun Jul 26 23:59:59.999 CDT.
    expect(filterValue(punches, 'gte', 'punch_time')).toBe('2026-07-20T05:00:00.000Z');
    expect(filterValue(punches, 'lte', 'punch_time')).toBe('2026-07-27T04:59:59.999Z');
    expect(filterValue(punches, 'eq', 'restaurant_id')).toBe(REST);
    expect(punches.select).toBe(
      'id, employee_id, restaurant_id, punch_time, punch_type, created_at, updated_at, shift_id, notes, photo_path, device_info, location, created_by, modified_by',
    );
    expect(punches.orders).toEqual([
      ['punch_time', { ascending: true }],
      ['id', undefined],
    ]);

    const [perJob] = client.recordsFor('daily_labor_allocations');
    expect(filterValue(perJob, 'eq', 'source')).toBe('per-job');
    expect(filterValue(perJob, 'gte', 'date')).toBe('2026-07-22');
    expect(filterValue(perJob, 'lte', 'date')).toBe('2026-07-22');

    const [tips] = client.recordsFor('tip_split_items');
    expect(filterValue(tips, 'gte', 'tip_splits.split_date')).toBe('2026-07-22');
    expect(filterValue(tips, 'lte', 'tip_splits.split_date')).toBe('2026-07-22');
    expect(filterValue(tips, 'in', 'tip_splits.status')).toEqual(['approved', 'archived']);

    const [payouts] = client.recordsFor('tip_payouts');
    expect(filterValue(payouts, 'gte', 'payout_date')).toBe('2026-07-22');
    expect(filterValue(payouts, 'lte', 'payout_date')).toBe('2026-07-22');
  });

  it('widens the fetch end by the 18 h look-ahead past the end of the last day', async () => {
    const client = makeLaborStubClient({});
    // Mon Jul 20 to Sun Jul 26 (a whole Chicago week): the week edges do not
    // widen the fetch. The end is Sun 23:59:59.999 CDT + 18 h.
    await loadPeriodLaborCost(client, {
      ...base,
      startDay: '2026-07-20',
      endDay: '2026-07-26',
      employees: [hourly('e1')],
    });
    const [punches] = client.recordsFor('time_punches');
    expect(filterValue(punches, 'gte', 'punch_time')).toBe('2026-07-20T05:00:00.000Z');
    expect(filterValue(punches, 'lte', 'punch_time')).toBe('2026-07-27T22:59:59.999Z');
  });

  it('pages time_punches with the keyset loop and asks for each page after the last (punch_time, id)', async () => {
    // 1,000 filler punches of an unknown employee fill page 1. The real
    // shift is on page 2.
    const filler = Array.from({ length: 1000 }, (_, i) =>
      punch(`f${String(i).padStart(4, '0')}`, 'ghost', '2026-07-22T12:00:00.000Z', i % 2 === 0 ? 'clock_in' : 'clock_out'),
    );
    const shift = [
      punch('p1', 'e1', '2026-07-22T15:00:00.000Z', 'clock_in'),
      punch('p2', 'e1', '2026-07-22T23:00:00.000Z', 'clock_out'),
    ];
    const client = makeLaborStubClient({ time_punches: [...shift, ...filler] });

    const result = await loadPeriodLaborCost(client, {
      ...base,
      startDay: '2026-07-22',
      endDay: '2026-07-22',
      employees: [hourly('e1')],
    });

    const pages = client.recordsFor('time_punches');
    expect(pages).toHaveLength(2);
    expect(pages[0].or).toBeNull();
    expect(pages[1].or).toBe(
      keysetAfterFilter('punch_time', { key: '2026-07-22T12:00:00.000Z', id: 'f0999' }),
    );
    expect(pages.map((p) => p.range)).toEqual([
      [0, 999],
      [0, 999],
    ]);
    // 8 h at $10.
    expect(result.dailyCosts).toEqual([
      expect.objectContaining({ date: '2026-07-22', hourly_wages: 80, total_hours: 8 }),
    ]);
    expect(result.totalCost).toBeCloseTo(80, 6);
    expect(result.capped).toBe(false);
  });

  it('nets tip payouts against tips owed per employee, floored at zero', async () => {
    const client = makeLaborStubClient({
      tip_split_items: [
        { id: 't1', amount: 500, employee_id: 'e1', tip_splits: { restaurant_id: REST, split_date: '2026-07-22' } },
        { id: 't2', amount: 300, employee_id: 'e2', tip_splits: { restaurant_id: REST, split_date: '2026-07-22' } },
      ],
      tip_payouts: [
        { id: 'o1', restaurant_id: REST, amount: 200, employee_id: 'e1', payout_date: '2026-07-22' },
        { id: 'o2', restaurant_id: REST, amount: 900, employee_id: 'e2', payout_date: '2026-07-22' },
      ],
    });

    const result = await loadPeriodLaborCost(client, {
      ...base,
      startDay: '2026-07-22',
      endDay: '2026-07-22',
      employees: [hourly('e1'), hourly('e2')],
    });

    // e1: 500 - 200 = 300 cents. e2: max(0, 300 - 900) = 0.
    expect(result.totalCost).toBeCloseTo(3, 6);
    // Tips owed are not wages.
    expect(result.wageCost).toBe(0);
  });

  it('adds the per-job payments to the daily series, the total and the wage cost', async () => {
    const client = makeLaborStubClient({
      daily_labor_allocations: [
        { id: 'j1', employee_id: 'c1', date: '2026-07-22', allocated_cost: 5000, notes: null, restaurant_id: REST, source: 'per-job' },
        { id: 'j2', employee_id: 'c1', date: '2026-07-22', allocated_cost: 2500, notes: null, restaurant_id: REST, source: 'per-job' },
      ],
    });

    const result = await loadPeriodLaborCost(client, {
      ...base,
      startDay: '2026-07-22',
      endDay: '2026-07-22',
      employees: [hourly('e1')],
    });

    expect(result.dailyCosts).toEqual([
      expect.objectContaining({ date: '2026-07-22', contractor_payments: 75, total_labor_cost: 75 }),
    ]);
    expect(result.totalCost).toBeCloseTo(75, 6);
    expect(result.wageCost).toBeCloseTo(75, 6);
  });

  it('closes a still-open shift at the given now only when throughNow is on', async () => {
    const open = [punch('p1', 'e1', '2026-07-22T15:00:00.000Z', 'clock_in')];

    const live = await loadPeriodLaborCost(makeLaborStubClient({ time_punches: open }), {
      ...base,
      startDay: '2026-07-22',
      endDay: '2026-07-22',
      employees: [hourly('e1')],
      throughNow: true,
      now: NOW, // 4 h after the clock-in
    });
    expect(live.dailyCosts[0]).toEqual(expect.objectContaining({ hourly_wages: 40, total_hours: 4 }));
    expect(live.totalCost).toBeCloseTo(40, 6);

    const matched = await loadPeriodLaborCost(makeLaborStubClient({ time_punches: open }), {
      ...base,
      startDay: '2026-07-22',
      endDay: '2026-07-22',
      employees: [hourly('e1')],
    });
    expect(matched.totalCost).toBe(0);
  });

  it('returns capped when the punch read hits the maxPages cap', async () => {
    let n = 0;
    const client = makeLaborStubClient({
      time_punches: () =>
        Array.from({ length: 1000 }, () => {
          n += 1;
          return punch(`p${String(n).padStart(6, '0')}`, 'ghost', '2026-07-22T12:00:00.000Z', 'clock_in');
        }),
    });
    const result = await loadPeriodLaborCost(client, {
      ...base,
      startDay: '2026-07-22',
      endDay: '2026-07-22',
      employees: [hourly('e1')],
    });
    expect(result.capped).toBe(true);
    expect(client.recordsFor('time_punches')).toHaveLength(20);
  });

  it.each([
    ['America/Chicago', CHICAGO],
    ['Pacific/Auckland', AUCKLAND],
  ])('gives one day of salary for one %s day on any host', async (_label, timeZone) => {
    const result = await loadPeriodLaborCost(makeLaborStubClient({}), {
      ...base,
      timeZone,
      startDay: '2026-07-22',
      endDay: '2026-07-22',
      employees: [salaried('s1')],
    });
    expect(result.dailyCosts).toEqual([
      expect.objectContaining({ date: '2026-07-22', salary_wages: 100, total_labor_cost: 100 }),
    ]);
    expect(result.totalCost).toBeCloseTo(100, 6);
    expect(result.wageCost).toBeCloseTo(100, 6);
    expect(result.breakdown.salary.cost).toBeCloseTo(100, 6);
  });

  it('gives the Auckland window as Auckland instants', async () => {
    const client = makeLaborStubClient({});
    await loadPeriodLaborCost(client, {
      ...base,
      timeZone: AUCKLAND,
      startDay: '2026-07-22',
      endDay: '2026-07-22',
      employees: [hourly('e1')],
    });
    const [punches] = client.recordsFor('time_punches');
    // Auckland is UTC+12 in July. Week Mon Jul 20 00:00 NZST to Sun Jul 26
    // 23:59:59.999 NZST.
    expect(filterValue(punches, 'gte', 'punch_time')).toBe('2026-07-19T12:00:00.000Z');
    expect(filterValue(punches, 'lte', 'punch_time')).toBe('2026-07-26T11:59:59.999Z');
  });
});

describe('loadPeriodBankLabor', () => {
  it('reads labor outflows and pending outflows by day strings and sums them by day', async () => {
    const labor = { account_subtype: 'labor' };
    const other = { account_subtype: 'utilities' };
    const client = makeLaborStubClient({
      bank_transactions: [
        { id: 'b1', restaurant_id: REST, transaction_date: '2026-07-22', amount: -100, status: 'posted', chart_of_accounts: labor },
        { id: 'b2', restaurant_id: REST, transaction_date: '2026-07-22', amount: -50, status: 'pending', chart_of_accounts: labor },
        { id: 'b3', restaurant_id: REST, transaction_date: '2026-07-22', amount: -999, status: 'posted', chart_of_accounts: other },
        { id: 'b4', restaurant_id: REST, transaction_date: '2026-07-23', amount: -10, status: 'posted', chart_of_accounts: labor },
      ],
      pending_outflows: [
        { id: 'o1', restaurant_id: REST, issue_date: '2026-07-23', amount: 25, status: 'pending', chart_account: labor },
        { id: 'o2', restaurant_id: REST, issue_date: '2026-07-23', amount: 25, status: 'stale_30', chart_account: null },
      ],
    });

    const result = await loadPeriodBankLabor(client, {
      restaurantId: REST,
      startDay: '2026-07-22',
      endDay: '2026-07-23',
    });

    expect(result.dailyCosts).toEqual([
      { date: '2026-07-22', labor_cost: 150, transaction_count: 2 },
      { date: '2026-07-23', labor_cost: 35, transaction_count: 2 },
    ]);
    expect(result.totalCost).toBe(185);
    expect(result.capped).toBe(false);

    const [bank] = client.recordsFor('bank_transactions');
    expect(filterValue(bank, 'gte', 'transaction_date')).toBe('2026-07-22');
    expect(filterValue(bank, 'lte', 'transaction_date')).toBe('2026-07-23');
    expect(filterValue(bank, 'in', 'status')).toEqual(['posted', 'pending']);
    expect(filterValue(bank, 'lt', 'amount')).toBe(0);
    expect(bank.orders).toEqual([['id', undefined]]);
    const [pending] = client.recordsFor('pending_outflows');
    expect(filterValue(pending, 'gte', 'issue_date')).toBe('2026-07-22');
    expect(filterValue(pending, 'lte', 'issue_date')).toBe('2026-07-23');
    expect(filterValue(pending, 'in', 'status')).toEqual(['pending', 'stale_30', 'stale_60', 'stale_90']);
  });

  it('reads all pages, not only the first 1000 rows', async () => {
    const rows = Array.from({ length: 1500 }, (_, i) => ({
      id: `b${String(i).padStart(5, '0')}`,
      restaurant_id: REST,
      transaction_date: '2026-07-22',
      amount: -1,
      status: 'posted',
      chart_of_accounts: { account_subtype: 'labor' },
    }));
    const client = makeLaborStubClient({ bank_transactions: rows });
    const result = await loadPeriodBankLabor(client, {
      restaurantId: REST,
      startDay: '2026-07-22',
      endDay: '2026-07-22',
    });
    expect(result.totalCost).toBe(1500);
    const pages = client.recordsFor('bank_transactions');
    expect(pages).toHaveLength(2);
    expect(pages[1].or).toBe(keysetAfterFilter('id', { key: 'b00999', id: 'b00999' }));
  });
});
