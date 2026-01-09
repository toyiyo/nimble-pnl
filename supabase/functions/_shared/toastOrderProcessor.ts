/**
 * Shared Toast order processing logic
 * Used by toast-webhook, toast-bulk-sync, and toast-sync-data edge functions
 */

export async function processOrder(
  supabase: any,
  order: any,
  restaurantId: string,
  toastRestaurantGuid: string
) {
  // Parse order date and time
  const closedDate = order.closedDate ? new Date(order.closedDate) : null;
  const orderDate = closedDate ? closedDate.toISOString().split('T')[0] : new Date().toISOString().split('T')[0];
  const orderTime = closedDate ? closedDate.toISOString().split('T')[1].split('.')[0] : null;

  // Upsert order header
  const { error: orderError } = await supabase.from('toast_orders').upsert({
    restaurant_id: restaurantId,
    toast_order_guid: order.guid,
    toast_restaurant_guid: toastRestaurantGuid,
    order_number: order.orderNumber || null,
    order_date: orderDate,
    order_time: orderTime,
    total_amount: order.totalAmount ? order.totalAmount / 100 : null,
    subtotal_amount: order.subtotal ? order.subtotal / 100 : null,
    tax_amount: order.taxAmount ? order.taxAmount / 100 : null,
    tip_amount: order.tipAmount ? order.tipAmount / 100 : null,
    discount_amount: order.discountAmount ? order.discountAmount / 100 : null,
    service_charge_amount: order.serviceChargeAmount ? order.serviceChargeAmount / 100 : null,
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
          const { error: itemError } = await supabase.from('toast_order_items').upsert({
            restaurant_id: restaurantId,
            toast_item_guid: selection.guid,
            toast_order_guid: order.guid,
            item_name: selection.itemName || selection.name || 'Unknown Item',
            quantity: selection.quantity || 1,
            unit_price: selection.preDiscountPrice ? selection.preDiscountPrice / 100 : 0,
            total_price: selection.price ? selection.price / 100 : 0,
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

      // Process payments
      if (check.payments) {
        for (const payment of check.payments) {
          const { error: paymentError } = await supabase.from('toast_payments').upsert({
            restaurant_id: restaurantId,
            toast_payment_guid: payment.guid,
            toast_order_guid: order.guid,
            payment_type: payment.type || null,
            amount: payment.amount ? payment.amount / 100 : 0,
            tip_amount: payment.tipAmount ? payment.tipAmount / 100 : null,
            payment_date: orderDate,
            payment_status: payment.status || null,
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
  const { error: rpcError } = await supabase.rpc('toast_sync_financial_breakdown', {
    p_order_guid: order.guid,
    p_restaurant_id: restaurantId
  });

  if (rpcError) {
    throw new Error(`Failed to sync financial breakdown: ${rpcError.message}`);
  }
}
