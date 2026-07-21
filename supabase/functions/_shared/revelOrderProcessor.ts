/**
 * Shared Revel order processing logic.
 * Used by revel-webhook, revel-sync-data, revel-bulk-sync.
 *
 * All Revel-payload field access is isolated in normalizeOrder() (spec risk 8.1:
 * OrderAllInOne vs wide_order). All currency scaling is isolated in toAmount()
 * (spec risk 8.2: dollars vs cents). Flip REVEL_AMOUNTS_IN_CENTS if Revel returns cents.
 */

import { zonedNaiveToUtc, DEFAULT_TIMEZONE } from './timezone.ts';

export interface ProcessOrderOptions {
  skipUnifiedSalesSync?: boolean;
}

// Set true if a real payload shows integer cents. Default: amounts are decimal dollars.
const REVEL_AMOUNTS_IN_CENTS = false;

function toAmount(v: unknown): number | null {
  if (v === null || v === undefined || v === '') return null;
  const n = typeof v === 'number' ? v : Number(v);
  if (Number.isNaN(n)) return null;
  return REVEL_AMOUNTS_IN_CENTS ? n / 100 : n;
}

interface NormalizedItem {
  itemId: string;
  itemName: string;
  quantity: number;
  unitPrice: number | null;
  totalPrice: number | null;
  category: string | null;
  isVoided: boolean;
  raw: any;
}

interface NormalizedPayment {
  paymentId: string;
  type: string | null;
  amount: number | null;
  tipAmount: number | null;
  status: string | null;
  raw: any;
}

export interface NormalizedOrder {
  orderId: string;
  orderNumber: string | null;
  orderDate: string;                 // YYYY-MM-DD
  orderTime: string | null;          // HH:MM:SS
  soldAt: string | null;             // ISO timestamp
  diningOption: string | null;
  paymentStatus: string | null;
  totals: {
    totalAmount: number | null;
    subtotalAmount: number | null;
    taxAmount: number | null;
    tipAmount: number | null;
    discountAmount: number | null;
    serviceChargeAmount: number | null;
  };
  items: NormalizedItem[];
  payments: NormalizedPayment[];
}

/** Pull the Order object regardless of envelope shape (OrderAllInOne vs flat). */
function getOrderNode(payload: any): any {
  return payload.Order ?? payload.order ?? payload;
}

/**
 * Revel's real feed sends `created_date` as NAIVE establishment-local time, no
 * offset (e.g. '2026-07-19T07:32:16') — interpret it in `timeZone` (DST-aware)
 * to get a correct UTC instant for `sold_at`. Defensively handle an
 * already-zoned string (`Z` / `±hh:mm` / `±hhmm`) via `new Date`, in case a
 * caller ever passes one (real Revel data does not).
 *
 * `orderTime` is always the naive local wall-clock digits as printed in the
 * raw string, regardless of which branch parsed `soldAt`.
 *
 * `orderDate` is the *business* date: Revel rolls over at a 2 AM local
 * boundary (same convention as Toast's `businessDate`). This must be computed
 * in local space — shifting the naive wall-clock digits back 2h — not by
 * shifting the (now correctly tz-converted) `soldAt` UTC instant, which would
 * reintroduce the same tz-anchoring bug this fix removes.
 */
function parseDateTime(
  order: any,
  timeZone: string = DEFAULT_TIMEZONE,
): { orderDate: string; orderTime: string | null; soldAt: string | null } {
  const rawDate =
    order.created_date ?? order.createdDate ?? order.closed_date ?? order.finalized_date ?? order.date ?? null;
  if (!rawDate) {
    const today = new Date().toISOString();
    return { orderDate: today.split('T')[0], orderTime: null, soldAt: null };
  }

  const raw = String(rawDate);
  const hasOffset = /(Z|[+-]\d{2}:?\d{2})$/i.test(raw);
  const naiveMatch = raw.match(/^(\d{4}-\d{2}-\d{2})[T ](\d{2}:\d{2}:\d{2})/);

  const soldAtDate = hasOffset ? new Date(raw) : zonedNaiveToUtc(raw, timeZone);
  if (Number.isNaN(soldAtDate.getTime())) {
    return { orderDate: raw.split('T')[0], orderTime: null, soldAt: null };
  }

  const orderTime = naiveMatch ? naiveMatch[2] : soldAtDate.toISOString().split('T')[1].split('.')[0];

  let orderDate: string;
  if (naiveMatch) {
    // Treat the naive digits as if they were UTC purely for calendar arithmetic
    // (no real tz conversion here — we're already in local space).
    const naiveAsUtcMs = Date.parse(`${naiveMatch[1]}T${naiveMatch[2]}Z`);
    orderDate = new Date(naiveAsUtcMs - 2 * 60 * 60 * 1000).toISOString().split('T')[0];
  } else {
    orderDate = soldAtDate.toISOString().split('T')[0];
  }

  return { orderDate, orderTime, soldAt: soldAtDate.toISOString() };
}

export function normalizeOrder(payload: any, timeZone: string = DEFAULT_TIMEZONE): NormalizedOrder {
  const order = getOrderNode(payload);
  const { orderDate, orderTime, soldAt } = parseDateTime(order, timeZone);

  const itemsRaw = payload.OrderItems ?? payload.order_items ?? order.items ?? [];
  const paymentsRaw = payload.Payments ?? payload.payments ?? order.payments ?? [];

  const items: NormalizedItem[] = (itemsRaw as any[]).map((it) => {
    const basePrice = toAmount(it.price ?? it.unit_price ?? it.amount);
    // Revel classic: the taxable line amount is base price + modifier_amount
    // (e.g. Beach Bowl 12.99 + 3.00 modifiers = 15.99, taxed at the item's rate).
    const modifier = toAmount(it.modifier_amount) ?? 0;
    const qty = Number(it.quantity ?? it.qty ?? 1) || 1;
    // Revel's `pure_sales` is its own per-line net sales (already price+modifiers × qty).
    // Prefer it; otherwise compute (price + modifier) × quantity — both matched Revel exactly.
    const pureSales = toAmount(it.pure_sales);
    const explicitTotal = toAmount(it.total ?? it.total_price);
    const lineTotal = pureSales != null
      ? pureSales
      : explicitTotal != null
      ? explicitTotal
      : (basePrice != null ? (basePrice + modifier) * qty : null);
    return {
      itemId: String(it.id ?? it.uuid ?? it.item_id ?? ''),
      // Revel classic OrderItem carries the human name in `product_name_override`.
      itemName: it.product_name_override ?? it.name ?? it.display_name ?? it.item_name ?? 'Unknown Item',
      quantity: Number(it.quantity ?? it.qty ?? 1),
      unitPrice: basePrice,
      totalPrice: lineTotal,
      category: it.category ?? it.category_name ?? it.menu_category ?? null,
      // Revel marks voids via voided_by / voided_date / deleted rather than a boolean.
      isVoided: Boolean(it.voided ?? it.is_voided ?? (it.voided_by != null || it.voided_date != null || it.deleted === true)),
      raw: it,
    };
  });

  const payments: NormalizedPayment[] = (paymentsRaw as any[]).map((p) => ({
    paymentId: String(p.id ?? p.uuid ?? p.payment_id ?? ''),
    type: p.card_type ?? p.payment_type ?? p.other_payment_type ?? p.type ?? p.tender_type ?? null,
    amount: toAmount(p.amount ?? p.total),
    tipAmount: toAmount(p.tip ?? p.tip_amount ?? p.gratuity),
    status: p.transaction_status ?? p.status ?? p.payment_status ?? null,
    raw: p,
  }));

  // Tips live on the Payment records (mostly credit-card tips), NOT the order header.
  // Sum tips across non-declined payments; fall back to header gratuity only if no
  // payments were fetched for this order.
  const paymentTips = payments
    .filter((p) => String(p.status ?? '').toLowerCase() !== 'declined')
    .reduce((s, p) => s + (p.tipAmount ?? 0), 0);

  return {
    orderId: String(order.id ?? order.uuid ?? order.order_id ?? ''),
    orderNumber: order.order_number ?? order.orderNumber ?? order.number ?? null,
    orderDate,
    orderTime,
    soldAt,
    diningOption: order.dining_option ?? order.diningOption ?? order.order_type ?? null,
    paymentStatus: order.payment_status ?? order.paymentStatus ?? null,
    totals: {
      // Revel classic header: final_total / subtotal / tax / gratuity / discount_amount (decimal-dollar strings).
      totalAmount: toAmount(order.total ?? order.total_amount ?? order.final_total),
      subtotalAmount: toAmount(order.subtotal ?? order.subtotal_amount),
      taxAmount: toAmount(order.tax ?? order.tax_amount),
      tipAmount: payments.length
        ? paymentTips
        : toAmount(order.tip ?? order.tip_amount ?? order.gratuity ?? order.smartpay_tip),
      discountAmount: toAmount(order.discount_amount ?? order.discount),
      serviceChargeAmount: toAmount(order.service_charge ?? order.service_charge_amount),
    },
    items,
    payments,
  };
}

async function upsertOrder(supabase: any, n: NormalizedOrder, restaurantId: string, establishmentId: string | null, raw: any): Promise<string> {
  const { data, error } = await supabase.from('revel_orders').upsert({
    restaurant_id: restaurantId,
    revel_order_id: n.orderId,
    establishment_id: establishmentId,
    order_number: n.orderNumber,
    order_date: n.orderDate,
    order_time: n.orderTime,
    sold_at: n.soldAt,
    total_amount: n.totals.totalAmount,
    subtotal_amount: n.totals.subtotalAmount,
    tax_amount: n.totals.taxAmount,
    tip_amount: n.totals.tipAmount,
    discount_amount: n.totals.discountAmount,
    service_charge_amount: n.totals.serviceChargeAmount,
    payment_status: n.paymentStatus,
    dining_option: n.diningOption,
    raw_json: raw,
    synced_at: new Date().toISOString(),
  }, { onConflict: 'restaurant_id,revel_order_id' }).select('id').maybeSingle();

  if (error) throw new Error(`Failed to upsert revel order: ${error.message}`);
  return data?.id;
}

async function upsertItems(supabase: any, n: NormalizedOrder, orderRowId: string, restaurantId: string): Promise<void> {
  for (const item of n.items) {
    const { error } = await supabase.from('revel_order_items').upsert({
      restaurant_id: restaurantId,
      revel_order_id_fk: orderRowId,
      revel_order_id: n.orderId,
      revel_item_id: item.itemId,
      item_name: item.itemName,
      quantity: item.quantity,
      unit_price: item.unitPrice,
      total_price: item.totalPrice,
      menu_category: item.category,
      modifiers: item.raw?.modifiers ?? null,
      is_voided: item.isVoided,
      raw_json: item.raw,
      synced_at: new Date().toISOString(),
    }, { onConflict: 'restaurant_id,revel_order_id,revel_item_id' });
    if (error) throw new Error(`Failed to upsert revel order item: ${error.message}`);
  }
}

async function upsertPayments(supabase: any, n: NormalizedOrder, restaurantId: string): Promise<void> {
  for (const p of n.payments) {
    const { error } = await supabase.from('revel_payments').upsert({
      restaurant_id: restaurantId,
      revel_payment_id: p.paymentId,
      revel_order_id: n.orderId,
      payment_type: p.type,
      amount: p.amount ?? 0,
      tip_amount: p.tipAmount,
      payment_date: n.orderDate,
      payment_status: p.status,
      raw_json: p.raw,
      synced_at: new Date().toISOString(),
    }, { onConflict: 'restaurant_id,revel_payment_id' });
    if (error) throw new Error(`Failed to upsert revel payment: ${error.message}`);
  }
}

export async function processOrder(
  supabase: any,
  payload: any,
  restaurantId: string,
  revelInstance: string,
  establishmentId: string | null,
  options: ProcessOrderOptions = {},
  timeZone: string = DEFAULT_TIMEZONE,
): Promise<void> {
  const n = normalizeOrder(payload, timeZone);
  if (!n.orderId) throw new Error('Revel order payload missing order id');

  const orderRowId = await upsertOrder(supabase, n, restaurantId, establishmentId, payload);
  await upsertItems(supabase, n, orderRowId, restaurantId);
  await upsertPayments(supabase, n, restaurantId);

  if (!options.skipUnifiedSalesSync) {
    const { error } = await supabase.rpc('revel_sync_financial_breakdown', {
      p_order_id: n.orderId,
      p_restaurant_id: restaurantId,
    });
    if (error) throw new Error(`Failed to sync financial breakdown: ${error.message}`);
  }
}
