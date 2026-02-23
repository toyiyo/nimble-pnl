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
import { corsHeaders } from "../_shared/cors.ts";

const TARGET_DAYS = 90;
const MAX_USERS_PER_SYNC = 50;
const DEBUG = Deno.env.get("DEBUG") === "true";

// --- Date helpers (no external deps) ---

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

// --- Date range validation ---

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
    return {
      isCustomRange: false,
      error: "Both startDate and endDate are required for custom range",
    };
  }

  const start = new Date(startDate);
  const end = new Date(endDate);

  if (isNaN(start.getTime()) || isNaN(end.getTime())) {
    return {
      isCustomRange: true,
      error: "Invalid date format. Use YYYY-MM-DD.",
    };
  }

  if (start > end) {
    return { isCustomRange: true, error: "Start date must be before end date" };
  }

  const daysDiff =
    (end.getTime() - start.getTime()) / (1000 * 60 * 60 * 24);
  if (daysDiff > 90) {
    return {
      isCustomRange: true,
      error: "Date range cannot exceed 90 days",
    };
  }

  return { isCustomRange: true };
}

// --- Sync range calculation (state machine) ---

interface SyncRange {
  mode: "custom" | "initial" | "incremental";
  batchStart: string;
  batchEnd: string;
}

function calculateSyncRange(
  connection: SlingConnection,
  customStartDate?: string,
  customEndDate?: string
): SyncRange {
  // Custom range provided by user
  if (customStartDate && customEndDate) {
    return {
      mode: "custom",
      batchStart: customStartDate,
      batchEnd: customEndDate,
    };
  }

  const now = new Date();

  // Initial sync: walk backwards from today in 1-day batches
  if (!connection.initial_sync_done) {
    const cursor = connection.sync_cursor || 0;
    const batchEnd = formatDate(subDays(now, cursor));
    const batchStart = formatDate(subDays(now, cursor + 1));
    return { mode: "initial", batchStart, batchEnd };
  }

  // Incremental: last ~25 hours
  const batchStart = formatDate(subDays(now, 1));
  const batchEnd = formatDate(now);
  return { mode: "incremental", batchStart, batchEnd };
}

// --- Fetch and upsert shifts for all users ---

interface SyncDataResult {
  shiftsSynced: number;
  timesheetsSynced: number;
  errors: string[];
}

async function fetchAndUpsertShifts(
  serviceSupabase: SupabaseClient,
  token: string,
  orgId: number,
  restaurantId: string,
  users: Array<{ sling_user_id: number }>,
  batchStart: string,
  batchEnd: string
): Promise<{ count: number; errors: string[] }> {
  let count = 0;
  const errors: string[] = [];

  const usersToSync = users.slice(0, MAX_USERS_PER_SYNC);

  for (const user of usersToSync) {
    try {
      const events = await fetchSlingCalendar(
        token,
        orgId,
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

      const { error: upsertError } = await serviceSupabase
        .from("sling_shifts")
        .upsert(rows, { onConflict: "restaurant_id,sling_shift_id" });

      if (upsertError) {
        errors.push(
          `Shifts upsert for user ${user.sling_user_id}: ${upsertError.message}`
        );
      } else {
        count += rows.length;
      }
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      if (message === "SLING_TOKEN_EXPIRED") throw err;
      errors.push(`Shifts for user ${user.sling_user_id}: ${message}`);
    }
  }

  return { count, errors };
}

async function fetchAndUpsertTimesheets(
  serviceSupabase: SupabaseClient,
  token: string,
  restaurantId: string,
  batchStart: string,
  batchEnd: string
): Promise<{ count: number; errors: string[] }> {
  const errors: string[] = [];
  let count = 0;

  try {
    const rawTimesheets = await fetchSlingTimesheets(token, batchStart, batchEnd);

    // The timesheets report may return an array or an object with entries
    const entries = Array.isArray(rawTimesheets)
      ? rawTimesheets
      : rawTimesheets?.timesheets ?? rawTimesheets?.entries ?? [];

    const parsed = parseSlingTimesheetEntries(
      Array.isArray(entries) ? entries : []
    );

    if (parsed.length === 0) {
      return { count: 0, errors };
    }

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

    const { error: upsertError } = await serviceSupabase
      .from("sling_timesheets")
      .upsert(rows, { onConflict: "restaurant_id,sling_timesheet_id" });

    if (upsertError) {
      errors.push(`Timesheets upsert: ${upsertError.message}`);
    } else {
      count = rows.length;
    }
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    if (message === "SLING_TOKEN_EXPIRED") throw err;
    errors.push(`Timesheets fetch: ${message}`);
  }

  return { count, errors };
}

// --- Main handler ---

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    if (DEBUG) console.log("Sling manual sync started");

    const authHeader = req.headers.get("Authorization");
    if (!authHeader) {
      return jsonResponse({ error: "Missing authorization" }, 401);
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL");
    const supabaseAnonKey = Deno.env.get("SUPABASE_ANON_KEY");
    const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");

    if (!supabaseUrl || !supabaseAnonKey || !supabaseServiceKey) {
      console.error("Missing required environment variables");
      return jsonResponse({ error: "Server misconfigured" }, 500);
    }

    // Dual client pattern: user JWT for auth, service role for data
    const userSupabase = createClient(supabaseUrl, supabaseAnonKey, {
      global: { headers: { Authorization: authHeader } },
    });
    const serviceSupabase = createClient(supabaseUrl, supabaseServiceKey);

    // Authenticate user
    const {
      data: { user },
    } = await userSupabase.auth.getUser();
    if (!user) {
      return jsonResponse({ error: "Unauthorized" }, 401);
    }

    // Parse request body
    let restaurantId: string | undefined;
    let customStartDate: string | undefined;
    let customEndDate: string | undefined;
    try {
      const body = await req.json();
      restaurantId = body.restaurantId;
      customStartDate = body.startDate;
      customEndDate = body.endDate;
    } catch {
      return jsonResponse({ error: "Invalid JSON body" }, 400);
    }

    if (!restaurantId) {
      return jsonResponse({ error: "Missing restaurantId" }, 400);
    }

    // Validate custom date range if provided
    const dateRangeValidation = validateDateRange(
      customStartDate,
      customEndDate
    );
    if (dateRangeValidation.error) {
      return jsonResponse({ error: dateRangeValidation.error }, 400);
    }

    // Authorization gate: verify user has access via RLS
    const { data: authorizedConn, error: authorizedConnError } =
      await userSupabase
        .from("sling_connections")
        .select("id")
        .eq("restaurant_id", restaurantId)
        .eq("is_active", true)
        .maybeSingle();

    if (authorizedConnError || !authorizedConn?.id) {
      console.error(
        "Authorization failed:",
        authorizedConnError?.message || "No connection found"
      );
      return jsonResponse(
        { error: "Forbidden - no access to this restaurant" },
        403
      );
    }

    // Privileged fetch of full connection row (includes encrypted password)
    const { data: connection, error: connectionError } = await serviceSupabase
      .from("sling_connections")
      .select("*")
      .eq("id", authorizedConn.id)
      .single();

    if (connectionError || !connection) {
      console.error("Connection fetch failed:", connectionError?.message);
      return jsonResponse(
        { error: "No active Sling connection found" },
        404
      );
    }

    if (!connection.sling_org_id) {
      return jsonResponse(
        {
          error:
            "Sling connection not fully configured - missing organization ID",
        },
        409
      );
    }

    // Get valid token (handles caching and re-login)
    let token: string;
    try {
      token = await getValidSlingToken(
        connection as SlingConnection,
        serviceSupabase
      );
    } catch (tokenErr: unknown) {
      const message =
        tokenErr instanceof Error ? tokenErr.message : String(tokenErr);
      await serviceSupabase
        .from("sling_connections")
        .update({
          last_error: `Token error: ${message}`,
          last_error_at: new Date().toISOString(),
        })
        .eq("id", connection.id);

      return jsonResponse({ error: `Authentication failed: ${message}` }, 401);
    }

    // Calculate sync range
    const { mode, batchStart, batchEnd } = calculateSyncRange(
      connection as SlingConnection,
      customStartDate,
      customEndDate
    );

    if (DEBUG) {
      console.log(`Sync mode: ${mode}, range: ${batchStart} to ${batchEnd}`);
    }

    // Get sling_users for this restaurant
    const { data: slingUsers, error: usersError } = await serviceSupabase
      .from("sling_users")
      .select("sling_user_id")
      .eq("restaurant_id", restaurantId)
      .eq("is_active", true);

    if (usersError) {
      console.error("Failed to fetch sling_users:", usersError.message);
      return jsonResponse(
        { error: "Failed to fetch Sling users" },
        500
      );
    }

    if (!slingUsers || slingUsers.length === 0) {
      return jsonResponse(
        {
          error:
            "No Sling users found. Please test the connection first to import users.",
        },
        400
      );
    }

    // --- Fetch data with token expiry retry ---
    let shiftResult: { count: number; errors: string[] };
    let timesheetResult: { count: number; errors: string[] };
    let retried = false;

    const doFetch = async (
      currentToken: string
    ): Promise<{
      shifts: { count: number; errors: string[] };
      timesheets: { count: number; errors: string[] };
    }> => {
      const shifts = await fetchAndUpsertShifts(
        serviceSupabase,
        currentToken,
        connection.sling_org_id,
        restaurantId!,
        slingUsers,
        batchStart,
        batchEnd
      );

      const timesheets = await fetchAndUpsertTimesheets(
        serviceSupabase,
        currentToken,
        restaurantId!,
        batchStart,
        batchEnd
      );

      return { shifts, timesheets };
    };

    try {
      const result = await doFetch(token);
      shiftResult = result.shifts;
      timesheetResult = result.timesheets;
    } catch (fetchErr: unknown) {
      const message =
        fetchErr instanceof Error ? fetchErr.message : String(fetchErr);

      // Handle token expiry with one retry
      if (message === "SLING_TOKEN_EXPIRED" && !retried) {
        retried = true;
        if (DEBUG) console.log("Token expired, re-logging in...");

        // Force re-login by clearing cached token
        await serviceSupabase
          .from("sling_connections")
          .update({ auth_token: null, token_fetched_at: null })
          .eq("id", connection.id);

        const freshConnection = {
          ...connection,
          auth_token: null,
          token_fetched_at: null,
        };
        const freshToken = await getValidSlingToken(
          freshConnection as SlingConnection,
          serviceSupabase
        );

        const result = await doFetch(freshToken);
        shiftResult = result.shifts;
        timesheetResult = result.timesheets;
      } else {
        throw fetchErr;
      }
    }

    // Combine errors
    const allErrors = [...shiftResult.errors, ...timesheetResult.errors];

    // --- Update sync state ---
    const syncUpdate: Record<string, unknown> = {
      last_sync_time: new Date().toISOString(),
      last_error: allErrors.length > 0 ? allErrors.join("; ") : null,
      last_error_at: allErrors.length > 0 ? new Date().toISOString() : null,
    };

    let syncComplete = false;
    let progress = 100;

    if (mode === "initial") {
      const currentCursor = connection.sync_cursor || 0;
      const newCursor = currentCursor + 1;

      if (newCursor >= TARGET_DAYS) {
        syncUpdate.initial_sync_done = true;
        syncUpdate.sync_cursor = 0;
        syncComplete = true;
      } else {
        syncUpdate.sync_cursor = newCursor;
      }

      progress = Math.round(
        (Math.min(newCursor, TARGET_DAYS) / TARGET_DAYS) * 100
      );
    } else {
      // Custom or incremental: always "complete" for this batch
      syncComplete = true;
    }

    const { error: syncUpdateError } = await serviceSupabase
      .from("sling_connections")
      .update(syncUpdate)
      .eq("id", connection.id);

    if (syncUpdateError) {
      console.error("Failed to update sync progress:", syncUpdateError.message);
    }

    // --- Call RPC for incremental/custom syncs (not during initial backfill) ---
    if (mode !== "initial" && (shiftResult.count > 0 || timesheetResult.count > 0)) {
      try {
        const { error: rpcError } = await serviceSupabase.rpc(
          "sync_sling_to_shifts_and_punches",
          {
            p_restaurant_id: restaurantId,
            p_start_date: batchStart,
            p_end_date: batchEnd,
          }
        );
        if (rpcError) {
          console.warn(
            "RPC sync_sling_to_shifts_and_punches warning:",
            rpcError.message
          );
        }
      } catch {
        console.warn("Sling-to-shifts RPC sync deferred to cron job");
      }
    }

    // Log security event
    await logSecurityEvent(
      serviceSupabase,
      "SLING_MANUAL_SYNC",
      user.id,
      restaurantId,
      {
        shiftsSynced: shiftResult.count,
        timesheetsSynced: timesheetResult.count,
        errorCount: allErrors.length,
        syncComplete,
        mode,
      }
    );

    if (DEBUG) {
      console.log(
        `Sling sync batch complete: ${shiftResult.count} shifts, ${timesheetResult.count} timesheets, ${allErrors.length} errors, mode: ${mode}`
      );
    }

    return jsonResponse({
      success: true,
      shiftsSynced: shiftResult.count,
      timesheetsSynced: timesheetResult.count,
      progress,
      syncComplete,
      mode,
      errors: allErrors.length > 0 ? allErrors : undefined,
    });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "Unknown error";
    console.error("Sling manual sync error:", message);
    return jsonResponse({ error: message }, 500);
  }
});
