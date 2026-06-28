/**
 * focusBulkSyncHandler.ts
 *
 * Injectable handler for the focus-bulk-sync edge function (pg_cron trigger).
 *
 * Responsibilities:
 *  1. Gate: constant-time Bearer comparison vs SUPABASE_SERVICE_ROLE_KEY → 401.
 *  2. Query: SELECT active focus_connections ORDER BY last_sync_time ASC NULLS FIRST LIMIT 5
 *     (round-robin per spec §9 / review S5).
 *  3. For each connection:
 *       a. Check wall-clock budget (90s). Break if exceeded.
 *       b. Determine sync mode from initial_sync_done:
 *          - false (backfill): one cursor day per call (mirrors focusSyncDataHandler).
 *          - true (incremental): last 2 business days in connection's timezone.
 *       c. Call processReportDay for each day.
 *       d. Update sync_cursor / initial_sync_done / last_sync_time via serviceClient.
 *       e. Per-connection exception caught — continues to next restaurant.
 *  4. Inject sleep(2000ms) between restaurants (injectable for tests per plan Task 10).
 *  5. Return 200 { processed, errors, elapsedMs }.
 *
 * Design references:
 *  - Plan Task 10
 *  - Spec §8 (focus-bulk-sync), §9 (sync orchestration)
 *  - §16 S5 (LIMIT 5 round-robin), review design ("timing-safe Bearer gate",
 *    "2s delay", "90s wall-clock budget")
 *  - Lesson 2026-05-07: timing-safe cron gate
 *
 * The handler receives pre-constructed deps (serviceClient, fetch, sleep, now,
 * serviceRoleKey) so it is fully testable with Vitest without Deno globals.
 */

import {
  processReportDay,
  type SyncDeps,
  type SupabaseDeps,
} from './focusSyncHandler.ts';
import {
  rowToFocusConnection,
  todayInTz,
  subtractDays,
  recentBusinessDays,
  type FocusConnection,
  type FocusConnectionRow as SharedFocusConnectionRow,
  type FetchDeps,
} from './focusReportClient.ts';

// ── Constants ─────────────────────────────────────────────────────────────────

/** Maximum number of restaurants to process per cron run (design S5). */
const LIMIT = 5;

/** Wall-clock budget in milliseconds (90 seconds). */
const BUDGET_MS = 90_000;

/** Delay between restaurants in milliseconds (design §9). */
const INTER_RESTAURANT_DELAY_MS = 2_000;

/** Days to backfill before marking initial_sync_done=true. */
const TARGET_DAYS = 90;

// ── Types ─────────────────────────────────────────────────────────────────────

/** DB row shape for focus_connections (extends shared routing params). */
interface FocusConnectionRow extends SharedFocusConnectionRow {
  id: string;
  restaurant_id: string;
  initial_sync_done: boolean;
  sync_cursor: number;
  last_sync_time: string | null;
}

/** Minimal Supabase service-role client surface needed by this handler. */
export interface ServiceClient {
  from(table: string): {
    select(columns: string): {
      eq(col: string, val: unknown): {
        order(col: string, opts: { ascending: boolean; nullsFirst: boolean }): {
          limit(n: number): Promise<{
            data: FocusConnectionRow[] | null;
            error: { message: string } | null;
          }>;
        };
      };
    };
    update(data: Record<string, unknown>): {
      eq(col: string, val: string): Promise<{ data: unknown; error: { message: string } | null }>;
    };
    upsert(
      data: Record<string, unknown>,
      options?: Record<string, unknown>,
    ): {
      onConflict(columns: string): {
        select(): Promise<{ data: unknown; error: { message: string } | null }>;
      };
    };
  };
}

/**
 * Injectable dependencies for the bulk-sync handler.
 *
 * - serviceClient    Built from SUPABASE_SERVICE_ROLE_KEY (bypasses RLS).
 * - fetch            fetch-compatible function.
 * - sleep            Waits n ms between restaurants (injectable for tests).
 * - now              Returns the current wall-clock timestamp in ms (injectable for tests).
 * - serviceRoleKey   The raw service-role key to compare against the Bearer token.
 * - domParser        Optional DOMParser-compatible instance (deno_dom in Deno edge
 *                    functions; omit in tests → jsdom globalThis.DOMParser fallback).
 */
export interface BulkSyncDeps {
  serviceClient: ServiceClient;
  fetch: FetchDeps['fetch'];
  sleep: (ms: number) => Promise<void>;
  now: () => number;
  serviceRoleKey: string;
  domParser?: { parseFromString(html: string, mimeType: string): Document };
}

/** Per-run result. */
interface BulkSyncResult {
  /** Restaurants successfully synced (excludes errored restaurants). */
  processed: number;
  /** Per-restaurant error strings for failed restaurants. */
  errors: string[];
  elapsedMs: number;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

/**
 * Constant-time string comparison to avoid timing side-channels on the
 * service-role Bearer token gate (lesson 2026-05-07).
 *
 * Iterates over max(a.length, b.length) in all branches so that response
 * time does not reveal the correct token length to an attacker making
 * requests with tokens of varying lengths.
 *
 * Returns true only when both strings have equal length and content.
 */
function timingSafeEqual(a: string, b: string): boolean {
  const maxLen = Math.max(a.length, b.length);
  let diff = a.length ^ b.length; // non-zero when lengths differ
  for (let i = 0; i < maxLen; i++) {
    // Out-of-bounds charCodeAt returns NaN; NaN ^ NaN is 0 in JS,
    // so we substitute 0 for missing characters to avoid NaN poisoning.
    const ca = i < a.length ? a.charCodeAt(i) : 0;
    const cb = i < b.length ? b.charCodeAt(i) : 0;
    diff |= ca ^ cb;
  }
  return diff === 0;
}

// ── Per-connection processor ──────────────────────────────────────────────────

async function processConnection(
  row: FocusConnectionRow,
  deps: BulkSyncDeps,
): Promise<{ newSyncCursor: number; newInitialSyncDone: boolean }> {
  const conn: FocusConnection = rowToFocusConnection(row);

  const syncDeps: SyncDeps = {
    fetch: deps.fetch,
    supabase: deps.serviceClient as unknown as SupabaseDeps,
    restaurantId: row.restaurant_id,
    domParser: deps.domParser,
  };

  const tz = row.timezone || 'America/Chicago';
  const now = new Date(deps.now());

  let newSyncCursor = row.sync_cursor;
  let newInitialSyncDone = row.initial_sync_done;

  if (!row.initial_sync_done) {
    // Backfill: one cursor day per call
    // Formula: today_in_tz − cursor − 1 (design review S4)
    const targetDate = subtractDays(todayInTz(tz, now), row.sync_cursor + 1);
    const result = await processReportDay(syncDeps, conn, targetDate);

    // Only advance the cursor on success or empty (day had no sales).
    // On error (network failure, parse failure) keep cursor in place so the
    // same day is retried on the next cron run — prevents permanently skipping
    // a business day due to a transient Focus outage. (Codex review P1)
    if (result.status !== 'error') {
      newSyncCursor = row.sync_cursor + 1;
      if (newSyncCursor >= TARGET_DAYS) {
        newInitialSyncDone = true;
      }
    }
  } else {
    // Incremental: last 2 business days in parallel
    const [yesterday, dayBefore] = recentBusinessDays(tz, now);
    await Promise.all([
      processReportDay(syncDeps, conn, yesterday),
      processReportDay(syncDeps, conn, dayBefore),
    ]);
  }

  return { newSyncCursor, newInitialSyncDone };
}

// ── Handler ───────────────────────────────────────────────────────────────────

/**
 * Handle a POST /focus-bulk-sync request (triggered by pg_cron).
 *
 * Required header: Authorization: Bearer <SUPABASE_SERVICE_ROLE_KEY>
 *
 * Returns 200 { processed, errors, elapsedMs } on success.
 * Returns 401 when the Bearer token is absent or does not match the service-role key.
 */
export async function handleBulkSync(
  req: Request,
  deps: BulkSyncDeps,
): Promise<Response> {
  const jsonResponse = (body: unknown, status = 200): Response =>
    new Response(JSON.stringify(body), {
      status,
      headers: { 'Content-Type': 'application/json' },
    });

  const startMs = deps.now();

  // ── 1. Bearer gate (timing-safe) ──────────────────────────────────────────

  const authHeader = req.headers.get('Authorization') ?? '';
  const prefix = 'Bearer ';
  if (!authHeader.startsWith(prefix)) {
    return jsonResponse({ error: 'Unauthorized: missing Bearer token' }, 401);
  }
  const token = authHeader.slice(prefix.length);

  if (!timingSafeEqual(token, deps.serviceRoleKey)) {
    return jsonResponse({ error: 'Unauthorized: invalid service-role key' }, 401);
  }

  // ── 2. Fetch active connections (round-robin LIMIT 5) ─────────────────────

  const { data: rows, error: queryError } = await deps.serviceClient
    .from('focus_connections')
    .select(
      'id, restaurant_id, report_base_url, report_path, db_server, db_catalog, ' +
        'report_user_id, store_id, revenue_center, timezone, initial_sync_done, ' +
        'sync_cursor, last_sync_time',
    )
    .eq('is_active', true)
    .order('last_sync_time', { ascending: true, nullsFirst: true })
    .limit(LIMIT);

  if (queryError) {
    console.error('focus-bulk-sync: failed to fetch connections:', queryError.message);
    return jsonResponse({ error: `Failed to fetch connections: ${queryError.message}` }, 500);
  }

  if (!rows || rows.length === 0) {
    return jsonResponse({
      processed: 0,
      errors: [],
      elapsedMs: deps.now() - startMs,
    });
  }

  // ── 3. Process each connection ─────────────────────────────────────────────

  const result: BulkSyncResult = {
    processed: 0,
    errors: [],
    elapsedMs: 0,
  };

  for (let i = 0; i < rows.length; i++) {
    // Sleep between restaurants (design §9: "2s delay")
    // Also acts as the budget checkpoint: if we've exceeded 90s after the
    // previous restaurant, stop before starting the next one.
    if (i > 0) {
      // Wall-clock budget check (design §8: "90s wall-clock budget guard")
      if (deps.now() - startMs > BUDGET_MS) {
        console.log('focus-bulk-sync: wall-clock budget exceeded, stopping early');
        break;
      }
      await deps.sleep(INTER_RESTAURANT_DELAY_MS);
    }

    const row = rows[i];

    try {
      const { newSyncCursor, newInitialSyncDone } = await processConnection(row, deps);

      // Update the connection row with the new cursor + sync time (review S3)
      await deps.serviceClient
        .from('focus_connections')
        .update({
          sync_cursor: newSyncCursor,
          initial_sync_done: newInitialSyncDone,
          last_sync_time: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        })
        .eq('id', row.id);

      result.processed++;
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      console.error(`focus-bulk-sync: error for restaurant ${row.restaurant_id}:`, message);
      // Do not increment result.processed on error — processed means succeeded.
      // The caller can compute attempted = processed + errors.length.
      result.errors.push(`${row.restaurant_id}: ${message}`);
    }
  }

  result.elapsedMs = deps.now() - startMs;
  return jsonResponse(result);
}
