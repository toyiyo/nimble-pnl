import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { getEncryptionService } from "../_shared/encryption.ts";
import { logSecurityEvent } from "../_shared/securityEvents.ts";
import { processOrder } from "../_shared/toastOrderProcessor.ts";

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
