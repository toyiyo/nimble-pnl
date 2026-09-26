/**
 * Each shared labor loader checks startDay / endDay against YYYY-MM-DD at
 * its entry, and throws a clear error before any read.
 */
import { describe, it, expect } from 'vitest';

import { loadPeriodBankLabor, loadPeriodLaborCost } from '../../supabase/functions/_shared/labor/periodLaborCost';
import { loadPeriodLaborBasis } from '../../supabase/functions/_shared/labor/periodLaborBasis';
import { loadPayrollPeriod } from '../../supabase/functions/_shared/labor/payrollPeriod';
import { loadScheduledLaborCost } from '../../supabase/functions/_shared/labor/scheduledLaborCost';
import { makeLaborStubClient } from './helpers/laborStubClient';

const base = { restaurantId: 'rest-1', timeZone: 'America/Chicago' };
const period = { ...base, employees: [], throughNow: false, now: new Date('2026-03-10T12:00:00Z') };

const cases: Array<[string, (client: ReturnType<typeof makeLaborStubClient>, startDay: string, endDay: string) => Promise<unknown>]> = [
  ['loadPeriodLaborCost', (c, startDay, endDay) => loadPeriodLaborCost(c, { ...period, startDay, endDay })],
  ['loadPeriodBankLabor', (c, startDay, endDay) => loadPeriodBankLabor(c, { restaurantId: 'rest-1', startDay, endDay })],
  ['loadPeriodLaborBasis', (c, startDay, endDay) => loadPeriodLaborBasis(c, { ...period, startDay, endDay })],
  ['loadPayrollPeriod', (c, startDay, endDay) => loadPayrollPeriod(c, { ...base, employees: [], startDay, endDay })],
  ['loadScheduledLaborCost', (c, startDay, endDay) => loadScheduledLaborCost(c, { ...base, startDay, endDay })],
];

describe('labor loader day check', () => {
  it.each(cases)('%s throws on a malformed startDay before any read', async (name, run) => {
    const client = makeLaborStubClient({});
    await expect(run(client, '2026-3-1', '2026-03-07')).rejects.toThrow(
      new RegExp(`${name}: startDay must be a calendar day \\(YYYY-MM-DD\\)`),
    );
    expect(client.records).toHaveLength(0);
  });

  it.each(cases)('%s throws on a malformed endDay before any read', async (name, run) => {
    const client = makeLaborStubClient({});
    await expect(run(client, '2026-03-01', '2026-03-07T23:59:59Z')).rejects.toThrow(
      new RegExp(`${name}: endDay must be a calendar day \\(YYYY-MM-DD\\)`),
    );
    expect(client.records).toHaveLength(0);
  });

  it.each(cases)('%s throws on a day that is not in the calendar before any read', async (name, run) => {
    const client = makeLaborStubClient({});
    await expect(run(client, '2026-02-30', '2026-03-07')).rejects.toThrow(
      new RegExp(`${name}: startDay must be a calendar day \\(YYYY-MM-DD\\)`),
    );
    await expect(run(client, '2026-03-01', '2026-13-01')).rejects.toThrow(
      new RegExp(`${name}: endDay must be a calendar day \\(YYYY-MM-DD\\)`),
    );
    expect(client.records).toHaveLength(0);
  });

  it.each(cases)('%s throws when startDay is after endDay before any read', async (name, run) => {
    const client = makeLaborStubClient({});
    await expect(run(client, '2026-03-08', '2026-03-07')).rejects.toThrow(
      new RegExp(`${name}: startDay 2026-03-08 is after endDay 2026-03-07`),
    );
    expect(client.records).toHaveLength(0);
  });

  it.each(cases)('%s accepts a one-day range and Feb 29 of a leap year', async (_name, run) => {
    const client = makeLaborStubClient({});
    await expect(run(client, '2028-02-29', '2028-02-29')).resolves.toBeDefined();
  });
});
