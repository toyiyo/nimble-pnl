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
 * When the response contains `pos_response.payload.blob_url` (a time-limited
 * Azure SAS URL), the client GETs that URL and returns the XML string.
 *
 * When the response has no blob_url, the datafeed is queued. The client polls
 * the same endpoint with Status requests that reference the initial
 * request_id. The poll response wraps the referenced message in
 * `pos_response.payload.repeated_message_response`. After STATUS_POLL_MAX
 * polls the client returns kind = "inprogress"; the caller retries on the
 * next cron pass.
 *
 * SSRF guard:
 *  - baseUrl must be https + host (sub.)focuspos.com, no userinfo.
 *  - blob_url must be https + host (sub.)blob.core.windows.net, no userinfo.
 *
 * Design ref: docs/superpowers/specs/2026-08-21-focus-lynk-async-datafeed-design.md
 */

// ── SSRF allow-lists ─────────────────────────────────────────────────────────

/**
 * https only, host must be (a subdomain of) focuspos.com.
 * Exported so other handlers (focusTestConnectionHandler) can reuse the
 * same allow-list rather than maintaining independent copies.
 */
export const FOCUSPOS_HOST_RE = /(^|\.)focuspos\.com$/i;

/** https only, host must be (a subdomain of) blob.core.windows.net. */
const BLOB_HOST_RE = /(^|\.)blob\.core\.windows\.net$/i;

/** ISO YYYY-MM-DD */
const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

const TIMEOUT_MS = 30_000;

/** Delay between Status polls. Vendor guidance: near 5000 ms. */
const STATUS_POLL_DELAY_MS = 5_000;

/** Maximum Status polls per fetchDatafeed call (~20 s of wait). */
const STATUS_POLL_MAX = 4;

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
  /**
   * Optional delay function injected for tests so the Status poll does not
   * actually sleep. Production: omit (defaults to a real setTimeout sleep).
   * Tests: pass `() => Promise.resolve()` or a spy that resolves immediately.
   */
  sleep?: (ms: number) => Promise<void>;
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

/**
 * Return true when `url` satisfies https + hostRe + no userinfo.
 * Exported for reuse in focusTestConnectionHandler (SSRF guard for the API base URL).
 */
export function isSafeUrl(url: string, hostRe: RegExp): boolean {
  let u: URL;
  try {
    u = new URL(url);
  } catch {
    return false;
  }
  return u.protocol === 'https:' && u.username === '' && u.password === '' && hostRe.test(u.hostname);
}

/**
 * Strip the query string from any URL-like substring in free text.
 * Vendor text (an unknown error_condition) is untrusted and can embed a
 * URL with a SAS token in its query params (sig=/se=/sv=); redact before
 * a log line ever carries it.
 */
export function redactUrlsInText(text: string): string {
  return text.replace(/https?:\/\/\S+/gi, (match) => {
    try {
      const u = new URL(match);
      return `${u.protocol}//${u.host}${u.pathname}`;
    } catch {
      return match;
    }
  });
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

/**
 * Read the error_condition from a pos_response.
 *
 * The live probe (2026-08-21) shows the condition at
 * `payload.response.error_condition`. The old top-level path stays as a
 * fallback for safety.
 */
function lynkErrorCondition(posResponse: unknown): string | undefined {
  if (typeof posResponse !== 'object' || posResponse === null) return undefined;
  const response = posResponse as {
    payload?: { response?: { error_condition?: unknown } };
    error_condition?: unknown;
  };
  const nested = response.payload?.response?.error_condition;
  if (typeof nested === 'string') return nested;
  return typeof response.error_condition === 'string' ? response.error_condition : undefined;
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
 * Build the JSON body for a Lynk Status poll request.
 *
 * The Status request asks Focus for the state of an earlier request.
 * The response wraps the referenced message in
 * `pos_response.payload.repeated_message_response`.
 *
 * @param requestReference request_id of the initial LegacyDatafeed request
 * @param requestId        Unique id for this poll request
 */
export function buildStatusRequest(
  requestReference: string,
  requestId: string,
): { pos_request: { header: Record<string, string>; payload: Record<string, string> } } {
  return {
    pos_request: {
      header: {
        category: 'Status',
        type: 'Request',
        request_id: requestId,
      },
      payload: {
        request_reference: requestReference,
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
 *  2. POST /api/lynk/sync (LegacyDatafeed) → look for
 *     `pos_response.payload.blob_url`.
 *  3. When blob_url is absent: poll with Status requests that reference the
 *     initial request_id (STATUS_POLL_DELAY_MS between polls, STATUS_POLL_MAX
 *     polls). The poll response wraps the referenced message in
 *     `pos_response.payload.repeated_message_response`.
 *  4. SSRF-guard the blob_url.
 *  5. GET the blob_url → return the XML text.
 *
 * @param deps         Injectable fetch + optional sleep.
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

  const requestIdBase = crypto.randomUUID();
  const initialRequestId = `${requestIdBase}.1`;
  let requestBody: ReturnType<typeof buildLynkRequest>;
  try {
    requestBody = buildLynkRequest(businessDate, initialRequestId);
  } catch (e) {
    return {
      ok: false,
      status: 0,
      kind: 'config',
      error: e instanceof Error ? e.message : String(e),
    };
  }

  // ── 3. POST helper for /api/lynk/sync ───────────────────────────────────────

  const syncUrl = `${config.baseUrl.replace(/\/+$/, '')}/api/lynk/sync`;

  /**
   * POST one body to the Lynk sync endpoint.
   * Maps terminal HTTP statuses and a non-JSON body to a FocusLynkResult.
   * On 2xx JSON, returns the parsed body.
   */
  // `any`: the parsed Lynk API response body is untyped vendor JSON with no schema.
  async function postLynk(body: unknown): Promise<
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    { ok: true; json: any; status: number } | { ok: false; result: FocusLynkResult }
  > {
    let res: Response;
    try {
      res = await deps.fetch(syncUrl, {
        method: 'POST',
        headers: {
          Authorization: basicAuth(config.apiKey, config.apiSecret),
          'Content-Type': 'application/json',
          'focuspos-restaurant-id': config.restaurantGuid,
        },
        body: JSON.stringify(body),
        // Disable redirect-follow so an allow-listed host responding with a 3xx
        // to an internal address cannot bypass the SSRF guard above.
        redirect: 'error',
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
    } catch (e) {
      return {
        ok: false,
        result: {
          ok: false,
          status: 0,
          kind: 'network',
          error: e instanceof Error ? e.message : 'network error',
        },
      };
    }

    const status = res.status;
    let text: string;
    try {
      text = await res.text();
    } catch (e) {
      return {
        ok: false,
        result: {
          ok: false,
          status,
          kind: 'network',
          error: e instanceof Error ? e.message : 'network error reading Lynk sync response body',
        },
      };
    }

    if (status === 401) {
      return { ok: false, result: { ok: false, status, kind: 'auth', error: 'Focus POS API returned 401 Unauthorized' } };
    }
    if (status === 403) {
      return { ok: false, result: { ok: false, status, kind: 'license', error: 'Focus POS API returned 403 Forbidden — check license / API key permissions' } };
    }
    if (status === 404) {
      return { ok: false, result: { ok: false, status, kind: 'not_found', error: 'Focus POS API returned 404 — check the restaurant GUID and base URL' } };
    }
    if (status < 200 || status >= 300) {
      return { ok: false, result: { ok: false, status, kind: 'http', error: `Focus POS Lynk API returned HTTP ${status}` } };
    }

    // `any`: parsed Lynk API response body is untyped vendor JSON with no schema.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let json: any;
    try {
      json = JSON.parse(text);
    } catch {
      return { ok: false, result: { ok: false, status, kind: 'parse', error: 'Focus POS Lynk API returned a non-JSON body' } };
    }

    return { ok: true, json, status };
  }

  // ── 4. Initial LegacyDatafeed request ───────────────────────────────────────

  const initial = await postLynk(requestBody);
  if (!initial.ok) {
    return initial.result;
  }

  let blobUrl: string | undefined = initial.json?.pos_response?.payload?.blob_url;
  let lastStatus = initial.status;

  // A pending signal is an InProgress condition or a repeated_message_response
  // wrapper object. A scalar wrapper is malformed and does not count.
  // When no response ever shows a signal, the shape is broken → 'parse'.
  let pendingSignal = lynkErrorCondition(initial.json?.pos_response) === 'InProgress';

  // ── 5. Status poll loop (runs only when the initial response has no blob_url)

  if (!blobUrl) {
    const sleepFn = deps.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));

    for (let poll = 1; poll <= STATUS_POLL_MAX && !blobUrl; poll++) {
      await sleepFn(STATUS_POLL_DELAY_MS);

      const statusBody = buildStatusRequest(initialRequestId, `${requestIdBase}.${poll + 1}`);
      const pollRes = await postLynk(statusBody);
      if (!pollRes.ok) {
        return pollRes.result;
      }
      lastStatus = pollRes.status;

      const wrapper = pollRes.json?.pos_response?.payload?.repeated_message_response;
      if (wrapper && typeof wrapper === 'object') {
        pendingSignal = true;
        // `unknown`: the inner error_condition is untyped vendor JSON with no
        // schema. A non-string value must not throw inside redactUrlsInText.
        const inner: unknown = wrapper?.payload?.response?.error_condition;
        if (inner === 'NotFound') {
          return {
            ok: false,
            status: lastStatus,
            kind: 'inprogress',
            error:
              'Focus POS lost the datafeed request reference (NotFound); a new request starts on the next pass',
          };
        }
        if (inner !== undefined && inner !== null && inner !== 'None' && inner !== 'InProgress') {
          // Unknown vendor condition — log it so it does not hide behind
          // "still generating". Stringify first (inner may not be a string)
          // then redact any embedded URL query string.
          console.warn(
            `focusLynkClient: unknown error_condition "${redactUrlsInText(String(inner))}" in a Status poll response`,
          );
        }
        blobUrl = wrapper?.payload?.blob_url;
      } else if (lynkErrorCondition(pollRes.json?.pos_response) === 'InProgress') {
        pendingSignal = true;
      }
    }

    if (!blobUrl) {
      if (pendingSignal) {
        console.warn(
          `focusLynkClient: poll cap exhausted (${STATUS_POLL_MAX} polls) for business date ${businessDate}`,
        );
        return {
          ok: false,
          status: lastStatus,
          kind: 'inprogress',
          error: 'Focus POS datafeed is not yet ready for this business date (poll cap exhausted)',
        };
      }
      return {
        ok: false,
        status: lastStatus,
        kind: 'parse',
        error: 'Focus POS Lynk response did not contain a blob_url',
      };
    }
  }

  // ── 6. SSRF-guard the blob URL ───────────────────────────────────────────────

  if (!isSafeUrl(blobUrl, BLOB_HOST_RE)) {
    // Redact any query string (Azure SAS URLs embed auth tokens in sig=/se=/sv= params).
    // `blob_url` is untyped vendor JSON. Stringify first: a non-string
    // value (e.g. a number from a malformed response) must not throw
    // inside redactUrlsInText's `.replace()` call.
    const redacted = redactUrlsInText(String(blobUrl));
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
      // Disable redirect-follow to prevent SSRF via 3xx responses from the
      // allow-listed Azure blob host.
      redirect: 'error',
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

  let xml: string;
  try {
    xml = await blobRes.text();
  } catch (e) {
    return {
      ok: false,
      status: blobRes.status,
      kind: 'network',
      error: e instanceof Error ? e.message : 'network error downloading datafeed blob',
    };
  }
  return { ok: true, status: blobRes.status, xml };
}
