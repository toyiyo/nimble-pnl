/**
 * focusTestConnectionHandler.ts
 *
 * Injectable handler for the focus-test-connection edge function.
 *
 * Verifies a Focus POS connection by calling:
 *   GET {baseUrl}/api/restaurants
 * with HTTP Basic auth (apiKey : apiSecret).
 *
 * The response returns `items[].restaurant_guid`.  The handler checks whether
 * the stored `store_id` (a GUID) is present in that list.
 *
 * - Found   → connection_status = 'connected'
 * - Missing → connection_status = 'error' with an actionable message
 *
 * This replaces the previous FocusLink datafeed approach (FocusLink is the
 * legacy SaaS relay; the real Focus POS API lives at pos-api.focuspos.com).
 *
 * Design ref: spec §2 (API / auth), plan Task 5.
 */

import { getEncryptionService } from './encryption.ts';
import { focusApiBaseUrl } from './focusLynkClient.ts';

const FOCUS_ALLOWED_ROLES = new Set(['owner', 'manager']);

const TIMEOUT_MS = 20_000;

// ── SSRF allow-list (same as focusLynkClient) ────────────────────────────────
/** https only, host must be (a subdomain of) focuspos.com. */
const FOCUSPOS_HOST_RE = /(^|\.)focuspos\.com$/i;

function isSafeBase(url: string): boolean {
  let u: URL;
  try {
    u = new URL(url);
  } catch {
    return false;
  }
  return u.protocol === 'https:' && u.username === '' && u.password === '' && FOCUSPOS_HOST_RE.test(u.hostname);
}

// ── Public types ──────────────────────────────────────────────────────────────

export interface UserClient {
  auth: { getUser(): Promise<{ data: { user: { id: string } | null } }> };
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

interface FocusConnectionRow {
  id: string;
  api_key: string;
  api_secret_encrypted: string;
  store_id: string;
  environment: string;
  timezone: string;
}

export interface ServiceClient {
  from(table: string): {
    select(columns: string): {
      eq(col: string, val: string): {
        eq(col: string, val: boolean | string): {
          single(): Promise<{ data: FocusConnectionRow | null; error: { message: string } | null }>;
        };
      };
    };
    update(
      data: Record<string, unknown>,
    ): { eq(col: string, val: string): Promise<{ data: unknown; error: { message: string } | null }> };
  };
}

export interface TestConnectionDeps {
  userClient: UserClient;
  serviceClient: ServiceClient;
  /** fetch implementation (native Deno fetch in prod; a double in tests). */
  fetch: typeof fetch;
  /** Base URL for the sandbox environment (issued by Shift4 at certification). */
  sandboxBaseUrl?: string;
}

// ── Handler ───────────────────────────────────────────────────────────────────

export async function handleTestConnection(
  req: Request,
  deps: TestConnectionDeps,
): Promise<Response> {
  const jsonError = (status: number, message: string): Response =>
    new Response(JSON.stringify({ error: message }), {
      status,
      headers: { 'Content-Type': 'application/json' },
    });

  // ── 1. Authorization header + JWT ──────────────────────────────────────────
  const authHeader = req.headers.get('Authorization');
  if (!authHeader) return jsonError(401, 'Missing Authorization header');

  const {
    data: { user },
  } = await deps.userClient.auth.getUser();
  if (!user) return jsonError(401, 'Unauthorized: invalid or expired token');

  // ── 2. Parse body ──────────────────────────────────────────────────────────
  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return jsonError(400, 'Invalid JSON body');
  }
  const { restaurantId } = body as { restaurantId?: string };
  if (!restaurantId) return jsonError(400, 'Missing required field: restaurantId');

  // ── 3. Role check ──────────────────────────────────────────────────────────
  const { data: membership } = await deps.userClient
    .from('user_restaurants')
    .select('role')
    .eq('user_id', user.id)
    .eq('restaurant_id', restaurantId)
    .single();
  if (!membership || !FOCUS_ALLOWED_ROLES.has(membership.role)) {
    return jsonError(403, 'Access denied: owner or manager role required');
  }

  // ── 4. Load the active connection ──────────────────────────────────────────
  const { data: conn, error: connError } = await deps.serviceClient
    .from('focus_connections')
    .select('id, api_key, api_secret_encrypted, store_id, environment, timezone')
    .eq('restaurant_id', restaurantId)
    .eq('is_active', true)
    .single();

  if (connError || !conn) {
    return jsonError(404, 'No active Focus POS connection found for this restaurant');
  }

  // ── 5. Decrypt secret ──────────────────────────────────────────────────────
  const encSvc = await getEncryptionService();
  const apiSecret = await encSvc.decrypt(conn.api_secret_encrypted);

  // ── 6. Determine base URL ─────────────────────────────────────────────────
  const baseUrl = focusApiBaseUrl(
    conn.environment as 'production' | 'sandbox',
    deps.sandboxBaseUrl,
  );

  if (!isSafeBase(baseUrl)) {
    const errMsg = 'Focus POS base URL must be https on a focuspos.com host';
    await writeStatus(deps.serviceClient, conn.id, 'error', errMsg);
    return new Response(
      JSON.stringify({ success: false, status: 'error', error: errMsg }),
      { status: 200, headers: { 'Content-Type': 'application/json' } },
    );
  }

  // ── 7. GET /api/restaurants ────────────────────────────────────────────────
  const restaurantsUrl = `${baseUrl.replace(/\/+$/, '')}/api/restaurants`;
  const authValue = 'Basic ' + btoa(`${conn.api_key}:${apiSecret}`);

  let apiRes: Response;
  try {
    apiRes = await deps.fetch(restaurantsUrl, {
      method: 'GET',
      headers: {
        Authorization: authValue,
        Accept: 'application/json',
      },
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
  } catch (e) {
    const errMsg = `Network error reaching Focus POS API: ${e instanceof Error ? e.message : String(e)}`;
    await writeStatus(deps.serviceClient, conn.id, 'error', errMsg);
    return new Response(
      JSON.stringify({ success: false, status: 'error', error: errMsg }),
      { status: 200, headers: { 'Content-Type': 'application/json' } },
    );
  }

  // ── 8. Handle non-2xx ─────────────────────────────────────────────────────
  if (!apiRes.ok) {
    const httpStatus = apiRes.status;
    let errMsg: string;
    if (httpStatus === 401) {
      errMsg = `Focus POS API returned 401 Unauthorized — check API key and secret`;
    } else if (httpStatus === 403) {
      errMsg = `Focus POS API returned 403 Forbidden — check license / permission`;
    } else if (httpStatus === 404) {
      errMsg = `Focus POS API returned 404 Not Found — check the base URL / route`;
    } else {
      errMsg = `Focus POS API returned HTTP ${httpStatus}`;
    }
    await writeStatus(deps.serviceClient, conn.id, 'error', errMsg);
    return new Response(
      JSON.stringify({ success: false, status: 'error', error: errMsg }),
      { status: 200, headers: { 'Content-Type': 'application/json' } },
    );
  }

  // ── 9. Parse JSON ─────────────────────────────────────────────────────────
  const rawText = await apiRes.text();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let parsed: any;
  try {
    parsed = JSON.parse(rawText);
  } catch {
    const errMsg = 'Focus POS API returned a non-JSON response — cannot parse restaurant list';
    await writeStatus(deps.serviceClient, conn.id, 'error', errMsg);
    return new Response(
      JSON.stringify({ success: false, status: 'error', error: errMsg }),
      { status: 200, headers: { 'Content-Type': 'application/json' } },
    );
  }

  // ── 10. Check store_id GUID is in items[].restaurant_guid ─────────────────
  const items: Array<{ restaurant_guid?: string }> = Array.isArray(parsed?.items)
    ? parsed.items
    : [];
  const found = items.some(
    (item) => item.restaurant_guid?.toLowerCase() === conn.store_id.toLowerCase(),
  );

  if (!found) {
    const errMsg =
      `Restaurant GUID "${conn.store_id}" not found in the Focus POS account's restaurant list — ` +
      `verify the Restaurant GUID entered during setup matches the one in the Focus POS portal.`;
    await writeStatus(deps.serviceClient, conn.id, 'error', errMsg);
    return new Response(
      JSON.stringify({ success: false, status: 'error', error: errMsg }),
      { status: 200, headers: { 'Content-Type': 'application/json' } },
    );
  }

  // ── 11. Success ───────────────────────────────────────────────────────────
  await writeStatus(deps.serviceClient, conn.id, 'connected', null);
  return new Response(
    JSON.stringify({ success: true, status: 'connected' }),
    { status: 200, headers: { 'Content-Type': 'application/json' } },
  );
}

// ── Helper ────────────────────────────────────────────────────────────────────

async function writeStatus(
  serviceClient: ServiceClient,
  connId: string,
  connectionStatus: 'connected' | 'error',
  lastError: string | null,
): Promise<void> {
  await serviceClient
    .from('focus_connections')
    .update({
      connection_status: connectionStatus,
      last_error: lastError,
      last_error_at: connectionStatus === 'connected' ? null : new Date().toISOString(),
      updated_at: new Date().toISOString(),
    })
    .eq('id', connId);
}
