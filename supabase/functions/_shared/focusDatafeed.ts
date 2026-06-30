/**
 * focusDatafeed.ts
 *
 * FocusLink (Shift4 / Focus POS) datafeed client.
 *
 * Pulls one business day of sales for a store:
 *   GET {baseUrl}/stores/{storeId}/datafeed?date=YYYY-MM-DD
 * authenticated with HTTP Basic (API Key = username, API Secret = password).
 *
 * Unlike the legacy portal/SSRS path, FocusLink is modern infrastructure that
 * Deno's fetch reaches natively — no Postgres `http` transport needed.
 *
 * The store identifier (numeric storeKey or restaurant GUID) is passed through
 * verbatim, so the client works regardless of which form Shift4 confirms.
 */

/** https + host is (a subdomain of) focuspos.com. */
const ALLOWED_HOST = /(^|\.)focuspos\.com$/i;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const TIMEOUT_MS = 25_000;

export interface FocusDatafeedConfig {
  /** API base, e.g. https://focuslink.focuspos.com/v2 (prod) or the sandbox URL. */
  baseUrl: string;
  /** Store identifier — numeric storeKey or restaurant GUID. */
  storeId: string;
  /** FocusLink license key (HTTP Basic username). */
  apiKey: string;
  /** FocusLink license secret (HTTP Basic password). */
  apiSecret: string;
}

export interface FocusDatafeedDeps {
  /** fetch implementation. Production: globalThis.fetch (native Deno). Tests: a double. */
  fetch: typeof fetch;
}

/** Why a datafeed call failed — drives the user-facing message. */
export type FocusDatafeedErrorKind =
  | 'config' // bad base URL (not https / not a focuspos.com host) or bad date
  | 'license' // 401 — license not found / inactive (key/secret not recognised)
  | 'auth' // 401 — auth header missing / malformed
  | 'not_found' // 404 — store / route not found
  | 'http' // other non-2xx
  | 'network' // fetch threw (DNS / TLS / timeout)
  | 'parse'; // 2xx but body was not valid JSON

export type FocusDatafeedResult =
  | { ok: true; status: number; data: unknown }
  | { ok: false; status: number; kind: FocusDatafeedErrorKind; error: string };

/** HTTP Basic header from a key/secret pair. */
export function basicAuthHeader(apiKey: string, apiSecret: string): string {
  return 'Basic ' + btoa(`${apiKey}:${apiSecret}`);
}

/** Build the datafeed URL for one business day. Throws on a malformed date. */
export function buildDatafeedUrl(baseUrl: string, storeId: string, date: string): string {
  if (!DATE_RE.test(date)) {
    throw new Error(`focus datafeed: date must be YYYY-MM-DD, got "${date}"`);
  }
  const base = baseUrl.replace(/\/+$/, '');
  return `${base}/stores/${encodeURIComponent(storeId)}/datafeed?date=${date}`;
}

/** SSRF guard: base must be https, no userinfo, host (sub.)focuspos.com. */
function isAllowedBase(baseUrl: string): boolean {
  let u: URL;
  try {
    u = new URL(baseUrl);
  } catch {
    return false;
  }
  return (
    u.protocol === 'https:' &&
    u.username === '' &&
    u.password === '' &&
    ALLOWED_HOST.test(u.hostname)
  );
}

/**
 * Fetch one day of datafeed JSON. Never throws — returns a discriminated result
 * so callers (test / sync handlers) can surface a precise message.
 */
export async function fetchDatafeed(
  deps: FocusDatafeedDeps,
  config: FocusDatafeedConfig,
  date: string,
): Promise<FocusDatafeedResult> {
  if (!isAllowedBase(config.baseUrl)) {
    return {
      ok: false,
      status: 0,
      kind: 'config',
      error: 'FocusLink base URL must be https on a focuspos.com host',
    };
  }

  let url: string;
  try {
    url = buildDatafeedUrl(config.baseUrl, config.storeId, date);
  } catch (e) {
    return { ok: false, status: 0, kind: 'config', error: e instanceof Error ? e.message : String(e) };
  }

  let res: Response;
  try {
    res = await deps.fetch(url, {
      method: 'GET',
      headers: {
        Authorization: basicAuthHeader(config.apiKey, config.apiSecret),
        Accept: 'application/json',
      },
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
  } catch (e) {
    return { ok: false, status: 0, kind: 'network', error: e instanceof Error ? e.message : 'network error' };
  }

  const status = res.status;
  const body = await res.text();

  if (status >= 200 && status < 300) {
    try {
      return { ok: true, status, data: JSON.parse(body) };
    } catch {
      return { ok: false, status, kind: 'parse', error: 'FocusLink returned a non-JSON body' };
    }
  }

  if (status === 401) {
    const kind: FocusDatafeedErrorKind = /license/i.test(body) ? 'license' : 'auth';
    const error =
      kind === 'license'
        ? 'FocusLink license not found or inactive — verify the API key/secret, that the license is active, and sandbox vs production'
        : 'FocusLink rejected the request authentication';
    return { ok: false, status, kind, error };
  }

  if (status === 404) {
    return {
      ok: false,
      status,
      kind: 'not_found',
      error: 'FocusLink store or route not found — check the store identifier',
    };
  }

  return { ok: false, status, kind: 'http', error: `FocusLink returned HTTP ${status}` };
}
