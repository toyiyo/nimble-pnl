/**
 * focusBulkSyncHandler.ts
 *
 * Injectable handler for the focus-bulk-sync edge function (pg_cron trigger).
 *
 * Responsibilities:
 *  1. No inbound auth gate (mirrors toast-bulk-sync / shift4-bulk-sync). verify_jwt=false.
 *  2. Claim up to LIMIT due connections atomically via the claim_focus_sync_batch
 *     RPC (single UPDATE ... FOR UPDATE SKIP LOCKED RETURNING * statement — safe
 *     under concurrent invocations, design review #1). The claim's due predicate
 *     already accounts for sync_interval_minutes and next_attempt_at backoff.
 *  3. For each connection:
 *       a. Check wall-clock budget (90s). Break if exceeded.
 *       b. Determine sync mode from initial_sync_done:
 *          - false (backfill): one cursor day per call (mirrors focusSyncDataHandler).
 *          - true (incremental), legacy portal path: last 2 business days in
 *            connection's timezone (unchanged).
 *          - true (incremental), Lynk API path: TODAY always, YESTERDAY only
 *            when its focus_datafeed_state fingerprint is missing or ≥ 6h
 *            stale (lynkIncrementalDates) — closes the "today is never
 *            pulled" gap. Wires a per-connection delta-skip state store
 *            (createDatafeedStateStore) into processDayTransactions so
 *            unchanged feeds skip parse/upserts/RPC entirely.
 *       c. Call processReportDay (portal) / processDayTransactions (Lynk) for each day.
 *       d. On success: update sync_cursor / initial_sync_done / last_sync_time and
 *          reset consecutive_failures=0 / next_attempt_at=null via serviceClient.
 *       e. Per-connection exception caught — writes exponential backoff
 *          (consecutive_failures+1, next_attempt_at = now + 15min*2^n capped at
 *          6h, design review #4) and continues to the next restaurant.
 *  4. Inject sleep(2000ms) between restaurants (injectable for tests per plan Task 10).
 *  5. Return 200 { processed, errors, elapsedMs }.
 *
 * Design references:
 *  - Plan Task 10; Focus sync frequency plan Task 5 (claim-RPC + backoff contract),
 *    Task 6 (today-inclusive Lynk window + state store)
 *  - Spec §8 (focus-bulk-sync), §9 (sync orchestration)
 *  - §16 S5 (LIMIT 5 round-robin), review design ("2s delay", "90s wall-clock budget")
 *  - Gate-less cron worker: matches toast-bulk-sync / shift4-bulk-sync (no Bearer)
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
  lynkIncrementalDates,
  type FocusConnection,
  type FocusConnectionRow as SharedFocusConnectionRow,
  type FetchDeps,
} from './focusReportClient.ts';
import { loginToPortal, FocusAuthError } from './focusPortalClient.ts';
import { getEncryptionService } from './encryption.ts';
import {
  processDayTransactions,
  type TransactionSyncConfig,
} from './focusTransactionSyncHandler.ts';
import { createDatafeedStateStore, type StateStoreClient } from './focusDatafeedFingerprint.ts';
import { focusApiBaseUrl, fetchDatafeed as realFetchDatafeed } from './focusLynkClient.ts';

// ── Constants ─────────────────────────────────────────────────────────────────

/** Maximum number of restaurants to process per cron run (design S5). */
const LIMIT = 5;

/** Wall-clock budget in milliseconds (90 seconds). */
const BUDGET_MS = 90_000;

/** Delay between restaurants in milliseconds (design §9). */
const INTER_RESTAURANT_DELAY_MS = 2_000;

/** Days to backfill before marking initial_sync_done=true. */
const TARGET_DAYS = 90;

/** Backoff base/cap: 15 min × 2^n, capped at 6 h (30 m, 1 h, 2 h, 4 h, 6 h…). */
const BACKOFF_BASE_MS = 15 * 60 * 1000;
const BACKOFF_CAP_MS = 6 * 60 * 60 * 1000;

/**
 * Compute the next backoff state after a connection failure (design review #4).
 *
 * Exponential backoff: 15min * 2^failures, capped at 6h. The claim RPC's due
 * predicate (`_focus_connection_is_due`) excludes rows until `next_attempt_at`
 * has passed, so this is how failing connections get spaced out instead of
 * being re-claimed on every fan-out tick.
 */
function backoffAfterFailure(
  priorFailures: number,
  nowMs: number,
): { consecutive_failures: number; next_attempt_at: string } {
  const failures = priorFailures + 1;
  const delay = Math.min(BACKOFF_CAP_MS, BACKOFF_BASE_MS * 2 ** failures);
  return {
    consecutive_failures: failures,
    next_attempt_at: new Date(nowMs + delay).toISOString(),
  };
}

// ── Types ─────────────────────────────────────────────────────────────────────

/** DB row shape for focus_connections (extends shared routing params). */
interface FocusConnectionRow extends SharedFocusConnectionRow {
  id: string;
  restaurant_id: string;
  initial_sync_done: boolean;
  sync_cursor: number;
  last_sync_time: string | null;
  username: string | null;
  password_encrypted: string | null;
  /** Lynk API key. Present for API-path connections. */
  api_key: string | null;
  /** Lynk API secret, AES-GCM encrypted. Present for API-path connections. */
  api_secret_encrypted: string | null;
  /** Environment: 'production' | 'sandbox'. */
  environment: string | null;
  /** Configured sync cadence in minutes (scheduler column, consumed by name only). */
  sync_interval_minutes: number;
  /** Backoff gate: claim predicate excludes rows until this timestamp. */
  next_attempt_at: string | null;
  /** Consecutive failure count driving exponential backoff. */
  consecutive_failures: number;
}

/** Minimal Supabase service-role client surface needed by this handler. */
export interface ServiceClient {
  from(table: string): {
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
    /**
     * select→eq→eq→maybeSingle chain — required by createDatafeedStateStore's
     * get() (focus_datafeed_state lookups for the delta-skip state store).
     */
    select(columns: string): {
      eq(col: string, val: string): {
        eq(col: string, val: string): {
          maybeSingle(): Promise<{
            data: { checks_bytes: number; checks_sha256: string; fetched_at: string } | null;
            error: { message: string } | null;
          }>;
        };
      };
    };
  };
  /** RPC surface — used for the atomic claim_focus_sync_batch call. */
  rpc(fn: string, args: Record<string, unknown>): Promise<{
    data: FocusConnectionRow[] | null;
    error: { message: string } | null;
  }>;
}

/**
 * Injectable dependencies for the bulk-sync handler.
 *
 * - serviceClient    Built from SUPABASE_SERVICE_ROLE_KEY (bypasses RLS).
 * - fetch            fetch-compatible function.
 * - sleep            Waits n ms between restaurants (injectable for tests).
 * - now              Returns the current wall-clock timestamp in ms (injectable for tests).
 * - sandboxBaseUrl   Optional override URL for environment='sandbox' connections
 *                    (FOCUS_API_SANDBOX_URL env var). Without it, sandbox connections
 *                    fall back to the production URL (focusApiBaseUrl doc §6).
 * - domParser        Optional DOMParser-compatible instance (deno_dom in Deno edge
 *                    functions; omit in tests → jsdom globalThis.DOMParser fallback).
 */
export interface BulkSyncDeps {
  serviceClient: ServiceClient;
  fetch: FetchDeps['fetch'];
  sleep: (ms: number) => Promise<void>;
  now: () => number;
  sandboxBaseUrl?: string;
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

// ── Per-connection processor ──────────────────────────────────────────────────

async function processConnection(
  row: FocusConnectionRow,
  deps: BulkSyncDeps,
): Promise<{ newSyncCursor: number; newInitialSyncDone: boolean; skipped?: boolean }> {
  const tz = row.timezone || 'America/Chicago';
  const now = new Date(deps.now());
  const isLynkPath = !!row.api_key;

  let newSyncCursor = row.sync_cursor;
  let newInitialSyncDone = row.initial_sync_done;

  if (isLynkPath) {
    // ── Lynk API path (Focus POS API with api_key / api_secret) ──────────────

    // B5 skip guard (design §8.7): Lynk backfill is owned by the 5-minute
    // focus-backfill-sync cron. The 6-h bulk-sync must NOT also advance Lynk
    // backfill rows — that would race the cron on sync_cursor.
    //
    // skipped:true → the caller writes NOTHING. Persisting row.sync_cursor here
    // could regress a newer cursor that focus-backfill-sync advanced between our
    // read and this write, and would spuriously bump last_sync_time (perturbing
    // the round-robin). (CodeRabbit Major, 9d.)
    if (!row.initial_sync_done) {
      return {
        newSyncCursor: row.sync_cursor,
        newInitialSyncDone: row.initial_sync_done,
        skipped: true,
      };
    }

    // Guard against partially-migrated or corrupted rows — both secrets required.
    if (!row.api_secret_encrypted || !row.store_id) {
      throw new Error('Focus POS API credentials are incomplete (missing api_secret_encrypted or store_id)');
    }

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

    // Delta-skip state store, built once per connection from the service
    // client (design §2 "Delta skip" — only the bulk-sync/cron path wires
    // this; manual/custom-range/backfill callers keep pre-delta-skip behavior).
    const stateStore = createDatafeedStateStore(
      deps.serviceClient as unknown as StateStoreClient,
    );

    const txDeps = {
      supabase: deps.serviceClient as unknown as Parameters<typeof processDayTransactions>[0]['supabase'],
      fetchDatafeed: realFetchDatafeed,
      stateStore,
    };

    // At this point initial_sync_done=true is guaranteed (B5 skip guard at top
    // of processConnection returns early for backfilling rows). The Lynk backfill
    // is owned exclusively by the 5-min focus-backfill-sync cron (design §8.7).
    //
    // Incremental window (design §2 "Lynk incremental window"): TODAY always
    // (fixes the "today is never pulled" gap — recentBusinessDays() never
    // included it); YESTERDAY only when its focus_datafeed_state fingerprint
    // is missing or ≥ 6h stale (lynkIncrementalDates), bounding
    // yesterday-correction staleness at the pre-change freshness level while
    // halving steady-state terminal load.
    const today = todayInTz(tz, now);
    const yesterday = subtractDays(today, 1);
    const yesterdayState = await stateStore.get(row.restaurant_id, yesterday);
    const dates = lynkIncrementalDates(tz, now, yesterdayState?.fetchedAt ?? null);

    const results = await Promise.all(
      dates.map((date) => processDayTransactions(txDeps, txConfig, date)),
    );
    const failed = results.find((r) => r.status === 'error');
    if (failed?.status === 'error') {
      const message = failed.error ?? 'Focus transaction incremental sync failed';
      // Persist error state so the frontend can surface it (mirrors legacy path and
      // focusBackfillSyncHandler behavior). Best-effort: don't await, never throw.
      deps.serviceClient
        .from('focus_connections')
        .update({
          connection_status: 'error',
          last_error: message,
          last_error_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        })
        .eq('id', row.id)
        .eq('restaurant_id', row.restaurant_id)
        .then(({ error: updateErr }: { error: { message: string } | null }) => {
          if (updateErr) {
            console.warn(
              `focus-bulk-sync: best-effort error-state write failed for ${row.restaurant_id}:`,
              updateErr.message,
            );
          }
        })
        .catch((e: unknown) => {
          console.warn(
            `focus-bulk-sync: best-effort error-state write threw for ${row.restaurant_id}:`,
            e instanceof Error ? e.message : String(e),
          );
        });
      throw new Error(message);
    }
  } else {
    // ── Legacy portal path (SSRS scrape) ──────────────────────────────────────
    const encSvc = await getEncryptionService();
    const password = await encSvc.decrypt(row.password_encrypted!);
    try {
      await loginToPortal({ fetch: deps.fetch }, row.username!, password);
    } catch (err) {
      if (err instanceof FocusAuthError) {
        // Filter by both id and restaurant_id to satisfy multi-tenant contract.
        await deps.serviceClient
          .from('focus_connections')
          .update({
            connection_status: 'error',
            last_error: 'Invalid Focus credentials',
            updated_at: new Date().toISOString(),
          })
          .eq('id', row.id)
          .eq('restaurant_id', row.restaurant_id);
      }
      throw err; // propagates to outer catch → added to errors[], restaurant skipped
    }

    const conn: FocusConnection = rowToFocusConnection(row);

    const syncDeps: SyncDeps = {
      fetch: deps.fetch,
      supabase: deps.serviceClient as unknown as SupabaseDeps,
      restaurantId: row.restaurant_id,
      domParser: deps.domParser,
    };

    if (!row.initial_sync_done) {
      const targetDate = subtractDays(todayInTz(tz, now), row.sync_cursor + 1);
      const result = await processReportDay(syncDeps, conn, targetDate);

      if (result.status !== 'error') {
        newSyncCursor = row.sync_cursor + 1;
        if (newSyncCursor >= TARGET_DAYS) {
          newInitialSyncDone = true;
        }
      }
    } else {
      const [yesterday, dayBefore] = recentBusinessDays(tz, now);
      await Promise.all([
        processReportDay(syncDeps, conn, yesterday),
        processReportDay(syncDeps, conn, dayBefore),
      ]);
    }
  }

  return { newSyncCursor, newInitialSyncDone };
}

// ── Handler ───────────────────────────────────────────────────────────────────

/**
 * Handle a POST /focus-bulk-sync request (triggered by pg_cron).
 *
 * No inbound auth gate — mirrors toast-bulk-sync / shift4-bulk-sync (verify_jwt=false,
 * no Bearer check). Pull-only, idempotent upserts; worst case for an unauthenticated
 * call is a redundant sync. Removes the dependency on the legacy service-role key in
 * the pg_cron invocation.
 *
 * Returns 200 { processed, errors, elapsedMs }.
 */
export async function handleBulkSync(
  _req: Request,
  deps: BulkSyncDeps,
): Promise<Response> {
  const jsonResponse = (body: unknown, status = 200): Response =>
    new Response(JSON.stringify(body), {
      status,
      headers: { 'Content-Type': 'application/json' },
    });

  const startMs = deps.now();

  // ── Claim a batch of due connections atomically (design review #1) ────────
  //
  // claim_focus_sync_batch performs an atomic UPDATE ... WHERE id IN (SELECT
  // ... FOR UPDATE SKIP LOCKED) RETURNING * inside a single SQL statement, so
  // concurrent invocations never double-claim the same connection. It also
  // bumps last_sync_time as a claim marker (Key Decisions: "Claim bumps
  // last_sync_time ... replaces worker-side failure-bump").

  const { data: rows, error: queryError } = await deps.serviceClient.rpc(
    'claim_focus_sync_batch',
    { p_limit: LIMIT },
  );

  if (queryError) {
    console.error('focus-bulk-sync: failed to claim connections:', queryError.message);
    return jsonResponse({ error: `Failed to claim connections: ${queryError.message}` }, 500);
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
      const { newSyncCursor, newInitialSyncDone, skipped } = await processConnection(row, deps);

      // Skipped rows (Lynk backfill — owned by focus-backfill-sync) get NO write:
      // persisting the stale cursor could regress the cron's progress and bumping
      // last_sync_time would perturb the round-robin. Still counted as processed
      // (it was handled without error). (CodeRabbit Major, 9d.)
      if (!skipped) {
        // Update the connection row with the new cursor + sync time (review S3).
        // Filter by both id and restaurant_id to satisfy multi-tenant contract.
        await deps.serviceClient
          .from('focus_connections')
          .update({
            sync_cursor: newSyncCursor,
            initial_sync_done: newInitialSyncDone,
            last_sync_time: new Date().toISOString(),
            updated_at: new Date().toISOString(),
            // Reset backoff state on success (design review #4) — a healthy
            // sync clears the failure streak so the connection resumes its
            // normal sync_interval_minutes cadence via the due predicate.
            consecutive_failures: 0,
            next_attempt_at: null,
          })
          .eq('id', row.id)
          .eq('restaurant_id', row.restaurant_id);
      }

      result.processed++;
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      console.error(`focus-bulk-sync: error for restaurant ${row.restaurant_id}:`, message);
      // Do not increment result.processed on error — processed means succeeded.
      // The caller can compute attempted = processed + errors.length.
      result.errors.push(`${row.restaurant_id}: ${message}`);
      // Write exponential backoff state instead of bumping last_sync_time
      // (design review #4). The claim already bumped last_sync_time as a claim
      // marker, so re-bumping it here is redundant; next_attempt_at is what
      // actually keeps the due predicate from re-selecting this connection
      // ahead of healthy ones. Best-effort only — never blocks the loop.
      const { consecutive_failures, next_attempt_at } = backoffAfterFailure(
        row.consecutive_failures ?? 0,
        deps.now(),
      );
      deps.serviceClient
        .from('focus_connections')
        .update({
          consecutive_failures,
          next_attempt_at,
          updated_at: new Date().toISOString(),
        })
        .eq('id', row.id)
        .eq('restaurant_id', row.restaurant_id)
        .then(({ error: tsErr }: { error: { message: string } | null }) => {
          if (tsErr) {
            console.warn(`focus-bulk-sync: backoff write failed for ${row.restaurant_id}:`, tsErr.message);
          }
        })
        .catch((e: unknown) => {
          console.warn(`focus-bulk-sync: backoff write threw for ${row.restaurant_id}:`, e instanceof Error ? e.message : String(e));
        });
    }
  }

  result.elapsedMs = deps.now() - startMs;
  return jsonResponse(result);
}
