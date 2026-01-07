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
    console.log('Toast bulk sync started');

    const supabaseUrl = Deno.env.get('SUPABASE_URL') ?? '';
    const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    // Get all active Toast connections
    const { data: connections, error: connectionsError } = await supabase
      .from('toast_connections')
      .select('*')
      .eq('is_active', true);

    if (connectionsError) {
      throw new Error(`Failed to fetch connections: ${connectionsError.message}`);
    }

    const results = {
      totalConnections: connections?.length || 0,
      successfulSyncs: 0,
      failedSyncs: 0,
      totalOrdersSynced: 0,
      errors: [] as string[]
    };

    if (!connections || connections.length === 0) {
      console.log('No active Toast connections found');
      return new Response(JSON.stringify(results), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const encryption = await getEncryptionService();

    // Process each connection
    for (const connection of connections) {
      try {
        console.log(`Processing restaurant: ${connection.toast_restaurant_guid}`);

        // Get or refresh access token
        let accessToken = connection.access_token_encrypted 
          ? await encryption.decrypt(connection.access_token_encrypted) 
          : null;
        
        const tokenExpired = !connection.token_expires_at || 
          new Date(connection.token_expires_at).getTime() < Date.now() + (3600 * 1000); // Refresh if <1hr left
        
        if (!accessToken || tokenExpired) {
          console.log('Refreshing access token...');
          const clientId = connection.client_id;
          const clientSecret = await encryption.decrypt(connection.client_secret_encrypted);
          
          const authResponse = await fetch('https://ws-api.toasttab.com/authentication/v1/authentication/login', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              clientId,
              clientSecret,
              userAccessType: 'TOAST_MACHINE_CLIENT'
            })
          });

          if (!authResponse.ok) {
            throw new Error(`Token refresh failed: ${authResponse.status}`);
          }

          const authData = await authResponse.json();
          accessToken = authData.token.accessToken;
          
          // Cache token
          const encryptedToken = await encryption.encrypt(accessToken);
          const expiresAt = new Date(Date.now() + (authData.token.expiresIn * 1000));
          
          await supabase.from('toast_connections').update({
            access_token_encrypted: encryptedToken,
            token_expires_at: expiresAt.toISOString(),
            token_fetched_at: new Date().toISOString()
          }).eq('id', connection.id);
        }

        // Determine sync window
        let startDate: string;
        let endDate: string = new Date().toISOString();
        
        if (!connection.initial_sync_done) {
          // Initial sync: last 90 days
          const ninetyDaysAgo = new Date();
          ninetyDaysAgo.setDate(ninetyDaysAgo.getDate() - 90);
          startDate = ninetyDaysAgo.toISOString();
          console.log('Initial sync: fetching last 90 days of orders');
        } else {
          // Regular sync: last 25 hours (24h + 1h buffer for late modifications)
          const lastSync = connection.last_sync_time 
            ? new Date(connection.last_sync_time) 
            : new Date(Date.now() - 25 * 3600 * 1000);
          
          startDate = new Date(lastSync.getTime() - 3600 * 1000).toISOString(); // 1hr buffer
          console.log(`Regular sync from ${startDate}`);
        }

        // Fetch orders using /ordersBulk endpoint with pagination
        let page = 1;
        let totalOrdersForRestaurant = 0;
        let hasMorePages = true;

        while (hasMorePages) {
          const bulkUrl = `https://ws-api.toasttab.com/orders/v2/ordersBulk?startDate=${encodeURIComponent(startDate)}&endDate=${encodeURIComponent(endDate)}&pageSize=100&page=${page}`;
          
          console.log(`Fetching page ${page}...`);
          
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

          console.log(`Processing ${orders.length} orders from page ${page}`);
          
          // Process each order
          for (const order of orders) {
            await processOrder(supabase, order, connection.restaurant_id, connection.toast_restaurant_guid);
            totalOrdersForRestaurant++;
          }

          // Check if there are more pages (if we got 100 orders, likely more exist)
          if (orders.length < 100) {
            hasMorePages = false;
          } else {
            page++;
            // Rate limiting: max 5 requests/second per restaurant
            await new Promise(resolve => setTimeout(resolve, 250));
          }
        }

        // Sync to unified_sales
        console.log('Syncing to unified_sales...');
        await supabase.rpc('sync_toast_to_unified_sales', {
          p_restaurant_id: connection.restaurant_id
        });

        // Update sync status
        await supabase.from('toast_connections').update({
          last_sync_time: new Date().toISOString(),
          initial_sync_done: true,
          connection_status: 'connected',
          last_error: null,
          last_error_at: null
        }).eq('id', connection.id);

        await logSecurityEvent(supabase, 'TOAST_BULK_SYNC_SUCCESS', undefined, connection.restaurant_id, {
          ordersProcessed: totalOrdersForRestaurant,
          restaurantGuid: connection.toast_restaurant_guid
        });

        results.successfulSyncs++;
        results.totalOrdersSynced += totalOrdersForRestaurant;
        
        console.log(`Successfully synced ${totalOrdersForRestaurant} orders for restaurant ${connection.toast_restaurant_guid}`);

      } catch (error: any) {
        console.error(`Error syncing restaurant ${connection.toast_restaurant_guid}:`, error);
        
        // Update connection with error
        await supabase.from('toast_connections').update({
          connection_status: 'error',
          last_error: error.message,
          last_error_at: new Date().toISOString()
        }).eq('id', connection.id);

        results.failedSyncs++;
        results.errors.push(`${connection.toast_restaurant_guid}: ${error.message}`);
      }
    }

    console.log('Bulk sync completed:', results);

    return new Response(JSON.stringify(results), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });

  } catch (error: any) {
    console.error('Toast bulk sync error:', error);
    return new Response(JSON.stringify({ error: error.message }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});

async function processOrder(supabase: any, order: any, restaurantId: string, toastRestaurantGuid: string) {
  // Parse order date and time
  const closedDate = order.closedDate ? new Date(order.closedDate) : null;
  const orderDate = closedDate ? closedDate.toISOString().split('T')[0] : new Date().toISOString().split('T')[0];
  const orderTime = closedDate ? closedDate.toISOString().split('T')[1].split('.')[0] : null;

  // Upsert order header
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

  // Process order items from checks
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

      // Process payments
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
