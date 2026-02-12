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
// Batch sizes optimized for Supabase Edge Function CPU limits (2s per request)
// Toast API allows pageSize up to 100 - use max to minimize requests
const BATCH_DAYS = 1;
const MAX_ORDERS_PER_REQUEST = 50;   // Orders to process per edge function request
const PAGE_SIZE = 100;               // Toast API max - minimizes API calls
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
  sync_page?: number;  // Page cursor within current sync_cursor day
}

interface SyncContext {
  connection: ToastConnection;
  encryption: EncryptionService;
  serviceSupabase: SupabaseClient;
  accessToken: string;
  tokenRefreshed?: boolean;  // Prevents multiple refresh attempts per sync session
}

interface OrderFetchResult {
  ordersProcessed: number;
  errors: Array<{ orderGuid: string; message: string }>;
  hasMore: boolean;  // True if we stopped due to maxOrders limit (more orders may exist)
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

interface OrderPageResult {
  orders: unknown[];
  refreshedToken?: string;
  hasNextPage: boolean;  // From Link header rel="next"
}

function checkHasNextPage(response: Response): boolean {
  // Toast API uses RFC 5988 Link headers for pagination
  // Example: <url>; rel="next", <url>; rel="self"
  const linkHeader = response.headers.get('Link');
  if (!linkHeader) return false;
  return linkHeader.includes('rel="next"');
}

async function fetchOrderPage(
  ctx: SyncContext,
  rangeStart: string,
  rangeEnd: string,
  page: number
): Promise<OrderPageResult> {
  const bulkUrl = `https://ws-api.toasttab.com/orders/v2/ordersBulk?startDate=${encodeURIComponent(rangeStart)}&endDate=${encodeURIComponent(rangeEnd)}&pageSize=${PAGE_SIZE}&page=${page}`;

  let ordersResponse = await fetchWithTimeout(bulkUrl, {
    headers: {
      'Authorization': `Bearer ${ctx.accessToken}`,
      'Toast-Restaurant-External-ID': ctx.connection.toast_restaurant_guid
    }
  }, 30000);

  // Handle 401 with one retry after token refresh (per sync session)
  if (!ordersResponse.ok && ordersResponse.status === 401 && !ctx.tokenRefreshed) {
    if (DEBUG) console.log('Got 401, attempting token refresh and retry...');
    ctx.tokenRefreshed = true;
    const newToken = await refreshAccessToken(ctx.connection, ctx.encryption, ctx.serviceSupabase);

    ordersResponse = await fetchWithTimeout(bulkUrl, {
      headers: {
        'Authorization': `Bearer ${newToken}`,
        'Toast-Restaurant-External-ID': ctx.connection.toast_restaurant_guid
      }
    }, 30000);

    if (ordersResponse.ok) {
      const hasNextPage = checkHasNextPage(ordersResponse);
      return { orders: await ordersResponse.json(), refreshedToken: newToken, hasNextPage };
    }
  }

  if (!ordersResponse.ok) {
    throw new Error(`Failed to fetch orders: ${ordersResponse.status}`);
  }

  const hasNextPage = checkHasNextPage(ordersResponse);
  return { orders: await ordersResponse.json(), hasNextPage };
}

interface FetchRangeOptions {
  startPage?: number;  // Resume from this page (for cursor-based pagination)
}

interface OrderFetchResultWithCursor extends OrderFetchResult {
  nextPage?: number;  // Next page to fetch if hasMore is true
}

async function fetchOrdersForRange(
  ctx: SyncContext,
  rangeStart: string,
  rangeEnd: string,
  maxOrders: number,
  options?: FetchRangeOptions
): Promise<OrderFetchResultWithCursor> {
  const errors: Array<{ orderGuid: string; message: string }> = [];
  let rangeOrders = 0;
  let page = options?.startPage || 1;
  let apiHasMorePages = false;  // From Toast API Link header (rel="next")

  while (rangeOrders < maxOrders) {
    const { orders, refreshedToken, hasNextPage } = await fetchOrderPage(ctx, rangeStart, rangeEnd, page);
    apiHasMorePages = hasNextPage;

    if (refreshedToken) {
      ctx.accessToken = refreshedToken;
    }

    if (!orders || orders.length === 0) {
      apiHasMorePages = false;
      break;
    }

    for (const order of orders) {
      const result = await processOrderSafely(ctx, order, errors);
      if (result) rangeOrders++;
    }

    // Continue if API has more pages AND we haven't hit our limit
    const shouldContinue = apiHasMorePages && rangeOrders < maxOrders;
    if (!shouldContinue) break;

    page++;
    await new Promise(resolve => setTimeout(resolve, 200));
  }

  // hasMore is true if we stopped because of maxOrders limit AND API has more pages
  const hasMore = rangeOrders >= maxOrders && apiHasMorePages;
  // Return next page for cursor-based pagination
  const nextPage = hasMore ? page + 1 : undefined;
  return { ordersProcessed: rangeOrders, errors, hasMore, nextPage };
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

interface DateRangeValidation {
  isCustomRange: boolean;
  error?: string;
}

function validateDateRange(
  startDate: string | undefined,
  endDate: string | undefined
): DateRangeValidation {
  if (!startDate && !endDate) {
    return { isCustomRange: false };
  }

  if (!startDate || !endDate) {
    return { isCustomRange: false, error: 'Both startDate and endDate are required for custom range' };
  }

  const start = new Date(startDate);
  const end = new Date(endDate);

  if (isNaN(start.getTime()) || isNaN(end.getTime())) {
    return { isCustomRange: true, error: 'Invalid date format. Use ISO 8601 format.' };
  }

  if (start > end) {
    return { isCustomRange: true, error: 'Start date must be before end date' };
  }

  const daysDiff = (end.getTime() - start.getTime()) / (1000 * 60 * 60 * 24);
  if (daysDiff > 90) {
    return { isCustomRange: true, error: 'Date range cannot exceed 90 days' };
  }

  return { isCustomRange: true };
}

interface SyncRange {
  isInitialSync: boolean;
  syncCursor: number;
  batchStart: Date;
  batchEnd: Date;
}

function calculateSyncRange(connection: ToastConnection): SyncRange {
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

interface UnifiedSalesSyncParams {
  serviceSupabase: SupabaseClient;
  restaurantId: string;
  isInitialSync: boolean;
  isCustomRange: boolean;
  totalOrders: number;
  startDate: string;
  endDate: string;
}

async function tryUnifiedSalesSync(params: UnifiedSalesSyncParams): Promise<void> {
  const { serviceSupabase, restaurantId, isInitialSync, isCustomRange, totalOrders, startDate, endDate } = params;
  const ORDER_THRESHOLD = 50;

  // Skip unified_sales sync during initial 90-day import or large batches
  // UNLESS this is a custom range sync - user explicitly requested this data
  // The scheduled cron job only processes last 7 days, so custom ranges need immediate sync
  if (!isCustomRange && (isInitialSync || totalOrders >= ORDER_THRESHOLD)) {
    if (DEBUG) console.log('Data imported - unified_sales sync will be handled by scheduled job');
    return;
  }

  if (DEBUG) console.log(`Syncing to unified_sales for ${startDate} to ${endDate}...`);

  try {
    const { error: rpcError } = await serviceSupabase.rpc('sync_toast_to_unified_sales', {
      p_restaurant_id: restaurantId,
      p_start_date: startDate.split('T')[0],
      p_end_date: endDate.split('T')[0]
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
    let customStartDate: string | undefined;
    let customEndDate: string | undefined;
    let startPage = 1;  // Page cursor for resuming custom range syncs
    try {
      const body = await req.json();
      restaurantId = body.restaurantId;
      customStartDate = body.startDate;
      customEndDate = body.endDate;
      startPage = body.page || 1;  // Resume from this page if provided
    } catch {
      return jsonResponse({ error: 'Invalid JSON body' }, 400);
    }

    if (!restaurantId) {
      return jsonResponse({ error: 'Missing restaurantId' }, 400);
    }

    const dateRangeValidation = validateDateRange(customStartDate, customEndDate);
    if (dateRangeValidation.error) {
      return jsonResponse({ error: dateRangeValidation.error }, 400);
    }
    const isCustomRange = dateRangeValidation.isCustomRange;

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

    let totalOrders = 0;
    let allErrors: Array<{ orderGuid: string; message: string }> = [];
    let syncComplete = false;
    let newCursor = 0;
    let progress = 100;
    let syncStartDate = '';
    let syncEndDate = '';
    let isInitialSyncPhase = false;
    let nextPage: number | undefined;  // Page cursor for custom range pagination

    // Custom date range sync (user-specified backfill)
    if (isCustomRange) {
      if (DEBUG) {
        console.log(`Custom range sync: ${customStartDate} to ${customEndDate}, starting page: ${startPage}`);
      }

      syncStartDate = customStartDate!;
      syncEndDate = customEndDate!;
      isInitialSyncPhase = false;

      const result = await fetchOrdersForRange(ctx, syncStartDate, syncEndDate, MAX_ORDERS_PER_REQUEST, { startPage });
      totalOrders = result.ordersProcessed;
      allErrors = result.errors;
      syncComplete = !result.hasMore;
      nextPage = result.nextPage;  // Pass to frontend for next request
      progress = syncComplete ? 100 : 50;

      if (DEBUG) console.log(`Custom range batch: ${totalOrders} orders, hasMore: ${result.hasMore}, nextPage: ${nextPage}`);
    } else {
      // Normal sync logic (initial or incremental)
      const { isInitialSync, syncCursor, batchStart, batchEnd } = calculateSyncRange(connection);
      newCursor = syncCursor;
      syncStartDate = batchStart.toISOString();
      syncEndDate = batchEnd.toISOString();
      isInitialSyncPhase = isInitialSync;

      if (DEBUG) {
        console.log(`Starting sync (initial_sync: ${isInitialSync}, cursor: ${syncCursor} days)`);
        console.log(`Sync range: ${syncStartDate} to ${syncEndDate}`);
      }

      if (isInitialSync && syncCursor < TARGET_DAYS) {
        // Use sync_page to resume within a day if needed (for days with many orders)
        const currentPage = connection.sync_page || 1;
        const result = await fetchOrdersForRange(ctx, syncStartDate, syncEndDate, MAX_ORDERS_PER_REQUEST, { startPage: currentPage });
        totalOrders = result.ordersProcessed;
        allErrors = result.errors;

        if (result.hasMore) {
          // More orders on this day - stay on same day, save next page
          newCursor = syncCursor;  // Don't advance
          nextPage = result.nextPage;
          syncComplete = false;
          if (DEBUG) console.log(`Day has more orders, staying on cursor ${syncCursor}, next page: ${nextPage}`);
        } else {
          // Day complete - move to next day, reset page to 1
          newCursor = Math.min(syncCursor + BATCH_DAYS, TARGET_DAYS);
          nextPage = 1;  // Reset for next day
          syncComplete = newCursor >= TARGET_DAYS;
          if (DEBUG) console.log(`Day complete, advancing cursor to ${newCursor}`);
        }

        progress = Math.round((newCursor / TARGET_DAYS) * 100);
        if (DEBUG) console.log(`Batch complete: ${totalOrders} orders, cursor: ${newCursor}, page: ${nextPage}`);
      } else if (isInitialSync) {
        syncComplete = true;
      } else {
        // Incremental sync (last 25 hours) - paginated like custom range
        const result = await fetchOrdersForRange(ctx, syncStartDate, syncEndDate, MAX_ORDERS_PER_REQUEST, { startPage });
        totalOrders = result.ordersProcessed;
        allErrors = result.errors;
        syncComplete = !result.hasMore;
        nextPage = result.nextPage;
        progress = syncComplete ? 100 : 50;
      }
    }

    // Sync to unified_sales if we have orders (using date range to avoid CPU timeout)
    if (syncComplete && totalOrders > 0) {
      await tryUnifiedSalesSync({
        serviceSupabase,
        restaurantId: connection.restaurant_id,
        isInitialSync: isInitialSyncPhase,
        isCustomRange,
        totalOrders,
        startDate: syncStartDate,
        endDate: syncEndDate
      });
    }

    // Update sync progress (skip for custom range backfills - don't change cursor)
    if (!isCustomRange) {
      const syncUpdate: Record<string, unknown> = {
        last_sync_time: new Date().toISOString(),
        connection_status: 'connected',
        last_error: null,
        last_error_at: null,
        sync_cursor: syncComplete ? 0 : newCursor,
        sync_page: syncComplete ? 1 : (nextPage || 1)  // Reset to 1 when complete, otherwise save next page
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
    }

    await logSecurityEvent(serviceSupabase, 'TOAST_MANUAL_SYNC', user.id, connection.restaurant_id, {
      ordersSynced: totalOrders,
      errorCount: allErrors.length,
      syncComplete,
      customRange: isCustomRange ? { startDate: customStartDate, endDate: customEndDate } : undefined
    });

    if (DEBUG) console.log(`Sync batch complete: ${totalOrders} orders, ${allErrors.length} errors, complete: ${syncComplete}`);

    return jsonResponse({
      success: true,
      ordersSynced: totalOrders,
      errors: allErrors,
      syncComplete,
      progress,
      isCustomRange,
      nextPage  // Page cursor for frontend to resume custom range sync
    });

  } catch (error: any) {
    console.error('Toast manual sync error:', error);
    return jsonResponse({ error: error.message }, 500);
  }
});
