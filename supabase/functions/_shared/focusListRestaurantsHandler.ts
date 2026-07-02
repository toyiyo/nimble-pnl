/**
 * focusListRestaurantsHandler.ts
 *
 * Injectable handler for the focus-list-restaurants edge function.
 *
 * Accepts an API Key + Secret in the POST body (NOT stored credentials),
 * calls GET {baseUrl}/api/restaurants with HTTP Basic auth, and returns the
 * list of restaurants belonging to that Focus POS account.
 *
 * This allows the setup wizard to present a picker instead of requiring the
 * operator to type a Restaurant GUID they cannot easily obtain.
 *
 * Security contract:
 * - apiKey and apiSecret are NEVER stored — used once, then discarded.
 * - apiKey and apiSecret must NEVER appear in console.log/warn/error output.
 * - Our own errors (auth/role/validation) use real HTTP 401/403/400.
 * - Focus-side failures return HTTP 200 {success:false, error} so the wizard
 *   shows a friendly inline message instead of a scary non-2xx toast.
 * - SSRF guard: baseUrl must be https on a focuspos.com host.
 *
 * Design ref: spec §4.1 (Increment A) + §8.6 (security).
 * Plan ref: A1.
 */

import {
  focusApiBaseUrl,
  isSafeUrl,
  FOCUSPOS_HOST_RE,
} from './focusLynkClient.ts';
import { FOCUS_ALLOWED_ROLES } from './focusReportClient.ts';

// ── Constants ─────────────────────────────────────────────────────────────────
const TIMEOUT_MS = 20_000;

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

export interface ListRestaurantsDeps {
  /** User-scoped Supabase client (JWT forwarded) for auth and role checks. */
  userClient: UserClient;
  /** fetch implementation — native Deno fetch in prod; vi.fn() double in tests. */
  fetch: typeof fetch;
  /** Sandbox base URL (from Deno.env in index.ts, never from the request body). */
  sandboxBaseUrl?: string;
}

export interface FocusRestaurantOption {
  restaurant_guid: string;
  restaurant_name: string;
}

// ── Handler ───────────────────────────────────────────────────────────────────

export async function handleListRestaurants(
  req: Request,
  deps: ListRestaurantsDeps,
): Promise<Response> {
  const jsonError = (status: number, message: string): Response =>
    new Response(JSON.stringify({ error: message }), {
      status,
      headers: { 'Content-Type': 'application/json' },
    });

  const jsonOk200 = (payload: Record<string, unknown>): Response =>
    new Response(JSON.stringify(payload), {
      status: 200,
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

  const { restaurantId, apiKey, apiSecret, environment } = body as {
    restaurantId?: string;
    apiKey?: string;
    apiSecret?: string;
    environment?: string;
  };

  if (!restaurantId || typeof restaurantId !== 'string') {
    return jsonError(400, 'Missing required field: restaurantId');
  }
  if (!apiKey || typeof apiKey !== 'string') {
    return jsonError(400, 'Missing required field: apiKey');
  }
  if (!apiSecret || typeof apiSecret !== 'string') {
    return jsonError(400, 'Missing required field: apiSecret');
  }

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

  // ── 4. Determine base URL + SSRF guard ────────────────────────────────────
  const baseUrl = focusApiBaseUrl(
    (environment as 'production' | 'sandbox') ?? 'production',
    deps.sandboxBaseUrl,
  );

  if (!isSafeUrl(baseUrl, FOCUSPOS_HOST_RE)) {
    return jsonOk200({
      success: false,
      error: 'Focus POS base URL must be https on a focuspos.com host (SSRF guard rejected the URL)',
    });
  }

  // ── 5. GET /api/restaurants ────────────────────────────────────────────────
  const restaurantsUrl = `${baseUrl.replace(/\/+$/, '')}/api/restaurants`;
  // Do NOT log apiKey or apiSecret — they must never appear in logs.
  const authValue = 'Basic ' + btoa(`${apiKey}:${apiSecret}`);

  let apiRes: Response;
  try {
    apiRes = await deps.fetch(restaurantsUrl, {
      method: 'GET',
      redirect: 'error', // Block 3xx to prevent SSRF bypass
      headers: {
        Authorization: authValue,
        Accept: 'application/json',
      },
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
  } catch (e) {
    const errMsg = `Network error reaching Focus POS API: ${
      e instanceof Error ? e.message : String(e)
    }`;
    return jsonOk200({ success: false, error: errMsg });
  }

  // ── 6. Handle Focus-side HTTP errors → HTTP 200 {success:false} ───────────
  if (!apiRes.ok) {
    const httpStatus = apiRes.status;
    let errMsg: string;
    if (httpStatus === 401) {
      errMsg =
        'Focus POS API returned 401 — check your API Key and Secret';
    } else if (httpStatus === 403) {
      errMsg =
        'Focus POS API returned 403 — check the license / API permissions';
    } else if (httpStatus === 404) {
      errMsg =
        'Focus POS API returned 404 — check the environment / base URL';
    } else {
      errMsg = `Focus POS API returned HTTP ${httpStatus}`;
    }
    return jsonOk200({ success: false, error: errMsg });
  }

  // ── 7. Parse JSON + shape restaurants list ────────────────────────────────
  const rawText = await apiRes.text();
  let parsed: unknown;
  try {
    parsed = JSON.parse(rawText);
  } catch {
    return jsonOk200({
      success: false,
      error: 'Focus POS API returned a non-JSON response',
    });
  }

  const rawItems: unknown[] =
    parsed !== null &&
    typeof parsed === 'object' &&
    Array.isArray((parsed as { items?: unknown }).items)
      ? (parsed as { items: unknown[] }).items
      : [];

  const restaurants: FocusRestaurantOption[] = rawItems
    .filter(
      (item): item is { restaurant_guid: string; restaurant_name?: string } =>
        item !== null &&
        typeof item === 'object' &&
        typeof (item as Record<string, unknown>).restaurant_guid === 'string',
    )
    .map((item) => {
      const guid = (item as { restaurant_guid: string }).restaurant_guid;
      const rawName = (item as { restaurant_name?: unknown }).restaurant_name;
      const name =
        typeof rawName === 'string' && rawName.trim() !== '' ? rawName : guid;
      return { restaurant_guid: guid, restaurant_name: name };
    });

  // ── 8. Success ────────────────────────────────────────────────────────────
  return jsonOk200({ success: true, restaurants });
}
