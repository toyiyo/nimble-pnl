/**
 * focusLynkClient.ts
 *
 * Focus POS "Lynk Legacy Datafeed" client.
 *
 * For a given business date, calls:
 *   POST {baseUrl}/api/lynk/sync
 *     body: LegacyDatafeed request with business_date in MM/DD/YYYY
 *     auth: HTTP Basic (apiKey:apiSecret)
 *     header: focuspos-restaurant-id: {restaurantGuid}
 *
 * On success the response contains `pos_response.payload.blob_url`, a
 * time-limited Azure SAS URL. The client GETs that URL and returns the XML
 * string to the caller.
 *
 * On `pos_response.error_condition === "InProgress"` the datafeed is not yet
 * ready; the caller should retry on the next cron pass (kind = "inprogress").
 *
 * SSRF guard:
 *  - baseUrl must be https + host (sub.)focuspos.com, no userinfo.
 *  - blob_url must be https + host (sub.)blob.core.windows.net, no userinfo.
 *
 * Design ref: design §2 (Lynk Datafeed), §6 (SSRF guard).
 */

// ── SSRF allow-lists ─────────────────────────────────────────────────────────

/** https only, host must be (a subdomain of) focuspos.com. */
const FOCUSPOS_HOST_RE = /(^|\.)focuspos\.com$/i;

/** https only, host must be (a subdomain of) blob.core.windows.net. */
const BLOB_HOST_RE = /(^|\.)blob\.core\.windows\.net$/i;

/** ISO YYYY-MM-DD */
const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

const TIMEOUT_MS = 30_000;

// ── Public types ──────────────────────────────────────────────────────────────

/** Injectable configuration for one Focus POS connection. */
export interface FocusLynkConfig {
  /** API base URL, e.g. https://pos-api.focuspos.com */
  baseUrl: string;
  /** Restaurant GUID (UUID) sent in the focuspos-restaurant-id header. */
  restaurantGuid: string;
  /** HTTP Basic username (API Key). */
  apiKey: string;
  /** HTTP Basic password (API Secret). */
  apiSecret: string;
}

/** Injectable deps so tests can supply a fetch double. */
export interface FocusLynkDeps {
  /** fetch implementation. Production: globalThis.fetch. Tests: a vi.fn() double. */
  fetch: typeof fetch;
}

/**
 * Discriminated error kind returned in the ok:false branch.
 *
 * - config      : bad baseUrl / blob URL (SSRF guard) or missing restaurantGuid
 * - auth        : HTTP 401 from the Lynk API
 * - license     : HTTP 403 (forbidden / license not active)
 * - not_found   : HTTP 404 (wrong route or GUID)
 * - http        : other non-2xx from the Lynk API
 * - network     : fetch threw (DNS / TLS / timeout)
 * - inprogress  : Lynk returned error_condition="InProgress" (try again later)
 * - parse       : 2xx but body was not valid JSON / blob_url missing
 */
export type FocusLynkErrorKind =
  | 'config'
  | 'auth'
  | 'license'
  | 'not_found'
  | 'http'
  | 'network'
  | 'inprogress'
  | 'parse';

/** Discriminated result from fetchDatafeed. */
export type FocusLynkResult =
  | { ok: true; status: number; xml: string }
  | { ok: false; status: number; kind: FocusLynkErrorKind; error: string };

// ── Helpers ───────────────────────────────────────────────────────────────────

/** Return true when `url` satisfies https + hostRe + no userinfo. */
function isSafeUrl(url: string, hostRe: RegExp): boolean {
  let u: URL;
  try {
    u = new URL(url);
  } catch {
    return false;
  }
  return u.protocol === 'https:' && u.username === '' && u.password === '' && hostRe.test(u.hostname);
}

/** HTTP Basic header. */
function basicAuth(apiKey: string, apiSecret: string): string {
  return 'Basic ' + btoa(`${apiKey}:${apiSecret}`);
}

/**
 * Convert an ISO YYYY-MM-DD date to the MM/DD/YYYY format expected by the
 * Focus Lynk API's business_date field.
 *
 * Throws when the input does not match YYYY-MM-DD.
 */
function isoToFocusDate(isoDate: string): string {
  if (!ISO_DATE_RE.test(isoDate)) {
    throw new Error(
      `focusLynkClient: date must be YYYY-MM-DD, got "${isoDate}"`,
    );
  }
  const [yyyy, mm, dd] = isoDate.split('-');
  return `${mm}/${dd}/${yyyy}`;
}

// ── Public functions ──────────────────────────────────────────────────────────

/**
 * Resolve the correct Focus POS API base URL.
 *
 * - `production` (or any other value) → `https://pos-api.focuspos.com`
 * - `sandbox` with `sandboxUrl` provided → use `sandboxUrl`
 * - `sandbox` without `sandboxUrl` → fall back to production URL
 */
export function focusApiBaseUrl(
  environment: 'production' | 'sandbox',
  sandboxUrl?: string,
): string {
  const PROD = 'https://pos-api.focuspos.com';
  if (environment === 'sandbox' && sandboxUrl) {
    return sandboxUrl;
  }
  return PROD;
}

/**
 * Build the JSON body for a Lynk LegacyDatafeed POST request.
 *
 * @param businessDate ISO date string (`YYYY-MM-DD`)
 * @param requestId    Unique string; the caller is responsible for uniqueness
 */
export function buildLynkRequest(
  businessDate: string,
  requestId: string,
): { pos_request: { header: Record<string, string>; payload: Record<string, string> } } {
  const focusDate = isoToFocusDate(businessDate); // throws on bad input
  return {
    pos_request: {
      header: {
        category: 'LegacyDatafeed',
        type: 'Request',
        request_id: requestId,
      },
      payload: {
        business_date: focusDate,
      },
    },
  };
}

/**
 * Fetch one day of datafeed XML from the Focus POS Lynk API.
 *
 * Never throws — returns a discriminated result so callers can surface a
 * precise user-facing message.
 *
 * Steps:
 *  1. SSRF-guard the baseUrl and restaurantGuid.
 *  2. POST /api/lynk/sync → get `pos_response.payload.blob_url`.
 *  3. SSRF-guard the blob_url.
 *  4. GET the blob_url → return the XML text.
 *
 * @param deps         Injectable fetch.
 * @param config       Connection parameters.
 * @param businessDate ISO date string (`YYYY-MM-DD`).
 */
export async function fetchDatafeed(
  deps: FocusLynkDeps,
  config: FocusLynkConfig,
  businessDate: string,
): Promise<FocusLynkResult> {
  // ── 1. Guard config ──────────────────────────────────────────────────────────

  if (!isSafeUrl(config.baseUrl, FOCUSPOS_HOST_RE)) {
    return {
      ok: false,
      status: 0,
      kind: 'config',
      error:
        'Focus POS base URL must be https on a focuspos.com host with no credentials in the URL',
    };
  }

  if (!config.restaurantGuid) {
    return {
      ok: false,
      status: 0,
      kind: 'config',
      error: 'Focus POS restaurantGuid is required',
    };
  }

  // ── 2. Build the Lynk request body ──────────────────────────────────────────

  const requestId = crypto.randomUUID();
  let requestBody: ReturnType<typeof buildLynkRequest>;
  try {
    requestBody = buildLynkRequest(businessDate, requestId);
  } catch (e) {
    return {
      ok: false,
      status: 0,
      kind: 'config',
      error: e instanceof Error ? e.message : String(e),
    };
  }

  // ── 3. POST /api/lynk/sync ───────────────────────────────────────────────────

  const syncUrl = `${config.baseUrl.replace(/\/+$/, '')}/api/lynk/sync`;
  let syncRes: Response;
  try {
    syncRes = await deps.fetch(syncUrl, {
      method: 'POST',
      headers: {
        Authorization: basicAuth(config.apiKey, config.apiSecret),
        'Content-Type': 'application/json',
        'focuspos-restaurant-id': config.restaurantGuid,
      },
      body: JSON.stringify(requestBody),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
  } catch (e) {
    return {
      ok: false,
      status: 0,
      kind: 'network',
      error: e instanceof Error ? e.message : 'network error',
    };
  }

  const syncStatus = syncRes.status;
  const syncText = await syncRes.text();

  // ── 4. Handle non-2xx from Lynk ─────────────────────────────────────────────

  if (syncStatus === 401) {
    return { ok: false, status: syncStatus, kind: 'auth', error: 'Focus POS API returned 401 Unauthorized' };
  }
  if (syncStatus === 403) {
    return { ok: false, status: syncStatus, kind: 'license', error: 'Focus POS API returned 403 Forbidden — check license / API key permissions' };
  }
  if (syncStatus === 404) {
    return { ok: false, status: syncStatus, kind: 'not_found', error: 'Focus POS API returned 404 — check the restaurant GUID and base URL' };
  }
  if (syncStatus < 200 || syncStatus >= 300) {
    return { ok: false, status: syncStatus, kind: 'http', error: `Focus POS Lynk API returned HTTP ${syncStatus}` };
  }

  // ── 5. Parse the Lynk JSON response ─────────────────────────────────────────

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let syncJson: any;
  try {
    syncJson = JSON.parse(syncText);
  } catch {
    return { ok: false, status: syncStatus, kind: 'parse', error: 'Focus POS Lynk API returned a non-JSON body' };
  }

  // Check for InProgress
  const posResponse = syncJson?.pos_response;
  if (posResponse?.error_condition === 'InProgress') {
    return {
      ok: false,
      status: syncStatus,
      kind: 'inprogress',
      error: 'Focus POS datafeed is not yet ready for this business date (InProgress)',
    };
  }

  // Extract blob_url
  const blobUrl: string | undefined = posResponse?.payload?.blob_url;
  if (!blobUrl) {
    return {
      ok: false,
      status: syncStatus,
      kind: 'parse',
      error: 'Focus POS Lynk response did not contain a blob_url',
    };
  }

  // ── 6. SSRF-guard the blob URL ───────────────────────────────────────────────

  if (!isSafeUrl(blobUrl, BLOB_HOST_RE)) {
    // Redact any query string (Azure SAS URLs embed auth tokens in sig=/se=/sv= params).
    let redacted = blobUrl;
    try {
      const u = new URL(blobUrl);
      redacted = `${u.protocol}//${u.host}${u.pathname}`;
    } catch {
      // If the URL can't be parsed just use it as-is (no query string to redact)
    }
    return {
      ok: false,
      status: 0,
      kind: 'config',
      error: `Focus POS blob_url must be https on blob.core.windows.net; got: ${redacted}`,
    };
  }

  // ── 7. Download the XML from the blob URL ────────────────────────────────────

  let blobRes: Response;
  try {
    blobRes = await deps.fetch(blobUrl, {
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
  } catch (e) {
    return {
      ok: false,
      status: 0,
      kind: 'network',
      error: e instanceof Error ? e.message : 'network error downloading datafeed blob',
    };
  }

  // ── 8. Guard the blob HTTP status ────────────────────────────────────────────
  // Azure SAS URLs are time-limited (30–60 min). An expired or throttled URL
  // returns 403/404 with an error body (XML or HTML), NOT the datafeed XML.
  // Without this check the error body is passed to the XML parser which sees
  // an empty DailyData.Checks node, returns {checks:[]}, and the caller
  // advances sync_cursor — permanently skipping that business day.

  if (!blobRes.ok) {
    return {
      ok: false,
      status: blobRes.status,
      kind: 'http',
      error: `Focus POS datafeed blob returned HTTP ${blobRes.status} — SAS URL may have expired`,
    };
  }

  const xml = await blobRes.text();
  return { ok: true, status: blobRes.status, xml };
}
