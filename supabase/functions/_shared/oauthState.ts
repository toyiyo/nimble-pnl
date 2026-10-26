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

export type OAuthProvider = 'square' | 'clover' | 'toast';

export const CLOVER_REGIONS = ['na', 'eu', 'latam', 'apac'] as const;
export type CloverRegion = (typeof CLOVER_REGIONS)[number];

/** 10 minutes: long enough to sign in at the POS, short enough to be worthless later. */
export const OAUTH_STATE_TTL_SECONDS = 600;

export const OAUTH_STATE_MIN_SECRET_LENGTH = 32;

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

const PROVIDERS: readonly string[] = ['square', 'clover', 'toast'];

export function isCloverRegion(value: unknown): value is CloverRegion {
  return typeof value === 'string' && (CLOVER_REGIONS as readonly string[]).includes(value);
}

function nonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0;
}

function isValidPayload(p: unknown): p is OAuthStatePayload {
  if (!p || typeof p !== 'object') return false;
  const o = p as Record<string, unknown>;
  return (
    typeof o.p === 'string' &&
    PROVIDERS.includes(o.p) &&
    nonEmptyString(o.rid) &&
    nonEmptyString(o.uid) &&
    nonEmptyString(o.o) &&
    nonEmptyString(o.n) &&
    typeof o.exp === 'number' &&
    Number.isFinite(o.exp) &&
    (o.r === undefined || isCloverRegion(o.r))
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
  return { origin: PRODUCTION_APP_ORIGIN, isProduction: true };
}

// Structural types, so this module does not import supabase-js.
interface RoleQueryClient {
  from(table: string): {
    select(columns: string): {
      eq(column: string, value: string): {
        eq(column: string, value: string): {
          in(column: string, values: string[]): {
            maybeSingle(): PromiseLike<{ data: unknown; error: unknown }>;
          };
        };
      };
    };
  };
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
