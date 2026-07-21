import { describe, it, expect } from 'vitest';
import { normalizeOrder, processOrder } from '../../supabase/functions/_shared/revelOrderProcessor';

// Revel's real feed sends created_date as NAIVE establishment-local time, no offset
// (e.g. '2026-07-19T07:32:16'). See docs/superpowers/specs/2026-07-21-revel-timezone-sold-at-design.md.
const SAMPLE = {
  Order: {
    id: 'order-1',
    order_number: 'A-1001',
    created_date: '2026-07-19T07:32:16',
    dining_option: 'DINE_IN',
    subtotal: 20.0,
    tax: 2.0,
    tip: 3.0,
    discount: 1.0,
    service_charge: 0.0,
    total: 24.0,
    payment_status: 'PAID',
  },
  OrderItems: [
    { id: 'item-1', name: 'Burger', quantity: 1, price: 20.0, category: 'Entrees', voided: false },
  ],
  Payments: [
    { id: 'pay-1', type: 'CREDIT', amount: 24.0, tip: 3.0, status: 'CAPTURED' },
  ],
};

function makeFakeSupabase() {
  const calls: Record<string, any[]> = { orders: [], items: [], payments: [], rpc: [] };
  const table = (name: string) => ({
    upsert: (row: any) => {
      if (name === 'revel_orders') calls.orders.push(row);
      if (name === 'revel_order_items') calls.items.push(row);
      if (name === 'revel_payments') calls.payments.push(row);
      const awaited = { data: null, error: null };
      return {
        // real supabase-js only returns rows when .select() is chained
        select: () => ({ maybeSingle: async () => ({ data: { id: 'order-row-uuid' }, error: null }) }),
        then: (resolve: (v: any) => any) => resolve(awaited),
      };
    },
  });
  const fake = {
    from: (name: string) => table(name),
    rpc: async (fn: string, args: any) => { calls.rpc.push({ fn, args }); return { data: 1, error: null }; },
    _calls: calls,
  };
  return fake;
}

describe('normalizeOrder', () => {
  it('extracts order id, totals, items, payments', () => {
    const n = normalizeOrder(SAMPLE, 'America/Chicago');
    expect(n.orderId).toBe('order-1');
    expect(n.totals.taxAmount).toBe(2.0);
    expect(n.totals.tipAmount).toBe(3.0);
    expect(n.items).toHaveLength(1);
    expect(n.items[0].itemName).toBe('Burger');
    expect(n.payments[0].amount).toBe(24.0);
  });

  it('interprets a naive created_date as establishment-local time and stamps a correct UTC sold_at (CDT, summer)', () => {
    const n = normalizeOrder(SAMPLE, 'America/Chicago');
    expect(n.soldAt).toBe('2026-07-19T12:32:16.000Z');
    expect(n.orderTime).toBe('07:32:16');
    expect(n.orderDate).toBe('2026-07-19');
  });

  it('interprets a naive created_date correctly in CST (winter, UTC-6)', () => {
    const winterOrder = {
      Order: { ...SAMPLE.Order, created_date: '2026-01-15T07:32:16' },
      OrderItems: SAMPLE.OrderItems,
      Payments: SAMPLE.Payments,
    };
    const n = normalizeOrder(winterOrder, 'America/Chicago');
    expect(n.soldAt).toBe('2026-01-15T13:32:16.000Z');
    expect(n.orderTime).toBe('07:32:16');
    expect(n.orderDate).toBe('2026-01-15');
  });

  it('rolls the business date back a day for an order before the 2 AM boundary (local space)', () => {
    const lateNightOrder = {
      Order: { ...SAMPLE.Order, created_date: '2026-07-19T01:15:00' },
      OrderItems: SAMPLE.OrderItems,
      Payments: SAMPLE.Payments,
    };
    const n = normalizeOrder(lateNightOrder, 'America/Chicago');
    expect(n.orderTime).toBe('01:15:00');
    expect(n.orderDate).toBe('2026-07-18');
    // sold_at is still the true instant of the naive local wall-clock, unaffected by the biz-date shift.
    expect(n.soldAt).toBe('2026-07-19T06:15:00.000Z');
  });

  it('keeps the business date same-day for an order at/after the 2 AM boundary (local space)', () => {
    const justAfterBoundary = {
      Order: { ...SAMPLE.Order, created_date: '2026-07-19T02:00:00' },
      OrderItems: SAMPLE.OrderItems,
      Payments: SAMPLE.Payments,
    };
    const n = normalizeOrder(justAfterBoundary, 'America/Chicago');
    expect(n.orderTime).toBe('02:00:00');
    expect(n.orderDate).toBe('2026-07-19');
  });

  it('handles an already-zoned created_date defensively via new Date (real Revel data is naive)', () => {
    const zonedOrder = {
      Order: { ...SAMPLE.Order, created_date: '2026-07-01T12:30:00+0000' },
      OrderItems: SAMPLE.OrderItems,
      Payments: SAMPLE.Payments,
    };
    const n = normalizeOrder(zonedOrder, 'America/Chicago');
    expect(n.soldAt).toBe('2026-07-01T12:30:00.000Z');
    expect(n.orderTime).toBe('12:30:00');
    expect(n.orderDate).toBe('2026-07-01');
  });

  it('falls back to America/Chicago when no timeZone is passed', () => {
    const n = normalizeOrder(SAMPLE);
    expect(n.soldAt).toBe('2026-07-19T12:32:16.000Z');
  });
});

describe('processOrder', () => {
  it('upserts order/items/payments (with a correct tz-aware sold_at) and calls the breakdown RPC', async () => {
    const fake = makeFakeSupabase();
    await processOrder(fake, SAMPLE, 'rest-1', 'reveltesta', 'est-1', {}, 'America/Chicago');
    expect(fake._calls.orders).toHaveLength(1);
    expect(fake._calls.orders[0].sold_at).toBe('2026-07-19T12:32:16.000Z');
    expect(fake._calls.orders[0].order_time).toBe('07:32:16');
    expect(fake._calls.orders[0].order_date).toBe('2026-07-19');
    expect(fake._calls.items).toHaveLength(1);
    expect(fake._calls.payments).toHaveLength(1);
    expect(fake._calls.rpc[0]).toEqual({ fn: 'revel_sync_financial_breakdown', args: { p_order_id: 'order-1', p_restaurant_id: 'rest-1' } });
  });

  it('skips the RPC when skipUnifiedSalesSync is set (bulk mode)', async () => {
    const fake = makeFakeSupabase();
    await processOrder(fake, SAMPLE, 'rest-1', 'reveltesta', 'est-1', { skipUnifiedSalesSync: true });
    expect(fake._calls.rpc).toHaveLength(0);
  });
});
