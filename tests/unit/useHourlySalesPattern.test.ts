import { describe, it, expect } from 'vitest';
import { aggregateHourlySales } from '@/hooks/useHourlySalesPattern';

describe('aggregateHourlySales — sold_at (tz-aware)', () => {
  it('buckets by sold_at local hour when sold_at is present', () => {
    // 2026-05-30T01:30:00Z == 2026-05-29 20:30 America/Chicago (CDT, UTC-5) → hour 20
    const rows = [
      {
        sale_date: '2026-05-29',
        sale_time: '23:15:00',
        sold_at: '2026-05-30T01:30:00.000Z',
        total_price: 100,
      },
    ];
    const { data, hasHourlyBreakdown } = aggregateHourlySales(rows, 'America/Chicago');
    expect(hasHourlyBreakdown).toBe(true);
    expect(data).toHaveLength(1);
    expect(data[0].hour).toBe(20); // from sold_at, NOT 23 from sale_time
  });

  it('falls back to sale_time hour when sold_at is null', () => {
    const rows = [
      {
        sale_date: '2026-05-29',
        sale_time: '14:00:00',
        sold_at: null,
        total_price: 50,
      },
    ];
    const { data, hasHourlyBreakdown } = aggregateHourlySales(rows, 'America/Chicago');
    expect(hasHourlyBreakdown).toBe(true);
    expect(data).toHaveLength(1);
    expect(data[0].hour).toBe(14); // fallback to sale_time
  });

  it('handles DST boundary correctly — clocks spring forward Mar 8 2026 at 2:00 AM', () => {
    // 2026-03-08T07:45:00Z == 2026-03-08 01:45 CST (UTC-6, before spring-forward at 2AM)
    // The DST transition occurs at 2:00 AM CST = 08:00 UTC
    // So 07:45Z is still 01:45 CST (hour 1)
    const rowsBefore = [
      {
        sale_date: '2026-03-08',
        sale_time: '01:45:00',
        sold_at: '2026-03-08T07:45:00.000Z',
        total_price: 25,
      },
    ];
    const { data: dataBefore } = aggregateHourlySales(rowsBefore, 'America/Chicago');
    expect(dataBefore[0].hour).toBe(1); // 07:45Z = 01:45 CST

    // 2026-03-08T08:30:00Z == 2026-03-08 03:30 CDT (UTC-5, after spring-forward; 2AM became 3AM)
    const rowsAfter = [
      {
        sale_date: '2026-03-08',
        sale_time: '03:30:00',
        sold_at: '2026-03-08T08:30:00.000Z',
        total_price: 40,
      },
    ];
    const { data: dataAfter } = aggregateHourlySales(rowsAfter, 'America/Chicago');
    expect(dataAfter[0].hour).toBe(3); // 08:30Z = 03:30 CDT
  });

  it('mixes sold_at rows and null-sold_at rows correctly', () => {
    // Toast row with sold_at at hour 12 local; legacy row with sale_time at hour 20
    const rows = [
      {
        sale_date: '2026-05-29',
        sale_time: '17:00:00',
        sold_at: '2026-05-29T17:00:00.000Z', // 17:00 UTC = 12:00 CDT (UTC-5)
        total_price: 60,
      },
      {
        sale_date: '2026-05-29',
        sale_time: '20:00:00',
        sold_at: null,
        total_price: 80,
      },
    ];
    const { data } = aggregateHourlySales(rows, 'America/Chicago');
    const hours = data.map((d) => d.hour).sort((a, b) => a - b);
    expect(hours).toContain(12); // from sold_at
    expect(hours).toContain(20); // fallback from sale_time
  });

  it('existing behaviour preserved: no timeZone arg still works (backward compat)', () => {
    // Calling without timeZone arg should not throw and should use sale_time
    const rows = [
      { sale_date: '2026-02-24', sale_time: '11:30:00', sold_at: null, total_price: 50 },
      { sale_date: '2026-02-24', sale_time: '12:30:00', sold_at: null, total_price: 100 },
    ];
    const { data, hasHourlyBreakdown } = aggregateHourlySales(rows);
    expect(hasHourlyBreakdown).toBe(true);
    expect(data.map((d) => d.hour).sort((a, b) => a - b)).toEqual([11, 12]);
  });
});

describe('aggregateHourlySales', () => {
  it('groups sales by hour and averages across days', () => {
    const rawSales = [
      { sale_date: '2026-02-24', sale_time: '11:30:00', total_price: 50 },
      { sale_date: '2026-02-24', sale_time: '11:45:00', total_price: 30 },
      { sale_date: '2026-03-03', sale_time: '11:15:00', total_price: 40 },
      { sale_date: '2026-02-24', sale_time: '12:00:00', total_price: 100 },
      { sale_date: '2026-03-03', sale_time: '12:30:00', total_price: 120 },
    ];
    const { data: result, hasHourlyBreakdown } = aggregateHourlySales(rawSales);
    expect(hasHourlyBreakdown).toBe(true);
    // Hour 11: day1=80 (50+30), day2=40 → avg=60, count=2
    const hour11 = result.find(h => h.hour === 11);
    expect(hour11?.avgSales).toBe(60);
    expect(hour11?.sampleCount).toBe(2);
    // Hour 12: day1=100, day2=120 → avg=110, count=2
    const hour12 = result.find(h => h.hour === 12);
    expect(hour12?.avgSales).toBe(110);
    expect(hour12?.sampleCount).toBe(2);
  });

  it('returns empty array for no sales', () => {
    const { data, hasHourlyBreakdown } = aggregateHourlySales([]);
    expect(data).toEqual([]);
    expect(hasHourlyBreakdown).toBe(false);
  });

  it('skips null sale_time when some rows have times', () => {
    const rawSales = [
      { sale_date: '2026-02-24', sale_time: null as unknown as string, total_price: 50 },
      { sale_date: '2026-02-24', sale_time: '11:00:00', total_price: 30 },
    ];
    const { data: result, hasHourlyBreakdown } = aggregateHourlySales(rawSales);
    expect(hasHourlyBreakdown).toBe(true);
    expect(result).toHaveLength(1);
    expect(result[0].hour).toBe(11);
  });

  it('falls back to daily spread when all sale_time values are null', () => {
    const rawSales = [
      { sale_date: '2026-02-24', sale_time: null as unknown as string, total_price: 100 },
      { sale_date: '2026-02-24', sale_time: null as unknown as string, total_price: 200 },
      { sale_date: '2026-02-25', sale_time: null as unknown as string, total_price: 390 },
    ];
    const { data: result, hasHourlyBreakdown } = aggregateHourlySales(rawSales);
    expect(hasHourlyBreakdown).toBe(false);
    // 13 business hours (9am–10pm), day1=300, day2=390, avg=345
    // 345/13 ≈ 26.54 per hour
    expect(result).toHaveLength(13);
    expect(result[0].hour).toBe(9);
    expect(result[result.length - 1].hour).toBe(21);
    expect(result[0].avgSales).toBeCloseTo(26.54, 1);
    expect(result[0].sampleCount).toBe(2);
  });

  it('sorts results by hour', () => {
    const rawSales = [
      { sale_date: '2026-02-24', sale_time: '14:00:00', total_price: 50 },
      { sale_date: '2026-02-24', sale_time: '09:00:00', total_price: 30 },
      { sale_date: '2026-02-24', sale_time: '11:00:00', total_price: 40 },
    ];
    const { data: result, hasHourlyBreakdown } = aggregateHourlySales(rawSales);
    expect(hasHourlyBreakdown).toBe(true);
    expect(result.map(r => r.hour)).toEqual([9, 11, 14]);
  });
});
