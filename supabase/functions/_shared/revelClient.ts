/**
 * Revel Classic API client (per-restaurant credentials).
 * Each request authenticates with header `API-AUTHENTICATION: <apiKey>:<apiSecret>`
 * against the merchant's own base URL https://<subdomain>.revelup.com/.
 * Credentials are stored per restaurant (AES-GCM encrypted) in revel_connections.
 */

/** Normalize a user-supplied Revel URL or subdomain to the merchant base URL. */
export function revelBaseUrl(instance: string): string {
  const sub = String(instance)
    .replace(/^https?:\/\//, '')
    .replace(/\.revelup\.com\/?.*$/, '')
    .replace(/\/.*$/, '')
    .trim()
    .toLowerCase();
  return `https://${sub}.revelup.com`;
}

/** Authed fetch against a merchant's Classic Revel API. */
export async function revelFetch(
  instance: string,
  apiKey: string,
  apiSecret: string,
  path: string,
  init: RequestInit = {},
): Promise<Response> {
  const base = revelBaseUrl(instance);
  const url = path.startsWith('http') ? path : `${base}${path.startsWith('/') ? '' : '/'}${path}`;

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 15000);
  try {
    return await fetch(url, {
      ...init,
      headers: {
        ...(init.headers ?? {}),
        'API-AUTHENTICATION': `${apiKey}:${apiSecret}`,
        'Accept': 'application/json',
      },
      signal: controller.signal,
    });
  } finally {
    clearTimeout(timeout);
  }
}
