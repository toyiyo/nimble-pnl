import { describe, it, expect, vi, beforeEach } from 'vitest';

const calls = vi.hoisted(() => ({ laborCost: 0, employees: 0 }));
const fixtures = vi.hoisted(() => ({
  cost: {
    dailyCosts: [] as { date: string; total_labor_cost: number }[],
    totalCost: 0,
    breakdown: { hourly: { cost: 0, hours: 0 } },
    capped: false,
  },
  employees: [] as Record<string, unknown>[],
}));

vi.mock('../../supabase/functions/_shared/labor/scheduledLaborCost.ts', () => ({
  loadScheduledLaborCost: vi.fn(async () => {
    calls.laborCost += 1;
    return fixtures.cost;
  }),
}));
vi.mock('../../supabase/functions/_shared/labor/loaderQuery.ts', () => ({
  fetchLaborEmployees: vi.fn(async () => {
    calls.employees += 1;
    return { rows: fixtures.employees, capped: false };
  }),
}));

import { loadLaborSection } from '../../supabase/functions/_shared/schedulingContextLabor';
import { calculateLaborBudget } from '../../supabase/functions/_shared/labor/laborBudget';
import { recommendForSlots } from '../../supabase/functions/_shared/hourlyStaffing';

const period = { start: '2026-10-05', end: '2026-10-11', today: '2026-10-07', tz: 'America/Chicago' };
const settings = {
  target_splh: 60,
  min_staff: 1,
  min_crew: null,
  lookback_weeks: 4,
  target_labor_pct: 25,
};

interface Mock {
  rpcs: string[];
  tables: string[];
  supabase: any;
}

function makeSupabase(opts: { costRows?: unknown[]; failRpc?: string } = {}): Mock {
  const rpcs: string[] = [];
  const tables: string[] = [];
  const supabase = {
    rpc: async (name: string, args: Record<string, unknown>) => {
      rpcs.push(name);
      if (name === opts.failRpc) return { data: null, error: { message: 'boom' } };
      if (name === 'get_hourly_sales_pattern') {
        if (args.p_view === 'by_date') {
          return {
            data: { days: [{ date: '2026-09-23', day_total: 1000 }, { date: '2026-09-30', day_total: 2000 }] },
            error: null,
          };
        }
        return {
          data: {
            total_sales: 600,
            days: [
              {
                day_of_week: 3,
                has_hourly_breakdown: true,
                slots: [
                  { start_minute: 720, sales: 300, sample_count: 4 },
                  { start_minute: 780, sales: 0, sample_count: 4 },
                ],
              },
            ],
          },
          error: null,
        };
      }
      if (name === 'get_daily_sales_totals') {
        return { data: [{ sale_date: '2026-10-06', total_revenue: 1400, transaction_count: 10 }], error: null };
      }
      return { data: null, error: null };
    },
    from: (table: string) => {
      tables.push(table);
      const result = { data: table === 'restaurant_operating_costs' ? (opts.costRows ?? []) : [], error: null };
      const chain: any = new Proxy(
        {},
        {
          get: (_t, prop) => {
            if (prop === 'then') return (res: (v: unknown) => unknown) => Promise.resolve(result).then(res);
            return () => chain;
          },
        },
      );
      return chain;
    },
  };
  return { rpcs, tables, supabase };
}

const laborRow = (extra: Record<string, unknown> = {}) => ({
  id: 'c1',
  restaurant_id: 'r1',
  cost_type: 'fixed',
  category: 'labor',
  name: 'Labor',
  entry_type: 'percentage',
  monthly_value: 0,
  percentage_value: 0.3,
  is_auto_calculated: false,
  manual_override: false,
  averaging_months: 3,
  display_order: 0,
  is_active: true,
  created_at: '2026-01-01',
  updated_at: '2026-01-01',
  ...extra,
});

const isHidden = (v: any) => v && v.hidden === true;
const isUnavailable = (v: any) => v && v.unavailable === true;

beforeEach(() => {
  calls.laborCost = 0;
  calls.employees = 0;
  fixtures.cost = {
    dailyCosts: [{ date: '2026-10-05', total_labor_cost: 200 }],
    totalCost: 500,
    breakdown: { hourly: { cost: 400, hours: 20 } },
    capped: false,
  };
  fixtures.employees = [
    { id: 'e1', compensation_type: 'hourly', is_active: true, hourly_rate: 2000 },
  ];
});

describe('loadLaborSection gates', () => {
  it('posSales false: no sales RPC, sales items hidden', async () => {
    const m = makeSupabase({ costRows: [laborRow()] });
    const out: any = await loadLaborSection(m.supabase, 'r1', period, { payRates: true, posSales: false }, settings);
    expect(m.rpcs).not.toContain('get_hourly_sales_pattern');
    expect(m.rpcs).not.toContain('get_daily_sales_totals');
    expect(isHidden(out.daily_labor_percent)).toBe(true);
    expect(isHidden(out.staffing_suggestions)).toBe(true);
    expect(isHidden(out.labor_budget)).toBe(true);
    expect(isHidden(out.scheduled_labor)).toBe(false);
    expect(out.scheduled_labor.total).toBe(500);
  });

  it('posSales false: a fixed labor budget still loads', async () => {
    const m = makeSupabase({ costRows: [laborRow({ entry_type: 'value', monthly_value: 300000 })] });
    const out: any = await loadLaborSection(m.supabase, 'r1', period, { payRates: true, posSales: false }, settings);
    expect(m.rpcs).toHaveLength(0);
    expect(out.labor_budget.has_budget).toBe(true);
    expect(out.labor_budget.source).toBe('fixed');
  });

  it('payRates false: no pay load, pay items hidden, headcount present', async () => {
    const m = makeSupabase({ costRows: [laborRow()] });
    const out: any = await loadLaborSection(m.supabase, 'r1', period, { payRates: false, posSales: true }, settings);
    expect(calls.laborCost).toBe(0);
    expect(calls.employees).toBe(0);
    expect(m.tables).not.toContain('restaurant_operating_costs');
    expect(isHidden(out.scheduled_labor)).toBe(true);
    expect(isHidden(out.daily_labor_percent)).toBe(true);
    expect(isHidden(out.labor_budget)).toBe(true);
    expect(isHidden(out.staffing_suggestions.labor)).toBe(true);
    expect(out.staffing_suggestions.hours.length).toBeGreaterThan(0);
  });

  it('both true: values equal the shared rule outputs', async () => {
    const costRows = [laborRow()];
    const m = makeSupabase({ costRows });
    const out: any = await loadLaborSection(m.supabase, 'r1', period, { payRates: true, posSales: true }, settings);
    expect(out.scheduled_labor).toMatchObject({ total: 500, hidden_cost_count: 0, is_average_high: false });
    const expectedHours = recommendForSlots(
      [{ startMinute: 720 }],
      [{ hour: 12, avgSales: 300 }],
      { targetSplh: 60, minStaff: 1, minCrew: null },
    );
    const noon = out.staffing_suggestions.hours.find((h: any) => h.hour === 12);
    expect(noon.recommended_staff).toBe(expectedHours[0].recommendedStaff);
    expect(out.staffing_suggestions.hours.find((h: any) => h.hour === 13)).toBeUndefined();
    expect(out.staffing_suggestions.labor.avg_hourly_rate).toBe(20);
    expect(out.staffing_suggestions.labor.has_wage_data).toBe(true);
    // Oct 5 is a Monday. No Monday history exists, so projected sales are 0.
    const monday = out.daily_labor_percent.days.find((d: any) => d.date === '2026-10-05');
    expect(monday.percent).toBeNull();
    // Wednesdays 09-23 and 09-30 average 1500.
    expect(out.daily_labor_percent.days.find((d: any) => d.date === '2026-10-07').projected_sales).toBe(1500);
    const expectedBudget = calculateLaborBudget(500, [], null);
    expect(expectedBudget.hasBudget).toBe(false);
    expect(out.labor_budget.has_budget).toBe(true);
    expect(out.labor_budget.source).toBe('sales');
  });

  it('settings null: percent and suggestions are unavailable', async () => {
    const m = makeSupabase();
    const out: any = await loadLaborSection(m.supabase, 'r1', period, { payRates: true, posSales: true }, null);
    expect(out.daily_labor_percent).toEqual({ unavailable: true, reason: 'no staffing settings' });
    expect(out.staffing_suggestions).toEqual({ unavailable: true, reason: 'no staffing settings' });
    expect(out.scheduled_labor.total).toBe(500);
  });

  it('a sales RPC error makes only that item unavailable', async () => {
    const m = makeSupabase({ failRpc: 'get_hourly_sales_pattern' });
    const out: any = await loadLaborSection(m.supabase, 'r1', period, { payRates: true, posSales: true }, settings);
    expect(isUnavailable(out.daily_labor_percent)).toBe(true);
    expect(isUnavailable(out.staffing_suggestions)).toBe(true);
    expect(out.scheduled_labor.total).toBe(500);
  });

  it('has_wage_data false: the rate note names the 1500-cent default', async () => {
    fixtures.employees = [];
    const m = makeSupabase();
    const out: any = await loadLaborSection(m.supabase, 'r1', period, { payRates: true, posSales: true }, settings);
    expect(out.staffing_suggestions.labor.has_wage_data).toBe(false);
    expect(out.staffing_suggestions.labor.rate_note).toContain('1500-cent default');
  });
});
