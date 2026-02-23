import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient, SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";
import {
  getValidSlingToken,
  fetchSlingCalendar,
  fetchSlingTimesheets,
  parseSlingShiftEvents,
  parseSlingTimesheetEntries,
  SlingConnection,
} from "../_shared/slingApiClient.ts";
import { logSecurityEvent } from "../_shared/securityEvents.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

const MAX_RESTAURANTS_PER_RUN = 5;
const DELAY_BETWEEN_RESTAURANTS_MS = 2000;
const MAX_USERS_PER_RESTAURANT = 100;

// --- Date helpers ---

function formatDate(date: Date): string {
  return date.toISOString().split("T")[0];
}

function subDays(date: Date, days: number): Date {
  const d = new Date(date);
  d.setDate(d.getDate() - days);
  return d;
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

// --- Types ---

interface SyncResults {
  totalConnections: number;
  successfulSyncs: number;
  failedSyncs: number;
  totalShiftsSynced: number;
  totalTimesheetsSynced: number;
  errors: string[];
  processingTimeMs: number;
}

// --- Per-connection sync logic ---

async function processConnection(
  supabase: SupabaseClient,
  connection: SlingConnection,
  results: SyncResults
): Promise<void> {
  const restaurantId = connection.restaurant_id;

  try {
    console.log(
      `Processing Sling connection for restaurant: ${restaurantId}`
    );

    if (!connection.sling_org_id) {
      console.warn(
        `Skipping restaurant ${restaurantId}: no sling_org_id configured`
      );
      results.errors.push(
        `${restaurantId}: missing sling_org_id`
      );
      results.failedSyncs++;
      return;
    }

    // Get valid token (handles caching + re-login)
    const token = await getValidSlingToken(connection, supabase);

    // Determine sync window
    const now = new Date();
    let batchStart: string;
    let batchEnd: string;

    if (connection.initial_sync_done) {
      // Incremental: last 25 hours
      batchStart = formatDate(subDays(now, 1));
      batchEnd = formatDate(now);
    } else {
      // Initial catch-up: last 3 days
      batchStart = formatDate(subDays(now, 3));
      batchEnd = formatDate(now);
    }

    console.log(
      `Sync range: ${batchStart} to ${batchEnd} (initial_done: ${connection.initial_sync_done})`
    );

    // Get sling_users for this restaurant
    const { data: slingUsers, error: usersError } = await supabase
      .from("sling_users")
      .select("sling_user_id")
      .eq("restaurant_id", restaurantId)
      .eq("is_active", true)
      .limit(MAX_USERS_PER_RESTAURANT);

    if (usersError) {
      throw new Error(`Failed to fetch sling_users: ${usersError.message}`);
    }

    if (!slingUsers || slingUsers.length === 0) {
      console.log(`No active Sling users for restaurant ${restaurantId}`);
      await updateConnectionSuccess(supabase, connection);
      results.successfulSyncs++;
      return;
    }

    // --- Fetch shifts for each user ---
    let shiftsSynced = 0;
    const fetchErrors: string[] = [];

    for (const user of slingUsers) {
      try {
        const events = await fetchSlingCalendar(
          token,
          connection.sling_org_id,
          user.sling_user_id,
          batchStart,
          batchEnd
        );

        const parsed = parseSlingShiftEvents(events);
        if (parsed.length === 0) continue;

        const rows = parsed.map((shift) => ({
          restaurant_id: restaurantId,
          sling_shift_id: shift.sling_shift_id,
          sling_user_id: shift.sling_user_id,
          shift_date: shift.shift_date,
          start_time: shift.start_time,
          end_time: shift.end_time,
          break_duration: shift.break_duration,
          position: shift.position,
          location: shift.location,
          status: shift.status,
          raw_json: shift.raw_json,
          updated_at: new Date().toISOString(),
        }));

        const { error: upsertError } = await supabase
          .from("sling_shifts")
          .upsert(rows, { onConflict: "restaurant_id,sling_shift_id" });

        if (upsertError) {
          fetchErrors.push(
            `Shifts user ${user.sling_user_id}: ${upsertError.message}`
          );
        } else {
          shiftsSynced += rows.length;
        }
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : String(err);
        fetchErrors.push(`Shifts user ${user.sling_user_id}: ${message}`);
      }
    }

    // --- Fetch timesheets ---
    let timesheetsSynced = 0;

    try {
      const rawTimesheets = await fetchSlingTimesheets(
        token,
        batchStart,
        batchEnd
      );

      const entries = Array.isArray(rawTimesheets)
        ? rawTimesheets
        : rawTimesheets?.timesheets ?? rawTimesheets?.entries ?? [];

      const parsed = parseSlingTimesheetEntries(
        Array.isArray(entries) ? entries : []
      );

      if (parsed.length > 0) {
        const rows = parsed.map((ts) => ({
          restaurant_id: restaurantId,
          sling_timesheet_id: ts.sling_timesheet_id,
          sling_shift_id: ts.sling_shift_id,
          sling_user_id: ts.sling_user_id,
          punch_type: ts.punch_type,
          punch_time: ts.punch_time,
          raw_json: ts.raw_json,
          updated_at: new Date().toISOString(),
        }));

        const { error: upsertError } = await supabase
          .from("sling_timesheets")
          .upsert(rows, { onConflict: "restaurant_id,sling_timesheet_id" });

        if (upsertError) {
          fetchErrors.push(`Timesheets upsert: ${upsertError.message}`);
        } else {
          timesheetsSynced = rows.length;
        }
      }
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      fetchErrors.push(`Timesheets fetch: ${message}`);
    }

    // --- Call RPC to sync into shifts/time_punches ---
    if (shiftsSynced > 0 || timesheetsSynced > 0) {
      try {
        const { error: rpcError } = await supabase.rpc(
          "sync_sling_to_shifts_and_punches",
          {
            p_restaurant_id: restaurantId,
            p_start_date: batchStart,
            p_end_date: batchEnd,
          }
        );
        if (rpcError) {
          console.warn(
            `RPC sync warning for ${restaurantId}:`,
            rpcError.message
          );
        }
      } catch {
        console.warn(
          `RPC sync_sling_to_shifts_and_punches failed for ${restaurantId}`
        );
      }
    }

    // --- Update connection state ---
    await updateConnectionSuccess(supabase, connection);

    await logSecurityEvent(
      supabase,
      "SLING_BULK_SYNC_SUCCESS",
      undefined,
      restaurantId,
      {
        shiftsSynced,
        timesheetsSynced,
        errorCount: fetchErrors.length,
      }
    );

    results.successfulSyncs++;
    results.totalShiftsSynced += shiftsSynced;
    results.totalTimesheetsSynced += timesheetsSynced;

    if (fetchErrors.length > 0) {
      results.errors.push(
        ...fetchErrors.map((e) => `${restaurantId}: ${e}`)
      );
    }

    console.log(
      `Synced ${shiftsSynced} shifts, ${timesheetsSynced} timesheets for restaurant ${restaurantId}`
    );
  } catch (error: unknown) {
    const errorMessage =
      error instanceof Error ? error.message : "Unknown error";
    console.error(
      `Error syncing Sling for restaurant ${restaurantId}:`,
      errorMessage
    );

    await updateConnectionError(supabase, connection.id, errorMessage);

    results.failedSyncs++;
    results.errors.push(`${restaurantId}: ${errorMessage}`);
  }
}

async function updateConnectionSuccess(
  supabase: SupabaseClient,
  connection: SlingConnection
): Promise<void> {
  const update: Record<string, unknown> = {
    last_sync_time: new Date().toISOString(),
    connection_status: "connected",
    last_error: null,
    last_error_at: null,
  };

  // Mark initial sync done if not already
  if (!connection.initial_sync_done) {
    update.initial_sync_done = true;
    update.sync_cursor = 0;
  }

  await supabase
    .from("sling_connections")
    .update(update)
    .eq("id", connection.id);
}

async function updateConnectionError(
  supabase: SupabaseClient,
  connectionId: string,
  errorMessage: string
): Promise<void> {
  await supabase
    .from("sling_connections")
    .update({
      connection_status: "error",
      last_error: errorMessage,
      last_error_at: new Date().toISOString(),
    })
    .eq("id", connectionId);
}

// --- Main handler ---

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  const startTime = Date.now();

  try {
    console.log("Sling bulk sync started");

    const supabaseUrl = Deno.env.get("SUPABASE_URL") ?? "";
    const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    // Fetch up to MAX_RESTAURANTS_PER_RUN active connections,
    // ordered by least-recently-synced first
    const { data: connections, error: connectionsError } = await supabase
      .from("sling_connections")
      .select("*")
      .eq("is_active", true)
      .eq("connection_status", "connected")
      .order("last_sync_time", { ascending: true, nullsFirst: true })
      .limit(MAX_RESTAURANTS_PER_RUN);

    if (connectionsError) {
      throw new Error(
        `Failed to fetch connections: ${connectionsError.message}`
      );
    }

    const results: SyncResults = {
      totalConnections: connections?.length || 0,
      successfulSyncs: 0,
      failedSyncs: 0,
      totalShiftsSynced: 0,
      totalTimesheetsSynced: 0,
      errors: [],
      processingTimeMs: 0,
    };

    if (!connections || connections.length === 0) {
      console.log("No active Sling connections found");
      results.processingTimeMs = Date.now() - startTime;
      return jsonResponse(results);
    }

    // Process each connection with delay between
    for (let i = 0; i < connections.length; i++) {
      if (i > 0) {
        await new Promise((resolve) =>
          setTimeout(resolve, DELAY_BETWEEN_RESTAURANTS_MS)
        );
      }

      console.log(
        `[${i + 1}/${connections.length}] Starting Sling sync...`
      );
      await processConnection(
        supabase,
        connections[i] as SlingConnection,
        results
      );
    }

    results.processingTimeMs = Date.now() - startTime;
    console.log(
      `Sling bulk sync completed in ${results.processingTimeMs}ms:`,
      JSON.stringify(results)
    );

    return jsonResponse(results);
  } catch (error: unknown) {
    const errorMessage =
      error instanceof Error ? error.message : "Unknown error";
    console.error("Sling bulk sync error:", errorMessage);
    return jsonResponse({ error: errorMessage }, 500);
  }
});
