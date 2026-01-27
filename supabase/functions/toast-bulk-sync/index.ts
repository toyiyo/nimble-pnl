import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient, SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";
import { getEncryptionService, EncryptionService } from "../_shared/encryption.ts";
import { logSecurityEvent } from "../_shared/securityEvents.ts";
import { processOrder } from "../_shared/toastOrderProcessor.ts";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

// Conservative limits for Supabase Edge Function CPU limits (2s per request)
const FETCH_TIMEOUT_MS = 20000;
const MAX_RESTAURANTS_PER_RUN = 5;
const MAX_ORDERS_PER_RESTAURANT = 100;  // Increased since PAGE_SIZE is now 100
const PAGE_SIZE = 100;                   // Toast API max - minimizes API calls
const DELAY_BETWEEN_RESTAURANTS_MS = 2000;
const TOAST_AUTH_URL = 'https://ws-api.toasttab.com/authentication/v1/authentication/login';

interface ToastConnection {
  id: string;
  restaurant_id: string;
  client_id: string;
  client_secret_encrypted: string;
  access_token_encrypted?: string;
  token_expires_at?: string;
  toast_restaurant_guid: string;
  initial_sync_done?: boolean;
}

interface SyncResults {
  totalConnections: number;
  successfulSyncs: number;
  failedSyncs: number;
  totalOrdersSynced: number;
  errors: string[];
  processingTimeMs: number;
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}

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

async function refreshAccessToken(
  connection: ToastConnection,
  encryption: EncryptionService,
  supabase: SupabaseClient
): Promise<string> {
  console.log('Refreshing access token...');
  const clientSecret = await encryption.decrypt(connection.client_secret_encrypted);

  const authResponse = await fetchWithTimeout(TOAST_AUTH_URL, {
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
  const accessToken = authData.token.accessToken;

  const encryptedToken = await encryption.encrypt(accessToken);
  const expiresAt = new Date(Date.now() + (authData.token.expiresIn * 1000));

  const { error: tokenUpdateError } = await supabase.from('toast_connections').update({
    access_token_encrypted: encryptedToken,
    token_expires_at: expiresAt.toISOString(),
    token_fetched_at: new Date().toISOString()
  }).eq('id', connection.id);

  if (tokenUpdateError) {
    // Token is valid for this request but won't be cached for next time.
    // This is acceptable - log warning and continue.
    console.warn('Token refresh succeeded but persistence failed:', tokenUpdateError.message);
  }

  return accessToken;
}

async function getValidAccessToken(
  connection: ToastConnection,
  encryption: EncryptionService,
  supabase: SupabaseClient
): Promise<string> {
  const existingToken = connection.access_token_encrypted
    ? await encryption.decrypt(connection.access_token_encrypted)
    : null;

  const tokenExpired = !connection.token_expires_at ||
    new Date(connection.token_expires_at).getTime() < Date.now() + (3600 * 1000);

  if (existingToken && !tokenExpired) {
    return existingToken;
  }

  return refreshAccessToken(connection, encryption, supabase);
}

interface FetchContext {
  supabase: SupabaseClient;
  connection: ToastConnection;
  encryption: EncryptionService;
  accessToken: string;
  tokenRefreshed?: boolean;  // Prevents multiple refresh attempts per sync session
}

async function fetchOrderPage(
  ctx: FetchContext,
  startDate: string,
  endDate: string,
  page: number
): Promise<{ orders: any[]; refreshedToken?: string }> {
  const bulkUrl = `https://ws-api.toasttab.com/orders/v2/ordersBulk?startDate=${encodeURIComponent(startDate)}&endDate=${encodeURIComponent(endDate)}&pageSize=${PAGE_SIZE}&page=${page}`;

  let ordersResponse = await fetchWithTimeout(bulkUrl, {
    headers: {
      'Authorization': `Bearer ${ctx.accessToken}`,
      'Toast-Restaurant-External-ID': ctx.connection.toast_restaurant_guid
    }
  });

  // Handle 401 with one retry after token refresh (per sync session)
  if (!ordersResponse.ok && ordersResponse.status === 401 && !ctx.tokenRefreshed) {
    console.log('Got 401, attempting token refresh and retry...');
    ctx.tokenRefreshed = true;
    const newToken = await refreshAccessToken(ctx.connection, ctx.encryption, ctx.supabase);

    ordersResponse = await fetchWithTimeout(bulkUrl, {
      headers: {
        'Authorization': `Bearer ${newToken}`,
        'Toast-Restaurant-External-ID': ctx.connection.toast_restaurant_guid
      }
    });

    if (ordersResponse.ok) {
      return { orders: await ordersResponse.json(), refreshedToken: newToken };
    }
  }

  if (!ordersResponse.ok) {
    throw new Error(`Failed to fetch orders: ${ordersResponse.status}`);
  }

  return { orders: await ordersResponse.json() };
}

async function fetchAndProcessOrders(
  ctx: FetchContext,
  startDate: string,
  endDate: string
): Promise<number> {
  let page = 1;
  let totalOrdersForRestaurant = 0;

  while (totalOrdersForRestaurant < MAX_ORDERS_PER_RESTAURANT) {
    const { orders, refreshedToken } = await fetchOrderPage(ctx, startDate, endDate, page);

    if (refreshedToken) {
      ctx.accessToken = refreshedToken;
    }

    if (!orders || orders.length === 0) {
      break;
    }

    console.log(`Processing ${orders.length} orders from page ${page}`);

    for (const order of orders) {
      if (totalOrdersForRestaurant >= MAX_ORDERS_PER_RESTAURANT) break;

      await processOrder(ctx.supabase, order, ctx.connection.restaurant_id, ctx.connection.toast_restaurant_guid, {
        skipUnifiedSalesSync: true
      });
      totalOrdersForRestaurant++;
    }

    const shouldContinue = orders.length >= PAGE_SIZE && totalOrdersForRestaurant < MAX_ORDERS_PER_RESTAURANT;
    if (!shouldContinue) break;

    page++;
    await new Promise(resolve => setTimeout(resolve, 200));
  }

  return totalOrdersForRestaurant;
}

async function syncUnifiedSales(
  supabase: SupabaseClient,
  restaurantId: string,
  ordersProcessed: number,
  startDate: string,
  endDate: string
): Promise<void> {
  if (ordersProcessed === 0) return;

  console.log(`Syncing to unified_sales for date range ${startDate} to ${endDate}...`);
  // Use date-range version to avoid CPU timeouts on large datasets
  const { error: rpcError } = await supabase.rpc('sync_toast_to_unified_sales', {
    p_restaurant_id: restaurantId,
    p_start_date: startDate.split('T')[0],  // Extract date portion
    p_end_date: endDate.split('T')[0]
  });

  if (rpcError) {
    console.warn('unified_sales sync warning:', rpcError.message);
  }
}

async function updateConnectionSuccess(
  supabase: SupabaseClient,
  connectionId: string
): Promise<void> {
  await supabase.from('toast_connections').update({
    last_sync_time: new Date().toISOString(),
    initial_sync_done: true,
    connection_status: 'connected',
    last_error: null,
    last_error_at: null
  }).eq('id', connectionId);
}

async function updateConnectionError(
  supabase: SupabaseClient,
  connectionId: string,
  errorMessage: string
): Promise<void> {
  await supabase.from('toast_connections').update({
    connection_status: 'error',
    last_error: errorMessage,
    last_error_at: new Date().toISOString()
  }).eq('id', connectionId);
}

async function processConnection(
  supabase: SupabaseClient,
  connection: ToastConnection,
  encryption: EncryptionService,
  results: SyncResults
): Promise<void> {
  try {
    console.log(`Processing restaurant: ${connection.toast_restaurant_guid}`);

    const accessToken = await getValidAccessToken(connection, encryption, supabase);

    // Determine sync window
    const syncHoursBack = connection.initial_sync_done ? 25 : 72;
    const startDate = new Date(Date.now() - syncHoursBack * 3600 * 1000).toISOString();
    const endDate = new Date().toISOString();

    console.log(`Syncing orders from ${startDate} (${syncHoursBack}h back)`);

    const ctx: FetchContext = {
      supabase,
      connection,
      encryption,
      accessToken
    };

    const totalOrdersForRestaurant = await fetchAndProcessOrders(
      ctx,
      startDate,
      endDate
    );

    await syncUnifiedSales(supabase, connection.restaurant_id, totalOrdersForRestaurant, startDate, endDate);
    await updateConnectionSuccess(supabase, connection.id);

    await logSecurityEvent(supabase, 'TOAST_BULK_SYNC_SUCCESS', undefined, connection.restaurant_id, {
      ordersProcessed: totalOrdersForRestaurant,
      restaurantGuid: connection.toast_restaurant_guid
    });

    results.successfulSyncs++;
    results.totalOrdersSynced += totalOrdersForRestaurant;

    console.log(`Synced ${totalOrdersForRestaurant} orders for restaurant ${connection.toast_restaurant_guid}`);

  } catch (error: unknown) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    console.error(`Error syncing restaurant ${connection.toast_restaurant_guid}:`, errorMessage);

    await updateConnectionError(supabase, connection.id, errorMessage);

    results.failedSyncs++;
    results.errors.push(`${connection.toast_restaurant_guid}: ${errorMessage}`);
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

    const { data: connections, error: connectionsError } = await supabase
      .from('toast_connections')
      .select('*')
      .eq('is_active', true)
      .order('last_sync_time', { ascending: true, nullsFirst: true })
      .limit(MAX_RESTAURANTS_PER_RUN);

    if (connectionsError) {
      throw new Error(`Failed to fetch connections: ${connectionsError.message}`);
    }

    const results: SyncResults = {
      totalConnections: connections?.length || 0,
      successfulSyncs: 0,
      failedSyncs: 0,
      totalOrdersSynced: 0,
      errors: [],
      processingTimeMs: 0
    };

    if (!connections || connections.length === 0) {
      console.log('No active Toast connections found');
      results.processingTimeMs = Date.now() - startTime;
      return jsonResponse(results);
    }

    const encryption = await getEncryptionService();

    for (let i = 0; i < connections.length; i++) {
      if (i > 0) {
        await new Promise(resolve => setTimeout(resolve, DELAY_BETWEEN_RESTAURANTS_MS));
      }

      console.log(`[${i + 1}/${connections.length}] Starting...`);
      await processConnection(supabase, connections[i], encryption, results);
    }

    results.processingTimeMs = Date.now() - startTime;
    console.log(`Bulk sync completed in ${results.processingTimeMs}ms:`, results);

    return jsonResponse(results);

  } catch (error: unknown) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    console.error('Toast bulk sync error:', errorMessage);
    return jsonResponse({ error: errorMessage }, 500);
  }
});
