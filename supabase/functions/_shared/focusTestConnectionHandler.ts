/**
 * focusTestConnectionHandler.ts
 *
 * Injectable handler for the focus-test-connection edge function.
 *
 * Responsibilities:
 *  1. Validate the Authorization header and verify the JWT via userClient.auth.getUser().
 *  2. Parse + validate the request body: { restaurantId }.
 *  3. Confirm the caller is an owner or manager of the target restaurant (review S6).
 *  4. Load the active focus_connections row for the restaurant via service-role client.
 *  5. Compute "yesterday" in the connection's IANA timezone (review S4 — tz-correct date).
 *  6. Fetch yesterday's Revenue Center report via focusReportClient (SSRF-guarded).
 *  7. Parse the HTML via focusReportParser.
 *  8. Based on the discriminated result (review S9):
 *       - {ok:true} or {ok:false, reason:'empty'}  → connection_status='connected'
 *       - {ok:false, reason:'parse_error'} or fetch error → connection_status='error'
 *  9. Write connection_status (+ last_error / last_error_at) via service-role client (review S3).
 * 10. Return 200 JSON { success, status, error? } for both outcomes (caller decides UX).
 *
 * Design references:
 *  - Plan Task 8
 *  - Spec §8 (focus-test-connection edge function)
 *  - §16 S3 (service-role client for writes), S4 (business-date timezone),
 *           S6 (JWT + role), S9 (empty → connected; parse_error → error)
 *
 * Auth pattern mirrors focus-save-connection (Task 7):
 *   Authorization header → userClient.auth.getUser() → user_restaurants role check → business logic.
 *
 * The handler receives pre-constructed clients (userClient built from the caller's JWT,
 * serviceClient built from SUPABASE_SERVICE_ROLE_KEY) so it is fully testable with Vitest
 * without any Deno-specific imports.
 */

import {
  buildReportUrl,
  fetchReportHtml,
  isoToMmDdYyyy,
  rowToFocusConnection,
  todayInTz,
  subtractDays,
  FOCUS_ALLOWED_ROLES,
  type FocusConnection,
  type FocusConnectionRow as SharedFocusConnectionRow,
  type FetchDeps,
} from './focusReportClient.ts';
import { parseRevenueCenterReport } from './focusReportParser.ts';
import { loginToPortal, FocusAuthError } from './focusPortalClient.ts';
import { getEncryptionService } from './encryption.ts';

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
  username: string;
  password_encrypted: string;
}

/** Minimal Supabase service-role client surface needed for reads + writes. */
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
  };
}

/**
 * Injectable dependencies that the thin index.ts provides.
 * Keeping them injectable makes the handler unit-testable without Deno env vars.
 */
export interface TestConnectionDeps {
  /** Supabase client created with the caller's Authorization JWT (for auth + role checks). */
  userClient: UserClient;
  /** Supabase client created with SUPABASE_SERVICE_ROLE_KEY (for reads + writes — bypasses RLS). */
  serviceClient: ServiceClient;
  /** fetch-compatible function. In production: globalThis.fetch. Injectable for Vitest. */
  fetch: FetchDeps['fetch'];
  /** Current time (injected so tests can control "yesterday" computation). Defaults to new Date(). */
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
 * Handle a POST /focus-test-connection request.
 *
 * Expected JSON body: { restaurantId: string }
 * Required header:    Authorization: Bearer <jwt>
 *
 * Always returns 200 for the connectivity outcome (caller reads {success, status}).
 * Returns 4xx for auth / input errors before we reach the test step.
 */
export async function handleTestConnection(
  req: Request,
  deps: TestConnectionDeps,
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
        'report_user_id, store_id, revenue_center, timezone, username, password_encrypted',
    )
    .eq('restaurant_id', restaurantId)
    .eq('is_active', true)
    .single();

  if (connError || !connRow) {
    return jsonError(404, 'No active Focus POS connection found for this restaurant');
  }

  // ── 6. Build FocusConnection for the client module ───────────────────────

  const conn: FocusConnection = rowToFocusConnection(connRow);

  // ── 6b. Auth gate: validate credentials before fetching report ───────────

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
          last_error_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        })
        .eq('id', connRow.id);
      return new Response(
        JSON.stringify({ success: false, status: 'error', error: 'Invalid Focus credentials' }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      );
    }
    throw err;
  }

  // ── 7. Compute yesterday in the connection's IANA timezone (review S4) ────

  const tz = connRow.timezone || 'America/Chicago';
  const businessDate = subtractDays(todayInTz(tz, now), 1); // 'YYYY-MM-DD'
  const formattedDate = isoToMmDdYyyy(businessDate); // 'MM/DD/YYYY'

  // ── 8. Fetch + parse the report ───────────────────────────────────────────

  let connectionStatus: 'connected' | 'error';
  let lastError: string | null = null;

  try {
    const url = buildReportUrl(conn, formattedDate, formattedDate);
    const html = await fetchReportHtml({ fetch: deps.fetch }, url);
    // Pass deps.domParser when provided (deno_dom in Deno edge functions).
    // Omit in tests so the parser falls back to globalThis.DOMParser (jsdom).
    const parseResult = parseRevenueCenterReport(html, businessDate, deps.domParser);

    // S9: ok:true OR reason:'empty' → connected; parse_error → error
    if (!parseResult.ok && parseResult.reason === 'parse_error') {
      connectionStatus = 'error';
      lastError = 'parse_error: report HTML could not be parsed — unexpected structure';
    } else {
      connectionStatus = 'connected';
    }
  } catch (err) {
    // Log the raw fetch/parse error server-side; surface a sanitized, actionable
    // reason to the client (CodeQL: don't leak internal error/stack detail).
    console.error(
      'focus-test-connection: report fetch failed:',
      err instanceof Error ? err.message : String(err),
    );
    connectionStatus = 'error';
    lastError = 'Could not fetch the Focus report — verify the report URL and Store ID are correct';
  }

  // ── 9. Write connection_status via service-role client (review S3) ────────

  const updatePayload: Record<string, unknown> = {
    connection_status: connectionStatus,
    last_error: connectionStatus === 'connected' ? null : lastError,
    last_error_at: connectionStatus === 'connected' ? null : new Date().toISOString(),
    updated_at: new Date().toISOString(),
  };

  await deps.serviceClient
    .from('focus_connections')
    .update(updatePayload)
    .eq('id', connRow.id);

  // ── 10. Respond ──────────────────────────────────────────────────────────

  const responseBody: Record<string, unknown> = {
    success: connectionStatus === 'connected',
    status: connectionStatus,
  };
  if (connectionStatus === 'error' && lastError) {
    responseBody.error = lastError;
  }

  return new Response(JSON.stringify(responseBody), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });
}
