// Signed `state` for the POS OAuth flows (square-oauth, clover-oauth, toast-oauth).
//
// The authorize step runs for a signed-in owner or manager. It signs the
// restaurant id, the user id, the app origin, a nonce and an expiry into the
// state. The callback trusts nothing in the state until checkOAuthCallback
// passes: signature, provider, expiry, caller JWT = state user, origin still
// allowed, and owner/manager role again. Only then may a function write.
//
// Pure module (no Deno globals) so Vitest can import it. Builds on the
// `<payload>.<signature>` primitives in hmacToken.ts.

import { signPayloadBytes, splitToken, toBase64Url, verifySignature } from './hmacToken.ts';

export const OAUTH_PROVIDERS = ['square', 'clover', 'toast'] as const;
export type OAuthProvider = (typeof OAUTH_PROVIDERS)[number];

export const CLOVER_REGIONS = ['na', 'eu', 'latam', 'apac'] as const;
export type CloverRegion = (typeof CLOVER_REGIONS)[number];
export const DEFAULT_CLOVER_REGION: CloverRegion = 'na';

/** 10 minutes: long enough to sign in at the POS, short enough to be worthless later. */
export const OAUTH_STATE_TTL_SECONDS = 600;

export const OAUTH_STATE_MIN_SECRET_LENGTH = 32;

/** A real state is about 300 characters. A longer one is not ours, so it is not parsed. */
export const OAUTH_STATE_MAX_LENGTH = 2048;

// Same value as APP_URL in notificationHelpers.ts. That module imports Deno
// code, so this pure module keeps its own copy for Vitest.
export const PRODUCTION_APP_ORIGIN = 'https://app.easyshifthq.com';

export interface OAuthStatePayload {
  /** Provider. A Square state does not pass a Clover callback. */
  p: OAuthProvider;
  /** restaurants.id */
  rid: string;
  /** auth.users.id of the authorize caller. */
  uid: string;
  /** App origin from the allowlist. The callback builds the redirect URI from it. */
  o: string;
  /** Random nonce, base64url. */
  n: string;
  /** Unix seconds. */
  exp: number;
  /** Clover region. */
  r?: CloverRegion;
}

export interface SignOAuthStateInput {
  provider: OAuthProvider;
  restaurantId: string;
  userId: string;
  origin: string;
  region?: CloverRegion;
}

export function isCloverRegion(value: unknown): value is CloverRegion {
  return typeof value === 'string' && (CLOVER_REGIONS as readonly string[]).includes(value);
}

function nonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0;
}

function isValidPayload(value: unknown): value is OAuthStatePayload {
  if (!value || typeof value !== 'object') return false;
  const candidate = value as Record<string, unknown>;
  return (
    typeof candidate.p === 'string' &&
    (OAUTH_PROVIDERS as readonly string[]).includes(candidate.p) &&
    nonEmptyString(candidate.rid) &&
    nonEmptyString(candidate.uid) &&
    nonEmptyString(candidate.o) &&
    nonEmptyString(candidate.n) &&
    typeof candidate.exp === 'number' &&
    Number.isFinite(candidate.exp) &&
    (candidate.r === undefined || isCloverRegion(candidate.r))
  );
}

export function isValidOAuthStateSecret(secret: string | null | undefined): secret is string {
  return typeof secret === 'string' && secret.length >= OAUTH_STATE_MIN_SECRET_LENGTH;
}

export async function signOAuthState(
  input: SignOAuthStateInput,
  secret: string,
  nowSeconds: number = Math.floor(Date.now() / 1000)
): Promise<string> {
  if (input.region !== undefined && !isCloverRegion(input.region)) {
    throw new Error('Invalid Clover region');
  }
  const payload: OAuthStatePayload = {
    p: input.provider,
    rid: input.restaurantId,
    uid: input.userId,
    o: input.origin,
    n: toBase64Url(crypto.getRandomValues(new Uint8Array(16))),
    exp: nowSeconds + OAUTH_STATE_TTL_SECONDS,
    ...(input.region ? { r: input.region } : {}),
  };
  return signPayloadBytes(new TextEncoder().encode(JSON.stringify(payload)), secret);
}

export async function verifyOAuthState(
  token: string,
  secret: string,
  provider: OAuthProvider,
  nowSeconds: number = Math.floor(Date.now() / 1000)
): Promise<OAuthStatePayload | null> {
  if (typeof token !== 'string' || token.length > OAUTH_STATE_MAX_LENGTH) return null;
  const split = splitToken(token);
  if (!split) return null;
  const { payloadBytes, sigBytes } = split;

  let parsed: unknown;
  try {
    parsed = JSON.parse(new TextDecoder().decode(payloadBytes));
  } catch {
    return null;
  }
  if (!isValidPayload(parsed)) return null;

  if (!(await verifySignature(payloadBytes, sigBytes, secret))) return null;
  if (parsed.p !== provider) return null;
  if (parsed.exp < nowSeconds) return null;

  return parsed;
}

function isLocalHost(hostname: string): boolean {
  return hostname === 'localhost' || hostname === '127.0.0.1';
}

/** Returns the exact origin of an allowlist entry, or null if the entry is not safe. */
function normalizeAllowedOrigin(entry: string): string | null {
  if (!entry || entry.includes('*')) return null;
  let url: URL;
  try {
    url = new URL(entry);
  } catch {
    return null;
  }
  if (url.pathname !== '/' || url.search || url.hash) return null;
  if (url.protocol === 'https:') return url.origin;
  if (url.protocol === 'http:' && isLocalHost(url.hostname)) return url.origin;
  return null;
}

/** Parses OAUTH_ALLOWED_ORIGINS (comma-separated). The production origin is always in the list. */
export function parseAllowedOrigins(envValue: string | null | undefined): string[] {
  const origins = [PRODUCTION_APP_ORIGIN];
  for (const raw of (envValue ?? '').split(',')) {
    const origin = normalizeAllowedOrigin(raw.trim());
    if (origin && !origins.includes(origin)) origins.push(origin);
  }
  return origins;
}

export interface AppOrigin {
  origin: string;
  isProduction: boolean;
}

interface HeaderReader {
  get(name: string): string | null;
}

function originOf(value: string | null): string | null {
  if (!value) return null;
  try {
    return new URL(value).origin;
  } catch {
    return null;
  }
}

/**
 * Picks the app origin for the redirect URI. A raw header value never reaches
 * the redirect: an origin outside the allowlist gives the production origin.
 */
export function resolveAppOrigin(headers: HeaderReader, allowedOrigins: string[]): AppOrigin {
  const candidate = originOf(headers.get('origin')) ?? originOf(headers.get('referer'));
  if (candidate && allowedOrigins.includes(candidate)) {
    return { origin: candidate, isProduction: candidate === PRODUCTION_APP_ORIGIN };
  }
  if (candidate) {
    // A preview host must be in OAUTH_ALLOWED_ORIGINS to use the sandbox.
    console.warn('OAuth origin is not in the allowlist, so production is used:', candidate);
  }
  return { origin: PRODUCTION_APP_ORIGIN, isProduction: true };
}

// Structural types, so this module does not import supabase-js. The query
// builder stays `any`: matching the supabase-js generics structurally makes
// tsc fail with "Type instantiation is excessively deep" (encryption.ts uses
// `supabase: any` for the same reason).
interface RoleQueryClient {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  from(table: string): any; // any: supabase-js generics are too deep for tsc
}

interface AuthClient {
  auth: {
    getUser(jwt: string): PromiseLike<{ data: { user: { id: string } | null }; error: unknown }>;
  };
}

export async function isOwnerOrManager(
  supabase: RoleQueryClient,
  userId: string,
  restaurantId: string
): Promise<boolean> {
  const { data, error } = await supabase
    .from('user_restaurants')
    .select('role')
    .eq('user_id', userId)
    .eq('restaurant_id', restaurantId)
    .in('role', ['owner', 'manager'])
    .maybeSingle();
  if (error) {
    console.error('OAuth role check failed:', error);
    return false;
  }
  return !!data;
}

/** Returns the user id for a `Bearer <jwt>` header, or null. The anon key gives null. */
export async function getUserIdFromAuthHeader(
  supabase: AuthClient,
  authHeader: string | null
): Promise<string | null> {
  if (!authHeader?.startsWith('Bearer ')) return null;
  const jwt = authHeader.slice('Bearer '.length).trim();
  if (!jwt) return null;
  const { data, error } = await supabase.auth.getUser(jwt);
  if (error || !data?.user) return null;
  return data.user.id;
}

export interface CheckOAuthCallbackParams {
  state: string;
  provider: OAuthProvider;
  secret: string;
  allowedOrigins: string[];
  getUserId: () => Promise<string | null>;
  isOwnerOrManager: (userId: string, restaurantId: string) => Promise<boolean>;
  nowSeconds?: number;
}

export type OAuthCallbackCheck =
  | {
      ok: true;
      restaurantId: string;
      userId: string;
      origin: string;
      isProduction: boolean;
      region: CloverRegion | undefined;
    }
  | { ok: false; status: 401 | 403; error: string };

/**
 * Runs every check the callback needs before a write. The order matters:
 * the cheap, attacker-controlled input (the state) goes first, and the
 * database role check goes last.
 */
export async function checkOAuthCallback(params: CheckOAuthCallbackParams): Promise<OAuthCallbackCheck> {
  const payload = await verifyOAuthState(params.state, params.secret, params.provider, params.nowSeconds);
  if (!payload) {
    return { ok: false, status: 403, error: 'Invalid or expired OAuth state' };
  }

  const callerId = await params.getUserId();
  if (!callerId) {
    return { ok: false, status: 401, error: 'Authentication required' };
  }
  if (callerId !== payload.uid) {
    return { ok: false, status: 403, error: 'OAuth state belongs to a different user' };
  }

  if (!params.allowedOrigins.includes(payload.o)) {
    return { ok: false, status: 403, error: 'OAuth state origin is not allowed' };
  }

  if (!(await params.isOwnerOrManager(payload.uid, payload.rid))) {
    return { ok: false, status: 403, error: 'Access denied to restaurant' };
  }

  return {
    ok: true,
    restaurantId: payload.rid,
    userId: payload.uid,
    origin: payload.o,
    isProduction: payload.o === PRODUCTION_APP_ORIGIN,
    region: payload.r,
  };
}

export interface OAuthRequestBody {
  action?: unknown;
  restaurantId?: unknown;
  code?: unknown;
  state?: unknown;
  region?: unknown;
}

interface OAuthRequestBase {
  userId: string;
  restaurantId: string;
  appOrigin: AppOrigin;
  /** Clover only. */
  region: CloverRegion | undefined;
  /** The checked secret, for signOAuthState. */
  stateSecret: string;
}

export type OAuthRequestGate =
  | (OAuthRequestBase & { ok: true; action: 'authorize' })
  | (OAuthRequestBase & { ok: true; action: 'callback'; code: string })
  | { ok: false; status: 400 | 401 | 403 | 500; error: string };

export interface ResolveOAuthRequestParams {
  provider: OAuthProvider;
  body: OAuthRequestBody;
  headers: HeaderReader;
  secret: string | undefined;
  allowedOriginsEnv: string | undefined;
  getUserId: () => Promise<string | null>;
  isOwnerOrManager: (userId: string, restaurantId: string) => Promise<boolean>;
  nowSeconds?: number;
}

/**
 * The one gate in front of every POS OAuth function. Each function calls it
 * first and returns the error on `ok: false`. On `ok: true`, every value in
 * the result is checked: the function may use credentials and write.
 */
export async function resolveOAuthRequest(params: ResolveOAuthRequestParams): Promise<OAuthRequestGate> {
  const { provider, body } = params;
  if (!isValidOAuthStateSecret(params.secret)) {
    console.error(`OAUTH_STATE_SECRET is missing or shorter than ${OAUTH_STATE_MIN_SECRET_LENGTH} characters`);
    return { ok: false, status: 500, error: 'OAuth is not configured' };
  }
  const stateSecret = params.secret;
  const allowedOrigins = parseAllowedOrigins(params.allowedOriginsEnv);

  if (body.action === 'authorize') {
    const userId = await params.getUserId();
    if (!userId) {
      return { ok: false, status: 401, error: 'Authentication required' };
    }
    if (!nonEmptyString(body.restaurantId)) {
      return { ok: false, status: 400, error: 'Restaurant ID is required for authorization' };
    }
    let region: CloverRegion | undefined;
    if (provider === 'clover') {
      const requested = body.region ?? DEFAULT_CLOVER_REGION;
      if (!isCloverRegion(requested)) {
        return { ok: false, status: 400, error: 'Invalid Clover region' };
      }
      region = requested;
    }
    if (!(await params.isOwnerOrManager(userId, body.restaurantId))) {
      return { ok: false, status: 403, error: 'Access denied to restaurant' };
    }
    return {
      ok: true,
      action: 'authorize',
      userId,
      restaurantId: body.restaurantId,
      appOrigin: resolveAppOrigin(params.headers, allowedOrigins),
      region,
      stateSecret,
    };
  }

  if (body.action === 'callback') {
    if (!nonEmptyString(body.code) || !nonEmptyString(body.state)) {
      return { ok: false, status: 400, error: 'Missing authorization code or state' };
    }
    const check = await checkOAuthCallback({
      state: body.state,
      provider,
      secret: stateSecret,
      allowedOrigins,
      getUserId: params.getUserId,
      isOwnerOrManager: params.isOwnerOrManager,
      nowSeconds: params.nowSeconds,
    });
    if (!check.ok) {
      console.warn(`${provider} OAuth callback rejected:`, check.error);
      return check;
    }
    return {
      ok: true,
      action: 'callback',
      code: body.code,
      userId: check.userId,
      restaurantId: check.restaurantId,
      appOrigin: { origin: check.origin, isProduction: check.isProduction },
      region: provider === 'clover' ? (check.region ?? DEFAULT_CLOVER_REGION) : undefined,
      stateSecret,
    };
  }

  return { ok: false, status: 400, error: 'Invalid action' };
}
