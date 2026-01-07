import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { getEncryptionService } from "../_shared/encryption.ts";
import { logSecurityEvent } from "../_shared/securityEvents.ts";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    console.log('Toast manual sync started');

    const authHeader = req.headers.get('Authorization');
    if (!authHeader) {
      return new Response(JSON.stringify({ error: 'Missing authorization' }), {
        status: 401,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const supabaseUrl = Deno.env.get('SUPABASE_URL') ?? '';
    const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
    const supabase = createClient(supabaseUrl, supabaseServiceKey, {
      global: { headers: { Authorization: authHeader } },
    });

    const { data: { user } } = await supabase.auth.getUser();
    if (!user) {
      return new Response(JSON.stringify({ error: 'Unauthorized' }), {
        status: 401,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const { restaurantId } = await req.json();

    if (!restaurantId) {
      return new Response(JSON.stringify({ error: 'Missing restaurantId' }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // Get connection
    const { data: connection, error: connectionError } = await supabase
      .from('toast_connections')
      .select('*')
      .eq('restaurant_id', restaurantId)
      .eq('is_active', true)
      .single();

    if (connectionError || !connection) {
      return new Response(JSON.stringify({ error: 'No active Toast connection found' }), {
        status: 404,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const encryption = await getEncryptionService();

    // Get or refresh access token
    let accessToken = connection.access_token_encrypted 
      ? await encryption.decrypt(connection.access_token_encrypted) 
      : null;
    
    const tokenExpired = !connection.token_expires_at || 
      new Date(connection.token_expires_at).getTime() < Date.now() + (3600 * 1000);
    
    if (!accessToken || tokenExpired) {
      console.log('Refreshing access token...');
      const clientSecret = await encryption.decrypt(connection.client_secret_encrypted);
      
      const authResponse = await fetch('https://ws-api.toasttab.com/authentication/v1/authentication/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          clientId: connection.client_id,
          clientSecret: clientSecret,
          userAccessType: 'TOAST_MACHINE_CLIENT'
        })
      });

      if (!authResponse.ok) {
        throw new Error(`Token refresh failed: ${authResponse.status}`);
      }

      const authData = await authResponse.json();
      accessToken = authData.token.accessToken;
      
      const encryptedToken = await encryption.encrypt(accessToken);
      const expiresAt = new Date(Date.now() + (authData.token.expiresIn * 1000));
      
      await supabase.from('toast_connections').update({
        access_token_encrypted: encryptedToken,
        token_expires_at: expiresAt.toISOString(),
        token_fetched_at: new Date().toISOString()
      }).eq('id', connection.id);
    }

    // Sync last 25 hours (24h + 1h buffer)
    const endDate = new Date().toISOString();
    const startDate = new Date(Date.now() - 25 * 3600 * 1000).toISOString();

    console.log(`Syncing orders from ${startDate} to ${endDate}`);

    let totalOrders = 0;
    let page = 1;
    let hasMorePages = true;

    while (hasMorePages) {
      const bulkUrl = `https://ws-api.toasttab.com/orders/v2/ordersBulk?startDate=${encodeURIComponent(startDate)}&endDate=${encodeURIComponent(endDate)}&pageSize=100&page=${page}`;
      
      const ordersResponse = await fetch(bulkUrl, {
        headers: {
          'Authorization': `Bearer ${accessToken}`,
          'Toast-Restaurant-External-ID': connection.toast_restaurant_guid
        }
      });

      if (!ordersResponse.ok) {
        throw new Error(`Failed to fetch orders: ${ordersResponse.status}`);
      }

      const orders = await ordersResponse.json();
      
      if (!orders || orders.length === 0) {
        hasMorePages = false;
        break;
      }

      for (const order of orders) {
        await processOrder(supabase, order, connection.restaurant_id, connection.toast_restaurant_guid);
        totalOrders++;
      }

      if (orders.length < 100) {
        hasMorePages = false;
      } else {
        page++;
        await new Promise(resolve => setTimeout(resolve, 250)); // Rate limiting
      }
    }

    // Sync to unified_sales
    console.log('Syncing to unified_sales...');
    await supabase.rpc('sync_toast_to_unified_sales', {
      p_restaurant_id: connection.restaurant_id
    });

    // Update last sync time
    await supabase.from('toast_connections').update({
      last_sync_time: new Date().toISOString(),
      connection_status: 'connected',
      last_error: null,
      last_error_at: null
    }).eq('id', connection.id);

    await logSecurityEvent(supabase, 'TOAST_MANUAL_SYNC', user.id, connection.restaurant_id, {
      ordersSynced: totalOrders
    });

    console.log(`Manual sync completed: ${totalOrders} orders`);

    return new Response(JSON.stringify({
      success: true,
      ordersSynced: totalOrders,
      errors: []
    }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });

  } catch (error: any) {
    console.error('Toast manual sync error:', error);
    return new Response(JSON.stringify({ error: error.message }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});

async function processOrder(supabase: any, order: any, restaurantId: string, toastRestaurantGuid: string) {
  const closedDate = order.closedDate ? new Date(order.closedDate) : null;
  const orderDate = closedDate ? closedDate.toISOString().split('T')[0] : new Date().toISOString().split('T')[0];
  const orderTime = closedDate ? closedDate.toISOString().split('T')[1].split('.')[0] : null;

  await supabase.from('toast_orders').upsert({
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

  if (order.checks) {
    for (const check of order.checks) {
      if (check.selections) {
        for (const selection of check.selections) {
          await supabase.from('toast_order_items').upsert({
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
        }
      }

      if (check.payments) {
        for (const payment of check.payments) {
          await supabase.from('toast_payments').upsert({
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
        }
      }
    }
  }
}

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
