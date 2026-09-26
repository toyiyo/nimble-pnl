/**
 * Return path for the OAuth consent page (/oauth/consent).
 *
 * A signed-out user who opens the consent page must sign in first. Sign-in can
 * leave the tab (Google, SSO) or open a new tab (email confirmation). This
 * module therefore keeps the path in localStorage with a short TTL, and reads
 * it once.
 *
 * The module accepts only the exact consent path with a safe authorization_id.
 * This blocks an open redirect through a stored or crafted value.
 */

export const CONSENT_PATH = '/oauth/consent';
export const CONSENT_RETURN_TTL_MS = 15 * 60 * 1000;
const STORAGE_KEY = 'oauth_consent_return_path';
const AUTHORIZATION_ID_PATTERN = /^[A-Za-z0-9_-]{1,128}$/;

export function consentPathFor(authorizationId: string): string {
  return `${CONSENT_PATH}?${new URLSearchParams({ authorization_id: authorizationId }).toString()}`;
}

/** Returns the rebuilt consent path, or null if the value is not safe. */
export function sanitizeConsentPath(value: unknown, origin: string): string | null {
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
  if (url.pathname !== CONSENT_PATH) return null;
  // new URL() resolves dot segments, so also reject them in the raw value.
  if (/(^|\/)\.\.?(\/|\?|#|$)/.test(value.split('?')[0])) return null;

  const id = url.searchParams.get('authorization_id');
  if (!id || !AUTHORIZATION_ID_PATTERN.test(id)) return null;
  return consentPathFor(id);
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
    const path = sanitizeConsentPath(parsed.path, currentOrigin());
    if (fresh && path) return path;
  } catch {
    // A bad value falls through and is deleted below.
  }
  clearConsentReturnPath();
  return null;
}

export function saveConsentReturnPath(path: string, now: number = Date.now()): void {
  const safe = sanitizeConsentPath(path, currentOrigin());
  if (!safe) return;
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ path: safe, savedAt: now }));
  } catch {
    // Storage can be blocked (private mode). The user then starts again in Claude.
  }
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
