// Pin TZ=UTC for this file before any imports execute. The labor wages
// assertion below is ISO-week-bucketed, and `calculateActualLaborCostForMonth`
// uses `date-fns` `startOfWeek`, which reads `process.env.TZ`. Other test files
// (e.g. `cogsCalculations.tz.test.ts`, `useMonthlyExpenses.tz.test.ts`) pin
// `TZ=America/Chicago` to exercise TZ-shift bugs. Without this guard, the env
// mutation bleeds into this worker and shifts the OT-D Hybrid week boundary.
process.env.TZ = 'UTC';

import { describe, it, expect, vi } from 'vitest';
import { fetchMonthRevenueTotals } from '@/hooks/useMonthlyMetrics';
import { calculateActualLaborCostForMonth } from '@/services/laborCalculations';
import revenueByAccount from '../fixtures/russos-2026-04/revenue_by_account.json';
import passThroughTotals from '../fixtures/russos-2026-04/pass_through_totals.json';
import tipSplits from '../fixtures/russos-2026-04/tip_splits.json';
import timePunches from '../fixtures/russos-2026-04/time_punches.json';
import employees from '../fixtures/russos-2026-04/employees.json';

// Acceptance fixture: Russo's Pizzeria April 2026.
// Snapshot of post-Migration-A and post-Migration-B production state. See
// tests/fixtures/russos-2026-04/README.md for provenance.
describe("Monthly Performance acceptance — Russo's April 2026", () => {
  it('produces the canonical revenue totals per spec', async () => {
    const supabaseMock = {
      rpc: vi.fn((name: string) => {
        if (name === 'get_revenue_by_account') {
          return Promise.resolve({ data: revenueByAccount, error: null });
        }
        if (name === 'get_pass_through_totals') {
          return Promise.resolve({ data: passThroughTotals, error: null });
        }
        if (name === 'get_unified_sales_totals') {
          // Russo's April 2026 had no void/discount offset rows in unified_sales,
          // so SUM(total_price) equals the legacy `gross + tax + tips + other`
          // formula ($92,274.48). May 2026 is where the two formulas diverge.
          return Promise.resolve({
            data: [{
              total_count: 0,
              revenue: 75917.82,
              discounts: 1477.40,
              pass_through_amount: 7012.66,
              unique_items: 0,
              collected_at_pos: 92274.48,
            }],
            error: null,
          });
        }
        return Promise.resolve({ data: [], error: null });
      }),
    };

    const totals = await fetchMonthRevenueTotals(
      supabaseMock as never,
      'adbd9392-928a-4a46-80d7-f7e453aa1956',
      '2026-04-01',
      '2026-04-30'
    );

    expect(totals.grossRevenueCents).toBe(7_591_782); // $75,917.82
    expect(totals.discountsCents).toBe(147_740); // $1,477.40
    expect(totals.netRevenueCents).toBe(7_444_042); // $74,440.42
    expect(totals.salesTaxCents).toBe(597_488); // $5,974.88
    expect(totals.tipsCents).toBe(1_038_178); // $10,381.78
    expect(totals.otherLiabilitiesCents).toBe(0);
    expect(totals.posCollectedCents).toBe(9_227_448); // $92,274.48
  });

  it('produces the canonical labor totals per spec', () => {
    const tipsOwedByEmployee = new Map<string, number>();
    for (const row of tipSplits as Array<{ employee_id: string; amount: number }>) {
      tipsOwedByEmployee.set(
        row.employee_id,
        (tipsOwedByEmployee.get(row.employee_id) ?? 0) + row.amount
      );
    }

    // Anchor month bounds in UTC so ISO-week bucketing is deterministic across
    // TZs. calculateActualLaborCostForMonth uses date-fns startOfWeek which
    // reads the host process timezone; pinning UTC matches CI/server runtime.
    const labor = calculateActualLaborCostForMonth({
      employees: employees as never,
      timePunches: timePunches as never,
      tipsOwedByEmployee,
      monthStart: new Date(Date.UTC(2026, 3, 1, 0, 0, 0)),
      monthEnd: new Date(Date.UTC(2026, 3, 30, 23, 59, 59)),
    });

    expect(labor.tipsOwedCents).toBe(0);
    // 1_282_985 (was 1_058_390). The old pin was the BUGGY value: overnight
    // shifts that cross an ISO-week boundary were bucketed per-punch, splitting
    // each shift's clock-in and clock-out into different weeks so parseWorkPeriods
    // dropped it — understating Russo's April labor by $2,245.95 (~22.7h). This
    // fix buckets by the shift's clock-in week and attributes by clock-in day,
    // recovering those hours. It also makes the total TIMEZONE-INVARIANT
    // (verified identical under TZ=UTC, America/Chicago, America/Los_Angeles),
    // resolving the TZ-dependent week-boundary swing documented in memory/
    // lessons.md PR #485 (which is exactly the PT↔UTC 1_282_985↔1_058_390 gap).
    expect(labor.wagesCents).toBe(1_282_985);
    expect(labor.actualLaborCents).toBe(1_282_985);
  });
});
