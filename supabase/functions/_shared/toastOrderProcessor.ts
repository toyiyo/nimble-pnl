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

export async function processOrder(
  supabase: any,
  order: any,
  restaurantId: string,
  toastRestaurantGuid: string,
  options: ProcessOrderOptions = {}
) {
  // Parse order date and time - prefer check closedDate over order level
  let closedDate = order.closedDate ? new Date(order.closedDate) : null;
  if (!closedDate && order.checks?.[0]?.closedDate) {
    closedDate = new Date(order.checks[0].closedDate);
  }
  const orderDate = closedDate ? closedDate.toISOString().split('T')[0] : new Date().toISOString().split('T')[0];
  const orderTime = closedDate ? closedDate.toISOString().split('T')[1].split('.')[0] : null;

  // Aggregate totals from checks (Toast stores amounts at check level, not order level)
  let totalAmount = order.totalAmount ?? null;
  let subtotalAmount = order.subtotal ?? null;
  let taxAmount = order.taxAmount ?? null;
  let tipAmount = order.tipAmount ?? null;
  let discountAmount = order.discountAmount ?? null;

  if (order.checks && order.checks.length > 0) {
    // Sum up from checks if order-level totals are missing
    if (totalAmount === null) {
      totalAmount = order.checks.reduce((sum: number, c: any) => sum + (c.totalAmount ?? c.amount ?? 0), 0);
    }
    if (taxAmount === null) {
      taxAmount = order.checks.reduce((sum: number, c: any) => sum + (c.taxAmount ?? 0), 0);
    }
    if (tipAmount === null) {
      // Tips are often on payments
      tipAmount = order.checks.reduce((sum: number, c: any) => {
        const checkTip = c.tipAmount ?? 0;
        const paymentTips = (c.payments || []).reduce((ps: number, p: any) => ps + (p.tipAmount ?? 0), 0);
        return sum + checkTip + paymentTips;
      }, 0);
    }
  }

  // Upsert order header (amounts are already in dollars from Toast API)
  const { error: orderError } = await supabase.from('toast_orders').upsert({
    restaurant_id: restaurantId,
    toast_order_guid: order.guid,
    toast_restaurant_guid: toastRestaurantGuid,
    order_number: order.orderNumber || null,
    order_date: orderDate,
    order_time: orderTime,
    total_amount: totalAmount,
    subtotal_amount: subtotalAmount,
    tax_amount: taxAmount,
    tip_amount: tipAmount,
    discount_amount: discountAmount,
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

  // Process order items from checks
  if (order.checks) {
    for (const check of order.checks) {
      if (check.selections) {
        for (const selection of check.selections) {
          // Toast uses displayName as the primary item name
          const itemName = selection.displayName || selection.itemName || selection.name || 'Unknown Item';

          const { error: itemError } = await supabase.from('toast_order_items').upsert({
            restaurant_id: restaurantId,
            toast_item_guid: selection.guid,
            toast_order_guid: order.guid,
            item_name: itemName,
            quantity: selection.quantity || 1,
            unit_price: selection.preDiscountPrice ?? 0,
            total_price: selection.price ?? 0,
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
      }

      // Process payments (amounts are already in dollars)
      if (check.payments) {
        for (const payment of check.payments) {
          const { error: paymentError } = await supabase.from('toast_payments').upsert({
            restaurant_id: restaurantId,
            toast_payment_guid: payment.guid,
            toast_order_guid: order.guid,
            payment_type: payment.type || null,
            amount: payment.amount ?? 0,
            tip_amount: payment.tipAmount ?? null,
            payment_date: orderDate,
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
      }
    }
  }

  // Call RPC to sync financial breakdown to unified_sales
  // Skip during bulk sync - caller should call sync_toast_to_unified_sales once at the end
  if (!options.skipUnifiedSalesSync) {
    const { error: rpcError } = await supabase.rpc('toast_sync_financial_breakdown', {
      p_order_guid: order.guid,
      p_restaurant_id: restaurantId
    });

    if (rpcError) {
      throw new Error(`Failed to sync financial breakdown: ${rpcError.message}`);
    }
  }
}
