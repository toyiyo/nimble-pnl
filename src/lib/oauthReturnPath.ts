/**
 * Return path after sign-in, for two pages that a signed-out user can reach:
 * - the OAuth consent page (/oauth/consent);
 * - the POS OAuth callback pages (/square|clover|toast/callback). The callback
 *   edge functions require the user who started the connect (a phone browser
 *   often has no session), so the page sends the user to sign in and back.
 *
 * Sign-in can leave the tab (Google, SSO) or open a new tab (email
 * confirmation). This module therefore keeps the path in localStorage with a
 * short TTL, and reads it once.
 *
 * The module accepts only these exact paths with safe query values, and it
 * rebuilds the path from them. This blocks an open redirect through a stored
 * or crafted value.
 */

export const CONSENT_PATH = '/oauth/consent';
export const CONSENT_RETURN_TTL_MS = 15 * 60 * 1000;
const STORAGE_KEY = 'oauth_consent_return_path';
const AUTHORIZATION_ID_PATTERN = /^[A-Za-z0-9_-]{1,128}$/;

export const POS_CALLBACK_PATHS = {
  square: '/square/callback',
  clover: '/clover/callback',
  toast: '/toast/callback',
} as const;
export type PosCallbackProvider = keyof typeof POS_CALLBACK_PATHS;

// Provider codes are URL-safe tokens. The state is the signed
// `<payload>.<signature>` token from _shared/oauthState.ts (max 2048 chars).
const POS_CODE_PATTERN = /^[A-Za-z0-9._~+=-]{1,1024}$/;
const POS_STATE_PATTERN = /^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/;
const POS_STATE_MAX_LENGTH = 2048;

export function consentPathFor(authorizationId: string): string {
  return `${CONSENT_PATH}?${new URLSearchParams({ authorization_id: authorizationId }).toString()}`;
}

/** Returns the callback path for a POS provider, or null if a value is not safe. */
export function posCallbackPathFor(provider: PosCallbackProvider, code: string, state: string): string | null {
  if (!POS_CODE_PATTERN.test(code)) return null;
  if (state.length > POS_STATE_MAX_LENGTH || !POS_STATE_PATTERN.test(state)) return null;
  return `${POS_CALLBACK_PATHS[provider]}?${new URLSearchParams({ code, state }).toString()}`;
}

/** Parses a same-origin path with no tricks, or returns null. */
function parseSameOriginPath(value: unknown, origin: string): URL | null {
  if (typeof value !== 'string' || value.length === 0) return null;
  // Browsers read a backslash as a slash ("/\evil.com" is "//evil.com").
  if (value.includes('\\')) return null;
  if (value.startsWith('//')) return null;

  let url: URL;
  try {
    url = new URL(value, origin);
  } catch {
    return null;
  }
  if (url.origin !== new URL(origin).origin) return null;
  // new URL() resolves dot segments, so also reject them in the raw value.
  if (/(^|\/)\.\.?(\/|\?|#|$)/.test(value.split('?')[0])) return null;
  return url;
}

/** Returns the rebuilt consent path, or null if the value is not safe. */
export function sanitizeConsentPath(value: unknown, origin: string): string | null {
  const url = parseSameOriginPath(value, origin);
  if (!url || url.pathname !== CONSENT_PATH) return null;

  const id = url.searchParams.get('authorization_id');
  if (!id || !AUTHORIZATION_ID_PATTERN.test(id)) return null;
  return consentPathFor(id);
}

/** Returns the rebuilt consent or POS callback path, or null if the value is not safe. */
export function sanitizeReturnPath(value: unknown, origin: string): string | null {
  const consent = sanitizeConsentPath(value, origin);
  if (consent) return consent;

  const url = parseSameOriginPath(value, origin);
  if (!url) return null;
  const provider = (Object.keys(POS_CALLBACK_PATHS) as PosCallbackProvider[]).find(
    (key) => POS_CALLBACK_PATHS[key] === url.pathname
  );
  const code = url.searchParams.get('code');
  const state = url.searchParams.get('state');
  if (!provider || !code || !state) return null;
  return posCallbackPathFor(provider, code, state);
}

/** The checked authorization_id from the consent page query, or null. */
export function authorizationIdFrom(searchParams: URLSearchParams): string | null {
  const id = searchParams.get('authorization_id');
  return id && AUTHORIZATION_ID_PATTERN.test(id) ? id : null;
}

function currentOrigin(): string {
  return window.location.origin;
}

function readStored(now: number): string | null {
  let raw: string | null;
  try {
    raw = localStorage.getItem(STORAGE_KEY);
  } catch {
    return null;
  }
  if (!raw) return null;

  try {
    const parsed = JSON.parse(raw) as { path?: unknown; savedAt?: unknown };
    const fresh =
      typeof parsed.savedAt === 'number' &&
      now - parsed.savedAt >= 0 &&
      now - parsed.savedAt <= CONSENT_RETURN_TTL_MS;
    const path = sanitizeReturnPath(parsed.path, currentOrigin());
    if (fresh && path) return path;
  } catch {
    // A bad value falls through and is deleted below.
  }
  clearConsentReturnPath();
  return null;
}

/** Returns false when storage refuses the write (for example, private mode). */
function writeStored(path: string, now: number): boolean {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ path, savedAt: now }));
    return true;
  } catch {
    return false;
  }
}

export function saveConsentReturnPath(path: string, now: number = Date.now()): void {
  const safe = sanitizeConsentPath(path, currentOrigin());
  // When storage is blocked, the user starts again in Claude.
  if (safe) writeStored(safe, now);
}

/**
 * Saves the POS callback URL, so sign-in returns the user to finish the connect.
 * Returns false when the URL is not safe or storage refuses the write.
 */
export function savePosCallbackReturnPath(
  provider: PosCallbackProvider,
  code: string,
  state: string,
  now: number = Date.now()
): boolean {
  const safe = posCallbackPathFor(provider, code, state);
  return safe !== null && writeStored(safe, now);
}

export function clearConsentReturnPath(): void {
  try {
    localStorage.removeItem(STORAGE_KEY);
  } catch {
    // Nothing to clear when storage is blocked.
  }
}

/** Reads the saved path without delete. Use it to build sign-in redirect URLs. */
export function peekConsentReturnPath(now: number = Date.now()): string | null {
  return readStored(now);
}

/** Reads the saved path and deletes it. */
export function takeConsentReturnPath(now: number = Date.now()): string | null {
  const path = readStored(now);
  clearConsentReturnPath();
  return path;
}

/** Where a sign-in provider must send the user back to. */
export function postAuthRedirectPath(now: number = Date.now()): string {
  return peekConsentReturnPath(now) ?? '/';
}
