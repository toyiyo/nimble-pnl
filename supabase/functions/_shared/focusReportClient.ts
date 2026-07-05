/**
 * focusReportClient.ts
 *
 * Shared client module for fetching Focus POS SSRS Revenue Center reports.
 *
 * Responsibilities:
 *  - buildReportUrl(conn, startDate, endDate): construct the full URL per §5 of the design
 *  - assertAllowedHost(url): SSRF guard per §5/S1 — validates scheme, no userinfo,
 *    and tight *.myfocuspos.com allow-list
 *  - fetchReportHtml(deps, url): redirect-safe fetch with 5-hop limit, per-hop
 *    AbortSignal.timeout, and re-validation of each Location header through assertAllowedHost
 *
 * Design references:
 *  - §5 (data source + URL shape + SSRF guard)
 *  - §16 S1 (critical — SSRF survives redirects)
 *  - §8 (_shared modules)
 *
 * URL template (design §5):
 *   {base}?{reportPath}&dbServer={}&dbCatalog={}&UserID={}&StoreID={}
 *         &StartDate={mm/dd/yyyy}&EndDate={mm/dd/yyyy}
 *         &rs:Command=Render&rs:Format=HTML4.0
 *
 * SECURITY NOTE: The Focus SSRS endpoint is anonymous — anyone knowing a StoreID
 * can read that store's sales data. We only ever fetch a store's data when a
 * restaurant owner has explicitly provided their own StoreID. See design §11.
 */

// ── Shared constants ──────────────────────────────────────────────────────────

/**
 * Edge-function handler roles that may save/test/sync Focus connections.
 * Declared here so all handlers import from one place (DRY).
 */
export const FOCUS_ALLOWED_ROLES = new Set(['owner', 'manager']);

// ── Types ─────────────────────────────────────────────────────────────────────

/**
 * Subset of focus_connections used by the client.
 * Mirrors the database columns that drive URL construction.
 */
export interface FocusConnection {
  /** scheme+host, e.g. "https://mfprod-1.myfocuspos.com" */
  reportBaseUrl: string;
  /** path + SSRS catalog segment, e.g. "/ReportServer?/generalstorereports/revenuecenter" */
  reportPath: string;
  /** SSRS routing param — optional; omitted from URL when empty */
  dbServer: string;
  /** SSRS routing param / brand tenant — optional */
  dbCatalog: string;
  /** Audit param — optional; omitted from URL when empty */
  reportUserId: string;
  /** Per-store ID — required */
  storeId: string;
  /** Optional brand filter; when empty means "all revenue centers" */
  revenueCenter: string;
}

/**
 * Injectable dependencies for fetchReportHtml.
 * Makes the function testable without a real network.
 */
export interface FetchDeps {
  /**
   * fetch-compatible function. In production: globalThis.fetch.
   * In tests: a vi.fn() mock.
   *
   * Called with (url: string, init: RequestInit) where
   *   init.redirect = 'manual'  — we handle redirects ourselves.
   *   init.signal   = AbortSignal.timeout(PER_HOP_TIMEOUT_MS)
   */
  fetch: (url: string, init: RequestInit) => Promise<FetchResponse>;
}

/**
 * Minimal Response shape we consume (avoids a DOM lib dependency in tests).
 */
export interface FetchResponse {
  status: number;
  headers: {
    get(name: string): string | null;
  };
  text(): Promise<string>;
}

// ── Constants ─────────────────────────────────────────────────────────────────

/** Maximum redirect hops before aborting (design §5). */
const MAX_REDIRECT_HOPS = 5;

/** Per-hop network timeout in milliseconds. */
const PER_HOP_TIMEOUT_MS = 20_000;

/**
 * SSRF host allow-list.
 *
 * Accepts:
 *   - myfocuspos.com (bare)
 *   - <label(s)>.myfocuspos.com  (e.g. mfprod-1.myfocuspos.com)
 *
 * Rejects:
 *   - evil.myfocuspos.com.attacker.com (does not end in .myfocuspos.com or equal it)
 *   - any non-https URL
 *   - any URL carrying userinfo
 */
const ALLOWED_HOST_RE = /^([a-z0-9-]+\.)*myfocuspos\.com$/i;

// ── Shared date helpers ───────────────────────────────────────────────────────

/**
 * Convert an ISO date string ('YYYY-MM-DD') to the MM/DD/YYYY format expected
 * by SSRS report URL params (StartDate / EndDate).
 */
export function isoToMmDdYyyy(iso: string): string {
  const [yyyy, mm, dd] = iso.split('-');
  return `${mm}/${dd}/${yyyy}`;
}

/**
 * Return the current calendar date as 'YYYY-MM-DD' in the given IANA timezone.
 * Uses the en-CA locale (produces 'YYYY-MM-DD' directly) to avoid UTC-midnight
 * off-by-one errors (design review S4).
 */
export function todayInTz(tz: string, now: Date): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: tz,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(now);
}

/**
 * Subtract `days` calendar days from an ISO date string ('YYYY-MM-DD').
 * Uses noon UTC to avoid DST edge cases.
 */
export function subtractDays(isoDate: string, days: number): string {
  const d = new Date(isoDate + 'T12:00:00Z');
  d.setUTCDate(d.getUTCDate() - days);
  return d.toISOString().substring(0, 10);
}

/**
 * Return yesterday and the day before as ISO strings in the given IANA timezone.
 */
export function recentBusinessDays(tz: string, now: Date): [string, string] {
  const todayStr = todayInTz(tz, now);
  return [subtractDays(todayStr, 1), subtractDays(todayStr, 2)];
}

/** Yesterday is re-pulled at most every 6 h (bounded correction staleness). */
const YESTERDAY_REFRESH_MS = 6 * 60 * 60 * 1000;

/**
 * Business dates for one Lynk incremental sync: TODAY always; YESTERDAY only
 * when its fingerprint row is missing or stale (fetched ≥ 6 h ago). Replaces
 * recentBusinessDays() for the Lynk path — that helper never included today,
 * which meant intraday data only landed after midnight.
 */
export function lynkIncrementalDates(
  tz: string,
  now: Date,
  yesterdayFetchedAt: string | null,
): string[] {
  const today = todayInTz(tz, now);
  const yesterday = subtractDays(today, 1);
  const fetchedMs = yesterdayFetchedAt ? Date.parse(yesterdayFetchedAt) : NaN;
  // ageMs >= 0: a FUTURE fetched_at (clock skew, bad state repair) counts as
  // stale, not fresh — otherwise yesterday could be skipped far too long.
  const ageMs = now.getTime() - fetchedMs;
  const yesterdayIsFresh =
    Number.isFinite(fetchedMs) && ageMs >= 0 && ageMs < YESTERDAY_REFRESH_MS;
  return yesterdayIsFresh ? [today] : [today, yesterday];
}

// ── Shared row mapper ─────────────────────────────────────────────────────────

/**
 * Shared shape for DB rows from focus_connections that carry routing params.
 * Used by focusTestConnectionHandler, focusSyncDataHandler, focusBulkSyncHandler.
 *
 * report_base_url and report_path are nullable because they are discovered at
 * connect-time and may be null if discovery failed (connection_status='error').
 */
export interface FocusConnectionRow {
  report_base_url: string | null;
  report_path: string | null;
  db_server: string | null;
  db_catalog: string | null;
  report_user_id: string | null;
  store_id: string;
  revenue_center: string | null;
  timezone: string;
}

/**
 * Map a DB focus_connections row to the FocusConnection type expected by
 * focusReportClient functions. Extracted here to avoid copy-paste in three handlers.
 *
 * Throws when report_base_url or report_path is null — this indicates the
 * connection is in an error state (discovery failed). Callers should check
 * connection_status before calling this function.
 */
export function rowToFocusConnection(row: FocusConnectionRow): FocusConnection {
  if (!row.report_base_url || !row.report_path) {
    throw new Error(
      'Focus connection is missing report routing — re-connect to discover report URL',
    );
  }
  return {
    reportBaseUrl: row.report_base_url,
    reportPath: row.report_path,
    dbServer: row.db_server ?? '',
    dbCatalog: row.db_catalog ?? '',
    reportUserId: row.report_user_id ?? '',
    storeId: row.store_id,
    revenueCenter: row.revenue_center ?? '',
  };
}

// ── assertAllowedHost ─────────────────────────────────────────────────────────

/**
 * Validate that `urlString` is safe to fetch (SSRF guard).
 *
 * Throws if any of the following are true:
 *  - Cannot be parsed as a URL
 *  - Protocol is not `https:`
 *  - URL contains embedded credentials (username or password)
 *  - Host does not match the *.myfocuspos.com allow-list
 *
 * Design ref: §5 / S1 (critical).
 */
export function assertAllowedHost(urlString: string): void {
  let parsed: URL;
  try {
    parsed = new URL(urlString);
  } catch {
    throw new Error(`SSRF guard: cannot parse URL: ${urlString}`);
  }

  // Must be HTTPS — reject http://, file://, javascript:, etc.
  if (parsed.protocol !== 'https:') {
    throw new Error(
      `SSRF guard: non-https protocol "${parsed.protocol}" is not allowed`,
    );
  }

  // No embedded credentials (SSRF vector / credential leakage)
  if (parsed.username !== '' || parsed.password !== '') {
    throw new Error(
      'SSRF guard: URL must not contain embedded credentials (username/password)',
    );
  }

  // Tight host allow-list — prevents open-redirect and DNS-rebinding attacks
  if (!ALLOWED_HOST_RE.test(parsed.hostname)) {
    throw new Error(
      `SSRF guard: host "${parsed.hostname}" is not in the allow-list (*.myfocuspos.com)`,
    );
  }
}

// ── buildReportUrl ────────────────────────────────────────────────────────────

/**
 * Construct the full SSRS Revenue Center report URL for a specific date range.
 *
 * The SSRS URL shape is unconventional: `reportPath` already contains a `?`
 * (e.g. `/ReportServer?/generalstorereports/revenuecenter`), so we build a
 * throwaway URL object from the stored `baseUrl + reportPath` to get a stable
 * base, then append all query parameters via URLSearchParams.
 *
 * Date format: `MM/DD/YYYY` (as expected by the SSRS report, URL-encoded as
 * `MM%2FDD%2FYYYY`).
 *
 * Design ref: §5, §16 S8 (use `new URL(path, base)` for the ?-bearing path).
 */
export function buildReportUrl(
  conn: FocusConnection,
  startDate: string, // 'MM/DD/YYYY'
  endDate: string,   // 'MM/DD/YYYY'
): string {
  // The reportPath looks like "/ReportServer?/generalstorereports/revenuecenter"
  // We need to parse this carefully — the part before "?" is the pathname and
  // the part starting with "/" after "?" is the SSRS catalog path (not a real param).
  //
  // Strategy: split on the first "?" to isolate the pathname vs the catalog segment,
  // then build the URL manually so we fully control the query string.
  const [pathPart, catalogPart] = conn.reportPath.split('?');
  const baseWithPath = `${conn.reportBaseUrl}${pathPart}`;

  // Build query string using URLSearchParams for proper encoding.
  // SSRS interprets the catalog path as a bare key (no value), so we
  // reconstruct: ?<catalogPart>&param1=val1&…
  const params = new URLSearchParams();
  params.set('StoreID', conn.storeId);
  if (conn.dbServer) params.set('dbServer', conn.dbServer);
  if (conn.dbCatalog) params.set('dbCatalog', conn.dbCatalog);
  if (conn.reportUserId) params.set('UserID', conn.reportUserId);
  if (conn.revenueCenter) params.set('RevenueCenter', conn.revenueCenter);
  params.set('StartDate', startDate);
  params.set('EndDate', endDate);
  // Force the specific render command + HTML4.0 format (CSV/XML are blocked).
  // Note: SSRS uses colon in param names (rs:Command, rs:Format); URLSearchParams
  // percent-encodes the colon → rs%3ACommand (accepted by SSRS).
  params.set('rs:Command', 'Render');
  params.set('rs:Format', 'HTML4.0');

  // Assemble final URL: base + path + ? + catalog-segment + & + params
  if (catalogPart) {
    return `${baseWithPath}?${catalogPart}&${params.toString()}`;
  }
  return `${baseWithPath}?${params.toString()}`;
}

// ── fetchReportHtml ───────────────────────────────────────────────────────────

/**
 * Fetch the SSRS Revenue Center report HTML, following up to MAX_REDIRECT_HOPS
 * redirects while re-validating each `Location` header through assertAllowedHost.
 *
 * This protects against:
 *  - Stored-SSRF via a URL that normally points to myfocuspos.com but has been
 *    tampered to redirect to 169.254.169.254 or an internal host.
 *  - Open-redirect chains that escape the allow-list.
 *
 * Each hop:
 *  1. Calls `deps.fetch(url, { redirect: 'manual', signal: AbortSignal.timeout(...) })`
 *  2. On 2xx: returns the body text.
 *  3. On 3xx: reads `Location`, validates via assertAllowedHost, continues loop.
 *  4. On other status: throws with the status code.
 *  5. Exceeds hop limit: throws.
 *
 * Design ref: §5 / S1.
 */
export async function fetchReportHtml(
  deps: FetchDeps,
  url: string,
): Promise<string> {
  let currentUrl = url;
  let hopsRemaining = MAX_REDIRECT_HOPS;

  while (hopsRemaining > 0) {
    // Guard: validate the URL before each hop (catches any mutation)
    assertAllowedHost(currentUrl);

    const response = await deps.fetch(currentUrl, {
      redirect: 'manual',
      signal: AbortSignal.timeout(PER_HOP_TIMEOUT_MS),
    } as RequestInit);

    const { status } = response;

    // ── 2xx: success ──────────────────────────────────────────────────────────
    if (status >= 200 && status < 300) {
      return response.text();
    }

    // ── 3xx: redirect — re-validate Location before following ─────────────────
    if (status >= 300 && status < 400) {
      const location = response.headers.get('location');
      if (!location) {
        throw new Error(
          `fetchReportHtml: received HTTP ${status} redirect with no Location header`,
        );
      }

      // SSRF guard: must pass the allow-list check before we follow the hop.
      // This throws if the Location is http:, an internal IP, or an unrelated host.
      assertAllowedHost(location);

      currentUrl = location;
      hopsRemaining--;
      continue;
    }

    // ── Other status: error ───────────────────────────────────────────────────
    throw new Error(
      `fetchReportHtml: unexpected HTTP status ${status} from ${currentUrl}`,
    );
  }

  // Hop limit exceeded (loop exited without returning)
  throw new Error(
    `fetchReportHtml: exceeded maximum redirect hops (${MAX_REDIRECT_HOPS})`,
  );
}
