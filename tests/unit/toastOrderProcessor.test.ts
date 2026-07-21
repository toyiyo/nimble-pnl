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
  // Real Toast timestamps include an explicit non-zero offset (e.g. CDT -05:00),
  // unlike Revel's naive local strings. A +0000 fixture would pass even if the
  // wire offset were silently discarded and the digits treated as naive UTC —
  // this fixture is only discriminating with a non-zero offset: wall-clock
  // 07:32:16-05:00 is a *different* instant (12:32:16Z) than a naive read of
  // the same digits (07:32:16Z) would produce.
  closedDate: '2026-07-19T07:32:16.071-05:00',
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

// Row shape read back by the assertions below. processOrder's own `supabase`
// param is typed `any` in the production module (no exported client type to
// pin against), so this narrows only the fields the tests actually read —
// deliberately more specific than `any` so a shape/rename drift on those
// fields fails to compile rather than silently reading `undefined`.
interface ToastUpsertRow extends Record<string, unknown> {
  order_date?: string;
  order_time?: string;
  raw_json?: { closedDate?: string };
}

interface FakeSupabaseCalls {
  orders: ToastUpsertRow[];
  items: ToastUpsertRow[];
  payments: ToastUpsertRow[];
  rpc: { fn: string; args: Record<string, unknown> }[];
}

function makeFakeSupabase() {
  const calls: FakeSupabaseCalls = { orders: [], items: [], payments: [], rpc: [] };
  const fake = {
    from: (name: string) => ({
      upsert: async (row: ToastUpsertRow, _opts?: Record<string, unknown>) => {
        if (name === 'toast_orders') calls.orders.push(row);
        if (name === 'toast_order_items') calls.items.push(row);
        if (name === 'toast_payments') calls.payments.push(row);
        return { data: null, error: null };
      },
    }),
    rpc: async (fn: string, args: Record<string, unknown>) => {
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
    await processOrder(fake, SAMPLE, 'rest-1', 'toast-restaurant-guid', { skipUnifiedSalesSync: true });

    expect(fake._calls.orders).toHaveLength(1);
    const upserted = fake._calls.orders[0];
    // closedDate '...T07:32:16.071-05:00' is an unambiguous instant (12:32:16Z)
    // regardless of the edge runtime's local tz (unlike Revel's naive local
    // created_date) — and, being non-zero, is discriminating against a
    // regression that silently drops the wire offset.
    expect(upserted.order_date).toBe('2026-07-19');
    expect(upserted.order_time).toBe('12:32:16');
  });

  it('preserves the raw closedDate verbatim in raw_json — this is what sync_toast_to_unified_sales (SQL) parses into sold_at', async () => {
    const fake = makeFakeSupabase();
    await processOrder(fake, SAMPLE, 'rest-1', 'toast-restaurant-guid', { skipUnifiedSalesSync: true });

    const upserted = fake._calls.orders[0];
    expect(upserted.raw_json?.closedDate).toBe('2026-07-19T07:32:16.071-05:00');
  });

  it('produces correctly-converted, distinct order_date/order_time across DST boundaries (winter closedDate offset), proving no naive-local reinterpretation was introduced', async () => {
    const fake = makeFakeSupabase();
    // Winter Toast wire offset (CST, -06:00) — also non-zero and distinct from
    // the summer (-05:00) fixture above, so this isn't just re-testing +0000.
    const winterOrder = { ...SAMPLE, closedDate: '2026-01-15T07:32:16.071-06:00' };
    await processOrder(fake, winterOrder, 'rest-1', 'toast-restaurant-guid', { skipUnifiedSalesSync: true });

    const upserted = fake._calls.orders[0];
    // Toast's offset is carried on the wire, not derived from an establishment tz lookup:
    // -06:00 correctly converts 07:32:16 local to 13:32:16Z, matching the summer fixture's
    // UTC hour (12:32:16Z) landing on a different wall-clock hour — proving the offset (not
    // a fixed/host-local assumption) drives the conversion. No DST-aware local-time
    // reinterpretation (like Revel's zonedNaiveToUtc) is or should be involved here.
    expect(upserted.order_date).toBe('2026-01-15');
    expect(upserted.order_time).toBe('13:32:16');
  });

  it('does not import the shared Revel timezone helpers (_shared/timezone.ts) — no shared read-path coupling was introduced', () => {
    const modulePath = resolve(__dirname, '../../supabase/functions/_shared/toastOrderProcessor.ts');
    const source = readFileSync(modulePath, 'utf8');
    // Matches both an absolute `_shared/timezone` import and a sibling-relative
    // `./timezone` import (the form an actual same-directory import would take).
    expect(source).not.toMatch(/from\s+['"](?:\.\/|.*\/_shared\/)timezone['"]/);
    expect(source).not.toMatch(/zonedNaiveToUtc|resolveRestaurantTimeZone|safeTz|tzOffsetMs/);
  });
});
