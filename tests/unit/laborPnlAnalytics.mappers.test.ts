import { describe, it, expect } from 'vitest';
import { dailySalesFromRpc, salesGridCellsFromRpc } from '@/lib/laborPnlAnalytics';
import { buildSplhGrid } from '@/lib/splhAnalytics';
import type { SplhSaleRow } from '@/lib/splhAnalytics';

describe('dailySalesFromRpc', () => {
  it('maps each daily row to an SplhPoint with zero hours and null splh', () => {
    expect(dailySalesFromRpc([
      { sale_date: '2026-07-06', revenue: 400 },
      { sale_date: '2026-07-07', revenue: 200.5 },
    ])).toEqual([
      { bucketStart: '2026-07-06', label: '2026-07-06', totalSales: 400, totalHours: 0, splh: null },
      { bucketStart: '2026-07-07', label: '2026-07-07', totalSales: 200.5, totalHours: 0, splh: null },
    ]);
  });

  it('returns [] for an empty array', () => {
    expect(dailySalesFromRpc([])).toEqual([]);
  });
});

describe('salesGridCellsFromRpc', () => {
  it('returns a full 7x24 grid, hourly path fills the reported cells', () => {
    const cells = salesGridCellsFromRpc(
      [{ dow: 1, hour: 17, revenue: 400 }, { dow: 2, hour: 12, revenue: 200 }],
      [{ dow: 1, revenue: 400 }, { dow: 2, revenue: 200 }],
      true,
    );
    expect(cells).toHaveLength(7 * 24);
    expect(cells.find((c) => c.dow === 1 && c.hour === 17)?.totalSales).toBe(400);
    expect(cells.find((c) => c.dow === 2 && c.hour === 12)?.totalSales).toBe(200);
    expect(cells.find((c) => c.dow === 0 && c.hour === 0)?.totalSales).toBe(0);
    for (const c of cells) {
      expect(c.totalHours).toBe(0);
      expect(c.splh).toBeNull();
    }
  });

  it('CRITICAL: fallback path matches buildSplhGrid to the cent (weekday total / 13, hours 9..21)', () => {
    // Two hourless sales on the same Monday (2026-07-06 = Monday = dow 1).
    const sales: SplhSaleRow[] = [
      { sale_date: '2026-07-06', sale_time: null as unknown as string, total_price: 100 },
      { sale_date: '2026-07-06', sale_time: null as unknown as string, total_price: 30 },
    ];
    const expected = buildSplhGrid(sales, [], 'UTC', 0); // fallback branch (no hours)
    const mapped = salesGridCellsFromRpc([], [{ dow: 1, revenue: 130 }], false);

    for (let dow = 0; dow < 7; dow++) {
      for (let hour = 0; hour < 24; hour++) {
        const e = expected.find((c) => c.dow === dow && c.hour === hour)!;
        const m = mapped.find((c) => c.dow === dow && c.hour === hour)!;
        expect(m.totalSales).toBe(e.totalSales);
      }
    }
    // Spot-check: 130 / 13 = 10 per hour across 9..21; 0 outside.
    expect(mapped.find((c) => c.dow === 1 && c.hour === 9)?.totalSales).toBe(10);
    expect(mapped.find((c) => c.dow === 1 && c.hour === 21)?.totalSales).toBe(10);
    expect(mapped.find((c) => c.dow === 1 && c.hour === 22)?.totalSales).toBe(0);
    expect(mapped.find((c) => c.dow === 1 && c.hour === 8)?.totalSales).toBe(0);
  });
});
