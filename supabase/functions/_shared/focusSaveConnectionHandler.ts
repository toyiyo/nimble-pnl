/**
 * focusSaveConnectionHandler.ts
 *
 * Injectable handler for the focus-save-connection edge function (FocusLink API).
 *
 * Responsibilities:
 *  1. Validate the Authorization header + verify the JWT via userClient.auth.getUser().
 *  2. Parse + validate the body: { restaurantId, apiKey, apiSecret, restaurantGuid, mid?, environment? }.
 *  3. Confirm the caller is an owner or manager of the target restaurant.
 *  4. Encrypt the API secret (AES-GCM) — the key is stored as-is (it is the Basic-auth username).
 *  5. Upsert into focus_connections via the service-role client (bypasses RLS).
 *
 * Credentials are per restaurant GROUP (one key/secret for all the group's
 * stores) + a per-store identifier, so they live per connection. This handler
 * only STORES them; focus-test-connection validates them with a datafeed call.
 */

import { getEncryptionService } from './encryption.ts';

/** Roles allowed to manage the Focus connection. */
const FOCUS_ALLOWED_ROLES = new Set(['owner', 'manager']);
const ALLOWED_ENVIRONMENTS = new Set(['sandbox', 'production']);

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

export interface ServiceClient {
  from(table: string): {
    upsert(
      data: Record<string, unknown>,
      options?: Record<string, unknown>,
    ): { select(columns?: string): Promise<{ data: unknown; error: { message: string } | null }> };
  };
}

export interface SaveConnectionDeps {
  /** Supabase client built from the caller's JWT (auth + role checks). */
  userClient: UserClient;
  /** Supabase client built from SUPABASE_SERVICE_ROLE_KEY (writes — bypasses RLS). */
  serviceClient: ServiceClient;
}

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
  if (!authHeader) return jsonError(401, 'Missing Authorization header');

  // ── 2. Verify JWT ──────────────────────────────────────────────────────────
  const {
    data: { user },
  } = await deps.userClient.auth.getUser();
  if (!user) return jsonError(401, 'Unauthorized: invalid or expired token');

  // ── 3. Parse + validate body ───────────────────────────────────────────────
  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return jsonError(400, 'Invalid JSON body');
  }

  const requiredString = (field: string): string | null => {
    const value = body[field];
    return typeof value === 'string' && value.trim() ? value.trim() : null;
  };

  const restaurantId = requiredString('restaurantId');
  const apiKey = requiredString('apiKey');
  const apiSecret = requiredString('apiSecret');
  const restaurantGuid = requiredString('restaurantGuid');
  const mid = typeof body.mid === 'string' ? body.mid : undefined;

  if (!restaurantId) return jsonError(400, 'Missing required field: restaurantId');
  if (!apiKey) return jsonError(400, 'Missing required field: apiKey');
  if (!apiSecret) return jsonError(400, 'Missing required field: apiSecret');
  if (!restaurantGuid) return jsonError(400, 'Missing required field: restaurantGuid');

  const environment = (body.environment as string | undefined) ?? 'production';
  if (!ALLOWED_ENVIRONMENTS.has(environment)) {
    return jsonError(400, 'environment must be "sandbox" or "production"');
  }

  // ── 4. Role check ──────────────────────────────────────────────────────────
  const { data: membership } = await deps.userClient
    .from('user_restaurants')
    .select('role')
    .eq('user_id', user.id)
    .eq('restaurant_id', restaurantId)
    .single();

  if (!membership || !FOCUS_ALLOWED_ROLES.has(membership.role)) {
    return jsonError(403, 'Access denied: owner or manager role required');
  }

  // ── 5. Encrypt the API secret ──────────────────────────────────────────────
  const encSvc = await getEncryptionService();
  const apiSecretEncrypted = await encSvc.encrypt(apiSecret);

  // ── 6. Upsert via service-role client ──────────────────────────────────────
  const upsertPayload: Record<string, unknown> = {
    restaurant_id: restaurantId,
    api_key: apiKey,
    api_secret_encrypted: apiSecretEncrypted,
    store_id: restaurantGuid,
    mid: mid ?? null,
    environment,
    is_active: true,
    connection_status: 'pending',
    last_error: null,
    // Reset backfill state on every save so replacing credentials / store id
    // triggers a fresh re-sync for the new connection.
    sync_cursor: 0,
    initial_sync_done: false,
    last_sync_time: null,
    // This handler only saves Lynk API connections — pin the fast cadence and
    // clear any accumulated backoff. Without this, a legacy portal row
    // (seeded 360 by the scheduler migration) that converts to API
    // credentials would keep syncing every 6 h instead of every 30 min
    // (codex review).
    sync_interval_minutes: 30,
    next_attempt_at: null,
    consecutive_failures: 0,
    updated_at: new Date().toISOString(),
  };

  // Select only non-sensitive fields — never expose api_secret_encrypted or api_key.
  const { data: connection, error: upsertError } = await deps.serviceClient
    .from('focus_connections')
    .upsert(upsertPayload, { onConflict: 'restaurant_id' })
    .select(
      'id, restaurant_id, store_id, mid, environment, is_active, connection_status, ' +
      'initial_sync_done, sync_cursor, last_sync_time, updated_at',
    );

  if (upsertError) {
    console.error('focus-save-connection: upsert failed:', upsertError.message);
    return jsonError(500, 'An internal error occurred while saving the connection');
  }

  return new Response(JSON.stringify({ success: true, connection }), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });
}
