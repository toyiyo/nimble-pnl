import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { processOrder } from '../../supabase/functions/_shared/toastOrderProcessor';

// Regression guard for the Revel sold_at timezone fix (see
// docs/superpowers/specs/2026-07-21-revel-timezone-sold-at-design.md, §3
// "Already correct (must NOT regress)"): unlike Revel, Toast's `closedDate`
// carries an explicit UTC offset (e.g. '+0000'), so `new Date(closedDate)`
// already yields a correct absolute instant. The Revel fix must not touch
// this path or the shared `_shared/timezone.ts` helpers it doesn't use.
const SAMPLE = {
  guid: 'toast-order-1',
  displayNumber: 'A-1001',
  paymentStatus: 'PAID',
  diningOption: { behavior: 'DINE_IN' },
  // Real Toast timestamps include an explicit offset, unlike Revel's naive local strings.
  closedDate: '2026-07-19T12:32:16.071+0000',
  totalAmount: 24.0,
  taxAmount: 2.0,
  tipAmount: 3.0,
  discountAmount: 1.0,
  checks: [
    {
      selections: [
        { guid: 'item-1', displayName: 'Burger', quantity: 1, price: 20.0, voided: false, salesCategory: 'Entrees' },
      ],
      payments: [
        { guid: 'pay-1', type: 'CREDIT', amount: 24.0, tipAmount: 3.0, paymentStatus: 'CAPTURED' },
      ],
    },
  ],
};

function makeFakeSupabase() {
  const calls: Record<string, any[]> = { orders: [], items: [], payments: [], rpc: [] };
  const fake = {
    from: (name: string) => ({
      upsert: async (row: any, _opts?: any) => {
        if (name === 'toast_orders') calls.orders.push(row);
        if (name === 'toast_order_items') calls.items.push(row);
        if (name === 'toast_payments') calls.payments.push(row);
        return { data: null, error: null };
      },
    }),
    rpc: async (fn: string, args: any) => {
      calls.rpc.push({ fn, args });
      return { data: null, error: null };
    },
    _calls: calls,
  };
  return fake;
}

describe('processOrder (Toast) — unaffected by the Revel tz fix', () => {
  it('derives order_date/order_time from the offset-carrying closedDate as a correct absolute instant', async () => {
    const fake = makeFakeSupabase();
    await processOrder(fake as any, SAMPLE, 'rest-1', 'toast-restaurant-guid', { skipUnifiedSalesSync: true });

    expect(fake._calls.orders).toHaveLength(1);
    const upserted = fake._calls.orders[0];
    // closedDate '...T12:32:16.071+0000' is an unambiguous instant regardless of the
    // edge runtime's local tz (unlike Revel's naive local created_date).
    expect(upserted.order_date).toBe('2026-07-19');
    expect(upserted.order_time).toBe('12:32:16');
  });

  it('preserves the raw closedDate verbatim in raw_json — this is what sync_toast_to_unified_sales (SQL) parses into sold_at', async () => {
    const fake = makeFakeSupabase();
    await processOrder(fake as any, SAMPLE, 'rest-1', 'toast-restaurant-guid', { skipUnifiedSalesSync: true });

    const upserted = fake._calls.orders[0];
    expect(upserted.raw_json.closedDate).toBe('2026-07-19T12:32:16.071+0000');
  });

  it('produces the same order_date/order_time across DST boundaries (winter closedDate offset), proving no naive-local reinterpretation was introduced', async () => {
    const fake = makeFakeSupabase();
    const winterOrder = { ...SAMPLE, closedDate: '2026-01-15T13:32:16.071+0000' };
    await processOrder(fake as any, winterOrder, 'rest-1', 'toast-restaurant-guid', { skipUnifiedSalesSync: true });

    const upserted = fake._calls.orders[0];
    // Toast's offset is carried on the wire, not derived from an establishment tz lookup,
    // so winter vs. summer closedDate values round-trip identically — no DST-aware
    // conversion (like Revel's zonedNaiveToUtc) is or should be involved here.
    expect(upserted.order_date).toBe('2026-01-15');
    expect(upserted.order_time).toBe('13:32:16');
  });

  it('does not import the shared Revel timezone helpers (_shared/timezone.ts) — no shared read-path coupling was introduced', () => {
    const modulePath = resolve(__dirname, '../../supabase/functions/_shared/toastOrderProcessor.ts');
    const source = readFileSync(modulePath, 'utf8');
    expect(source).not.toMatch(/_shared\/timezone/);
    expect(source).not.toMatch(/zonedNaiveToUtc|resolveRestaurantTimeZone|safeTz/);
  });
});
