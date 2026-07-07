/**
 * Revel partner API client.
 * Partner credentials (REVEL_CLIENT_ID / REVEL_CLIENT_SECRET) are app-level env secrets.
 * One bearer token (24h) is shared across all merchants and cached in revel_auth_cache.
 */
import { getEncryptionService } from './encryption.ts';

const AUTH_URL = 'https://authentication.revelup.com/oauth/token';
export const REVEL_API_BASE = 'https://api.revelsystems.com';
const AUDIENCE = 'https://api.revelsystems.com';
// Refresh a bit before the 24h expiry to avoid edge-of-window failures.
const EXPIRY_SKEW_MS = 5 * 60 * 1000;

async function mintToken(): Promise<{ token: string; expiresAt: Date }> {
  const clientId = Deno.env.get('REVEL_CLIENT_ID');
  const clientSecret = Deno.env.get('REVEL_CLIENT_SECRET');
  if (!clientId || !clientSecret) {
    throw new Error('Revel partner credentials not configured (REVEL_CLIENT_ID/REVEL_CLIENT_SECRET)');
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 10000);
  try {
    const res = await fetch(AUTH_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        grant_type: 'client_credentials',
        client_id: clientId,
        client_secret: clientSecret,
        audience: AUDIENCE,
      }),
      signal: controller.signal,
    });
    if (!res.ok) {
      throw new Error(`Revel token request failed: ${res.status}`);
    }
    const data = await res.json();
    const expiresInSec = Number(data.expires_in ?? 86400);
    return { token: data.access_token as string, expiresAt: new Date(Date.now() + expiresInSec * 1000) };
  } finally {
    clearTimeout(timeout);
  }
}

/** Get a valid partner bearer token, using and refreshing the shared cache. */
export async function getAccessToken(supabase: any): Promise<string> {
  const encryption = await getEncryptionService();

  const { data: cached } = await supabase
    .from('revel_auth_cache')
    .select('access_token_encrypted, token_expires_at')
    .eq('id', 1)
    .maybeSingle();

  if (cached?.access_token_encrypted && cached.token_expires_at) {
    const expiresAt = new Date(cached.token_expires_at).getTime();
    if (expiresAt - EXPIRY_SKEW_MS > Date.now()) {
      return await encryption.decrypt(cached.access_token_encrypted);
    }
  }

  const { token, expiresAt } = await mintToken();
  const encrypted = await encryption.encrypt(token);
  await supabase.from('revel_auth_cache').upsert({
    id: 1,
    access_token_encrypted: encrypted,
    token_expires_at: expiresAt.toISOString(),
    updated_at: new Date().toISOString(),
  }, { onConflict: 'id' });

  return token;
}

/** Authed fetch against the Revel API for a specific merchant instance. */
export async function revelFetch(
  supabase: any,
  instance: string,
  path: string,
  init: RequestInit = {},
): Promise<Response> {
  const token = await getAccessToken(supabase);
  const url = path.startsWith('http') ? path : `${REVEL_API_BASE}${path.startsWith('/') ? '' : '/'}${path}`;

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 10000);
  try {
    return await fetch(url, {
      ...init,
      headers: {
        ...(init.headers ?? {}),
        'Authorization': `Bearer ${token}`,
        'Client-Id': instance,
        'Accept': 'application/json',
      },
      signal: controller.signal,
    });
  } finally {
    clearTimeout(timeout);
  }
}
