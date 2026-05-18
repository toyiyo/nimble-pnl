import { describe, it, expect } from 'vitest';
import {
  computeRequiredStaff,
  type ComputeInput,
} from '../../supabase/functions/_shared/staffing-requirements';

function makeInput(overrides: Partial<ComputeInput> = {}): ComputeInput {
  return {
    templates: [
      {
        id: 'tpl-server',
        name: 'Lunch Server',
        days: [1, 2, 3, 4, 5],
        start_time: '11:00:00',
        end_time: '16:00:00',
        position: 'server',
        area: null,
      },
    ],
    minCrew: null,
    minStaff: null,
    priorPatterns: [],
    hourlySales: [],
    ...overrides,
  };
}

describe('computeRequiredStaff', () => {
  it('returns 1 per (template, day) when nothing else is configured', () => {
    const result = computeRequiredStaff(makeInput());
    const map = result.get('tpl-server');
    expect(map).toBeDefined();
    for (const day of [1, 2, 3, 4, 5]) {
      expect(map!.get(day)).toBe(1);
    }
    expect(map!.has(0)).toBe(false); // Sunday is not in template.days
    expect(map!.has(6)).toBe(false);
  });

  it('uses minCrew[position] when provided', () => {
    const result = computeRequiredStaff(
      makeInput({ minCrew: { Server: 3 } }),
    );
    expect(result.get('tpl-server')!.get(1)).toBe(3);
  });

  it('normalizes minCrew keys (case + plural) when matching template positions', () => {
    const result = computeRequiredStaff(
      makeInput({
        minCrew: { Servers: 2 }, // plural; template position is "server"
      }),
    );
    expect(result.get('tpl-server')!.get(1)).toBe(2);
  });

  it('falls back to priorPatterns[day][position] when no minCrew', () => {
    const result = computeRequiredStaff(
      makeInput({
        priorPatterns: [{ day_of_week: 1, position: 'server', avg_count: 4 }],
      }),
    );
    // priorPatterns are floats; rounded to nearest int, min 1
    expect(result.get('tpl-server')!.get(1)).toBe(4);
    // No pattern for day 2 → falls back to 1
    expect(result.get('tpl-server')!.get(2)).toBe(1);
  });

  it('floor of minStaff applies as a global minimum', () => {
    const result = computeRequiredStaff(
      makeInput({
        minCrew: { server: 1 },
        minStaff: 2,
      }),
    );
    expect(result.get('tpl-server')!.get(1)).toBe(2);
  });

  it('adds +1 peak boost when template start hour is in top-quartile sales for that day', () => {
    const result = computeRequiredStaff(
      makeInput({
        hourlySales: [
          { day_of_week: 1, hour: 9, avg_sales: 100 },
          { day_of_week: 1, hour: 10, avg_sales: 200 },
          { day_of_week: 1, hour: 11, avg_sales: 1000 }, // template starts here
          { day_of_week: 1, hour: 12, avg_sales: 300 },
        ],
      }),
    );
    // base=1, peakBoost=+1 because hour 11 has top sales for day 1
    expect(result.get('tpl-server')!.get(1)).toBe(2);
  });

  it('does not add peak boost on days without hourlySales data', () => {
    const result = computeRequiredStaff(
      makeInput({
        hourlySales: [{ day_of_week: 1, hour: 11, avg_sales: 1000 }],
      }),
    );
    expect(result.get('tpl-server')!.get(1)).toBe(2); // peak on Mon
    expect(result.get('tpl-server')!.get(2)).toBe(1); // no data Tue
  });
});
