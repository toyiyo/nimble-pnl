/**
 * focusUrlParser.ts
 *
 * Pure client + server (Deno-compatible) parser for Focus POS SSRS report URLs.
 * Used in the FocusSetupWizard for a client-side preview before the server
 * re-parses + SSRF-guards authoritatively in focus-save-connection.
 *
 * See design doc §5 / F4 for the authoritative contract.
 *
 * ASSUMED URL shape (from live investigation 2026-06-27):
 *   https://<host>/ReportServer?/generalstorereports/revenuecenter
 *     &dbServer=<srv>&dbCatalog=<cat>&UserID=<uid>&StoreID=<sid>
 *     &rs:Command=Render&rs:Format=HTML4.0
 *     [&StartDate=...&EndDate=...]
 *
 * The "path" in SSRS URLs is unconventional: everything from "/" after "?" is the
 * report-catalog path, NOT a query-param value. We reconstruct it by slicing the
 * raw search string.
 */

/** Routing parameters extracted from a Focus report URL. */
export interface FocusUrlParams {
  /** scheme+host only, e.g. "https://mfprod-1.myfocuspos.com" */
  baseUrl: string;
  /** path + report-catalog portion, e.g. "/ReportServer?/generalstorereports/revenuecenter" */
  reportPath: string;
  /** SSRS routing param (may be empty string when absent) */
  dbServer: string;
  /** SSRS routing param / brand-tenant (may be empty) */
  dbCatalog: string;
  /** Audit param — optional in URL (may be empty) */
  userId: string;
  /** Per-store identifier — REQUIRED; null return if missing */
  storeId: string;
}

/**
 * Host-allowlist regex.  Mirrors the DB CHECK and server-side SSRF guard
 * in focusReportClient.ts.
 *
 * Allows:
 *   - myfocuspos.com (bare)
 *   - <subdomain(s)>.myfocuspos.com  (e.g. mfprod-1.myfocuspos.com)
 *
 * Rejects:
 *   - evil.myfocuspos.com.attacker.com  (suffix doesn't end in myfocuspos.com)
 */
const ALLOWED_HOST_RE = /^([a-z0-9-]+\.)*myfocuspos\.com$/i;

/**
 * Parse a Focus POS SSRS Revenue Center report URL and extract routing params.
 *
 * Returns `null` when:
 *  - The string cannot be parsed as a URL.
 *  - The protocol is not `https:`.
 *  - The host does not match `*.myfocuspos.com`.
 *  - The URL contains embedded credentials (username/password — SSRF vector).
 *  - `StoreID` is absent (required for per-store routing).
 */
export function parseFocusReportUrl(rawUrl: string): FocusUrlParams | null {
  // ── 1. Parse ─────────────────────────────────────────────────────────────
  let parsed: URL;
  try {
    parsed = new URL(rawUrl);
  } catch {
    return null;
  }

  // ── 2. Protocol must be https ─────────────────────────────────────────────
  if (parsed.protocol !== 'https:') {
    return null;
  }

  // ── 3. No embedded credentials (SSRF vector) ──────────────────────────────
  if (parsed.username !== '' || parsed.password !== '') {
    return null;
  }

  // ── 4. Host allowlist ─────────────────────────────────────────────────────
  if (!ALLOWED_HOST_RE.test(parsed.hostname)) {
    return null;
  }

  // ── 5. Extract query params (case-insensitive key lookup) ─────────────────
  //
  // SSRS URL shape: /ReportServer?/catalog/path&param1=val1&param2=val2
  //
  // `new URL()` treats the entire `?...` as search params.  However, the
  // catalog path segment (`/generalstorereports/revenuecenter`) appears as
  // the *key* of the first search param with an empty value — i.e.
  //   searchParams has entry ["/generalstorereports/revenuecenter", ""]
  // followed by the real key=value pairs.
  //
  // We collect all params into a lower-cased map, skipping the catalog-path key.
  const paramMap = new Map<string, string>();
  for (const [key, value] of parsed.searchParams.entries()) {
    if (!key.startsWith('/')) {
      paramMap.set(key.toLowerCase(), value);
    }
  }

  // ── 6. StoreID is required ────────────────────────────────────────────────
  const storeId = paramMap.get('storeid') ?? '';
  if (!storeId) {
    return null;
  }

  // ── 7. Build reportPath ───────────────────────────────────────────────────
  //
  // The report path is:  <pathname>?<catalog-segment>
  // e.g. "/ReportServer?/generalstorereports/revenuecenter"
  //
  // We extract the catalog segment as the first entry key (starts with "/")
  // from the raw URLSearchParams iteration.
  let catalogSegment = '';
  for (const [key] of parsed.searchParams.entries()) {
    if (key.startsWith('/')) {
      catalogSegment = key;
      break;
    }
  }
  const reportPath = catalogSegment
    ? `${parsed.pathname}?${catalogSegment}`
    : parsed.pathname;

  // ── 8. Build result ───────────────────────────────────────────────────────
  return {
    baseUrl: `${parsed.protocol}//${parsed.host}`,
    reportPath,
    dbServer: paramMap.get('dbserver') ?? '',
    dbCatalog: paramMap.get('dbcatalog') ?? '',
    userId: paramMap.get('userid') ?? '',
    storeId,
  };
}
