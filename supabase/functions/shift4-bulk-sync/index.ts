/**
 * Shift4/Lighthouse Bulk Sync Edge Function
 *
 * Scheduled cron job that syncs Shift4/Lighthouse data for multiple restaurants.
 * Runs every 2 hours at odd hours (1, 3, 5, ...) - offset from Toast (even hours).
 */

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient, SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";

import { getEncryptionService, EncryptionService } from "../_shared/encryption.ts";
import { logSecurityEvent } from "../_shared/securityEvents.ts";
import { Shift4Connection, syncLighthouseData, SyncStats } from "../_shared/lighthouseSync.ts";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const MAX_RESTAURANTS_PER_RUN = 5;
const MAX_TICKETS_PER_RESTAURANT = 200;
const TARGET_DAYS = 90;
const BATCH_DAYS = 3;
const DELAY_BETWEEN_RESTAURANTS_MS = 2000;
const INCREMENTAL_HOURS = 25;

interface BulkSyncResults {
  totalConnections: number;
  successfulSyncs: number;
  failedSyncs: number;
  totalTicketsSynced: number;
  errors: string[];
  processingTimeMs: number;
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}

function calculateSyncRange(connection: Shift4Connection): {
  startDate: Date;
  endDate: Date;
  isInitialSync: boolean;
  newCursor: number;
} {
  const isInitialSync = !connection.initial_sync_done;
  const syncCursor = connection.sync_cursor || 0;
  const now = Date.now();

  if (isInitialSync && syncCursor < TARGET_DAYS) {
    // Initial sync: process BATCH_DAYS days at a time, working backwards from today
    // cursor=0 means start from today, cursor=3 means days 3-6, etc.
    const endDaysBack = syncCursor;
    const startDaysBack = Math.min(syncCursor + BATCH_DAYS, TARGET_DAYS);

    const endDate = new Date(now - endDaysBack * 24 * 3600 * 1000);
    const startDate = new Date(now - startDaysBack * 24 * 3600 * 1000);
    const newCursor = Math.min(syncCursor + BATCH_DAYS, TARGET_DAYS);

    return { startDate, endDate, isInitialSync: true, newCursor };
  }

  // Incremental sync: last 25 hours
  const endDate = new Date(now);
  const startDate = new Date(now - INCREMENTAL_HOURS * 3600 * 1000);

  return { startDate, endDate, isInitialSync: false, newCursor: 0 };
}

async function updateConnectionSuccess(
  supabase: SupabaseClient,
  connectionId: string,
  newCursor: number,
  syncComplete: boolean
): Promise<void> {
  await supabase.from('shift4_connections').update({
    last_sync_time: new Date().toISOString(),
    sync_cursor: syncComplete ? 0 : newCursor,
    initial_sync_done: syncComplete,
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
  await supabase.from('shift4_connections').update({
    connection_status: 'error',
    last_error: errorMessage,
    last_error_at: new Date().toISOString()
  }).eq('id', connectionId);
}

async function processConnection(
  supabase: SupabaseClient,
  connection: Shift4Connection,
  encryption: EncryptionService,
  results: BulkSyncResults
): Promise<void> {
  try {
    console.log(`[Shift4 Bulk Sync] Processing restaurant: ${connection.restaurant_id}`);

    // Get restaurant timezone
    const { data: restaurant } = await supabase
      .from('restaurants')
      .select('timezone')
      .eq('id', connection.restaurant_id)
      .single();
    const timezone = restaurant?.timezone || 'America/Chicago';

    // Calculate sync date range
    const { startDate, endDate, isInitialSync, newCursor } = calculateSyncRange(connection);
    const syncComplete = !isInitialSync || newCursor >= TARGET_DAYS;

    console.log(`[Shift4 Bulk Sync] Range: ${startDate.toISOString()} - ${endDate.toISOString()}`);
    console.log(`[Shift4 Bulk Sync] Mode: ${isInitialSync ? `initial (cursor: ${connection.sync_cursor} -> ${newCursor})` : 'incremental'}`);

    // Sync data from Lighthouse
    const stats: SyncStats = await syncLighthouseData(
      supabase,
      connection,
      startDate,
      endDate,
      timezone,
      encryption,
      { maxTickets: MAX_TICKETS_PER_RESTAURANT }
    );

    // Update connection state
    await updateConnectionSuccess(
      supabase,
      connection.id,
      newCursor,
      syncComplete
    );

    // Log security event
    await logSecurityEvent(
      supabase,
      'SHIFT4_BULK_SYNC_SUCCESS',
      undefined,
      connection.restaurant_id,
      {
        ticketsProcessed: stats.ticketsProcessed,
        rowsInserted: stats.rowsInserted,
        syncCursor: newCursor,
        isInitialSync,
        syncComplete
      }
    );

    results.successfulSyncs++;
    results.totalTicketsSynced += stats.ticketsProcessed;

    if (stats.errors.length > 0) {
      // Partial success - some tickets had issues
      results.errors.push(`${connection.restaurant_id}: ${stats.errors.length} ticket errors`);
    }

    console.log(`[Shift4 Bulk Sync] Completed: ${stats.ticketsProcessed} tickets, ${stats.rowsInserted} rows`);
  } catch (error: unknown) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    console.error(`[Shift4 Bulk Sync] Error for ${connection.restaurant_id}:`, errorMessage);

    await updateConnectionError(supabase, connection.id, errorMessage);

    results.failedSyncs++;
    results.errors.push(`${connection.restaurant_id}: ${errorMessage}`);
  }
}

serve(async (req) => {
  // Handle CORS preflight
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  const startTime = Date.now();

  try {
    console.log('[Shift4 Bulk Sync] Started');

    const supabaseUrl = Deno.env.get('SUPABASE_URL') ?? '';
    const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    const { data: connections, error: connectionsError } = await supabase
      .from('shift4_connections')
      .select('*')
      .eq('is_active', true)
      .order('last_sync_time', { ascending: true, nullsFirst: true })
      .limit(MAX_RESTAURANTS_PER_RUN);

    if (connectionsError) {
      throw new Error(`Failed to fetch connections: ${connectionsError.message}`);
    }

    const results: BulkSyncResults = {
      totalConnections: connections?.length || 0,
      successfulSyncs: 0,
      failedSyncs: 0,
      totalTicketsSynced: 0,
      errors: [],
      processingTimeMs: 0
    };

    if (!connections || connections.length === 0) {
      console.log('[Shift4 Bulk Sync] No active connections found');
      results.processingTimeMs = Date.now() - startTime;
      return jsonResponse(results);
    }

    console.log(`[Shift4 Bulk Sync] Processing ${connections.length} connections`);

    const encryption = await getEncryptionService();

    for (let i = 0; i < connections.length; i++) {
      if (i > 0) {
        await new Promise((resolve) => setTimeout(resolve, DELAY_BETWEEN_RESTAURANTS_MS));
      }
      console.log(`[Shift4 Bulk Sync] [${i + 1}/${connections.length}] Starting...`);
      await processConnection(supabase, connections[i], encryption, results);
    }

    results.processingTimeMs = Date.now() - startTime;
    console.log(`[Shift4 Bulk Sync] Completed in ${results.processingTimeMs}ms:`, results);

    return jsonResponse(results);

  } catch (error: unknown) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    console.error('[Shift4 Bulk Sync] Fatal error:', errorMessage);
    return jsonResponse({ error: errorMessage }, 500);
  }
});
