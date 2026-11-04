import { describe, it, expect } from 'vitest';

import { mapHourlySalesPattern } from '@/hooks/useWeekStaffingSuggestions';

describe('mapHourlySalesPattern', () => {
  it('maps each day in days[] to its hourly data, keyed by day_of_week', () => {
    const result = {
      days: [
        {
          day_of_week: 1,
          has_hourly_breakdown: true,
          slots: [
            { start_minute: 540, sales: 100, sample_count: 3 },
            { start_minute: 600, sales: 150, sample_count: 3 },
          ],
        },
        {
          day_of_week: 3,
          has_hourly_breakdown: false,
          slots: [
            { start_minute: 540, sales: 50, sample_count: 2 },
          ],
        },
      ],
    };

    const mapped = mapHourlySalesPattern(result);

    expect(mapped.get(1)).toEqual({
      hasHourlyBreakdown: true,
      data: [
        { hour: 9, avgSales: 100, sampleCount: 3 },
        { hour: 10, avgSales: 150, sampleCount: 3 },
      ],
    });
    expect(mapped.get(3)).toEqual({
      hasHourlyBreakdown: false,
      data: [{ hour: 9, avgSales: 50, sampleCount: 2 }],
    });
  });

  it('maps a weekday absent from days[] to an empty, non-hourly entry', () => {
    const result = { days: [{ day_of_week: 2, has_hourly_breakdown: true, slots: [] }] };

    const mapped = mapHourlySalesPattern(result);

    // day_of_week 2 is the only key present -- every other weekday (0-6)
    // falls back to the empty entry, so the caller never has to guard a
    // missing Map key with its own default.
    expect(mapped.get(0)).toEqual({ data: [], hasHourlyBreakdown: false });
    expect(mapped.get(5)).toEqual({ data: [], hasHourlyBreakdown: false });
    expect(mapped.get(2)).toEqual({ data: [], hasHourlyBreakdown: true });
  });

  it('handles an empty or missing days array by falling back every weekday', () => {
    for (const input of [{ days: [] }, {}, null]) {
      const mapped = mapHourlySalesPattern(input);
      expect(mapped.size).toBe(7);
      for (let dow = 0; dow <= 6; dow++) {
        expect(mapped.get(dow)).toEqual({ data: [], hasHourlyBreakdown: false });
      }
    }
  });
});
