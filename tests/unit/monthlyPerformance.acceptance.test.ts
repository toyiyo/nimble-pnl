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

    const labor = calculateActualLaborCostForMonth({
      employees: employees as never,
      timePunches: timePunches as never,
      tipsOwedByEmployee,
      monthStart: new Date('2026-04-01T00:00:00'),
      monthEnd: new Date('2026-04-30T23:59:59'),
    });

    expect(labor.tipsOwedCents).toBe(0);
    // Pinned 2026-05-02 from canonical OT-D Hybrid pipeline against Russo's April fixture.
    expect(labor.wagesCents).toBe(1_282_985);
    expect(labor.actualLaborCents).toBe(1_282_985);
  });
});
