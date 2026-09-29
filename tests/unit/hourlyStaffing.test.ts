import { describe, expect, it } from 'vitest';
import {
  minStaffFromCrew,
  recommendForSlots,
  recommendStaffForHour,
  type HourlySlotSales,
  type MinCrew,
} from '../../supabase/functions/_shared/hourlyStaffing';
import {
  buildHourlyRecommendations,
  computeMinStaffFromCrew,
} from '../../src/lib/staffingCalculator';
import type { HourlySalesData } from '../../src/types/scheduling';

// Parity test (plan Phase 4 task-3): `hourlyStaffing.ts` (the edge-function
// helper) must produce the same numbers as `staffingCalculator.ts` (the
// client). The two cannot share an import (Deno vs. Vite `src/` alias), so
// this test is the only thing stopping them from drifting.

const SALES_GRID = [0, -5, -0.5, 12.5, 100.33];
const SPLH_GRID = [0, null, 60];
const MIN_CREW_GRID: (MinCrew | null)[] = [null, {}, { server: 2, cook: 1 }];
const MIN_STAFF = 2;
const AVG_HOURLY_RATE_CENTS = 1500;
const TARGET_LABOR_PCT = 30;

describe('minStaffFromCrew parity with computeMinStaffFromCrew', () => {
  it.each(MIN_CREW_GRID)('matches for min_crew=%j', (minCrew) => {
    expect(minStaffFromCrew(minCrew, MIN_STAFF)).toBe(computeMinStaffFromCrew(minCrew, MIN_STAFF));
  });
});

describe('recommendStaffForHour parity with buildHourlyRecommendations', () => {
  for (const sales of SALES_GRID) {
    for (const splh of SPLH_GRID) {
      for (const minCrew of MIN_CREW_GRID) {
        it(`matches for sales=${sales}, target_splh=${splh}, min_crew=${JSON.stringify(minCrew)}`, () => {
          const targetSplh = splh ?? 0;
          const effectiveMinStaff = minStaffFromCrew(minCrew, MIN_STAFF);

          const actual = recommendStaffForHour(sales, targetSplh, effectiveMinStaff);

          const hourlySales: HourlySalesData[] = [{ hour: 12, avgSales: sales, sampleCount: 1 }];
          const [expected] = buildHourlyRecommendations(hourlySales, {
            targetSplh,
            minStaff: computeMinStaffFromCrew(minCrew, MIN_STAFF),
            avgHourlyRateCents: AVG_HOURLY_RATE_CENTS,
            targetLaborPct: TARGET_LABOR_PCT,
          });

          expect(actual).toBe(expected.recommendedStaff);
        });
      }
    }
  }
});

describe('recommendForSlots', () => {
  it('gives each sub-hour slot the recommendation of the hour that contains it', () => {
    const hourly: HourlySlotSales[] = [
      { hour: 11, avgSales: 100 },
      { hour: 12, avgSales: 400 },
    ];
    const slots = [
      { startMinute: 11 * 60 },
      { startMinute: 11 * 60 + 30 },
      { startMinute: 12 * 60 },
      { startMinute: 12 * 60 + 30 },
    ];
    const settings = { targetSplh: 60, minStaff: 1, minCrew: null };

    const result = recommendForSlots(slots, hourly, settings);

    expect(result).toEqual([
      { startMinute: 660, hour: 11, recommendedStaff: recommendStaffForHour(100, 60, 1) },
      { startMinute: 690, hour: 11, recommendedStaff: recommendStaffForHour(100, 60, 1) },
      { startMinute: 720, hour: 12, recommendedStaff: recommendStaffForHour(400, 60, 1) },
      { startMinute: 750, hour: 12, recommendedStaff: recommendStaffForHour(400, 60, 1) },
    ]);
  });

  it('uses min_staff, and 0 sales, for an hour with no matching hourly entry', () => {
    const result = recommendForSlots([{ startMinute: 540 }], [], {
      targetSplh: 60,
      minStaff: 3,
      minCrew: null,
    });

    expect(result).toEqual([{ startMinute: 540, hour: 9, recommendedStaff: 3 }]);
  });
});
