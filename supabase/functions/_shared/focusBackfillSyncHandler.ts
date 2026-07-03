/**
 * focusBackfillSyncHandler.ts
 *
 * Injectable handler for the focus-backfill-sync edge function (pg_cron trigger).
 *
 * This is the durable engine for the 90-day Lynk backfill. It runs every 5
 * minutes and processes up to 5 backfilling connections per tick, 7 days per
 * connection, within an 80-second total wall budget.
 *
 * Responsibilities:
 *  1. No inbound auth gate (mirrors toast-bulk-sync / shift4-bulk-sync). verify_jwt=false.
 *  2. Query: active Lynk connections still backfilling:
 *       is_active=true AND initial_sync_done=false AND api_key IS NOT NULL
 *       ORDER BY last_sync_time ASC NULLS FIRST LIMIT 5  (round-robin fairness).
 *  3. Per connection:
 *       a. Wall-clock budget check (80s). Break if exceeded.
 *       b. Decrypt api_secret_encrypted.
 *       c. processBackfillBatch({ budgetMs: ~50_000, maxDays: 5 }).
 *       d. Persist cursor/flag/last_sync_time via CAS (§8.1).
 *       e. On batch error: also write connection_status='error' + last_error (§8.3).
 *       f. Per-restaurant exception caught → recorded in errors[], continue.
 *  4. Injectable sleep(2000ms) between restaurants (round-robin fairness).
 *  5. Returns 200 { processed, errors, elapsedMs }.
 *
 * Design references:
 *  - Plan B4; spec §5.3 (focus-backfill-sync) + §8.1 (CAS) + §8.3 (error status).
 *  - Gate-less cron worker: matches toast-bulk-sync / shift4-bulk-sync (no Bearer).
 *  - Per-restaurant budget: remaining_budget / restaurants_left, capped at 50_000ms.
 */

import { getEncryptionService } from './encryption.ts';
import { focusApiBaseUrl, fetchDatafeed as realFetchDatafeed } from './focusLynkClient.ts';
import {
  processBackfillBatch,
  type BackfillBatchDeps,
} from './focusBackfillBatch.ts';
import {
  processDayTransactions,
  type TransactionSyncConfig,
} from './focusTransactionSyncHandler.ts';

// ── Constants ─────────────────────────────────────────────────────────────────

/** Maximum active connections to process per cron run (round-robin fairness). */
const LIMIT = 5;

/** Total wall-clock budget for the entire cron run (80 seconds per spec §8.3). */
const BUDGET_MS = 80_000;

/** Maximum days to process per connection per tick (spec §8.3).
 *  Lowered 7→5: the worker no longer runs the unified_sales RPC (moved to a
 *  Postgres cron), but fewer XML parses per tick keeps CPU well under the limit. */
const MAX_DAYS_PER_CONNECTION = 5;

/** Delay between restaurants in milliseconds. */
const INTER_RESTAURANT_DELAY_MS = 2_000;

// ── Types ─────────────────────────────────────────────────────────────────────

/** DB row shape for focus_connections (backfilling Lynk connections only). */
interface FocusBackfillRow {
  id: string;
  restaurant_id: string;
  store_id: string | null;
  timezone: string | null;
  initial_sync_done: boolean;
  sync_cursor: number;
  last_sync_time: string | null;
  api_key: string | null;
  api_secret_encrypted: string | null;
  environment: string | null;
}

/**
 * CAS update chain type:
 *   .update(data).eq('id',...).eq('restaurant_id',...).eq('sync_cursor',old).select()
 *
 * Three .eq() calls before .select() requires four chain levels (CasEq1–CasEq4).
 */
interface CasSelectResult {
  data: unknown[] | null;
  error: { message: string } | null;
}

interface CasEq4 {
  select(): Promise<CasSelectResult>;
}

interface CasEq3 {
  eq(col: string, val: unknown): CasEq4;
}

interface CasEq2 {
  eq(col: string, val: unknown): CasEq3;
}

interface CasEq1 {
  eq(col: string, val: string): CasEq2;
}

/** Minimal Supabase service-role client surface needed by this handler. */
export interface BackfillSyncServiceClient {
  from(table: string): {
    select(columns: string): {
      eq(col: string, val: unknown): {
        eq(col: string, val: unknown): {
          not(col: string, op: string, val: null): {
            order(col: string, opts: { ascending: boolean; nullsFirst: boolean }): {
              limit(n: number): Promise<{
                data: FocusBackfillRow[] | null;
                error: { message: string } | null;
              }>;
            };
          };
        };
      };
    };
    update(data: Record<string, unknown>): CasEq1;
  };
}

/**
 * Injectable dependencies for the backfill-sync handler.
 *
 * - serviceClient  Built from SUPABASE_SERVICE_ROLE_KEY (bypasses RLS).
 * - sleep          Waits n ms between restaurants (injectable for tests).
 * - now            Returns the current wall-clock timestamp in ms (injectable for tests).
 * - sandboxBaseUrl Optional override URL for environment='sandbox' connections
 *                  (FOCUS_API_SANDBOX_URL env var). Without it, sandbox connections
 *                  fall back to the production URL (focusApiBaseUrl doc §6).
 */
export interface BackfillSyncDeps {
  serviceClient: BackfillSyncServiceClient;
  sleep: (ms: number) => Promise<void>;
  now: () => number;
  sandboxBaseUrl?: string;
}

/** Per-run result. */
interface BackfillSyncResult {
  processed: number;
  errors: string[];
  elapsedMs: number;
}

// ── Handler ───────────────────────────────────────────────────────────────────

/**
 * Handle a POST /focus-backfill-sync request (triggered by pg_cron).
 *
 * No inbound auth gate — this worker mirrors the toast-bulk-sync / shift4-bulk-sync
 * cron pattern (verify_jwt=false, no Bearer check). It only PULLs the restaurant's
 * own Focus data via idempotent upserts, so the worst case for an unauthenticated
 * call is a redundant sync. This removes the dependency on the legacy service-role
 * key (which Supabase now discourages) in the pg_cron invocation.
 *
 * Returns 200 { processed, errors, elapsedMs }.
 */
export async function handleBackfillSync(
  _req: Request,
  deps: BackfillSyncDeps,
): Promise<Response> {
  const jsonResponse = (body: unknown, status = 200): Response =>
    new Response(JSON.stringify(body), {
      status,
      headers: { 'Content-Type': 'application/json' },
    });

  const startMs = deps.now();

  // ── Query: backfilling Lynk connections only ──────────────────────────────
  // Filters:  is_active=true, initial_sync_done=false, api_key IS NOT NULL
  // Ordering: last_sync_time ASC NULLS FIRST (round-robin fairness, same as bulk-sync)
  // Limit:    5 (one run cannot starve other restaurants)

  const { data: rows, error: queryError } = await deps.serviceClient
    .from('focus_connections')
    .select(
      'id, restaurant_id, store_id, timezone, initial_sync_done, sync_cursor, ' +
        'last_sync_time, api_key, api_secret_encrypted, environment',
    )
    .eq('is_active', true)
    .eq('initial_sync_done', false)
    .not('api_key', 'is', null)
    .order('last_sync_time', { ascending: true, nullsFirst: true })
    .limit(LIMIT);

  if (queryError) {
    console.error('focus-backfill-sync: failed to fetch connections:', queryError.message);
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

  const result: BackfillSyncResult = {
    processed: 0,
    errors: [],
    elapsedMs: 0,
  };

  for (let i = 0; i < rows.length; i++) {
    // Sleep between restaurants (not before first).
    // Also acts as the budget checkpoint: if we've exceeded the budget after
    // the previous restaurant, stop before starting the next one.
    if (i > 0) {
      if (deps.now() - startMs > BUDGET_MS) {
        console.log('focus-backfill-sync: wall-clock budget exceeded, stopping early');
        break;
      }
      await deps.sleep(INTER_RESTAURANT_DELAY_MS);
    }

    const row = rows[i];

    try {
      // Guard: api_key, api_secret_encrypted, and store_id are all required for Lynk.
      // Including api_key here makes the check self-contained (query filter is the primary
      // guard, but an explicit throw is cleaner than a downstream non-null assertion).
      if (!row.api_key || !row.api_secret_encrypted || !row.store_id) {
        throw new Error(
          'Focus POS API credentials are incomplete (missing api_key, api_secret_encrypted, or store_id)',
        );
      }

      // Decrypt the API secret.
      const encSvc = await getEncryptionService();
      const apiSecret = await encSvc.decrypt(row.api_secret_encrypted);

      const txConfig: TransactionSyncConfig = {
        restaurantId: row.restaurant_id,
        storeId: row.store_id,
        apiKey: row.api_key!,
        apiSecret,
        baseUrl: focusApiBaseUrl(
          (row.environment as 'production' | 'sandbox') ?? 'production',
          deps.sandboxBaseUrl,
        ),
      };

      // Calculate per-restaurant budget from remaining wall time, capped at 50_000ms.
      const elapsed = deps.now() - startMs;
      const remainingBudget = Math.max(0, BUDGET_MS - elapsed);
      const perRestaurantBudget = Math.min(50_000, remainingBudget);

      const batchDeps: BackfillBatchDeps = {
        supabase: deps.serviceClient as unknown as BackfillBatchDeps['supabase'],
        fetchDatafeed: realFetchDatafeed,
        processDayTransactions,
      };

      // Read current cursor for CAS.
      const readCursor = row.sync_cursor;

      const batchResult = await processBackfillBatch(batchDeps, txConfig, {
        syncCursor: readCursor,
        timezone: row.timezone ?? 'America/Chicago',
        now: new Date(deps.now()),
        budgetMs: perRestaurantBudget,
        maxDays: MAX_DAYS_PER_CONNECTION,
      });

      // Single timestamp shared across all fields in this update.
      const nowIso = new Date(deps.now()).toISOString();

      // Build update payload.
      const updatePayload: Record<string, unknown> = {
        sync_cursor: batchResult.syncCursor,
        initial_sync_done: batchResult.initialSyncDone,
        last_sync_time: nowIso,
        updated_at: nowIso,
      };

      // On error, persist the stall details so the frontend can stop polling (§8.3).
      if (batchResult.status === 'error') {
        updatePayload.connection_status = 'error';
        updatePayload.last_error = batchResult.lastError ?? 'Unknown backfill error';
        updatePayload.last_error_at = nowIso;
      }

      // CAS write: filter on (id, restaurant_id, sync_cursor=readCursor) so concurrent
      // ticks don't clobber each other (§8.1). 0 rows back = another tick already won;
      // in that case, skip incrementing processed (the other tick already counted it).
      const { data: casRows, error: casErr } = await deps.serviceClient
        .from('focus_connections')
        .update(updatePayload)
        .eq('id', row.id)
        .eq('restaurant_id', row.restaurant_id)
        .eq('sync_cursor', readCursor)
        .select();

      if (casErr) {
        throw new Error(`CAS write failed: ${casErr.message}`);
      }
      if (!casRows?.length) {
        // A concurrent tick already advanced this cursor — skip silently.
        console.log(
          `focus-backfill-sync: CAS miss for restaurant ${row.restaurant_id} (cursor ${readCursor}), skipping`,
        );
        continue;
      }

      result.processed++;
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      console.error(`focus-backfill-sync: error for restaurant ${row.restaurant_id}:`, message);
      result.errors.push(`${row.restaurant_id}: ${message}`);

      // Best-effort: advance last_sync_time so this connection is not perpetually
      // NULLS FIRST in the round-robin ORDER BY, which would starve healthy connections.
      // Also write connection_status='error' + last_error for frontend visibility (§8.3).
      // Intentionally fire-and-forget: if this write also fails, we log but don't throw.
      const nowIso = new Date(deps.now()).toISOString();
      deps.serviceClient
        .from('focus_connections')
        .update({
          last_sync_time: nowIso,
          connection_status: 'error',
          last_error: message,
          last_error_at: nowIso,
          updated_at: nowIso,
        })
        .eq('id', row.id)
        .eq('restaurant_id', row.restaurant_id)
        .eq('sync_cursor', row.sync_cursor)
        .select()
        .then(({ error: updateErr }) => {
          if (updateErr) {
            console.warn(
              `focus-backfill-sync: best-effort error-state write failed for ${row.restaurant_id}:`,
              updateErr.message,
            );
          }
        })
        .catch((e: unknown) => {
          console.warn(
            `focus-backfill-sync: best-effort error-state write threw for ${row.restaurant_id}:`,
            e instanceof Error ? e.message : String(e),
          );
        });
    }
  }

  result.elapsedMs = deps.now() - startMs;
  return jsonResponse(result);
}
