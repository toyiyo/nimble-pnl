import { describe, it, expect, vi, beforeEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const state = vi.hoisted(() => ({
  fromCalls: [] as { table: string; select: string; eqs: [string, unknown][] }[],
  rows: {} as Record<string, unknown[]>,
  caps: {} as Record<string, boolean>,
  laborGates: null as unknown,
}));

vi.mock('../../supabase/functions/_shared/schedulingContextLabor.ts', () => ({
  loadLaborSection: vi.fn(async (_s: unknown, _r: unknown, _p: unknown, gates: unknown) => {
    state.laborGates = gates;
    return { scheduled_labor: { hidden: true, reason: 'needs view:pay_rates' } };
  }),
}));

import {
  runGetSchedulingContext,
  restaurantWeek,
} from '../../supabase/functions/_shared/schedulingContextTool';
import { isCapabilityGatedTool } from '../../supabase/functions/_shared/tools-registry';

function makeSupabase() {
  return {
    rpc: vi.fn(async (name: string, args: Record<string, string>) => {
      if (name === 'user_has_capability') {
        return { data: state.caps[args.p_capability] ?? false, error: null };
      }
      return { data: [], error: null };
    }),
    from: vi.fn((table: string) => {
      const call = { table, select: '', eqs: [] as [string, unknown][] };
      state.fromCalls.push(call);
      const result = () => ({ data: state.rows[table] ?? [], error: null });
      const chain: any = {
        select: (s: string) => ((call.select = s), chain),
        eq: (c: string, v: unknown) => (call.eqs.push([c, v]), chain),
        in: () => chain,
        gte: () => chain,
        lte: () => chain,
        lt: () => chain,
        gt: () => chain,
        neq: () => chain,
        order: () => chain,
        limit: () => chain,
        maybeSingle: async () => ({ data: (state.rows[table] ?? [])[0] ?? null, error: null }),
        then: (res: (v: unknown) => unknown) => Promise.resolve(result()).then(res),
      };
      return chain;
    }),
  };
}

const NOW = new Date('2026-10-14T15:00:00Z'); // Wednesday
const TZ = 'America/Chicago';

beforeEach(() => {
  state.fromCalls = [];
  state.rows = {};
  state.caps = { 'edit:scheduling': true, 'view:pay_rates': true, 'view:pos_sales': true };
  state.laborGates = null;
});

describe('restaurantWeek', () => {
  it('returns Monday to Sunday in the restaurant zone', () => {
    expect(restaurantWeek(NOW, TZ)).toEqual({ start: '2026-10-12', end: '2026-10-18' });
  });
  it('uses the restaurant date, not the UTC date', () => {
    // Monday 01:00 UTC is still Sunday evening in Chicago.
    expect(restaurantWeek(new Date('2026-10-12T01:00:00Z'), TZ)).toEqual({
      start: '2026-10-05',
      end: '2026-10-11',
    });
  });
});

describe('runGetSchedulingContext arguments', () => {
  it('defaults to the current restaurant week', async () => {
    const r = await runGetSchedulingContext({}, 'r1', makeSupabase(), TZ, NOW);
    expect(r.ok).toBe(true);
    expect(r.data.period).toMatchObject({ start: '2026-10-12', end: '2026-10-18' });
  });

  it('rejects a 32-day period', async () => {
    const r = await runGetSchedulingContext(
      { start_date: '2026-10-01', end_date: '2026-11-01' }, 'r1', makeSupabase(), TZ, NOW);
    expect(r).toMatchObject({ ok: false, error: { code: 'INVALID_ARGUMENTS' } });
  });

  it('accepts a 31-day period', async () => {
    const r = await runGetSchedulingContext(
      { start_date: '2026-10-01', end_date: '2026-10-31' }, 'r1', makeSupabase(), TZ, NOW);
    expect(r.ok).toBe(true);
  });

  it('rejects end_date before start_date', async () => {
    const r = await runGetSchedulingContext(
      { start_date: '2026-10-10', end_date: '2026-10-09' }, 'r1', makeSupabase(), TZ, NOW);
    expect(r).toMatchObject({ ok: false, error: { code: 'INVALID_ARGUMENTS' } });
  });

  it('rejects a malformed date', async () => {
    const r = await runGetSchedulingContext(
      { start_date: 'tomorrow' }, 'r1', makeSupabase(), TZ, NOW);
    expect(r).toMatchObject({ ok: false, error: { code: 'INVALID_ARGUMENTS' } });
  });
});

describe('runGetSchedulingContext gates and queries', () => {
  it('does not query trades or claims without edit:scheduling', async () => {
    state.caps['edit:scheduling'] = false;
    const r = await runGetSchedulingContext({}, 'r1', makeSupabase(), TZ, NOW);
    const tables = state.fromCalls.map((c) => c.table);
    expect(tables).not.toContain('shift_trades');
    expect(tables).not.toContain('open_shift_claims');
    expect(r.data.pending.trades).toMatchObject({ hidden: true });
    expect(r.data.pending.claims).toMatchObject({ hidden: true });
  });

  it('queries trades and claims with edit:scheduling', async () => {
    await runGetSchedulingContext({}, 'r1', makeSupabase(), TZ, NOW);
    const tables = state.fromCalls.map((c) => c.table);
    expect(tables).toContain('shift_trades');
    expect(tables).toContain('open_shift_claims');
  });

  it('passes the pay and sales gates to the labor loader', async () => {
    state.caps['view:pos_sales'] = false;
    await runGetSchedulingContext({}, 'r1', makeSupabase(), TZ, NOW);
    expect(state.laborGates).toEqual({ payRates: true, posSales: false });
  });

  it('scopes every query by restaurant_id and never selects *', async () => {
    await runGetSchedulingContext({}, 'r1', makeSupabase(), TZ, NOW);
    expect(state.fromCalls.length).toBeGreaterThan(5);
    for (const c of state.fromCalls) {
      expect(c.eqs).toContainEqual(['restaurant_id', 'r1']);
      expect(c.select).not.toBe('');
      expect(c.select).not.toContain('*');
    }
  });
});

describe('runGetSchedulingContext size', () => {
  it('stays below 40,000 chars for 40 employees', async () => {
    const employees = Array.from({ length: 40 }, (_, i) => ({
      id: `e${i}`, name: `Employee ${i}`, position: 'Server', area: 'FOH',
      employment_type: 'part_time', status: 'active', is_active: true, is_minor: false, date_of_birth: null,
    }));
    const shifts = employees.flatMap((e) =>
      [12, 13, 14, 15, 16].map((d) => ({
        id: `${e.id}-${d}`, employee_id: e.id,
        start_time: `2026-10-${d}T15:00:00Z`, end_time: `2026-10-${d}T23:00:00Z`,
        break_duration: 30, status: 'scheduled', position: 'Server', is_published: false, shift_template_id: null,
      })));
    state.rows = { employees, shifts };
    const r = await runGetSchedulingContext({}, 'r1', makeSupabase(), TZ, NOW);
    expect(JSON.stringify(r.data).length).toBeLessThan(40_000);
  });
});

describe('registry and dispatcher wiring', () => {
  it('lists get_scheduling_context as capability gated', () => {
    expect(isCapabilityGatedTool('get_scheduling_context')).toBe(true);
  });
  const root = resolve(__dirname, '../..');
  const src = readFileSync(resolve(root, 'supabase/functions/ai-execute-tool/index.ts'), 'utf8');
  it('dispatches get_scheduling_context', () => {
    expect(src).toMatch(/case 'get_scheduling_context':/);
    expect(src).toMatch(/runGetSchedulingContext\(args, restaurant_id, supabase, restaurantTimeZone, restaurantNow\)/);
  });
});
