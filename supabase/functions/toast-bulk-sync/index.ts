import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { getEncryptionService } from "../_shared/encryption.ts";
import { logSecurityEvent } from "../_shared/securityEvents.ts";
import { processOrder } from "../_shared/toastOrderProcessor.ts";

/**
 * Toast Bulk Sync - Scheduled sync for all active Toast connections
 *
 * SCALE CONSIDERATIONS:
 * - Processes MAX_RESTAURANTS_PER_RUN restaurants per execution
 * - Uses round-robin via `last_sync_time` to ensure fair scheduling
 * - Each restaurant gets MAX_ORDERS_PER_RESTAURANT orders per run
 * - Cron runs every 6 hours, so all restaurants get synced eventually
 * - For 100+ restaurants, may need to increase cron frequency or add workers
 */

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const FETCH_TIMEOUT_MS = 20000;
const MAX_RESTAURANTS_PER_RUN = 5; // Process max 5 restaurants per cron run
const MAX_ORDERS_PER_RESTAURANT = 200; // Limit orders per restaurant per run
const DELAY_BETWEEN_RESTAURANTS_MS = 2000; // 2 second delay between restaurants

async function fetchWithTimeout(url: string, options: RequestInit = {}): Promise<Response> {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);

  try {
    const response = await fetch(url, { ...options, signal: controller.signal });
    clearTimeout(timeoutId);
    return response;
  } catch (error) {
    clearTimeout(timeoutId);
    if (error instanceof Error && error.name === 'AbortError') {
      throw new Error(`Request timeout after ${FETCH_TIMEOUT_MS}ms`);
    }
    throw error;
  }
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  const startTime = Date.now();

  try {
    console.log('Toast bulk sync started');

    const supabaseUrl = Deno.env.get('SUPABASE_URL') ?? '';
    const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    // Get connections that need syncing, ordered by least recently synced
    // This ensures fair round-robin scheduling across all restaurants
    const { data: connections, error: connectionsError } = await supabase
      .from('toast_connections')
      .select('*')
      .eq('is_active', true)
      .order('last_sync_time', { ascending: true, nullsFirst: true })
      .limit(MAX_RESTAURANTS_PER_RUN);

    if (connectionsError) {
      throw new Error(`Failed to fetch connections: ${connectionsError.message}`);
    }

    const results = {
      totalConnections: connections?.length || 0,
      successfulSyncs: 0,
      failedSyncs: 0,
      totalOrdersSynced: 0,
      errors: [] as string[],
      processingTimeMs: 0
    };

    if (!connections || connections.length === 0) {
      console.log('No active Toast connections found');
      results.processingTimeMs = Date.now() - startTime;
      return new Response(JSON.stringify(results), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const encryption = await getEncryptionService();

    // Process each connection sequentially with delays
    for (let i = 0; i < connections.length; i++) {
      const connection = connections[i];

      // Add delay between restaurants (except first one)
      if (i > 0) {
        await new Promise(resolve => setTimeout(resolve, DELAY_BETWEEN_RESTAURANTS_MS));
      }

      try {
        console.log(`[${i + 1}/${connections.length}] Processing restaurant: ${connection.toast_restaurant_guid}`);

        // Get or refresh access token
        let accessToken = connection.access_token_encrypted
          ? await encryption.decrypt(connection.access_token_encrypted)
          : null;

        const tokenExpired = !connection.token_expires_at ||
          new Date(connection.token_expires_at).getTime() < Date.now() + (3600 * 1000);

        if (!accessToken || tokenExpired) {
          console.log('Refreshing access token...');
          const clientSecret = await encryption.decrypt(connection.client_secret_encrypted);

          const authResponse = await fetchWithTimeout('https://ws-api.toasttab.com/authentication/v1/authentication/login', {
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

        // Determine sync window - always incremental for bulk sync
        // Initial syncs should be triggered manually by the user
        const syncHoursBack = connection.initial_sync_done ? 25 : 72; // 3 days for new connections
        const startDate = new Date(Date.now() - syncHoursBack * 3600 * 1000).toISOString();
        const endDate = new Date().toISOString();

        console.log(`Syncing orders from ${startDate} (${syncHoursBack}h back)`);

        // Fetch orders with limits
        let page = 1;
        let totalOrdersForRestaurant = 0;

        while (totalOrdersForRestaurant < MAX_ORDERS_PER_RESTAURANT) {
          const bulkUrl = `https://ws-api.toasttab.com/orders/v2/ordersBulk?startDate=${encodeURIComponent(startDate)}&endDate=${encodeURIComponent(endDate)}&pageSize=100&page=${page}`;

          const ordersResponse = await fetchWithTimeout(bulkUrl, {
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
            break;
          }

          console.log(`Processing ${orders.length} orders from page ${page}`);

          for (const order of orders) {
            if (totalOrdersForRestaurant >= MAX_ORDERS_PER_RESTAURANT) break;

            // Skip unified_sales sync during bulk - we do it once at the end
            await processOrder(supabase, order, connection.restaurant_id, connection.toast_restaurant_guid, {
              skipUnifiedSalesSync: true
            });
            totalOrdersForRestaurant++;
          }

          if (orders.length < 100 || totalOrdersForRestaurant >= MAX_ORDERS_PER_RESTAURANT) {
            break;
          }

          page++;
          await new Promise(resolve => setTimeout(resolve, 200)); // Rate limiting
        }

        // Sync to unified_sales (only if we processed orders)
        if (totalOrdersForRestaurant > 0) {
          console.log('Syncing to unified_sales...');
          const { error: rpcError } = await supabase.rpc('sync_toast_to_unified_sales', {
            p_restaurant_id: connection.restaurant_id
          });

          if (rpcError) {
            console.warn('unified_sales sync warning:', rpcError.message);
            // Don't fail the whole sync for this
          }
        }

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

        console.log(`✓ Synced ${totalOrdersForRestaurant} orders for restaurant ${connection.toast_restaurant_guid}`);

      } catch (error: unknown) {
        const errorMessage = error instanceof Error ? error.message : 'Unknown error';
        console.error(`✗ Error syncing restaurant ${connection.toast_restaurant_guid}:`, errorMessage);

        await supabase.from('toast_connections').update({
          connection_status: 'error',
          last_error: errorMessage,
          last_error_at: new Date().toISOString()
        }).eq('id', connection.id);

        results.failedSyncs++;
        results.errors.push(`${connection.toast_restaurant_guid}: ${errorMessage}`);
      }
    }

    results.processingTimeMs = Date.now() - startTime;
    console.log(`Bulk sync completed in ${results.processingTimeMs}ms:`, results);

    return new Response(JSON.stringify(results), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });

  } catch (error: unknown) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    console.error('Toast bulk sync error:', errorMessage);
    return new Response(JSON.stringify({ error: errorMessage }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
