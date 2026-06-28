/**
 * focusSaveConnectionHandler.ts
 *
 * Injectable handler for the focus-save-connection edge function.
 *
 * Responsibilities:
 *  1. Validate the Authorization header and verify the JWT via userClient.auth.getUser().
 *  2. Parse + validate the request body: { restaurantId, reportUrl }.
 *  3. Confirm the caller is an owner or manager of the target restaurant.
 *  4. Parse the reportUrl via parseFocusReportUrl (SSRF guard baked in: https-only,
 *     *.myfocuspos.com allowlist, StoreID required).
 *  5. Upsert into focus_connections via the service-role client (review S3: all writes
 *     to integration tables use service_role to bypass RLS).
 *  6. Return JSON responses with appropriate HTTP status codes.
 *
 * Design references:
 *  - Plan Task 7
 *  - Spec §8 (_shared/focusSaveConnectionHandler.ts)
 *  - §16 S3 (service-role writes), S6 (JWT + role check), S1 (SSRF — delegated to parseFocusReportUrl)
 *
 * Auth pattern mirrors toast-save-credentials:
 *   Authorization header → userClient.auth.getUser() → user_restaurants role check → business logic.
 *
 * The handler receives pre-constructed clients (userClient built from the caller's JWT,
 * serviceClient built from SUPABASE_SERVICE_ROLE_KEY) so it is fully testable with Vitest
 * without any Deno-specific imports.
 */

import { parseFocusReportUrl } from '../../../src/lib/focusUrlParser.ts';

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

/** Minimal Supabase service-role client surface needed for the upsert. */
export interface ServiceClient {
  from(table: string): {
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
 * Keeping them injectable makes the handler unit-testable without Deno env vars.
 */
export interface SaveConnectionDeps {
  /** Supabase client created with the caller's Authorization JWT (for auth + role checks). */
  userClient: UserClient;
  /** Supabase client created with SUPABASE_SERVICE_ROLE_KEY (for writes — bypasses RLS). */
  serviceClient: ServiceClient;
}

// ── Allowed roles ─────────────────────────────────────────────────────────────

const ALLOWED_ROLES = new Set(['owner', 'manager']);

// ── Handler ───────────────────────────────────────────────────────────────────

/**
 * Handle a POST /focus-save-connection request.
 *
 * Expected JSON body: { restaurantId: string, reportUrl: string }
 * Required header:    Authorization: Bearer <jwt>
 *
 * On success returns 200 JSON { success: true, connection: <row> }.
 * On failure returns 400 / 401 / 403 / 500 with JSON { error: string }.
 */
export async function handleSaveConnection(
  req: Request,
  deps: SaveConnectionDeps,
): Promise<Response> {
  const jsonError = (status: number, message: string): Response =>
    new Response(JSON.stringify({ error: message }), {
      status,
      headers: { 'Content-Type': 'application/json' },
    });

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

  const { restaurantId, reportUrl } = body as {
    restaurantId?: string;
    reportUrl?: string;
  };

  if (!restaurantId) {
    return jsonError(400, 'Missing required field: restaurantId');
  }
  if (!reportUrl) {
    return jsonError(400, 'Missing required field: reportUrl');
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

  // ── 5. Validate + parse the report URL (SSRF guard) ───────────────────────

  const parsed = parseFocusReportUrl(reportUrl);
  if (!parsed) {
    return jsonError(
      400,
      'Invalid report URL: must be https://*.myfocuspos.com with a StoreID parameter',
    );
  }

  // ── 6. Upsert via service-role client (review S3) ─────────────────────────

  const upsertPayload: Record<string, unknown> = {
    restaurant_id: restaurantId,
    report_base_url: parsed.baseUrl,
    report_path: parsed.reportPath,
    store_id: parsed.storeId,
    db_server: parsed.dbServer || null,
    db_catalog: parsed.dbCatalog || null,
    report_user_id: parsed.userId || null,
    is_active: true,
    connection_status: 'pending',
    updated_at: new Date().toISOString(),
  };

  const { data: connection, error: upsertError } = await deps.serviceClient
    .from('focus_connections')
    .upsert(upsertPayload)
    .onConflict('restaurant_id')
    .select();

  if (upsertError) {
    console.error('focus-save-connection: upsert failed:', upsertError.message);
    return jsonError(500, `Failed to save connection: ${upsertError.message}`);
  }

  // ── 7. Success ────────────────────────────────────────────────────────────

  return new Response(JSON.stringify({ success: true, connection }), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });
}
