/**
 * Client for the Supabase Auth OAuth 2.1 consent endpoints.
 *
 * The installed @supabase/auth-js (2.71.x) has no `auth.oauth` API, so this
 * module calls the REST endpoints that newer auth-js releases call:
 *   GET  /auth/v1/oauth/authorizations/{id}
 *   POST /auth/v1/oauth/authorizations/{id}/consent  { action }
 * Both need the anon `apikey` header and the user's access token.
 */

import { supabase, SUPABASE_ANON_KEY, SUPABASE_URL } from '@/integrations/supabase/client';

export interface OAuthClientInfo {
  id: string;
  name: string;
  uri?: string | null;
  logo_uri?: string | null;
}

export interface OAuthAuthorizationDetails {
  authorization_id: string;
  redirect_uri: string;
  client: OAuthClientInfo;
  user: { id: string; email: string };
  scope: string;
}

export type AuthorizationLookup =
  | { kind: 'consent'; details: OAuthAuthorizationDetails }
  | { kind: 'redirect'; redirectUrl: string };

export type ConsentAction = 'approve' | 'deny';

export class ConsentApiError extends Error {
  constructor(message: string, readonly status: number) {
    super(message);
    this.name = 'ConsentApiError';
  }
}

/** Hosts that Claude uses for its OAuth callback. Claude Code uses a local port. */
const TRUSTED_REDIRECT_HOSTS = ['claude.ai', 'claude.com', 'localhost', '127.0.0.1'];

export function redirectHost(redirectUri: string): string | null {
  try {
    return new URL(redirectUri).hostname || null;
  } catch {
    return null;
  }
}

export function isTrustedRedirectHost(redirectUri: string): boolean {
  const host = redirectHost(redirectUri);
  if (!host) return false;
  return TRUSTED_REDIRECT_HOSTS.some((trusted) => host === trusted || host.endsWith(`.${trusted}`));
}

function authorizationUrl(authorizationId: string, suffix = ''): string {
  return `${SUPABASE_URL}/auth/v1/oauth/authorizations/${encodeURIComponent(authorizationId)}${suffix}`;
}

async function authHeaders(): Promise<Record<string, string>> {
  const { data, error } = await supabase.auth.getSession();
  const token = data.session?.access_token;
  if (error || !token) throw new ConsentApiError('Your session ended. Sign in again.', 401);
  return {
    apikey: SUPABASE_ANON_KEY,
    Authorization: `Bearer ${token}`,
    'Content-Type': 'application/json',
    'X-Supabase-Api-Version': '2024-01-01',
  };
}

async function readJson(response: Response): Promise<Record<string, unknown>> {
  let body: Record<string, unknown> = {};
  try {
    body = (await response.json()) as Record<string, unknown>;
  } catch {
    body = {};
  }
  if (!response.ok) {
    const message =
      (typeof body.msg === 'string' && body.msg) ||
      (typeof body.message === 'string' && body.message) ||
      (typeof body.error_description === 'string' && body.error_description) ||
      `Request failed (HTTP ${response.status})`;
    throw new ConsentApiError(message, response.status);
  }
  return body;
}

export async function getAuthorization(authorizationId: string): Promise<AuthorizationLookup> {
  const response = await fetch(authorizationUrl(authorizationId), {
    method: 'GET',
    headers: await authHeaders(),
  });
  const body = await readJson(response);
  if (body.client && typeof body.redirect_uri === 'string') {
    return { kind: 'consent', details: body as unknown as OAuthAuthorizationDetails };
  }
  if (typeof body.redirect_url === 'string') {
    return { kind: 'redirect', redirectUrl: body.redirect_url };
  }
  throw new ConsentApiError('The authorization response is not valid.', 502);
}

/** Sends the decision and returns the URL that sends the user back to the client. */
export async function submitConsent(authorizationId: string, action: ConsentAction): Promise<string> {
  const response = await fetch(authorizationUrl(authorizationId, '/consent'), {
    method: 'POST',
    headers: await authHeaders(),
    body: JSON.stringify({ action }),
  });
  const body = await readJson(response);
  if (typeof body.redirect_url !== 'string') {
    throw new ConsentApiError('The consent response is not valid.', 502);
  }
  return body.redirect_url;
}

/**
 * Sends the browser to the client's redirect URL. Refuses a script or data
 * URL, as a defense in depth: the URL comes from Supabase Auth.
 */
export function goToClientRedirect(url: string): boolean {
  let protocol: string;
  try {
    protocol = new URL(url).protocol;
  } catch {
    return false;
  }
  if (protocol === 'javascript:' || protocol === 'data:' || protocol === 'vbscript:') return false;
  window.location.assign(url);
  return true;
}
