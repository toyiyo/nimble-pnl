/**
 * focusSyncDataHandler.ts
 *
 * Injectable handler for the focus-sync-data edge function (manual / user-triggered sync).
 *
 * Responsibilities:
 *  1. Validate the Authorization header and verify the JWT via userClient.auth.getUser().
 *  2. Parse + validate the request body: { restaurantId, startDate?, endDate? }.
 *  3. Confirm the caller is an owner or manager of the target restaurant (review S6).
 *  4. Load the active focus_connections row via the service-role client.
 *  5. Determine the sync path:
 *       - Lynk API path (api_key present): use processBackfillBatch / processDateRangeTransactions.
 *       - Legacy portal path (api_key absent): use processReportDay (SSRS scrape).
 *  6. Determine the sync mode for the Lynk path:
 *       a. Custom range (startDate + endDate in body, ≤14 days, Lynk only):
 *          - Validate: both required, start≤end, span≤14 days → else 400.
 *          - Call processDateRangeTransactions synchronously.
 *          - Return { daysSynced, status }.
 *       b. Backfill (initial_sync_done=false):
 *          - Delegate to processBackfillBatch({ budgetMs:12_000, maxDays:3 }).
 *          - Persist cursor/flag/last_sync_time via CAS (§8.1).
 *          - On error: also write connection_status='error' + last_error (§8.3).
 *          - Return { syncCursor, initialSyncDone, status, backgrounded }.
 *       c. Incremental (initial_sync_done=true):
 *          - Process the last 2 business days (yesterday + day before) in the tz.
 *  7. Write the updated sync_cursor / initial_sync_done / last_sync_time via service-role
 *     client with CAS to prevent concurrent-tick clobbering (§8.1).
 *  8. Return 200 JSON.
 *
 * Design references:
 *  - Plan B3; spec §5.2 (custom range), §8.1 (CAS), §8.2 (14-day cap), §8.3 (error status)
 *  - Plan Task 9 (portal path unchanged)
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
  FOCUS_ALLOWED_ROLES,
  type FocusConnection,
  type FocusConnectionRow as SharedFocusConnectionRow,
  type FetchDeps,
} from './focusReportClient.ts';
import { loginToPortal, FocusAuthError } from './focusPortalClient.ts';
import { getEncryptionService } from './encryption.ts';
import {
  processDayTransactions,
  processDateRangeTransactions,
  type TransactionSyncConfig,
} from './focusTransactionSyncHandler.ts';
import { focusApiBaseUrl, fetchDatafeed as realFetchDatafeed } from './focusLynkClient.ts';
import {
  processBackfillBatch,
  type BackfillBatchDeps,
} from './focusBackfillBatch.ts';

// ── Constants ──────────────────────────────────────────────────────────────────

/** Maximum days span allowed for a custom date-range sync (§8.2). */
const MAX_CUSTOM_RANGE_DAYS = 14;

// ── Types ─────────────────────────────────────────────────────────────────────

/** Minimal Supabase user-client surface needed by the handler. */
export interface UserClient {
  auth: {
    getUser(): Promise<{ data: { user: { id: string } | null } }>;
  };
  from(table: string): {
    select(columns: string): {
      eq(col: string, val: string): {
        eq(col: string, val: string): {
          single(): Promise<{ data: { role: string } | null; error: unknown }>;
        };
      };
    };
  };
}

/** DB row shape returned from focus_connections (extends shared routing params). */
interface FocusConnectionRow extends SharedFocusConnectionRow {
  id: string;
  restaurant_id: string;
  initial_sync_done: boolean;
  sync_cursor: number;
  username: string | null;
  password_encrypted: string | null;
  /** Lynk API key (HTTP Basic username). Present for API-path connections. */
  api_key: string | null;
  /** Lynk API secret, AES-GCM encrypted. Present for API-path connections. */
  api_secret_encrypted: string | null;
  /** Environment: 'production' | 'sandbox'. */
  environment: string | null;
}

/**
 * CAS update chain: .update(data).eq(id).eq(restaurantId).eq('sync_cursor', readCursor).select()
 * Returns { data: row[], error } — 0 rows means another tick already advanced it.
 */
interface CasUpdateResult {
  data: unknown[] | null;
  error: { message: string } | null;
}

interface CasEq3 {
  select(): Promise<CasUpdateResult>;
}

interface CasEq2 {
  eq(col: string, val: unknown): CasEq3;
}

interface CasEq1 {
  eq(col: string, val: string): CasEq2;
}

/** Minimal Supabase service-role client surface (reads + writes). */
export interface ServiceClient {
  from(table: string): {
    select(columns: string): {
      eq(col: string, val: string): {
        eq(col: string, val: string): {
          single(): Promise<{
            data: FocusConnectionRow | null;
            error: { message: string } | null;
          }>;
        };
      };
    };
    update(
      data: Record<string, unknown>,
    ): CasEq1;
    upsert(
      data: Record<string, unknown>,
      options?: Record<string, unknown>,
    ): {
      onConflict(columns: string): {
        select(): Promise<{ data: unknown; error: { message: string } | null }>;
      };
    };
  };
  rpc(
    fn: string,
    args: Record<string, unknown>,
  ): Promise<{ data: unknown; error: { message: string } | null }>;
}

/**
 * Injectable dependencies that the thin index.ts provides.
 */
export interface SyncDataDeps {
  /** Supabase client created with the caller's Authorization JWT (for auth + role checks). */
  userClient: UserClient;
  /** Supabase client created with SUPABASE_SERVICE_ROLE_KEY (for reads + writes — bypasses RLS). */
  serviceClient: ServiceClient;
  /** fetch-compatible function. In production: globalThis.fetch. Injectable for Vitest. */
  fetch: FetchDeps['fetch'];
  /** Current time (injected so tests can control date calculations). Defaults to new Date(). */
  now?: Date;
  /**
   * Optional DOMParser-compatible instance. Provide `new DOMParser()` from deno_dom in
   * Deno edge functions (globalThis.DOMParser is undefined there).
   * Omit in tests — jsdom provides globalThis.DOMParser.
   */
  domParser?: { parseFromString(html: string, mimeType: string): Document };
  /**
   * Optional injectable fetchDatafeed function for the Lynk API path.
   * Defaults to the real fetchDatafeed from focusLynkClient. Injectable for tests.
   */
  fetchDatafeed?: Parameters<typeof processDayTransactions>[0]['fetchDatafeed'];
  /**
   * Optional override URL for environment='sandbox' connections
   * (FOCUS_API_SANDBOX_URL env var). Without it, sandbox connections
   * fall back to the production URL (focusApiBaseUrl doc §6).
   */
  sandboxBaseUrl?: string;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

/**
 * Validate an ISO date string (YYYY-MM-DD). Returns a Date if valid, null otherwise.
 */
function parseIsoDate(s: string): Date | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return null;
  const d = new Date(s + 'T00:00:00Z');
  if (isNaN(d.getTime())) return null;
  return d;
}

/**
 * Count the number of calendar days in the range [startDate, endDate] inclusive.
 * Both are ISO YYYY-MM-DD strings.
 */
function rangeDays(startDate: string, endDate: string): number {
  const start = new Date(startDate + 'T00:00:00Z');
  const end = new Date(endDate + 'T00:00:00Z');
  return Math.round((end.getTime() - start.getTime()) / 86_400_000) + 1;
}

// ── Handler ───────────────────────────────────────────────────────────────────

/**
 * Handle a POST /focus-sync-data request.
 *
 * Expected JSON body: { restaurantId: string, startDate?: string, endDate?: string }
 * Required header:    Authorization: Bearer <jwt>
 *
 * Returns 200 JSON on success; 4xx for auth / input errors.
 */
export async function handleSyncData(
  req: Request,
  deps: SyncDataDeps,
): Promise<Response> {
  const jsonError = (status: number, message: string): Response =>
    new Response(JSON.stringify({ error: message }), {
      status,
      headers: { 'Content-Type': 'application/json' },
    });

  const now = deps.now ?? new Date();

  // ── 1. Authorization header ────────────────────────────────────────────────

  const authHeader = req.headers.get('Authorization');
  if (!authHeader) {
    return jsonError(401, 'Missing Authorization header');
  }

  // ── 2. Verify JWT ─────────────────────────────────────────────────────────

  const {
    data: { user },
  } = await deps.userClient.auth.getUser();
  if (!user) {
    return jsonError(401, 'Unauthorized: invalid or expired token');
  }

  // ── 3. Parse request body ─────────────────────────────────────────────────

  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return jsonError(400, 'Invalid JSON body');
  }

  const { restaurantId, startDate, endDate } = body as {
    restaurantId?: string;
    startDate?: string;
    endDate?: string;
  };

  if (!restaurantId) {
    return jsonError(400, 'Missing required field: restaurantId');
  }

  // ── 4. Role check ─────────────────────────────────────────────────────────

  const { data: membership } = await deps.userClient
    .from('user_restaurants')
    .select('role')
    .eq('user_id', user.id)
    .eq('restaurant_id', restaurantId)
    .single();

  if (!membership || !FOCUS_ALLOWED_ROLES.has(membership.role)) {
    return jsonError(403, 'Access denied: owner or manager role required');
  }

  // ── 5. Load the active connection (via service-role client) ───────────────

  const { data: connRow, error: connError } = await deps.serviceClient
    .from('focus_connections')
    .select(
      'id, restaurant_id, report_base_url, report_path, db_server, db_catalog, ' +
        'report_user_id, store_id, revenue_center, timezone, initial_sync_done, sync_cursor, ' +
        'username, password_encrypted, api_key, api_secret_encrypted, environment',
    )
    .eq('restaurant_id', restaurantId)
    .eq('is_active', true)
    .single();

  if (connError || !connRow) {
    return jsonError(404, 'No active Focus POS connection found for this restaurant');
  }

  const tz = connRow.timezone || 'America/Chicago';
  const isLynkPath = !!connRow.api_key;

  if (isLynkPath) {
    // ── Lynk API path (Focus POS API with api_key / api_secret) ──────────────
    if (!connRow.api_secret_encrypted || !connRow.store_id) {
      return jsonError(409, 'Focus POS API credentials are incomplete');
    }

    // Decrypt the API secret and build the transaction sync config.
    // Wrap in try/catch: a corrupted ciphertext or key rotation must return a
    // clean JSON error (Edge Function convention) instead of an uncaught throw.
    const encSvc = await getEncryptionService();
    let apiSecret: string;
    try {
      apiSecret = await encSvc.decrypt(connRow.api_secret_encrypted!);
    } catch {
      return jsonError(500, 'Failed to decrypt Focus POS API credentials');
    }

    const txConfig: TransactionSyncConfig = {
      restaurantId,
      storeId: connRow.store_id,
      apiKey: connRow.api_key!,
      apiSecret,
      baseUrl: focusApiBaseUrl(
        (connRow.environment as 'production' | 'sandbox') ?? 'production',
        deps.sandboxBaseUrl,
      ),
    };

    const fetchDatafeedFn = deps.fetchDatafeed ?? realFetchDatafeed;

    // ── Custom range (§8.2) ────────────────────────────────────────────────────
    // Detected when either startDate or endDate is present in the body.
    const hasCustomRange = startDate !== undefined || endDate !== undefined;
    if (hasCustomRange) {
      // Both fields required
      if (!startDate || !endDate) {
        return jsonError(
          400,
          'Both startDate and endDate are required for a custom range sync',
        );
      }
      // Parse + validate
      const startD = parseIsoDate(startDate);
      const endD = parseIsoDate(endDate);
      if (!startD || !endD) {
        return jsonError(400, 'startDate and endDate must be valid ISO dates (YYYY-MM-DD)');
      }
      if (startD > endD) {
        return jsonError(
          400,
          'Invalid range: startDate must be on or before endDate',
        );
      }
      const span = rangeDays(startDate, endDate);
      if (span > MAX_CUSTOM_RANGE_DAYS) {
        return jsonError(
          400,
          `Custom range is limited to ${MAX_CUSTOM_RANGE_DAYS} days. Use the automatic 90-day import for a full backfill.`,
        );
      }

      // Run synchronously (§8.2 — dropped waitUntil)
      const rangeResult = await processDateRangeTransactions(
        {
          supabase: deps.serviceClient as unknown as Parameters<typeof processDateRangeTransactions>[0]['supabase'],
          fetchDatafeed: fetchDatafeedFn,
        },
        txConfig,
        startDate,
        endDate,
      );

      return new Response(
        JSON.stringify({
          daysSynced: rangeResult.daysSynced,
          status: rangeResult.status,
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      );
    }

    // ── Read the cursor before the batch (for CAS) ─────────────────────────
    const readCursor = connRow.sync_cursor;

    if (!connRow.initial_sync_done) {
      // ── Backfill: small kick via processBackfillBatch (§8.3) ─────────────────
      const batchDeps: BackfillBatchDeps = {
        supabase: deps.serviceClient as unknown as BackfillBatchDeps['supabase'],
        fetchDatafeed: fetchDatafeedFn,
        processDayTransactions,
      };

      const batchResult = await processBackfillBatch(batchDeps, txConfig, {
        syncCursor: readCursor,
        timezone: tz,
        now,
        budgetMs: 12_000,
        maxDays: 3,
      });

      // Single timestamp shared across all fields in this update.
      const nowIso = now.toISOString();

      // Build update payload
      const updatePayload: Record<string, unknown> = {
        sync_cursor: batchResult.syncCursor,
        initial_sync_done: batchResult.initialSyncDone,
        last_sync_time: nowIso,
        updated_at: nowIso,
      };

      // On error, persist the stall details so the frontend can stop polling (§8.3)
      if (batchResult.status === 'error') {
        updatePayload.connection_status = 'error';
        updatePayload.last_error = batchResult.lastError ?? 'Unknown backfill error';
        updatePayload.last_error_at = nowIso;
      }

      // CAS write: filter on (id, restaurant_id, sync_cursor=readCursor) so concurrent
      // ticks don't clobber each other (§8.1). 0 rows back = another tick already won;
      // return the stale cursor values — the cron tick that won will advance them next tick.
      const { data: casBfRows, error: casBfErr } = await deps.serviceClient
        .from('focus_connections')
        .update(updatePayload)
        .eq('id', connRow.id)
        .eq('restaurant_id', restaurantId)
        .eq('sync_cursor', readCursor)
        .select();

      if (casBfErr) {
        return jsonError(500, `CAS write failed: ${casBfErr.message}`);
      }

      // CAS miss: a concurrent tick already advanced the cursor; report the current
      // batch result so the frontend still shows progress, but note the actual write
      // was skipped (the winning tick's update already took effect).
      const casWon = !!(casBfRows?.length);

      return new Response(
        JSON.stringify({
          syncCursor: batchResult.syncCursor,
          initialSyncDone: batchResult.initialSyncDone,
          status: casWon ? batchResult.status : 'ok',
          backgrounded: !batchResult.initialSyncDone,
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      );
    } else {
      // ── Incremental: last 2 business days ────────────────────────────────────
      const [yesterday, dayBefore] = recentBusinessDays(tz, now);

      const txDeps = {
        supabase: deps.serviceClient as unknown as Parameters<typeof processDayTransactions>[0]['supabase'],
        fetchDatafeed: fetchDatafeedFn,
      };

      const [r1, r2] = await Promise.all([
        processDayTransactions(txDeps, txConfig, yesterday),
        processDayTransactions(txDeps, txConfig, dayBefore),
      ]);

      let status: 'ok' | 'empty' | 'error' = 'ok';
      if (r1.status === 'error' || r2.status === 'error') {
        status = 'error';
      } else if (r1.status === 'empty' && r2.status === 'empty') {
        status = 'empty';
      }

      const nowIso = now.toISOString();

      // Build update payload: always refresh last_sync_time; also persist error
      // state when incremental sync fails so the frontend / ops can surface it.
      const incUpdatePayload: Record<string, unknown> = {
        last_sync_time: nowIso,
        updated_at: nowIso,
      };
      if (status === 'error') {
        incUpdatePayload.connection_status = 'error';
        incUpdatePayload.last_error =
          (r1.status === 'error' ? r1.error : undefined) ??
          (r2.status === 'error' ? r2.error : undefined) ??
          'Incremental sync failed';
        incUpdatePayload.last_error_at = nowIso;
      }

      const { error: casIncErr } = await deps.serviceClient
        .from('focus_connections')
        .update(incUpdatePayload)
        .eq('id', connRow.id)
        .eq('restaurant_id', restaurantId)
        .eq('sync_cursor', readCursor)
        .select();

      if (casIncErr) {
        console.warn(`focus-sync-data: incremental CAS write warning: ${casIncErr.message}`);
      }
      // A CAS miss on the incremental path is non-critical: sync_cursor doesn't
      // advance on incremental syncs anyway, so 0 rows just means another client
      // also updated last_sync_time — both writes are idempotent (same timestamp ~).

      return new Response(
        JSON.stringify({
          syncCursor: connRow.sync_cursor,
          initialSyncDone: connRow.initial_sync_done,
          status,
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      );
    }
  } else {
    // ── Legacy portal path (SSRS scrape) ──────────────────────────────────────

    let status: 'ok' | 'empty' | 'error' = 'ok';
    let newSyncCursor = connRow.sync_cursor;
    let newInitialSyncDone = connRow.initial_sync_done;

    // ── 6. Auth gate: validate credentials before syncing ─────────────────────

    try {
      const encSvc = await getEncryptionService();
      const password = await encSvc.decrypt(connRow.password_encrypted!);
      await loginToPortal({ fetch: deps.fetch }, connRow.username!, password);
    } catch (err) {
      if (err instanceof FocusAuthError) {
        // Filter by both id and restaurant_id to satisfy multi-tenant contract.
        await deps.serviceClient
          .from('focus_connections')
          .update({
            connection_status: 'error',
            last_error: 'Invalid Focus credentials',
            updated_at: now.toISOString(),
          })
          .eq('id', connRow.id)
          .eq('restaurant_id', restaurantId)
          .eq('sync_cursor', connRow.sync_cursor)
          .select();
        return new Response(
          JSON.stringify({
            syncCursor: connRow.sync_cursor,
            initialSyncDone: connRow.initial_sync_done,
            status: 'error',
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } },
        );
      }
      throw err;
    }

    // ── 7. Build FocusConnection for the client module ─────────────────────────

    const conn: FocusConnection = rowToFocusConnection(connRow);

    const syncDeps: SyncDeps = {
      fetch: deps.fetch,
      supabase: deps.serviceClient as unknown as SupabaseDeps,
      restaurantId,
      domParser: deps.domParser,
    };

    if (!connRow.initial_sync_done) {
      // ── Backfill: one day per call ────────────────────────────────────────────
      const targetDate = subtractDays(todayInTz(tz, now), connRow.sync_cursor + 1);

      const result = await processReportDay(syncDeps, conn, targetDate);
      status = result.status;

      if (result.status !== 'error') {
        newSyncCursor = connRow.sync_cursor + 1;
        if (newSyncCursor >= 90) {
          newInitialSyncDone = true;
        }
      }
    } else {
      // ── Incremental: re-fetch last 2 business days ────────────────────────────
      const [yesterday, dayBefore] = recentBusinessDays(tz, now);

      const [r1, r2] = await Promise.all([
        processReportDay(syncDeps, conn, yesterday),
        processReportDay(syncDeps, conn, dayBefore),
      ]);

      if (r1.status === 'error' || r2.status === 'error') {
        status = 'error';
      } else if (r1.status === 'empty' && r2.status === 'empty') {
        status = 'empty';
      }
    }

    // ── 9. Update connection state via service-role client ─────────────────────

    const nowIso = now.toISOString();
    await deps.serviceClient
      .from('focus_connections')
      .update({
        sync_cursor: newSyncCursor,
        initial_sync_done: newInitialSyncDone,
        last_sync_time: nowIso,
        updated_at: nowIso,
      })
      .eq('id', connRow.id)
      .eq('restaurant_id', restaurantId)
      .eq('sync_cursor', connRow.sync_cursor)
      .select();

    // ── 10. Respond ────────────────────────────────────────────────────────────

    return new Response(
      JSON.stringify({
        syncCursor: newSyncCursor,
        initialSyncDone: newInitialSyncDone,
        status,
      }),
      {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      },
    );
  }
}
