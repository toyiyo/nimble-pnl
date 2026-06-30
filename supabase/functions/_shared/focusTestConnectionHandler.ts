/**
 * focusTestConnectionHandler.ts
 *
 * Injectable handler for the focus-test-connection edge function (FocusLink API).
 *
 * Responsibilities:
 *  1. Validate the Authorization header + verify the JWT.
 *  2. Confirm the caller is an owner/manager of the restaurant.
 *  3. Load the active focus_connections row; decrypt the API secret.
 *  4. Make ONE datafeed call for yesterday (in the store timezone).
 *  5. Write connection_status: 'connected' on a 200, else 'error' + last_error.
 *  6. Return 200 with { success, status, error? } for both outcomes.
 *
 * No portal login, no HTML — just a Basic-auth datafeed call via focusDatafeed.
 */

import { fetchDatafeed, type FocusDatafeedConfig } from './focusDatafeed.ts';
import { getEncryptionService } from './encryption.ts';

const FOCUS_ALLOWED_ROLES = new Set(['owner', 'manager']);
const FOCUS_API_PROD_BASE = 'https://focuslink.focuspos.com/v2';

/** Map the connection's environment to a base URL (sandbox URL is env-configured). */
function baseUrlForEnvironment(environment: string, sandboxBaseUrl?: string): string {
  return environment === 'sandbox' && sandboxBaseUrl ? sandboxBaseUrl : FOCUS_API_PROD_BASE;
}

/** Yesterday (YYYY-MM-DD) in an IANA timezone. */
function yesterdayInTz(tz: string, now: Date): string {
  const today = new Intl.DateTimeFormat('en-CA', {
    timeZone: tz || 'America/Chicago',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(now);
  const d = new Date(`${today}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() - 1);
  return d.toISOString().slice(0, 10);
}

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
  /** Injected clock so "yesterday" is deterministic in tests. */
  now?: Date;
  /** Base URL for the sandbox environment (issued by Shift4 at certification). */
  sandboxBaseUrl?: string;
}

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

  // ── 5. Decrypt secret + make one datafeed call for yesterday ───────────────
  const encSvc = await getEncryptionService();
  const apiSecret = await encSvc.decrypt(conn.api_secret_encrypted);

  const config: FocusDatafeedConfig = {
    baseUrl: baseUrlForEnvironment(conn.environment, deps.sandboxBaseUrl),
    storeId: conn.store_id,
    apiKey: conn.api_key,
    apiSecret,
  };
  const date = yesterdayInTz(conn.timezone, now);
  const result = await fetchDatafeed({ fetch: deps.fetch }, config, date);

  const connectionStatus: 'connected' | 'error' = result.ok ? 'connected' : 'error';
  const lastError = result.ok ? null : result.error;

  // ── 6. Write status ────────────────────────────────────────────────────────
  await deps.serviceClient
    .from('focus_connections')
    .update({
      connection_status: connectionStatus,
      last_error: lastError,
      last_error_at: connectionStatus === 'connected' ? null : new Date().toISOString(),
      updated_at: new Date().toISOString(),
    })
    .eq('id', conn.id);

  const responseBody: Record<string, unknown> = {
    success: connectionStatus === 'connected',
    status: connectionStatus,
  };
  if (lastError) responseBody.error = lastError;

  return new Response(JSON.stringify(responseBody), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });
}
