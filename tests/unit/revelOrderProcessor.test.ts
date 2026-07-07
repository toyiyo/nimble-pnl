import { describe, it, expect } from 'vitest';
import { normalizeOrder, processOrder } from '../../supabase/functions/_shared/revelOrderProcessor';

// Assumed OrderAllInOne-ish shape (field names are defensive; confirm with Revel per spec risk 8.1).
const SAMPLE = {
  Order: {
    id: 'order-1',
    order_number: 'A-1001',
    created_date: '2026-07-01T12:30:00+0000',
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
  it('extracts order id, date, totals, items, payments', () => {
    const n = normalizeOrder(SAMPLE);
    expect(n.orderId).toBe('order-1');
    expect(n.orderDate).toBe('2026-07-01');
    expect(n.totals.taxAmount).toBe(2.0);
    expect(n.totals.tipAmount).toBe(3.0);
    expect(n.items).toHaveLength(1);
    expect(n.items[0].itemName).toBe('Burger');
    expect(n.payments[0].amount).toBe(24.0);
  });
});

describe('processOrder', () => {
  it('upserts order/items/payments and calls the breakdown RPC', async () => {
    const fake = makeFakeSupabase();
    await processOrder(fake as any, SAMPLE, 'rest-1', 'reveltesta', 'est-1');
    expect(fake._calls.orders).toHaveLength(1);
    expect(fake._calls.items).toHaveLength(1);
    expect(fake._calls.payments).toHaveLength(1);
    expect(fake._calls.rpc[0]).toEqual({ fn: 'revel_sync_financial_breakdown', args: { p_order_id: 'order-1', p_restaurant_id: 'rest-1' } });
  });

  it('skips the RPC when skipUnifiedSalesSync is set (bulk mode)', async () => {
    const fake = makeFakeSupabase();
    await processOrder(fake as any, SAMPLE, 'rest-1', 'reveltesta', 'est-1', { skipUnifiedSalesSync: true });
    expect(fake._calls.rpc).toHaveLength(0);
  });
});
