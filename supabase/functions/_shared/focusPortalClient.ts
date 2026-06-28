/**
 * focusPortalClient.ts
 *
 * Authenticates against the Focus POS portal (my.focuspos.com) via its ASP.NET
 * WebForms forms-login, and discovers the report routing parameters from the
 * authenticated session. Used by the connect / test / sync edge functions
 * (Option A — credential-gated access).
 *
 * Why this exists: the Revenue Center report data is served by Focus's report
 * host (mfprod-N.myfocuspos.com). That host does not share auth with the portal,
 * so the portal login does not (and cannot) authenticate the report fetch — but
 * a successful login proves the restaurant owns a valid Focus account and lets us
 * auto-discover the deployment routing params (report host / dbServer / dbCatalog
 * / report path) so the operator only ever supplies username + password + Store ID.
 *
 * No credential is ever logged or persisted in plaintext by this module; the
 * password is passed in transiently and the caller encrypts it before storage.
 */

const PORTAL_BASE = 'https://my.focuspos.com';
const ALLOWED_HOST = /^([a-z0-9-]+\.)*myfocuspos\.com$/i;
const UA = 'EasyShiftHQ-Focus/1.0';
const TIMEOUT_MS = 20_000;

/** Thrown when the portal login fails (bad username/password or portal down). */
export class FocusAuthError extends Error {
  constructor(message = 'Focus login failed — check the username and password') {
    super(message);
    this.name = 'FocusAuthError';
  }
}

/** Thrown when the report routing params can't be discovered from the session. */
export class FocusDiscoveryError extends Error {
  constructor(message = 'Could not locate the Focus report for this account') {
    super(message);
    this.name = 'FocusDiscoveryError';
  }
}

export interface PortalDeps {
  fetch: typeof fetch;
}

/** An authenticated portal session — an opaque Cookie header value. */
export interface FocusSession {
  cookie: string;
}

export interface ReportRouting {
  baseUrl: string; // e.g. https://mfprod-1.myfocuspos.com
  reportPath: string; // e.g. /ReportServer?/generalstorereports/revenuecenter
  dbServer: string | null;
  dbCatalog: string | null;
}

const HTML_ENTITIES: Record<string, string> = {
  '&amp;': '&', '&quot;': '"', '&#39;': "'", '&lt;': '<', '&gt;': '>',
};

/** Read an ASP.NET hidden field value out of a rendered page. */
function hiddenField(html: string, name: string): string {
  const re = new RegExp(`(?:id|name)="${name}"[^>]*value="([^"]*)"`, 'i');
  const m = html.match(re);
  if (!m) return '';
  return m[1].replace(/&amp;|&quot;|&#39;|&lt;|&gt;/g, (e) => HTML_ENTITIES[e] ?? e);
}

/** Merge a response's Set-Cookie headers into a name→value jar. */
function mergeCookies(jar: Map<string, string>, res: Response): void {
  // Deno + modern fetch expose getSetCookie(); fall back to a single header.
  const headersWithCookie = res.headers as Headers & { getSetCookie?: () => string[] };
  const setCookies: string[] = headersWithCookie.getSetCookie?.() ??
    (res.headers.get('set-cookie') ? [res.headers.get('set-cookie') as string] : []);
  for (const sc of setCookies) {
    const first = sc.split(';')[0];
    const eq = first.indexOf('=');
    if (eq > 0) jar.set(first.slice(0, eq).trim(), first.slice(eq + 1).trim());
  }
}

function cookieHeader(jar: Map<string, string>): string {
  return [...jar.entries()].map(([k, v]) => `${k}=${v}`).join('; ');
}

/**
 * Perform the Focus portal forms-login. Returns an authenticated session, or
 * throws FocusAuthError if the credentials are rejected / the portal is down.
 */
export async function loginToPortal(
  deps: PortalDeps,
  username: string,
  password: string,
): Promise<FocusSession> {
  const jar = new Map<string, string>();

  // 1. GET Login.aspx → fresh VIEWSTATE/EVENTVALIDATION + initial session cookie.
  let getRes: Response;
  try {
    getRes = await deps.fetch(`${PORTAL_BASE}/Login.aspx`, {
      headers: { 'User-Agent': UA },
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
  } catch {
    throw new FocusAuthError('Focus portal is unreachable');
  }
  if (!getRes.ok) throw new FocusAuthError('Focus portal is unreachable');
  mergeCookies(jar, getRes);
  const loginHtml = await getRes.text();

  const form = new URLSearchParams({
    __EVENTTARGET: '',
    __EVENTARGUMENT: '',
    __LASTFOCUS: '',
    __VIEWSTATE: hiddenField(loginHtml, '__VIEWSTATE'),
    __VIEWSTATEGENERATOR: hiddenField(loginHtml, '__VIEWSTATEGENERATOR'),
    __EVENTVALIDATION: hiddenField(loginHtml, '__EVENTVALIDATION'),
    __PREVIOUSPAGE: hiddenField(loginHtml, '__PREVIOUSPAGE'),
    'ctl00$Main$hfServerName': '',
    'ctl00$Main$txtEMail': '',
    'ctl00$Main$txtUsername': username,
    'ctl00$Main$txtPwd': password,
    'ctl00$Main$cboPage': 'Default.aspx',
    'ctl00$txtEMail': '',
    'ctl00$txtComments': '',
    'ctl00$Main$btnLogin': 'Login',
  });

  // 2. POST credentials. redirect:'manual' so we can read Set-Cookie + Location
  //    on the 302 that forms-auth issues on success.
  let postRes: Response;
  try {
    postRes = await deps.fetch(`${PORTAL_BASE}/Login.aspx`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        Cookie: cookieHeader(jar),
        'User-Agent': UA,
      },
      body: form.toString(),
      redirect: 'manual',
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
  } catch {
    throw new FocusAuthError('Focus portal is unreachable');
  }
  mergeCookies(jar, postRes);

  // Success: forms-auth 3xx-redirects to the return URL (not back to Login.aspx),
  // and/or sets the AuthCookie / a populated MyMenu cookie. Failure: re-renders
  // the login page (200) with no auth cookie.
  const location = postRes.headers.get('location') ?? '';
  const redirectedAway =
    postRes.status >= 300 && postRes.status < 400 && !!location && !/login\.aspx/i.test(location);
  const hasAuthCookie = jar.has('AuthCookie') || (jar.get('MyMenu') ?? '').length > 0;
  if (!redirectedAway && !hasAuthCookie) {
    throw new FocusAuthError();
  }

  return { cookie: cookieHeader(jar) };
}

/**
 * With an authenticated session, discover the report routing params (report host,
 * dbServer, dbCatalog, report path) from the portal's report viewer page. These
 * are deployment/brand-level (same for every store under the login), so the
 * operator never has to paste a URL. Throws FocusDiscoveryError if not found, or
 * if the discovered host fails the *.myfocuspos.com allow-list (SSRF guard).
 */
export async function discoverReportRouting(
  deps: PortalDeps,
  session: FocusSession,
): Promise<ReportRouting> {
  const url =
    `${PORTAL_BASE}/Reports/ViewReport.aspx?reportURL=/generalstorereports/revenuecenter` +
    `&reportName=Revenue%20Center%20Report&rs:Command=render`;
  let res: Response;
  try {
    res = await deps.fetch(url, {
      headers: { Cookie: session.cookie, 'User-Agent': UA },
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
  } catch {
    throw new FocusDiscoveryError();
  }
  if (!res.ok) throw new FocusDiscoveryError();
  const html = await res.text();

  const hostM = html.match(/https?:\/\/(mf[a-z0-9-]+\.myfocuspos\.com)/i);
  if (!hostM || !ALLOWED_HOST.test(hostM[1])) {
    throw new FocusDiscoveryError('Report host not found or not an allowed myfocuspos.com host');
  }
  const catalogPathM = html.match(/\/generalstorereports\/[a-z0-9_]+/i);
  const dbServerM = html.match(/dbServer=([\w.-]+)/i);
  const dbCatalogM = html.match(/dbCatalog=([\w.-]+)/i);

  return {
    baseUrl: `https://${hostM[1]}`,
    reportPath: `/ReportServer?${catalogPathM ? catalogPathM[0] : '/generalstorereports/revenuecenter'}`,
    dbServer: dbServerM ? dbServerM[1] : null,
    dbCatalog: dbCatalogM ? dbCatalogM[1] : null,
  };
}
