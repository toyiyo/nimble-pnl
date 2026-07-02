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
 *  1. Gate: timing-safe Bearer compare vs SUPABASE_SERVICE_ROLE_KEY → 401.
 *  2. Query: active Lynk connections still backfilling:
 *       is_active=true AND initial_sync_done=false AND api_key IS NOT NULL
 *       ORDER BY last_sync_time ASC NULLS FIRST LIMIT 5  (round-robin fairness).
 *  3. Per connection:
 *       a. Wall-clock budget check (80s). Break if exceeded.
 *       b. Decrypt api_secret_encrypted.
 *       c. processBackfillBatch({ budgetMs: ~50_000, maxDays: 7 }).
 *       d. Persist cursor/flag/last_sync_time via CAS (§8.1).
 *       e. On batch error: also write connection_status='error' + last_error (§8.3).
 *       f. Per-restaurant exception caught → recorded in errors[], continue.
 *  4. Injectable sleep(2000ms) between restaurants (round-robin fairness).
 *  5. Returns 200 { processed, errors, elapsedMs }.
 *
 * Design references:
 *  - Plan B4; spec §5.3 (focus-backfill-sync) + §8.1 (CAS) + §8.3 (error status).
 *  - Mirrors focusBulkSyncHandler timing-safe Bearer gate pattern.
 *  - Per-restaurant budget: remaining_budget / restaurants_left, capped at 50_000ms.
 */

import { getEncryptionService } from './encryption.ts';
import { focusApiBaseUrl } from './focusLynkClient.ts';
import { fetchDatafeed as realFetchDatafeed } from './focusLynkClient.ts';
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

/** Maximum days to process per connection per tick (spec §8.3). */
const MAX_DAYS_PER_CONNECTION = 7;

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
 */
interface CasSelectResult {
  data: unknown[] | null;
  error: { message: string } | null;
}

interface CasEq3 {
  select(): Promise<CasSelectResult>;
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
 * - serviceRoleKey The raw service-role key to compare against the Bearer token.
 */
export interface BackfillSyncDeps {
  serviceClient: BackfillSyncServiceClient;
  sleep: (ms: number) => Promise<void>;
  now: () => number;
  serviceRoleKey: string;
}

/** Per-run result. */
interface BackfillSyncResult {
  processed: number;
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

// ── Handler ───────────────────────────────────────────────────────────────────

/**
 * Handle a POST /focus-backfill-sync request (triggered by pg_cron).
 *
 * Required header: Authorization: Bearer <SUPABASE_SERVICE_ROLE_KEY>
 *
 * Returns 200 { processed, errors, elapsedMs } on success.
 * Returns 401 when the Bearer token is absent or does not match the service-role key.
 */
export async function handleBackfillSync(
  req: Request,
  deps: BackfillSyncDeps,
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

  // ── 2. Query: backfilling Lynk connections only ───────────────────────────
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
      // Guard: store_id is required for the Lynk API path.
      if (!row.api_secret_encrypted || !row.store_id) {
        throw new Error(
          'Focus POS API credentials are incomplete (missing api_secret_encrypted or store_id)',
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

      // Build update payload.
      const updatePayload: Record<string, unknown> = {
        sync_cursor: batchResult.syncCursor,
        initial_sync_done: batchResult.initialSyncDone,
        last_sync_time: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      };

      // On error, persist the stall details so the frontend can stop polling (§8.3).
      if (batchResult.status === 'error') {
        updatePayload.connection_status = 'error';
        updatePayload.last_error = batchResult.lastError ?? 'Unknown backfill error';
        updatePayload.last_error_at = new Date().toISOString();
      }

      // CAS write: filter on (id, restaurant_id, sync_cursor=readCursor) so concurrent
      // ticks don't clobber each other (§8.1). 0 rows back = another tick already won.
      await deps.serviceClient
        .from('focus_connections')
        .update(updatePayload)
        .eq('id', row.id)
        .eq('restaurant_id', row.restaurant_id)
        .eq('sync_cursor', readCursor)
        .select();

      result.processed++;
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      console.error(`focus-backfill-sync: error for restaurant ${row.restaurant_id}:`, message);
      result.errors.push(`${row.restaurant_id}: ${message}`);
    }
  }

  result.elapsedMs = deps.now() - startMs;
  return jsonResponse(result);
}
