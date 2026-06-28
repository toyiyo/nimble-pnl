/**
 * focusSyncDataHandler.ts
 *
 * Injectable handler for the focus-sync-data edge function (manual / user-triggered sync).
 *
 * Responsibilities:
 *  1. Validate the Authorization header and verify the JWT via userClient.auth.getUser().
 *  2. Parse + validate the request body: { restaurantId }.
 *  3. Confirm the caller is an owner or manager of the target restaurant (review S6).
 *  4. Load the active focus_connections row via the service-role client.
 *  5. Determine the sync mode:
 *       a. Backfill (initial_sync_done=false):
 *          - Compute the target business date: today_in_tz − sync_cursor − 1 (review S4).
 *          - Call processReportDay for that date.
 *          - Increment sync_cursor; when it reaches TARGET_DAYS (90) set initial_sync_done=true.
 *       b. Incremental (initial_sync_done=true):
 *          - Process the last 2 business days (yesterday + day before) in the tz.
 *  6. Write the updated sync_cursor / initial_sync_done / last_sync_time via service-role
 *     client (review S3).
 *  7. Return 200 JSON { syncCursor, initialSyncDone, status } where status comes from
 *     processReportDay ('ok' | 'empty' | 'error').
 *
 * Design references:
 *  - Plan Task 9
 *  - Spec §8 (focus-sync-data edge function), §9 (sync orchestration)
 *  - §16 S3 (service-role client for writes), S4 (business-date timezone),
 *           S6 (JWT + role), S9 (parse_error propagation)
 *
 * The handler receives pre-constructed clients (userClient built from the caller's JWT,
 * serviceClient built from SUPABASE_SERVICE_ROLE_KEY) so it is fully testable with Vitest
 * without any Deno-specific imports.
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

// ── Constants ──────────────────────────────────────────────────────────────────

/** Number of days to backfill (one per call). */
const TARGET_DAYS = 90;

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
  username: string;
  password_encrypted: string;
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
    ): {
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
}

// ── Handler ───────────────────────────────────────────────────────────────────

/**
 * Handle a POST /focus-sync-data request.
 *
 * Expected JSON body: { restaurantId: string }
 * Required header:    Authorization: Bearer <jwt>
 *
 * Returns 200 { syncCursor, initialSyncDone, status } on success.
 * Returns 4xx for auth / input errors.
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

  const { restaurantId } = body as { restaurantId?: string };

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
        'username, password_encrypted',
    )
    .eq('restaurant_id', restaurantId)
    .eq('is_active', true)
    .single();

  if (connError || !connRow) {
    return jsonError(404, 'No active Focus POS connection found for this restaurant');
  }

  // ── 6. Auth gate: validate credentials before syncing ────────────────────

  try {
    const encSvc = await getEncryptionService();
    const password = await encSvc.decrypt(connRow.password_encrypted);
    await loginToPortal({ fetch: deps.fetch }, connRow.username, password);
  } catch (err) {
    if (err instanceof FocusAuthError) {
      await deps.serviceClient
        .from('focus_connections')
        .update({
          connection_status: 'error',
          last_error: 'Invalid Focus credentials',
          updated_at: new Date().toISOString(),
        })
        .eq('id', connRow.id);
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

  // ── 7. Build FocusConnection for the client module ───────────────────────

  const conn: FocusConnection = rowToFocusConnection(connRow);

  // Build the injectable SyncDeps that processReportDay expects.
  // The serviceClient satisfies the SupabaseDeps interface (it has upsert).
  // Forward domParser so processReportDay can pass it to parseRevenueCenterReport
  // (deno_dom in Deno edge function runtime; undefined in tests → jsdom fallback).
  const syncDeps: SyncDeps = {
    fetch: deps.fetch,
    supabase: deps.serviceClient as unknown as SupabaseDeps,
    restaurantId,
    domParser: deps.domParser,
  };

  const tz = connRow.timezone || 'America/Chicago';

  let status: 'ok' | 'empty' | 'error' = 'ok';
  let newSyncCursor = connRow.sync_cursor;
  let newInitialSyncDone = connRow.initial_sync_done;

  if (!connRow.initial_sync_done) {
    // ── 8a. Backfill: one day per call ────────────────────────────────────────
    // Target date = today_in_tz − sync_cursor − 1
    // (day 0 = yesterday, day 1 = 2 days ago, …, day 89 = 90 days ago)
    const targetDate = subtractDays(todayInTz(tz, now), connRow.sync_cursor + 1);

    const result = await processReportDay(syncDeps, conn, targetDate);
    status = result.status;

    // Only advance the cursor on success or empty (day had no sales).
    // On error (network failure, parse failure) keep cursor in place so the
    // same day is retried on the next call — prevents permanently skipping
    // a business day due to a transient Focus outage. (Codex review P1)
    if (result.status !== 'error') {
      newSyncCursor = connRow.sync_cursor + 1;
      if (newSyncCursor >= TARGET_DAYS) {
        newInitialSyncDone = true;
      }
    }
  } else {
    // ── 8b. Incremental: re-fetch last 2 business days ─────────────────────
    const [yesterday, dayBefore] = recentBusinessDays(tz, now);

    const [r1, r2] = await Promise.all([
      processReportDay(syncDeps, conn, yesterday),
      processReportDay(syncDeps, conn, dayBefore),
    ]);

    // Surface the worst status of the two calls
    if (r1.status === 'error' || r2.status === 'error') {
      status = 'error';
    } else if (r1.status === 'empty' && r2.status === 'empty') {
      status = 'empty';
    }
    // else: at least one is 'ok' → keep the default 'ok'
  }

  // ── 9. Update connection state via service-role client (review S3) ────────

  await deps.serviceClient
    .from('focus_connections')
    .update({
      sync_cursor: newSyncCursor,
      initial_sync_done: newInitialSyncDone,
      last_sync_time: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    })
    .eq('id', connRow.id);

  // ── 10. Respond ───────────────────────────────────────────────────────────

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
