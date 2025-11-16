import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.57.4';
import { getEncryptionService, logSecurityEvent } from '../_shared/encryption.ts';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

interface ToastSyncRequest {
  restaurantId: string;
  action: 'initial_sync' | 'daily_sync' | 'hourly_sync';
  dateRange?: {
    startDate: string;
    endDate: string;
  };
}

Deno.serve(async (req) => {
  // Handle CORS preflight requests
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabase = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
    );

    const body: ToastSyncRequest = await req.json();
    const { restaurantId, action, dateRange } = body;

    console.log('Toast sync started:', { restaurantId, action, dateRange });

    // Get Toast connection and decrypt tokens
    const { data: connection, error: connectionError } = await supabase
      .from('toast_connections')
      .select('*')
      .eq('restaurant_id', restaurantId)
      .single();

    if (connectionError || !connection) {
      throw new Error('Toast connection not found');
    }

    // Decrypt the access token
    const encryption = await getEncryptionService();
    const decryptedAccessToken = await encryption.decrypt(connection.access_token);

    // Log security event for token access
    await logSecurityEvent(supabase, 'TOAST_TOKEN_ACCESSED', undefined, restaurantId, {
      action: action,
      toastRestaurantGuid: connection.toast_restaurant_guid
    });

    const TOAST_BASE_URL = 'https://ws-api.toasttab.com';
    const toastHeaders = {
      'Authorization': `Bearer ${decryptedAccessToken}`,
      'Toast-Restaurant-External-ID': connection.toast_restaurant_guid,
      'Content-Type': 'application/json',
    };

    const results = {
      ordersSynced: 0,
      itemsSynced: 0,
      paymentsSynced: 0,
      menuItemsSynced: 0,
      errors: [] as string[]
    };

    // Calculate date range based on action
    let startDate: string;
    let endDate: string;

    if (dateRange) {
      startDate = dateRange.startDate;
      endDate = dateRange.endDate;
    } else {
      const now = new Date();
      endDate = now.toISOString().split('T')[0];

      switch (action) {
        case 'initial_sync':
          // Last 90 days
          const ninetyDaysAgo = new Date(now);
          ninetyDaysAgo.setDate(ninetyDaysAgo.getDate() - 90);
          startDate = ninetyDaysAgo.toISOString().split('T')[0];
          break;
        case 'daily_sync':
          // Yesterday
          const yesterday = new Date(now);
          yesterday.setDate(yesterday.getDate() - 1);
          startDate = yesterday.toISOString().split('T')[0];
          endDate = startDate;
          break;
        case 'hourly_sync':
          // Last 2 hours
          const twoHoursAgo = new Date(now.getTime() - 2 * 60 * 60 * 1000);
          startDate = twoHoursAgo.toISOString().split('T')[0];
          break;
        default:
          startDate = endDate;
      }
    }

    console.log('Syncing Toast data from', startDate, 'to', endDate);

    // Sync orders
    try {
      const ordersCount = await syncOrders(
        TOAST_BASE_URL,
        toastHeaders,
        connection.toast_restaurant_guid,
        restaurantId,
        startDate,
        endDate,
        supabase
      );
      results.ordersSynced = ordersCount;
    } catch (error: any) {
      console.error('Orders sync error:', error);
      results.errors.push(`Orders sync failed: ${error.message}`);
    }

    // Sync menu items (only for initial sync)
    if (action === 'initial_sync') {
      try {
        const menuCount = await syncMenuItems(
          TOAST_BASE_URL,
          toastHeaders,
          connection.toast_restaurant_guid,
          restaurantId,
          supabase
        );
        results.menuItemsSynced = menuCount;
      } catch (error: any) {
        console.error('Menu sync error:', error);
        results.errors.push(`Menu sync failed: ${error.message}`);
      }
    }

    // Sync to unified sales table
    try {
      const { data: syncCount, error: syncError } = await supabase.rpc(
        'sync_toast_to_unified_sales',
        { p_restaurant_id: restaurantId }
      );

      if (syncError) throw syncError;
      results.itemsSynced = syncCount || 0;
    } catch (error: any) {
      console.error('Unified sales sync error:', error);
      results.errors.push(`Unified sales sync failed: ${error.message}`);
    }

    // Update last_sync_at
    await supabase
      .from('toast_connections')
      .update({ last_sync_at: new Date().toISOString() })
      .eq('restaurant_id', restaurantId);

    console.log('Toast sync completed:', results);

    return new Response(JSON.stringify({
      success: true,
      results
    }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    });

  } catch (error: any) {
    console.error('Toast sync error:', error);
    return new Response(JSON.stringify({
      success: false,
      error: error.message || 'An error occurred during Toast sync'
    }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    });
  }
});

// Helper function to sync orders
async function syncOrders(
  baseUrl: string,
  headers: Record<string, string>,
  toastRestaurantGuid: string,
  restaurantId: string,
  startDate: string,
  endDate: string,
  supabase: any
): Promise<number> {
  let ordersCount = 0;
  let page = 1;
  const pageSize = 100;

  while (true) {
    const ordersUrl = `${baseUrl}/orders/v2/orders`;
    const params = new URLSearchParams({
      businessDate: startDate,
      endDate: endDate,
      page: page.toString(),
      pageSize: pageSize.toString(),
    });

    const response = await fetch(`${ordersUrl}?${params}`, { headers });

    if (!response.ok) {
      throw new Error(`Failed to fetch orders: ${response.statusText}`);
    }

    const ordersData = await response.json();
    const orders = ordersData.data || [];

    if (orders.length === 0) break;

    // Store orders
    for (const order of orders) {
      const orderDate = new Date(order.closedDate || order.openedDate);
      
      // Store order
      await supabase.from('toast_orders').upsert({
        restaurant_id: restaurantId,
        toast_order_guid: order.guid,
        toast_restaurant_guid: toastRestaurantGuid,
        order_number: order.orderNumber,
        order_date: orderDate.toISOString().split('T')[0],
        order_time: orderDate.toTimeString().split(' ')[0],
        total_amount: (order.totalAmount || 0) / 100, // Convert cents to dollars
        subtotal_amount: (order.subtotal || 0) / 100,
        tax_amount: (order.taxAmount || 0) / 100,
        tip_amount: (order.tipAmount || 0) / 100,
        discount_amount: (order.discountAmount || 0) / 100,
        service_charge_amount: (order.serviceChargeAmount || 0) / 100,
        payment_status: order.paymentStatus,
        dining_option: order.diningOption?.behavior,
        raw_json: order,
        synced_at: new Date().toISOString(),
      }, {
        onConflict: 'restaurant_id,toast_order_guid',
      });

      // Store order items
      if (order.checks) {
        for (const check of order.checks) {
          if (check.selections) {
            for (const selection of check.selections) {
              await supabase.from('toast_order_items').upsert({
                restaurant_id: restaurantId,
                toast_order_guid: order.guid,
                toast_item_guid: selection.itemGuid || selection.guid,
                item_name: selection.itemName || selection.name,
                quantity: selection.quantity || 1,
                unit_price: (selection.preDiscountPrice || 0) / 100,
                total_price: (selection.price || 0) / 100,
                menu_category: selection.salesCategory,
                modifiers: selection.modifiers,
                raw_json: selection,
                synced_at: new Date().toISOString(),
              }, {
                onConflict: 'restaurant_id,toast_order_guid,toast_item_guid',
                ignoreDuplicates: true,
              });
            }
          }
        }
      }

      // Store payments
      if (order.checks) {
        for (const check of order.checks) {
          if (check.payments) {
            for (const payment of check.payments) {
              await supabase.from('toast_payments').upsert({
                restaurant_id: restaurantId,
                toast_payment_guid: payment.guid,
                toast_order_guid: order.guid,
                payment_type: payment.type,
                amount: (payment.amount || 0) / 100,
                tip_amount: (payment.tipAmount || 0) / 100,
                payment_date: orderDate.toISOString().split('T')[0],
                payment_status: payment.status,
                raw_json: payment,
                synced_at: new Date().toISOString(),
              }, {
                onConflict: 'restaurant_id,toast_payment_guid',
              });
            }
          }
        }
      }

      ordersCount++;
    }

    if (orders.length < pageSize) break;
    page++;
  }

  console.log(`Synced ${ordersCount} Toast orders`);
  return ordersCount;
}

// Helper function to sync menu items
async function syncMenuItems(
  baseUrl: string,
  headers: Record<string, string>,
  toastRestaurantGuid: string,
  restaurantId: string,
  supabase: any
): Promise<number> {
  let menuItemsCount = 0;

  const menusUrl = `${baseUrl}/menus/v2/menus`;
  const response = await fetch(menusUrl, { headers });

  if (!response.ok) {
    throw new Error(`Failed to fetch menus: ${response.statusText}`);
  }

  const menusData = await response.json();
  const menus = menusData || [];

  for (const menu of menus) {
    if (menu.groups) {
      for (const group of menu.groups) {
        if (group.items) {
          for (const item of group.items) {
            await supabase.from('toast_menu_items').upsert({
              restaurant_id: restaurantId,
              toast_item_guid: item.guid,
              toast_restaurant_guid: toastRestaurantGuid,
              item_name: item.name,
              description: item.description,
              price: item.price ? item.price / 100 : null,
              category: group.name,
              is_active: !item.visibility || item.visibility === 'VISIBLE',
              raw_json: item,
              synced_at: new Date().toISOString(),
            }, {
              onConflict: 'restaurant_id,toast_item_guid',
            });

            menuItemsCount++;
          }
        }
      }
    }
  }

  console.log(`Synced ${menuItemsCount} Toast menu items`);
  return menuItemsCount;
}
