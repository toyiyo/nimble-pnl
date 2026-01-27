import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { getEncryptionService } from "../_shared/encryption.ts";
import { logSecurityEvent } from "../_shared/securityEvents.ts";
import { processOrder } from "../_shared/toastOrderProcessor.ts";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

const FETCH_TIMEOUT_MS = 20000; // 20 seconds for API calls
const DEBUG = Deno.env.get('DEBUG') === 'true';

function fetchWithTimeout(input: RequestInfo | URL, init: RequestInit = {}, timeoutMs = FETCH_TIMEOUT_MS) {
  const controller = new AbortController();
  const id = setTimeout(() => controller.abort(), timeoutMs);
  return fetch(input, { ...init, signal: controller.signal }).finally(() => clearTimeout(id));
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    if (DEBUG) console.log('Toast manual sync started');

    const authHeader = req.headers.get('Authorization');
    if (!authHeader) {
      return new Response(JSON.stringify({ error: 'Missing authorization' }), {
        status: 401,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // Validate environment variables
    const supabaseUrl = Deno.env.get('SUPABASE_URL');
    const supabaseAnonKey = Deno.env.get('SUPABASE_ANON_KEY');
    const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
    
    if (!supabaseUrl || !supabaseAnonKey || !supabaseServiceKey) {
      console.error('Missing required environment variables');
      return new Response(JSON.stringify({ error: 'Server misconfigured' }), {
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // User-scoped client for auth + authorization (RLS enforced)
    const userSupabase = createClient(supabaseUrl, supabaseAnonKey, {
      global: { headers: { Authorization: authHeader } },
    });

    // Service-role client for privileged reads/writes (bypasses RLS)
    const serviceSupabase = createClient(supabaseUrl, supabaseServiceKey);

    const { data: { user } } = await userSupabase.auth.getUser();
    if (!user) {
      return new Response(JSON.stringify({ error: 'Unauthorized' }), {
        status: 401,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    let restaurantId: string | undefined;
    try {
      ({ restaurantId } = await req.json());
    } catch {
      return new Response(JSON.stringify({ error: 'Invalid JSON body' }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    if (!restaurantId) {
      return new Response(JSON.stringify({ error: 'Missing restaurantId' }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // Authorization gate: verify user has access to this restaurant via RLS
    const { data: authorizedConn, error: authorizedConnError } = await userSupabase
      .from('toast_connections')
      .select('id')
      .eq('restaurant_id', restaurantId)
      .eq('is_active', true)
      .maybeSingle();

    if (authorizedConnError || !authorizedConn?.id) {
      console.error('Authorization failed:', authorizedConnError?.message || 'No connection found');
      return new Response(JSON.stringify({ error: 'Forbidden - no access to this restaurant' }), {
        status: 403,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // Privileged fetch of full connection row (includes encrypted secrets)
    const { data: connection, error: connectionError } = await serviceSupabase
      .from('toast_connections')
      .select('*')
      .eq('id', authorizedConn.id)
      .single();

    if (connectionError || !connection) {
      console.error('Connection fetch failed:', connectionError?.message);
      return new Response(JSON.stringify({ error: 'No active Toast connection found' }), {
        status: 404,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // Validate encrypted fields exist
    if (!connection.client_secret_encrypted) {
      console.error('Missing client_secret_encrypted for connection:', connection.id);
      return new Response(JSON.stringify({ error: 'Integration configuration incomplete - missing credentials' }), {
        status: 409,
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
      if (DEBUG) console.log('Refreshing access token...');
      const clientSecret = await encryption.decrypt(connection.client_secret_encrypted);
      
      const authResponse = await fetchWithTimeout('https://ws-api.toasttab.com/authentication/v1/authentication/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          clientId: connection.client_id,
          clientSecret: clientSecret,
          userAccessType: 'TOAST_MACHINE_CLIENT'
        })
      }, 15000);

      if (!authResponse.ok) {
        const errorText = await authResponse.text().catch(() => 'Unknown error');
        console.error('Token refresh failed:', authResponse.status, errorText);
        throw new Error(`Token refresh failed: ${authResponse.status}`);
      }

      const authData = await authResponse.json();
      accessToken = authData.token.accessToken;
      
      const encryptedToken = await encryption.encrypt(accessToken);
      const expiresAt = new Date(Date.now() + (authData.token.expiresIn * 1000));
      
      const { error: tokenUpdateError } = await serviceSupabase.from('toast_connections').update({
        access_token_encrypted: encryptedToken,
        token_expires_at: expiresAt.toISOString(),
        token_fetched_at: new Date().toISOString()
      }).eq('id', connection.id);

      if (tokenUpdateError) {
        console.error('Failed to update token:', tokenUpdateError.message);
        // Continue anyway - we have the token in memory
      }
    }

    // Determine sync range based on initial_sync_done flag
    // Initial sync: 90 days of historical data (batched in 7-day chunks to avoid timeouts)
    // Subsequent syncs: 25 hours (24h + 1h buffer for timezone edge cases)
    const isInitialSync = !connection.initial_sync_done;
    const BATCH_DAYS = 7; // Process 7 days at a time for initial sync
    const totalSyncDays = isInitialSync ? 90 : 1;

    if (DEBUG) console.log(`Starting sync (initial_sync: ${isInitialSync}, ${totalSyncDays} days total)`);

    let totalOrders = 0;
    const errors: Array<{ orderGuid: string; message: string }> = [];
    const MAX_ERRORS = 50;

    // Helper to fetch orders for a date range
    async function fetchOrdersForRange(rangeStart: string, rangeEnd: string): Promise<number> {
      let page = 1;
      let rangeOrders = 0;
      let hasMorePages = true;

      while (hasMorePages) {
        const bulkUrl = `https://ws-api.toasttab.com/orders/v2/ordersBulk?startDate=${encodeURIComponent(rangeStart)}&endDate=${encodeURIComponent(rangeEnd)}&pageSize=100&page=${page}`;

        let ordersResponse;
        try {
          ordersResponse = await fetchWithTimeout(bulkUrl, {
            headers: {
              'Authorization': `Bearer ${accessToken}`,
              'Toast-Restaurant-External-ID': connection.toast_restaurant_guid
            }
          }, 30000);
        } catch (fetchError: any) {
          console.error('Fetch orders failed:', fetchError.message);
          throw new Error(`Failed to fetch orders: ${fetchError.message}`);
        }

        if (!ordersResponse.ok) {
          // Handle 401 with one retry after token refresh
          if (ordersResponse.status === 401 && page === 1) {
            if (DEBUG) console.log('Got 401, attempting token refresh and retry...');
            const clientSecret = await encryption.decrypt(connection.client_secret_encrypted);

            const retryAuthResponse = await fetchWithTimeout('https://ws-api.toasttab.com/authentication/v1/authentication/login', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                clientId: connection.client_id,
                clientSecret: clientSecret,
                userAccessType: 'TOAST_MACHINE_CLIENT'
              })
            }, 15000);

            if (retryAuthResponse.ok) {
              const authData = await retryAuthResponse.json();
              accessToken = authData.token.accessToken;

              ordersResponse = await fetchWithTimeout(bulkUrl, {
                headers: {
                  'Authorization': `Bearer ${accessToken}`,
                  'Toast-Restaurant-External-ID': connection.toast_restaurant_guid
                }
              }, 30000);
            }
          }

          if (!ordersResponse.ok) {
            throw new Error(`Failed to fetch orders: ${ordersResponse.status}`);
          }
        }

        const orders = await ordersResponse.json();

        if (!orders || orders.length === 0) {
          break;
        }

        for (const order of orders) {
          try {
            // Skip per-order unified_sales sync during bulk - we'll do it once at the end
            await processOrder(serviceSupabase, order, connection.restaurant_id, connection.toast_restaurant_guid, { skipUnifiedSalesSync: true });
            rangeOrders++;
          } catch (orderError: any) {
            console.error(`Error processing order ${order.guid || 'unknown'}:`, orderError.message);
            if (errors.length < MAX_ERRORS) {
              errors.push({
                orderGuid: order.guid || order.id || 'unknown',
                message: orderError.message || 'Unknown error'
              });
            }
          }
        }

        if (orders.length < 100) {
          hasMorePages = false;
        } else {
          page++;
          await new Promise(resolve => setTimeout(resolve, 200)); // Rate limiting
        }
      }
      return rangeOrders;
    }

    // Process in batches for initial sync, single range for incremental
    if (isInitialSync) {
      // Break into 7-day chunks, working backwards from now
      const now = Date.now();
      for (let daysBack = 0; daysBack < totalSyncDays; daysBack += BATCH_DAYS) {
        const batchEnd = new Date(now - daysBack * 24 * 3600 * 1000);
        const batchStart = new Date(now - Math.min(daysBack + BATCH_DAYS, totalSyncDays) * 24 * 3600 * 1000);

        if (DEBUG) console.log(`Batch: ${batchStart.toISOString()} to ${batchEnd.toISOString()}`);

        const batchOrders = await fetchOrdersForRange(batchStart.toISOString(), batchEnd.toISOString());
        totalOrders += batchOrders;

        if (DEBUG) console.log(`Batch complete: ${batchOrders} orders (total: ${totalOrders})`);

        // Small delay between batches
        await new Promise(resolve => setTimeout(resolve, 500));
      }
    } else {
      // Incremental sync: just 25 hours
      const endDate = new Date().toISOString();
      const startDate = new Date(Date.now() - 25 * 3600 * 1000).toISOString();

      if (DEBUG) console.log(`Incremental sync: ${startDate} to ${endDate}`);
      totalOrders = await fetchOrdersForRange(startDate, endDate);
    }

    // Sync to unified_sales
    if (DEBUG) console.log('Syncing to unified_sales...');
    const { error: rpcError } = await serviceSupabase.rpc('sync_toast_to_unified_sales', {
      p_restaurant_id: connection.restaurant_id
    });

    if (rpcError) {
      console.error('RPC sync_toast_to_unified_sales failed:', rpcError.message);
      throw new Error(`Failed to sync to unified_sales: ${rpcError.message}`);
    }

    // Update last sync time and mark initial sync as done if applicable
    const syncUpdate: Record<string, any> = {
      last_sync_time: new Date().toISOString(),
      connection_status: 'connected',
      last_error: null,
      last_error_at: null
    };
    if (isInitialSync) {
      syncUpdate.initial_sync_done = true;
    }
    const { error: syncUpdateError } = await serviceSupabase.from('toast_connections').update(syncUpdate).eq('id', connection.id);

    if (syncUpdateError) {
      console.error('Failed to update last_sync_time:', syncUpdateError.message);
      // Non-fatal, continue
    }

    await logSecurityEvent(serviceSupabase, 'TOAST_MANUAL_SYNC', user.id, connection.restaurant_id, {
      ordersSynced: totalOrders,
      errorCount: errors.length
    });

    if (DEBUG) console.log(`Manual sync completed: ${totalOrders} orders, ${errors.length} errors`);

    return new Response(JSON.stringify({
      success: true,
      ordersSynced: totalOrders,
      errors: errors
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
