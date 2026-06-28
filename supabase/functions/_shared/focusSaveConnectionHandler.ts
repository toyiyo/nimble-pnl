/**
 * focusSaveConnectionHandler.ts
 *
 * Injectable handler for the focus-save-connection edge function.
 *
 * Responsibilities:
 *  1. Validate the Authorization header and verify the JWT via userClient.auth.getUser().
 *  2. Parse + validate the request body: { restaurantId, username, password, storeId }.
 *  3. Confirm the caller is an owner or manager of the target restaurant.
 *  4. Authenticate against the Focus portal via loginToPortal (401 on FocusAuthError).
 *  5. Discover report routing via discoverReportRouting.
 *     - On FocusDiscoveryError: save the connection with connection_status='error'.
 *  6. Encrypt the password with the encryption service.
 *  7. Upsert into focus_connections via the service-role client (review S3: all writes
 *     to integration tables use service_role to bypass RLS).
 *  8. Return JSON responses with appropriate HTTP status codes.
 *
 * Design references:
 *  - Plan Task 7
 *  - Spec §8 (_shared/focusSaveConnectionHandler.ts)
 *  - §16 S3 (service-role writes), S6 (JWT + role check)
 *
 * Auth pattern mirrors toast-save-credentials:
 *   Authorization header → userClient.auth.getUser() → user_restaurants role check → business logic.
 *
 * The handler receives pre-constructed clients (userClient built from the caller's JWT,
 * serviceClient built from SUPABASE_SERVICE_ROLE_KEY) so it is fully testable with Vitest
 * without any Deno-specific imports.
 */

import {
  loginToPortal,
  discoverReportRouting,
  FocusAuthError,
  FocusDiscoveryError,
} from './focusPortalClient.ts';
import { getEncryptionService } from './encryption.ts';
import { FOCUS_ALLOWED_ROLES } from './focusReportClient.ts';

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
      select(): Promise<{ data: unknown; error: { message: string } | null }>;
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
  /** fetch implementation. In production: globalThis.fetch. Injectable for Vitest. */
  fetch: typeof fetch;
  /**
   * Optional injectable: replace loginToPortal for testing.
   * Defaults to the real loginToPortal when omitted.
   */
  login?: (
    deps: { fetch: typeof fetch },
    username: string,
    password: string,
  ) => Promise<{ cookie: string }>;
  /**
   * Optional injectable: replace discoverReportRouting for testing.
   * Defaults to the real discoverReportRouting when omitted.
   */
  discover?: (
    deps: { fetch: typeof fetch },
    session: { cookie: string },
  ) => Promise<{
    baseUrl: string;
    reportPath: string;
    dbServer: string | null;
    dbCatalog: string | null;
  }>;
}

// ── Handler ───────────────────────────────────────────────────────────────────

/**
 * Handle a POST /focus-save-connection request.
 *
 * Expected JSON body: { restaurantId: string, username: string, password: string, storeId: string }
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

  // Resolve injectable overrides
  const loginFn = deps.login ?? loginToPortal;
  const discoverFn = deps.discover ?? discoverReportRouting;

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

  const { restaurantId, username, password, storeId } = body as {
    restaurantId?: string;
    username?: string;
    password?: string;
    storeId?: string;
  };

  if (!restaurantId) {
    return jsonError(400, 'Missing required field: restaurantId');
  }
  if (!username) {
    return jsonError(400, 'Missing required field: username');
  }
  if (!password) {
    return jsonError(400, 'Missing required field: password');
  }
  if (!storeId) {
    return jsonError(400, 'Missing required field: storeId');
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

  // ── 5. Authenticate against Focus portal (auth gate) ─────────────────────

  let session: { cookie: string };
  try {
    session = await loginFn({ fetch: deps.fetch }, username, password);
  } catch (err) {
    if (err instanceof FocusAuthError) {
      return jsonError(401, 'Invalid Focus credentials');
    }
    throw err;
  }

  // ── 6. Discover report routing params ─────────────────────────────────────

  let routing: {
    baseUrl: string;
    reportPath: string;
    dbServer: string | null;
    dbCatalog: string | null;
  } | null = null;
  let discoveryError: string | null = null;

  try {
    routing = await discoverFn({ fetch: deps.fetch }, session);
  } catch (err) {
    if (err instanceof FocusDiscoveryError) {
      discoveryError = err.message;
    } else {
      throw err;
    }
  }

  // ── 7. Encrypt password ───────────────────────────────────────────────────

  const encSvc = await getEncryptionService();
  const passwordEncrypted = await encSvc.encrypt(password);

  // ── 8. Upsert via service-role client (review S3) ─────────────────────────

  const upsertPayload: Record<string, unknown> = {
    restaurant_id: restaurantId,
    username,
    password_encrypted: passwordEncrypted,
    store_id: storeId,
    report_base_url: routing?.baseUrl ?? null,
    report_path: routing?.reportPath ?? null,
    db_server: routing?.dbServer ?? null,
    db_catalog: routing?.dbCatalog ?? null,
    report_user_id: username,
    is_active: true,
    connection_status: discoveryError ? 'error' : 'pending',
    last_error: discoveryError ?? null,
    // Reset backfill state on every save so that replacing credentials or storeId
    // triggers a full 90-day re-sync for the new connection. Without this reset an
    // already-completed sync would skip the backfill and only fetch recent days for
    // the replacement store. (Codex review P2)
    sync_cursor: 0,
    initial_sync_done: false,
    last_sync_time: null,
    updated_at: new Date().toISOString(),
  };

  const { data: connection, error: upsertError } = await deps.serviceClient
    .from('focus_connections')
    .upsert(upsertPayload, { onConflict: 'restaurant_id' })
    .select();

  if (upsertError) {
    // Log full detail server-side; return a generic message to avoid leaking
    // DB constraint names or table structure to the caller (security review finding).
    console.error('focus-save-connection: upsert failed:', upsertError.message);
    return jsonError(500, 'An internal error occurred while saving the connection');
  }

  // ── 9. Success ────────────────────────────────────────────────────────────

  return new Response(JSON.stringify({ success: true, connection }), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });
}
