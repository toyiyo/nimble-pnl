/**
 * Shared Toast order processing logic
 * Used by toast-webhook, toast-bulk-sync, and toast-sync-data edge functions
 *
 * NOTE: Toast API returns amounts in DOLLARS (not cents), so no division by 100 needed.
 */

export interface ProcessOrderOptions {
  /** Skip the unified_sales sync RPC - use when doing bulk sync (call once at end instead) */
  skipUnifiedSalesSync?: boolean;
}

interface OrderTotals {
  totalAmount: number | null;
  subtotalAmount: number | null;
  taxAmount: number | null;
  tipAmount: number | null;
  discountAmount: number | null;
}

interface OrderDateTime {
  orderDate: string;
  orderTime: string | null;
}

/** Convert Toast YYYYMMDD integer (e.g. 20260210) to ISO date string (2026-02-10) */
function parseBusinessDate(bizDate: number | undefined): string | null {
  if (!bizDate) return null;
  const s = String(bizDate);
  if (s.length !== 8) return null;
  return `${s.slice(0, 4)}-${s.slice(4, 6)}-${s.slice(6, 8)}`;
}

function parseOrderDateTime(order: any): OrderDateTime {
  // Prefer businessDate (restaurant's business day, YYYYMMDD integer) over UTC closedDate
  const bizDate = parseBusinessDate(order.businessDate);
  if (bizDate) {
    return { orderDate: bizDate, orderTime: null };
  }

  let closedDate = order.closedDate ? new Date(order.closedDate) : null;

  if (!closedDate && order.checks?.[0]?.closedDate) {
    closedDate = new Date(order.checks[0].closedDate);
  }

  const orderDate = closedDate
    ? closedDate.toISOString().split('T')[0]
    : new Date().toISOString().split('T')[0];

  const orderTime = closedDate
    ? closedDate.toISOString().split('T')[1].split('.')[0]
    : null;

  return { orderDate, orderTime };
}

function aggregateCheckTotals(checks: any[]): OrderTotals {
  const totalAmount = checks.reduce(
    (sum: number, c: any) => sum + (c.totalAmount ?? c.amount ?? 0),
    0
  );

  const taxAmount = checks.reduce(
    (sum: number, c: any) => sum + (c.taxAmount ?? 0),
    0
  );

  const tipAmount = checks.reduce((sum: number, c: any) => {
    const checkTip = c.tipAmount ?? 0;
    const paymentTips = (c.payments || []).reduce(
      (ps: number, p: any) => ps + (p.tipAmount ?? 0),
      0
    );
    return sum + checkTip + paymentTips;
  }, 0);

  return {
    totalAmount,
    subtotalAmount: null,
    taxAmount,
    tipAmount,
    discountAmount: null
  };
}

function getOrderTotals(order: any): OrderTotals {
  const baseTotals: OrderTotals = {
    totalAmount: order.totalAmount ?? null,
    subtotalAmount: order.subtotal ?? null,
    taxAmount: order.taxAmount ?? null,
    tipAmount: order.tipAmount ?? null,
    discountAmount: order.discountAmount ?? null
  };

  if (!order.checks || order.checks.length === 0) {
    return baseTotals;
  }

  const aggregated = aggregateCheckTotals(order.checks);

  return {
    totalAmount: baseTotals.totalAmount ?? aggregated.totalAmount,
    subtotalAmount: baseTotals.subtotalAmount,
    taxAmount: baseTotals.taxAmount ?? aggregated.taxAmount,
    tipAmount: baseTotals.tipAmount ?? aggregated.tipAmount,
    discountAmount: baseTotals.discountAmount
  };
}

async function upsertOrder(
  supabase: any,
  order: any,
  restaurantId: string,
  toastRestaurantGuid: string,
  dateTime: OrderDateTime,
  totals: OrderTotals
): Promise<void> {
  const { error: orderError } = await supabase.from('toast_orders').upsert({
    restaurant_id: restaurantId,
    toast_order_guid: order.guid,
    toast_restaurant_guid: toastRestaurantGuid,
    order_number: order.displayNumber || order.orderNumber || null,
    order_date: dateTime.orderDate,
    order_time: dateTime.orderTime,
    total_amount: totals.totalAmount,
    subtotal_amount: totals.subtotalAmount,
    tax_amount: totals.taxAmount,
    tip_amount: totals.tipAmount,
    discount_amount: totals.discountAmount,
    service_charge_amount: order.serviceChargeAmount ?? null,
    payment_status: order.paymentStatus || null,
    dining_option: order.diningOption?.behavior || null,
    raw_json: order,
    synced_at: new Date().toISOString(),
  }, {
    onConflict: 'restaurant_id,toast_order_guid'
  });

  if (orderError) {
    throw new Error(`Failed to upsert order: ${orderError.message}`);
  }
}

async function upsertOrderItem(
  supabase: any,
  selection: any,
  orderGuid: string,
  restaurantId: string
): Promise<void> {
  const itemName = selection.displayName || selection.itemName || selection.name || 'Unknown Item';

  const unitPrice = selection.preDiscountPrice ?? selection.price ?? 0;
  const netPrice = selection.price ?? 0;

  const { error: itemError } = await supabase.from('toast_order_items').upsert({
    restaurant_id: restaurantId,
    toast_item_guid: selection.guid,
    toast_order_guid: orderGuid,
    item_name: itemName,
    quantity: selection.quantity || 1,
    unit_price: unitPrice,
    total_price: netPrice,
    is_voided: selection.voided ?? false,
    discount_amount: Math.max(unitPrice - netPrice, 0),
    menu_category: selection.salesCategory || null,
    modifiers: selection.modifiers || null,
    raw_json: selection,
    synced_at: new Date().toISOString(),
  }, {
    onConflict: 'restaurant_id,toast_item_guid,toast_order_guid'
  });

  if (itemError) {
    throw new Error(`Failed to upsert order item: ${itemError.message}`);
  }
}

async function upsertPayment(
  supabase: any,
  payment: any,
  orderGuid: string,
  restaurantId: string,
  orderDate: string
): Promise<void> {
  // Use paidBusinessDate (restaurant's business day) when available,
  // falling back to orderDate (UTC-derived) for older data
  const paymentDate = parseBusinessDate(payment.paidBusinessDate) || orderDate;

  const { error: paymentError } = await supabase.from('toast_payments').upsert({
    restaurant_id: restaurantId,
    toast_payment_guid: payment.guid,
    toast_order_guid: orderGuid,
    payment_type: payment.type || null,
    amount: payment.amount ?? 0,
    tip_amount: payment.tipAmount ?? null,
    payment_date: paymentDate,
    payment_status: payment.paymentStatus || payment.status || null,
    raw_json: payment,
    synced_at: new Date().toISOString(),
  }, {
    onConflict: 'restaurant_id,toast_payment_guid,toast_order_guid'
  });

  if (paymentError) {
    throw new Error(`Failed to upsert payment: ${paymentError.message}`);
  }
}

async function processCheckSelections(
  supabase: any,
  selections: any[],
  orderGuid: string,
  restaurantId: string
): Promise<void> {
  for (const selection of selections) {
    await upsertOrderItem(supabase, selection, orderGuid, restaurantId);
  }
}

async function processCheckPayments(
  supabase: any,
  payments: any[],
  orderGuid: string,
  restaurantId: string,
  orderDate: string
): Promise<void> {
  for (const payment of payments) {
    await upsertPayment(supabase, payment, orderGuid, restaurantId, orderDate);
  }
}

async function processChecks(
  supabase: any,
  order: any,
  restaurantId: string,
  orderDate: string
): Promise<void> {
  if (!order.checks) return;

  for (const check of order.checks) {
    if (check.selections) {
      await processCheckSelections(supabase, check.selections, order.guid, restaurantId);
    }

    if (check.payments) {
      await processCheckPayments(supabase, check.payments, order.guid, restaurantId, orderDate);
    }
  }
}

async function syncFinancialBreakdown(
  supabase: any,
  orderGuid: string,
  restaurantId: string
): Promise<void> {
  const { error: rpcError } = await supabase.rpc('toast_sync_financial_breakdown', {
    p_order_guid: orderGuid,
    p_restaurant_id: restaurantId
  });

  if (rpcError) {
    throw new Error(`Failed to sync financial breakdown: ${rpcError.message}`);
  }
}

export async function processOrder(
  supabase: any,
  order: any,
  restaurantId: string,
  toastRestaurantGuid: string,
  options: ProcessOrderOptions = {}
): Promise<void> {
  const dateTime = parseOrderDateTime(order);
  const totals = getOrderTotals(order);

  await upsertOrder(supabase, order, restaurantId, toastRestaurantGuid, dateTime, totals);
  await processChecks(supabase, order, restaurantId, dateTime.orderDate);

  if (!options.skipUnifiedSalesSync) {
    await syncFinancialBreakdown(supabase, order.guid, restaurantId);
  }
}
