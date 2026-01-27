import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient, SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";
import { getEncryptionService, EncryptionService } from "../_shared/encryption.ts";
import { logSecurityEvent } from "../_shared/securityEvents.ts";
import { processOrder } from "../_shared/toastOrderProcessor.ts";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

const FETCH_TIMEOUT_MS = 20000;
const DEBUG = Deno.env.get('DEBUG') === 'true';
const TOAST_AUTH_URL = 'https://ws-api.toasttab.com/authentication/v1/authentication/login';
const BATCH_DAYS = 3;
const MAX_ORDERS_PER_REQUEST = 100;
const TARGET_DAYS = 90;
const MAX_ERRORS = 50;

interface ToastConnection {
  id: string;
  restaurant_id: string;
  client_id: string;
  client_secret_encrypted: string;
  access_token_encrypted?: string;
  token_expires_at?: string;
  toast_restaurant_guid: string;
  initial_sync_done?: boolean;
  sync_cursor?: number;
}

interface SyncContext {
  connection: ToastConnection;
  encryption: EncryptionService;
  serviceSupabase: SupabaseClient;
  accessToken: string;
}

interface OrderFetchResult {
  ordersProcessed: number;
  errors: Array<{ orderGuid: string; message: string }>;
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}

function fetchWithTimeout(
  input: RequestInfo | URL,
  init: RequestInit = {},
  timeoutMs = FETCH_TIMEOUT_MS
): Promise<Response> {
  const controller = new AbortController();
  const id = setTimeout(() => controller.abort(), timeoutMs);
  return fetch(input, { ...init, signal: controller.signal }).finally(() => clearTimeout(id));
}

async function refreshAccessToken(
  connection: ToastConnection,
  encryption: EncryptionService,
  serviceSupabase: SupabaseClient
): Promise<string> {
  if (DEBUG) console.log('Refreshing access token...');
  const clientSecret = await encryption.decrypt(connection.client_secret_encrypted);

  const authResponse = await fetchWithTimeout(TOAST_AUTH_URL, {
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
  const accessToken = authData.token.accessToken;

  const encryptedToken = await encryption.encrypt(accessToken);
  const expiresAt = new Date(Date.now() + (authData.token.expiresIn * 1000));

  const { error: tokenUpdateError } = await serviceSupabase.from('toast_connections').update({
    access_token_encrypted: encryptedToken,
    token_expires_at: expiresAt.toISOString(),
    token_fetched_at: new Date().toISOString()
  }).eq('id', connection.id);

  if (tokenUpdateError) {
    console.error('Failed to update token:', tokenUpdateError.message);
  }

  return accessToken;
}

async function getValidAccessToken(
  connection: ToastConnection,
  encryption: EncryptionService,
  serviceSupabase: SupabaseClient
): Promise<string> {
  const existingToken = connection.access_token_encrypted
    ? await encryption.decrypt(connection.access_token_encrypted)
    : null;

  const tokenExpired = !connection.token_expires_at ||
    new Date(connection.token_expires_at).getTime() < Date.now() + (3600 * 1000);

  if (existingToken && !tokenExpired) {
    return existingToken;
  }

  return refreshAccessToken(connection, encryption, serviceSupabase);
}

async function fetchOrderPage(
  ctx: SyncContext,
  rangeStart: string,
  rangeEnd: string,
  page: number
): Promise<{ orders: any[]; refreshedToken?: string }> {
  const bulkUrl = `https://ws-api.toasttab.com/orders/v2/ordersBulk?startDate=${encodeURIComponent(rangeStart)}&endDate=${encodeURIComponent(rangeEnd)}&pageSize=100&page=${page}`;

  let ordersResponse = await fetchWithTimeout(bulkUrl, {
    headers: {
      'Authorization': `Bearer ${ctx.accessToken}`,
      'Toast-Restaurant-External-ID': ctx.connection.toast_restaurant_guid
    }
  }, 30000);

  // Handle 401 with one retry after token refresh
  if (!ordersResponse.ok && ordersResponse.status === 401 && page === 1) {
    if (DEBUG) console.log('Got 401, attempting token refresh and retry...');
    const newToken = await refreshAccessToken(ctx.connection, ctx.encryption, ctx.serviceSupabase);

    ordersResponse = await fetchWithTimeout(bulkUrl, {
      headers: {
        'Authorization': `Bearer ${newToken}`,
        'Toast-Restaurant-External-ID': ctx.connection.toast_restaurant_guid
      }
    }, 30000);

    if (ordersResponse.ok) {
      return { orders: await ordersResponse.json(), refreshedToken: newToken };
    }
  }

  if (!ordersResponse.ok) {
    throw new Error(`Failed to fetch orders: ${ordersResponse.status}`);
  }

  return { orders: await ordersResponse.json() };
}

async function fetchOrdersForRange(
  ctx: SyncContext,
  rangeStart: string,
  rangeEnd: string,
  maxOrders: number
): Promise<OrderFetchResult> {
  const errors: Array<{ orderGuid: string; message: string }> = [];
  let rangeOrders = 0;
  let page = 1;

  while (rangeOrders < maxOrders) {
    const { orders, refreshedToken } = await fetchOrderPage(ctx, rangeStart, rangeEnd, page);

    if (refreshedToken) {
      ctx.accessToken = refreshedToken;
    }

    if (!orders || orders.length === 0) {
      break;
    }

    for (const order of orders) {
      const result = await processOrderSafely(ctx, order, errors);
      if (result) rangeOrders++;
    }

    const shouldContinue = orders.length >= 100 && rangeOrders < maxOrders;
    if (!shouldContinue) break;

    page++;
    await new Promise(resolve => setTimeout(resolve, 200));
  }

  return { ordersProcessed: rangeOrders, errors };
}

async function processOrderSafely(
  ctx: SyncContext,
  order: any,
  errors: Array<{ orderGuid: string; message: string }>
): Promise<boolean> {
  try {
    await processOrder(
      ctx.serviceSupabase,
      order,
      ctx.connection.restaurant_id,
      ctx.connection.toast_restaurant_guid,
      { skipUnifiedSalesSync: true }
    );
    return true;
  } catch (orderError: any) {
    console.error(`Error processing order ${order.guid || 'unknown'}:`, orderError.message);
    if (errors.length < MAX_ERRORS) {
      errors.push({
        orderGuid: order.guid || order.id || 'unknown',
        message: orderError.message || 'Unknown error'
      });
    }
    return false;
  }
}

function calculateSyncRange(connection: ToastConnection): {
  isInitialSync: boolean;
  syncCursor: number;
  batchStart: Date;
  batchEnd: Date;
} {
  const isInitialSync = !connection.initial_sync_done;
  const syncCursor = connection.sync_cursor || 0;
  const now = Date.now();

  if (isInitialSync && syncCursor < TARGET_DAYS) {
    const batchEnd = new Date(now - syncCursor * 24 * 3600 * 1000);
    const batchStart = new Date(now - Math.min(syncCursor + BATCH_DAYS, TARGET_DAYS) * 24 * 3600 * 1000);
    return { isInitialSync, syncCursor, batchStart, batchEnd };
  }

  // Incremental sync: 25 hours
  const batchEnd = new Date(now);
  const batchStart = new Date(now - 25 * 3600 * 1000);
  return { isInitialSync, syncCursor, batchStart, batchEnd };
}

async function tryUnifiedSalesSync(
  serviceSupabase: SupabaseClient,
  restaurantId: string,
  isInitialSync: boolean,
  totalOrders: number
): Promise<void> {
  if (isInitialSync || totalOrders >= 50) {
    if (DEBUG) console.log('Data imported - unified_sales sync will be handled by scheduled job');
    return;
  }

  try {
    const { error: rpcError } = await serviceSupabase.rpc('sync_toast_to_unified_sales', {
      p_restaurant_id: restaurantId
    });
    if (rpcError) {
      console.warn('RPC sync_toast_to_unified_sales warning:', rpcError.message);
    }
  } catch {
    console.warn('Unified sales sync deferred to cron job');
  }
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    if (DEBUG) console.log('Toast manual sync started');

    const authHeader = req.headers.get('Authorization');
    if (!authHeader) {
      return jsonResponse({ error: 'Missing authorization' }, 401);
    }

    const supabaseUrl = Deno.env.get('SUPABASE_URL');
    const supabaseAnonKey = Deno.env.get('SUPABASE_ANON_KEY');
    const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');

    if (!supabaseUrl || !supabaseAnonKey || !supabaseServiceKey) {
      console.error('Missing required environment variables');
      return jsonResponse({ error: 'Server misconfigured' }, 500);
    }

    const userSupabase = createClient(supabaseUrl, supabaseAnonKey, {
      global: { headers: { Authorization: authHeader } },
    });
    const serviceSupabase = createClient(supabaseUrl, supabaseServiceKey);

    const { data: { user } } = await userSupabase.auth.getUser();
    if (!user) {
      return jsonResponse({ error: 'Unauthorized' }, 401);
    }

    let restaurantId: string | undefined;
    try {
      ({ restaurantId } = await req.json());
    } catch {
      return jsonResponse({ error: 'Invalid JSON body' }, 400);
    }

    if (!restaurantId) {
      return jsonResponse({ error: 'Missing restaurantId' }, 400);
    }

    // Authorization gate: verify user has access via RLS
    const { data: authorizedConn, error: authorizedConnError } = await userSupabase
      .from('toast_connections')
      .select('id')
      .eq('restaurant_id', restaurantId)
      .eq('is_active', true)
      .maybeSingle();

    if (authorizedConnError || !authorizedConn?.id) {
      console.error('Authorization failed:', authorizedConnError?.message || 'No connection found');
      return jsonResponse({ error: 'Forbidden - no access to this restaurant' }, 403);
    }

    // Privileged fetch of full connection row
    const { data: connection, error: connectionError } = await serviceSupabase
      .from('toast_connections')
      .select('*')
      .eq('id', authorizedConn.id)
      .single();

    if (connectionError || !connection) {
      console.error('Connection fetch failed:', connectionError?.message);
      return jsonResponse({ error: 'No active Toast connection found' }, 404);
    }

    if (!connection.client_secret_encrypted) {
      console.error('Missing client_secret_encrypted for connection:', connection.id);
      return jsonResponse({ error: 'Integration configuration incomplete - missing credentials' }, 409);
    }

    const encryption = await getEncryptionService();
    const accessToken = await getValidAccessToken(connection, encryption, serviceSupabase);

    const ctx: SyncContext = { connection, encryption, serviceSupabase, accessToken };
    const { isInitialSync, syncCursor, batchStart, batchEnd } = calculateSyncRange(connection);

    if (DEBUG) {
      console.log(`Starting sync (initial_sync: ${isInitialSync}, cursor: ${syncCursor} days)`);
      console.log(`Sync range: ${batchStart.toISOString()} to ${batchEnd.toISOString()}`);
    }

    let totalOrders = 0;
    let allErrors: Array<{ orderGuid: string; message: string }> = [];
    let syncComplete = false;
    let newCursor = syncCursor;

    if (isInitialSync && syncCursor < TARGET_DAYS) {
      const result = await fetchOrdersForRange(ctx, batchStart.toISOString(), batchEnd.toISOString(), MAX_ORDERS_PER_REQUEST);
      totalOrders = result.ordersProcessed;
      allErrors = result.errors;
      newCursor = Math.min(syncCursor + BATCH_DAYS, TARGET_DAYS);
      syncComplete = newCursor >= TARGET_DAYS;
      if (DEBUG) console.log(`Batch complete: ${totalOrders} orders, new cursor: ${newCursor}`);
    } else if (isInitialSync) {
      syncComplete = true;
    } else {
      const result = await fetchOrdersForRange(ctx, batchStart.toISOString(), batchEnd.toISOString(), MAX_ORDERS_PER_REQUEST);
      totalOrders = result.ordersProcessed;
      allErrors = result.errors;
      syncComplete = true;
    }

    if (syncComplete && totalOrders > 0) {
      await tryUnifiedSalesSync(serviceSupabase, connection.restaurant_id, isInitialSync, totalOrders);
    }

    // Update sync progress
    const syncUpdate: Record<string, unknown> = {
      last_sync_time: new Date().toISOString(),
      connection_status: 'connected',
      last_error: null,
      last_error_at: null,
      sync_cursor: syncComplete ? 0 : newCursor
    };
    if (syncComplete) {
      syncUpdate.initial_sync_done = true;
    }

    const { error: syncUpdateError } = await serviceSupabase
      .from('toast_connections')
      .update(syncUpdate)
      .eq('id', connection.id);

    if (syncUpdateError) {
      console.error('Failed to update sync progress:', syncUpdateError.message);
    }

    await logSecurityEvent(serviceSupabase, 'TOAST_MANUAL_SYNC', user.id, connection.restaurant_id, {
      ordersSynced: totalOrders,
      errorCount: allErrors.length,
      syncComplete
    });

    if (DEBUG) console.log(`Sync batch complete: ${totalOrders} orders, ${allErrors.length} errors, complete: ${syncComplete}`);

    return jsonResponse({
      success: true,
      ordersSynced: totalOrders,
      errors: allErrors,
      syncComplete,
      progress: isInitialSync ? Math.round((newCursor / TARGET_DAYS) * 100) : 100
    });

  } catch (error: any) {
    console.error('Toast manual sync error:', error);
    return jsonResponse({ error: error.message }, 500);
  }
});
