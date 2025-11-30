import { test, expect } from '@playwright/test';
import { normalizeAdjustmentsWithPassThrough, splitPassThroughSales } from '../../src/hooks/utils/passThroughAdjustments';

test.describe('pass-through adjustment helpers', () => {
  test('splits pass-through item types out of sales', () => {
    const sales = [
      { id: '1', item_type: 'sale' },
      { id: '2', item_type: 'tax' },
      { id: '3', item_type: 'tip' },
      { id: '4', item_type: 'refund' },
    ];

    const { revenue, passThrough } = splitPassThroughSales(sales);

    expect(revenue.map(s => s.id)).toEqual(['1', '4']);
    expect(passThrough.map(s => s.id)).toEqual(['2', '3']);
  });

  test('normalizes adjustment_type for pass-through sales rows', () => {
    const adjustments = [{ id: 'a1', adjustment_type: 'tax', total_price: 5 }];
    const passThrough = [
      { id: 'p1', item_type: 'tip', total_price: 10 },
      { id: 'p2', item_type: 'service_charge', adjustment_type: null, total_price: 20 },
    ];

    const combined = normalizeAdjustmentsWithPassThrough(adjustments as any, passThrough as any);

    const tipRow = combined.find((c: any) => c.id === 'p1');
    const serviceRow = combined.find((c: any) => c.id === 'p2');

    expect(tipRow?.adjustment_type).toBe('tip');
    expect(serviceRow?.adjustment_type).toBe('service_charge');
    expect(combined.length).toBe(3);
  });
});
