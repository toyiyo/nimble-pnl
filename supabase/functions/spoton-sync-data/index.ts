import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.57.4';
import { getEncryptionService } from '../_shared/encryption.ts';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

interface SyncRequest {
  restaurantId: string;
  action?: 'initial_sync' | 'incremental_sync';
  startDate?: string;
  endDate?: string;
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

    const authHeader = req.headers.get('Authorization');
    if (!authHeader) {
      throw new Error('No authorization header');
    }

    const body: SyncRequest = await req.json();
    const { restaurantId, action = 'incremental_sync', startDate, endDate } = body;

    if (!restaurantId) {
      throw new Error('Restaurant ID is required');
    }

    // Get user from auth header
    const token = authHeader.replace('Bearer ', '');
    const { data: { user }, error: authError } = await supabase.auth.getUser(token);
    if (authError || !user) {
      throw new Error('Invalid authentication');
    }

    // Verify user has access to this restaurant
    const { data: userRestaurant, error: accessError } = await supabase
      .from('user_restaurants')
      .select('role')
      .eq('user_id', user.id)
      .eq('restaurant_id', restaurantId)
      .in('role', ['owner', 'manager'])
      .single();

    if (accessError || !userRestaurant) {
      throw new Error('Access denied to restaurant');
    }

    // Get SpotOn connection
    const { data: connection, error: connectionError } = await supabase
      .from('spoton_connections')
      .select('*')
      .eq('restaurant_id', restaurantId)
      .single();

    if (connectionError || !connection) {
      throw new Error('SpotOn connection not found');
    }

    const encryption = await getEncryptionService();
    let apiKey = '';
    let accessToken = '';

    // Decrypt credentials
    if (connection.api_key_encrypted) {
      apiKey = await encryption.decrypt(connection.api_key_encrypted);
    } else if (connection.access_token) {
      accessToken = await encryption.decrypt(connection.access_token);
    } else {
      throw new Error('No valid credentials found');
    }

    const SPOTON_BASE_URL = 'https://enterprise.appetize.com';
    
    // Determine date range
    let syncStartDate = startDate;
    let syncEndDate = endDate || new Date().toISOString().split('T')[0];

    if (action === 'initial_sync' && !startDate) {
      // For initial sync, get data from last 30 days
      const thirtyDaysAgo = new Date();
      thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
      syncStartDate = thirtyDaysAgo.toISOString().split('T')[0];
    } else if (!startDate) {
      // For incremental sync, get data from last sync or last 7 days
      const lastSync = connection.last_sync_at || new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
      syncStartDate = new Date(lastSync).toISOString().split('T')[0];
    }

    console.log('SpotOn sync:', { restaurantId, action, syncStartDate, syncEndDate });

    // Fetch orders from SpotOn API
    const ordersUrl = new URL(`${SPOTON_BASE_URL}/ordering/api/orders`);
    ordersUrl.searchParams.set('start_date', syncStartDate);
    ordersUrl.searchParams.set('end_date', syncEndDate);

    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
    };

    if (apiKey) {
      headers['x-api-key'] = apiKey;
    } else if (accessToken) {
      headers['Authorization'] = `Bearer ${accessToken}`;
    }

    const ordersResponse = await fetch(ordersUrl.toString(), {
      method: 'GET',
      headers: headers,
    });

    if (!ordersResponse.ok) {
      const errorText = await ordersResponse.text();
      console.error('SpotOn API error:', errorText);
      throw new Error(`Failed to fetch orders from SpotOn: ${ordersResponse.status}`);
    }

    const ordersData = await ordersResponse.json();
    const orders = ordersData.orders || ordersData.data || [];

    console.log(`Fetched ${orders.length} orders from SpotOn`);

    // Store raw orders in spoton_orders table
    let syncedOrders = 0;
    let syncedItems = 0;

    for (const order of orders) {
      try {
        // Store raw order data
        const { error: orderError } = await supabase
          .from('spoton_orders')
          .upsert({
            restaurant_id: restaurantId,
            connection_id: connection.id,
            external_order_id: order.id || order.order_id,
            order_date: order.created_at || order.order_date,
            total_amount: order.total || order.total_amount,
            tax_amount: order.tax || order.tax_amount,
            discount_amount: order.discount || order.discount_amount,
            status: order.status,
            raw_data: order,
            synced_at: new Date().toISOString(),
          }, {
            onConflict: 'restaurant_id,external_order_id'
          });

        if (orderError) {
          console.error('Error storing order:', orderError);
          continue;
        }

        syncedOrders++;

        // Process order items
        const items = order.items || order.line_items || [];
        for (const item of items) {
          const { error: itemError } = await supabase
            .from('spoton_order_items')
            .upsert({
              restaurant_id: restaurantId,
              connection_id: connection.id,
              external_order_id: order.id || order.order_id,
              external_item_id: item.id || item.item_id,
              item_name: item.name || item.item_name,
              quantity: item.quantity || 1,
              unit_price: item.unit_price || item.price,
              total_price: item.total || item.total_price || (item.quantity * (item.unit_price || item.price)),
              category: item.category || item.category_name,
              raw_data: item,
              synced_at: new Date().toISOString(),
            }, {
              onConflict: 'restaurant_id,external_order_id,external_item_id'
            });

          if (!itemError) {
            syncedItems++;
          }
        }
      } catch (error) {
        console.error('Error processing order:', error);
        // Continue with next order
      }
    }

    // Update last sync timestamp
    await supabase
      .from('spoton_connections')
      .update({ last_sync_at: new Date().toISOString() })
      .eq('id', connection.id);

    // Trigger RPC to sync to unified_sales
    const { error: rpcError } = await supabase.rpc('sync_spoton_to_unified_sales' as any, {
      p_restaurant_id: restaurantId
    });

    if (rpcError) {
      console.error('Error syncing to unified_sales:', rpcError);
    }

    return new Response(JSON.stringify({
      success: true,
      ordersProcessed: syncedOrders,
      itemsProcessed: syncedItems,
      message: `Synced ${syncedOrders} orders with ${syncedItems} items from SpotOn`
    }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });

  } catch (error: any) {
    console.error('SpotOn sync error:', error);
    return new Response(JSON.stringify({
      error: error.message
    }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
