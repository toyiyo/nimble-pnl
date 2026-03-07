import { describe, it, expect } from 'vitest';
import { aggregateHourlySales } from '@/hooks/useHourlySalesPattern';

describe('aggregateHourlySales', () => {
  it('groups sales by hour and averages across days', () => {
    const rawSales = [
      { sale_date: '2026-02-24', sale_time: '11:30:00', total_price: 50 },
      { sale_date: '2026-02-24', sale_time: '11:45:00', total_price: 30 },
      { sale_date: '2026-03-03', sale_time: '11:15:00', total_price: 40 },
      { sale_date: '2026-02-24', sale_time: '12:00:00', total_price: 100 },
      { sale_date: '2026-03-03', sale_time: '12:30:00', total_price: 120 },
    ];
    const result = aggregateHourlySales(rawSales);
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
    expect(aggregateHourlySales([])).toEqual([]);
  });

  it('skips sales with null sale_time', () => {
    const rawSales = [
      { sale_date: '2026-02-24', sale_time: null as any, total_price: 50 },
      { sale_date: '2026-02-24', sale_time: '11:00:00', total_price: 30 },
    ];
    const result = aggregateHourlySales(rawSales);
    expect(result).toHaveLength(1);
    expect(result[0].hour).toBe(11);
  });

  it('sorts results by hour', () => {
    const rawSales = [
      { sale_date: '2026-02-24', sale_time: '14:00:00', total_price: 50 },
      { sale_date: '2026-02-24', sale_time: '09:00:00', total_price: 30 },
      { sale_date: '2026-02-24', sale_time: '11:00:00', total_price: 40 },
    ];
    const result = aggregateHourlySales(rawSales);
    expect(result.map(r => r.hour)).toEqual([9, 11, 14]);
  });
});
