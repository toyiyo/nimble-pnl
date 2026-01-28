/**
 * Shift4/Lighthouse Manual Sync Edge Function
 *
 * Handles manual sync requests from the UI. Supports initial_sync, hourly_sync,
 * daily_sync, and custom date ranges.
 */

import { createClient, SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.57.4";

import { getEncryptionService } from "../_shared/encryption.ts";
import { logSecurityEvent } from "../_shared/securityEvents.ts";
import { Shift4Connection, syncLighthouseData, SyncStats } from "../_shared/lighthouseSync.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type"
};

const TARGET_DAYS = 90;
const BATCH_DAYS = 3;
const INCREMENTAL_HOURS = 25;

interface SyncRange {
  startDate: Date;
  endDate: Date;
  isInitialSync: boolean;
  newCursor: number;
  syncComplete: boolean;
}

function calculateDateRangeSync(
  syncCursor: number,
  dateRange: { startDate: string; endDate: string },
  initialSyncDone: boolean
): SyncRange {
  return {
    startDate: new Date(dateRange.startDate),
    endDate: new Date(dateRange.endDate),
    isInitialSync: false,
    newCursor: syncCursor,
    syncComplete: initialSyncDone
  };
}

function calculateInitialSync(syncCursor: number): SyncRange {
  const now = Date.now();
  const endDaysBack = syncCursor;
  const startDaysBack = Math.min(syncCursor + BATCH_DAYS, TARGET_DAYS);
  const newCursor = Math.min(syncCursor + BATCH_DAYS, TARGET_DAYS);

  console.log(`[Initial Sync] Cursor: ${syncCursor} -> ${newCursor}, Days: ${endDaysBack}-${startDaysBack}`);

  return {
    startDate: new Date(now - startDaysBack * 24 * 3600 * 1000),
    endDate: new Date(now - endDaysBack * 24 * 3600 * 1000),
    isInitialSync: true,
    newCursor,
    syncComplete: newCursor >= TARGET_DAYS
  };
}

function calculateDailySync(): SyncRange {
  const endDate = new Date();
  const startDate = new Date();
  startDate.setDate(endDate.getDate() - 1);
  return { startDate, endDate, isInitialSync: false, newCursor: 0, syncComplete: true };
}

function calculateIncrementalSync(): SyncRange {
  return {
    startDate: new Date(Date.now() - INCREMENTAL_HOURS * 3600 * 1000),
    endDate: new Date(),
    isInitialSync: false,
    newCursor: 0,
    syncComplete: true
  };
}

function calculateSyncRange(
  connection: Shift4Connection,
  action: string | undefined,
  dateRange?: { startDate: string; endDate: string }
): SyncRange {
  const syncCursor = connection.sync_cursor || 0;
  const isInitialSync = !connection.initial_sync_done;

  if (dateRange) {
    return calculateDateRangeSync(syncCursor, dateRange, connection.initial_sync_done || false);
  }

  if (action === 'initial_sync' || (isInitialSync && syncCursor < TARGET_DAYS)) {
    return calculateInitialSync(syncCursor);
  }

  if (action === 'daily_sync') {
    return calculateDailySync();
  }

  return calculateIncrementalSync();
}

async function authenticateUser(
  supabase: SupabaseClient,
  authHeader: string | null,
  restaurantId: string
): Promise<string | null> {
  if (!authHeader) return null;

  const token = authHeader.replace('Bearer ', '');
  const { data: { user }, error: userError } = await supabase.auth.getUser(token);

  if (userError || !user) {
    throw new Error('Invalid authentication token');
  }

  const { data: userRestaurant, error: restaurantError } = await supabase
    .from('user_restaurants')
    .select('role')
    .eq('user_id', user.id)
    .eq('restaurant_id', restaurantId)
    .single();

  if (restaurantError || !userRestaurant) {
    throw new Error('Access denied: User does not have access to this restaurant');
  }

  if (!['owner', 'manager'].includes(userRestaurant.role)) {
    throw new Error('Access denied: Only owners and managers can sync POS data');
  }

  return user.id;
}

async function updateConnectionSuccess(
  supabase: SupabaseClient,
  connectionId: string,
  isInitialSync: boolean,
  newCursor: number,
  syncComplete: boolean
): Promise<void> {
  const updatePayload: Record<string, unknown> = {
    last_sync_at: new Date().toISOString(),
    last_sync_time: new Date().toISOString(),
    connection_status: 'connected',
    last_error: null,
    last_error_at: null
  };

  if (isInitialSync) {
    updatePayload.sync_cursor = syncComplete ? 0 : newCursor;
    updatePayload.initial_sync_done = syncComplete;
  }

  await supabase.from('shift4_connections').update(updatePayload).eq('id', connectionId);
}

async function updateConnectionError(
  supabase: SupabaseClient,
  connectionId: string,
  errorMessage: string
): Promise<void> {
  await supabase.from('shift4_connections').update({
    connection_status: 'error',
    last_error: errorMessage,
    last_error_at: new Date().toISOString()
  }).eq('id', connectionId);
}

function buildResponsePayload(
  stats: SyncStats,
  isInitialSync: boolean,
  newCursor: number,
  syncComplete: boolean,
  initialSyncDone: boolean
) {
  return {
    success: stats.errors.length === 0,
    results: {
      chargesSynced: stats.ticketsProcessed,
      refundsSynced: 0,
      errors: stats.errors
    },
    stats,
    syncProgress: {
      isInitialSync,
      syncCursor: syncComplete ? 0 : newCursor,
      syncComplete: syncComplete || initialSyncDone,
      daysRemaining: syncComplete ? 0 : TARGET_DAYS - newCursor
    }
  };
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' }
  });
}

const SENSITIVE_PATTERNS = /supabase|password|secret|token|key|credential/i;

function sanitizeErrorMessage(message: string): string {
  if (SENSITIVE_PATTERNS.test(message)) {
    return 'An internal error occurred during sync';
  }
  return message;
}

async function handleSyncRequest(req: Request): Promise<Response> {
  const supabase = createClient(
    Deno.env.get('SUPABASE_URL') ?? '',
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
  );

  const body = await req.json();
  const { restaurantId, action, dateRange } = body;

  if (!restaurantId) {
    throw new Error('Restaurant ID is required');
  }

  const userId = await authenticateUser(supabase, req.headers.get('Authorization'), restaurantId);
  console.log('Shift4 sync started:', { restaurantId, action, dateRange, userId });

  const { data: connection, error: connError } = await supabase
    .from('shift4_connections')
    .select('*')
    .eq('restaurant_id', restaurantId)
    .single();

  if (connError || !connection) {
    throw new Error('Shift4 connection not found');
  }

  const { data: restaurant } = await supabase
    .from('restaurants')
    .select('timezone')
    .eq('id', restaurantId)
    .single();

  const restaurantTimezone = restaurant?.timezone || 'America/Chicago';

  if (userId) {
    await logSecurityEvent(supabase as any, 'SHIFT4_KEY_ACCESSED', userId, restaurantId, {
      action,
      merchantId: connection.merchant_id
    });
  }

  const { startDate, endDate, isInitialSync, newCursor, syncComplete } = calculateSyncRange(
    connection as Shift4Connection,
    action,
    dateRange
  );

  console.log('Syncing Shift4 data:', {
    startDate: startDate.toISOString(),
    endDate: endDate.toISOString(),
    timezone: restaurantTimezone,
    isInitialSync,
    syncCursor: connection.sync_cursor,
    newCursor
  });

  const encryption = await getEncryptionService();
  let stats: SyncStats;

  try {
    stats = await syncLighthouseData(
      supabase as any,
      connection as Shift4Connection,
      startDate,
      endDate,
      restaurantTimezone,
      encryption,
      {}
    );

    await updateConnectionSuccess(supabase, connection.id, isInitialSync, newCursor, syncComplete);

    if (userId) {
      await logSecurityEvent(supabase as any, 'SHIFT4_SYNC_SUCCESS', userId, restaurantId, {
        ticketsProcessed: stats.ticketsProcessed,
        rowsInserted: stats.rowsInserted,
        action
      });
    }
  } catch (syncError: unknown) {
    console.error('Lighthouse sync error:', syncError);
    const errMsg = syncError instanceof Error ? syncError.message : String(syncError);
    await updateConnectionError(supabase, connection.id, errMsg);
    throw syncError;
  }

  console.log('[Lighthouse Sync] Summary', {
    ticketsProcessed: stats.ticketsProcessed,
    rowsInserted: stats.rowsInserted,
    errors: stats.errors.length
  });

  const payload = buildResponsePayload(stats, isInitialSync, newCursor, syncComplete, connection.initial_sync_done);
  return jsonResponse(payload, payload.success ? 200 : 207);
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    return await handleSyncRequest(req);
  } catch (error: unknown) {
    console.error('Shift4 sync error:', error);
    const errMsg = error instanceof Error ? error.message : String(error);
    const sanitizedMsg = sanitizeErrorMessage(errMsg);
    return jsonResponse({ success: false, error: sanitizedMsg }, 400);
  }
});
