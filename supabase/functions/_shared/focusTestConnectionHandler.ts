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
  type FocusConnection,
  type FetchDeps,
} from './focusReportClient.ts';
import { parseRevenueCenterReport } from './focusReportParser.ts';

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

/** DB row shape returned from focus_connections. */
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
}

// ── Constants ─────────────────────────────────────────────────────────────────

const ALLOWED_ROLES = new Set(['owner', 'manager']);

// ── Helpers ───────────────────────────────────────────────────────────────────

/**
 * Compute "yesterday" as an ISO date string ('YYYY-MM-DD') in the given IANA timezone.
 *
 * Uses Intl.DateTimeFormat to get the current calendar date in the connection's timezone,
 * then subtracts one day. This correctly handles UTC-midnight off-by-one across all
 * 90-day backfill dates (design review S4).
 *
 * @param tz   IANA timezone string, e.g. 'America/Chicago'
 * @param now  Reference point for "now" (injectable for tests)
 */
function yesterdayInTz(tz: string, now: Date): string {
  // Get "today" in the connection's timezone
  const formatter = new Intl.DateTimeFormat('en-CA', {
    timeZone: tz,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  });
  // en-CA locale gives "YYYY-MM-DD" format directly
  const todayStr = formatter.format(now); // e.g. "2026-06-27"

  // Subtract one day from the parsed date (no timezone offset confusion because
  // we're working with the calendar date in the target tz, not a UTC timestamp).
  const today = new Date(todayStr + 'T12:00:00Z'); // noon UTC to avoid DST edge cases
  today.setUTCDate(today.getUTCDate() - 1);

  // Return as 'YYYY-MM-DD'
  return today.toISOString().substring(0, 10);
}

/**
 * Convert an ISO date string ('YYYY-MM-DD') to the MM/DD/YYYY format
 * expected by the SSRS report URL params (StartDate / EndDate).
 */
function isoToMmDdYyyy(iso: string): string {
  const [yyyy, mm, dd] = iso.split('-');
  return `${mm}/${dd}/${yyyy}`;
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

  if (!membership || !ALLOWED_ROLES.has(membership.role)) {
    return jsonError(403, 'Access denied: owner or manager role required');
  }

  // ── 5. Load the active connection (via service-role client) ───────────────

  const { data: connRow, error: connError } = await deps.serviceClient
    .from('focus_connections')
    .select(
      'id, restaurant_id, report_base_url, report_path, db_server, db_catalog, ' +
        'report_user_id, store_id, revenue_center, timezone',
    )
    .eq('restaurant_id', restaurantId)
    .eq('is_active', 'true')
    .single();

  if (connError || !connRow) {
    return jsonError(404, 'No active Focus POS connection found for this restaurant');
  }

  // ── 6. Build FocusConnection for the client module ───────────────────────

  const conn: FocusConnection = {
    reportBaseUrl: connRow.report_base_url,
    reportPath: connRow.report_path,
    dbServer: connRow.db_server ?? '',
    dbCatalog: connRow.db_catalog ?? '',
    reportUserId: connRow.report_user_id ?? '',
    storeId: connRow.store_id,
    revenueCenter: connRow.revenue_center ?? '',
  };

  // ── 7. Compute yesterday in the connection's IANA timezone (review S4) ────

  const tz = connRow.timezone || 'America/Chicago';
  const businessDate = yesterdayInTz(tz, now); // 'YYYY-MM-DD'
  const formattedDate = isoToMmDdYyyy(businessDate); // 'MM/DD/YYYY'

  // ── 8. Fetch + parse the report ───────────────────────────────────────────

  let connectionStatus: 'connected' | 'error';
  let lastError: string | null = null;

  try {
    const url = buildReportUrl(conn, formattedDate, formattedDate);
    const html = await fetchReportHtml({ fetch: deps.fetch }, url);
    const parseResult = parseRevenueCenterReport(html, businessDate);

    // S9: ok:true OR reason:'empty' → connected; parse_error → error
    if (!parseResult.ok && parseResult.reason === 'parse_error') {
      connectionStatus = 'error';
      lastError = 'parse_error: report HTML could not be parsed — unexpected structure';
    } else {
      connectionStatus = 'connected';
    }
  } catch (err) {
    connectionStatus = 'error';
    lastError = err instanceof Error ? err.message : String(err);
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
