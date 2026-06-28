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
import { type FocusConnection, type FetchDeps } from './focusReportClient.ts';

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

/** DB row shape for focus_connections. */
interface FocusConnectionRow {
  id: string;
  restaurant_id: string;
  report_base_url: string;
  report_path: string;
  db_server: string | null;
  db_catalog: string | null;
  report_user_id: string | null;
  store_id: string;
  revenue_center: string | null;
  timezone: string;
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
 */
export interface BulkSyncDeps {
  serviceClient: ServiceClient;
  fetch: FetchDeps['fetch'];
  sleep: (ms: number) => Promise<void>;
  now: () => number;
  serviceRoleKey: string;
}

/** Per-run result. */
interface BulkSyncResult {
  processed: number;
  errors: string[];
  elapsedMs: number;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

/**
 * Constant-time string comparison to avoid timing side-channels on the
 * service-role Bearer token gate (lesson 2026-05-07).
 *
 * Returns true only when both strings are identical and non-empty.
 */
function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) {
    // Still iterate to prevent length leakage — XOR all characters of a with
    // a[0] so the loop is not trivially optimised away.
    let mismatch = 1;
    for (let i = 0; i < a.length; i++) {
      mismatch |= a.charCodeAt(i) ^ a.charCodeAt(0);
    }
    return mismatch === 0; // always false (mismatch starts at 1)
  }
  let diff = 0;
  for (let i = 0; i < a.length; i++) {
    diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return diff === 0;
}

/**
 * Return yesterday and the day before as ISO strings in the given IANA timezone.
 * Uses Intl.DateTimeFormat with the en-CA locale (→ 'YYYY-MM-DD') to avoid UTC
 * midnight off-by-one (design review S4).
 */
function recentBusinessDays(tz: string, now: Date): [string, string] {
  const formatter = new Intl.DateTimeFormat('en-CA', {
    timeZone: tz,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  });
  const todayStr = formatter.format(now);
  const yesterday = subtractDays(todayStr, 1);
  const dayBefore = subtractDays(todayStr, 2);
  return [yesterday, dayBefore];
}

/**
 * Return the target backfill date for the given cursor position.
 * Formula: today_in_tz − cursor − 1  (design review S4, plan Task 9).
 */
function backfillDate(tz: string, now: Date, cursor: number): string {
  const formatter = new Intl.DateTimeFormat('en-CA', {
    timeZone: tz,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  });
  const todayStr = formatter.format(now);
  return subtractDays(todayStr, cursor + 1);
}

/**
 * Subtract `days` calendar days from an ISO date string ('YYYY-MM-DD').
 * Uses noon UTC to avoid DST edge cases.
 */
function subtractDays(isoDate: string, days: number): string {
  const d = new Date(isoDate + 'T12:00:00Z');
  d.setUTCDate(d.getUTCDate() - days);
  return d.toISOString().substring(0, 10);
}

// ── Per-connection processor ──────────────────────────────────────────────────

async function processConnection(
  row: FocusConnectionRow,
  deps: BulkSyncDeps,
): Promise<{ newSyncCursor: number; newInitialSyncDone: boolean }> {
  const conn: FocusConnection = {
    reportBaseUrl: row.report_base_url,
    reportPath: row.report_path,
    dbServer: row.db_server ?? '',
    dbCatalog: row.db_catalog ?? '',
    reportUserId: row.report_user_id ?? '',
    storeId: row.store_id,
    revenueCenter: row.revenue_center ?? '',
  };

  const syncDeps: SyncDeps = {
    fetch: deps.fetch,
    supabase: deps.serviceClient as unknown as SupabaseDeps,
    restaurantId: row.restaurant_id,
  };

  const tz = row.timezone || 'America/Chicago';
  const now = new Date(deps.now());

  let newSyncCursor = row.sync_cursor;
  let newInitialSyncDone = row.initial_sync_done;

  if (!row.initial_sync_done) {
    // Backfill: one cursor day per call
    const targetDate = backfillDate(tz, now, row.sync_cursor);
    await processReportDay(syncDeps, conn, targetDate);

    newSyncCursor = row.sync_cursor + 1;
    if (newSyncCursor >= TARGET_DAYS) {
      newInitialSyncDone = true;
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
      result.errors.push(`${row.restaurant_id}: ${message}`);
      result.processed++; // Count as attempted (even if errored)
    }
  }

  result.elapsedMs = deps.now() - startMs;
  return jsonResponse(result);
}
