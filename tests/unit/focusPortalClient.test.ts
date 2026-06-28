/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * focusPortalClient.test.ts
 *
 * Vitest unit tests for supabase/functions/_shared/focusPortalClient.ts
 *
 * Coverage:
 *  - loginToPortal happy path: GET returns 200 with VIEWSTATE/EVENTVALIDATION;
 *    POST returns 302 with auth cookie → resolves with { cookie }
 *  - loginToPortal failure: POST returns 200 with no auth cookie → FocusAuthError
 *  - discoverReportRouting happy path: page contains allowed myfocuspos.com host
 *    + dbServer/dbCatalog/report-catalog path → resolves with ReportRouting
 *  - discoverReportRouting failure: page contains non-myfocuspos host → FocusDiscoveryError
 *  - resolveStoreId: store code label match → numeric ID
 *  - resolveStoreId: numeric ID direct match → same numeric ID
 *  - resolveStoreId: unknown store → FocusDiscoveryError with hint
 */

import { describe, it, expect, vi } from 'vitest';
import {
  loginToPortal,
  discoverReportRouting,
  resolveStoreId,
  FocusAuthError,
  FocusDiscoveryError,
} from '../../supabase/functions/_shared/focusPortalClient';

// ── Fake credentials (never use real credentials in tests) ────────────────────

const USERNAME = 'sample.user';
const PASSWORD = 'test-pass';

// ── Helpers ───────────────────────────────────────────────────────────────────

/**
 * Build a minimal Response-like object that mimics the browser Headers API
 * including the getSetCookie() method used in focusPortalClient.
 */
function makeHeaders(headersInit: Record<string, string>, setCookies: string[] = []) {
  return {
    get: (name: string) => headersInit[name.toLowerCase()] ?? null,
    getSetCookie: () => setCookies,
  };
}

function makeResponse(opts: {
  status: number;
  headers?: Record<string, string>;
  setCookies?: string[];
  body?: string;
}) {
  return {
    ok: opts.status >= 200 && opts.status < 300,
    status: opts.status,
    headers: makeHeaders(opts.headers ?? {}, opts.setCookies ?? []),
    text: async () => opts.body ?? '',
  };
}

// ── loginToPortal tests ───────────────────────────────────────────────────────

describe('loginToPortal', () => {
  it('resolves with a session cookie on successful login (302 redirect away from Login.aspx)', async () => {
    // GET Login.aspx → 200 with VIEWSTATE + EVENTVALIDATION fields
    const loginHtml = `
      <html><body>
        <input type="hidden" id="__VIEWSTATE" value="fake-viewstate-value" />
        <input type="hidden" id="__EVENTVALIDATION" value="fake-eventvalidation-value" />
      </body></html>
    `;

    // POST credentials → 302 to /Default.aspx (redirecting away from Login.aspx = success)
    // with Set-Cookie header containing AuthCookie
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(
        makeResponse({
          status: 200,
          setCookies: ['ASP.NET_SessionId=session123; Path=/'],
          body: loginHtml,
        }),
      )
      .mockResolvedValueOnce(
        makeResponse({
          status: 302,
          headers: { location: 'https://my.focuspos.com/Default.aspx' },
          setCookies: ['AuthCookie=abc123; Path=/; HttpOnly'],
        }),
      );

    const result = await loginToPortal({ fetch: fetchMock as any }, USERNAME, PASSWORD);

    // The returned cookie string should contain the AuthCookie value
    expect(result.cookie).toContain('AuthCookie=abc123');
  });

  it('throws FocusAuthError when POST returns 200 with no auth cookie (bad credentials)', async () => {
    const loginHtml = `
      <html><body>
        <input type="hidden" id="__VIEWSTATE" value="vs" />
        <input type="hidden" id="__EVENTVALIDATION" value="ev" />
        <span class="error">Invalid username or password</span>
      </body></html>
    `;

    // POST returns 200 (stays on Login.aspx) with no AuthCookie
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(makeResponse({ status: 200, body: loginHtml }))
      .mockResolvedValueOnce(makeResponse({ status: 200, body: loginHtml }));

    await expect(
      loginToPortal({ fetch: fetchMock as any }, USERNAME, PASSWORD),
    ).rejects.toThrow(FocusAuthError);
  });

  it('throws FocusAuthError when the GET for Login.aspx fails (portal unreachable)', async () => {
    const fetchMock = vi.fn().mockRejectedValueOnce(new TypeError('fetch failed'));

    await expect(
      loginToPortal({ fetch: fetchMock as any }, USERNAME, PASSWORD),
    ).rejects.toThrow(FocusAuthError);
  });

  it('throws FocusAuthError when GET returns a non-2xx status', async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce(makeResponse({ status: 503 }));

    await expect(
      loginToPortal({ fetch: fetchMock as any }, USERNAME, PASSWORD),
    ).rejects.toThrow(FocusAuthError);
  });
});

// ── discoverReportRouting tests ───────────────────────────────────────────────

describe('discoverReportRouting', () => {
  const FAKE_SESSION = { cookie: 'AuthCookie=abc123' };

  it('resolves with report routing params when page contains valid myfocuspos.com host', async () => {
    // Page HTML that contains the expected patterns the discover function looks for
    const reportViewHtml = `
      <html><body>
        <iframe src="https://mfprod-1.myfocuspos.com/ReportServer/...">
        </iframe>
        <script>
          var dbServer = 'dbServer=mfaz-rep-1';
          var dbCatalog = 'dbCatalog=KAHALA2';
          var reportUrl = '/generalstorereports/revenuecenter';
        </script>
      </body></html>
    `;

    const fetchMock = vi.fn().mockResolvedValueOnce(
      makeResponse({ status: 200, body: reportViewHtml }),
    );

    const result = await discoverReportRouting({ fetch: fetchMock as any }, FAKE_SESSION);

    expect(result.baseUrl).toBe('https://mfprod-1.myfocuspos.com');
    expect(result.reportPath).toContain('/generalstorereports/revenuecenter');
    expect(result.dbServer).toBe('mfaz-rep-1');
    expect(result.dbCatalog).toBe('KAHALA2');
  });

  it('throws FocusDiscoveryError when page HTML contains a non-myfocuspos host', async () => {
    const badHtml = `
      <html><body>
        <iframe src="https://evil-report-server.com/reports"></iframe>
      </body></html>
    `;

    const fetchMock = vi.fn().mockResolvedValueOnce(
      makeResponse({ status: 200, body: badHtml }),
    );

    await expect(
      discoverReportRouting({ fetch: fetchMock as any }, FAKE_SESSION),
    ).rejects.toThrow(FocusDiscoveryError);
  });

  it('throws FocusDiscoveryError when the ViewReport page returns non-2xx', async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce(makeResponse({ status: 403 }));

    await expect(
      discoverReportRouting({ fetch: fetchMock as any }, FAKE_SESSION),
    ).rejects.toThrow(FocusDiscoveryError);
  });

  it('throws FocusDiscoveryError when fetch rejects (network error)', async () => {
    const fetchMock = vi.fn().mockRejectedValueOnce(new TypeError('fetch failed'));

    await expect(
      discoverReportRouting({ fetch: fetchMock as any }, FAKE_SESSION),
    ).rejects.toThrow(FocusDiscoveryError);
  });
});

// ── resolveStoreId tests ──────────────────────────────────────────────────────

describe('resolveStoreId', () => {
  const FAKE_SESSION = { cookie: 'AuthCookie=abc123' };

  /** Build an HTML page with a store dropdown containing the given entries. */
  function makeStoreListHtml(entries: Array<{ value: string; label: string }>): string {
    const options = entries
      .map((e) => `<option value="${e.value}">${e.label}</option>`)
      .join('\n');
    return `<html><body><select id="storeList">${options}</select></body></html>`;
  }

  it('returns the numeric ID when the entered value matches an option label (case-insensitive)', async () => {
    const html = makeStoreListHtml([
      { value: '54321', label: 'ABC-12345' },
      { value: '99999', label: 'XYZ-99' },
    ]);
    const fetchMock = vi.fn().mockResolvedValueOnce({
      ok: true,
      status: 200,
      text: async () => html,
    });

    const result = await resolveStoreId({ fetch: fetchMock as any }, FAKE_SESSION, 'ABC-12345');
    expect(result).toBe('54321');
  });

  it('label match is case-insensitive', async () => {
    const html = makeStoreListHtml([{ value: '54321', label: 'ABC-12345' }]);
    const fetchMock = vi.fn().mockResolvedValueOnce({
      ok: true,
      status: 200,
      text: async () => html,
    });

    const result = await resolveStoreId({ fetch: fetchMock as any }, FAKE_SESSION, 'abc-12345');
    expect(result).toBe('54321');
  });

  it('returns the numeric ID when the entered value is already the numeric SSRS StoreID', async () => {
    const html = makeStoreListHtml([
      { value: '54321', label: 'ABC-12345' },
      { value: '99999', label: 'XYZ-99' },
    ]);
    const fetchMock = vi.fn().mockResolvedValueOnce({
      ok: true,
      status: 200,
      text: async () => html,
    });

    const result = await resolveStoreId({ fetch: fetchMock as any }, FAKE_SESSION, '54321');
    expect(result).toBe('54321');
  });

  it('throws FocusDiscoveryError when the store is not found in the dropdown', async () => {
    const html = makeStoreListHtml([
      { value: '54321', label: 'ABC-12345' },
      { value: '99999', label: 'XYZ-99' },
    ]);
    const fetchMock = vi.fn().mockResolvedValueOnce({
      ok: true,
      status: 200,
      text: async () => html,
    });

    await expect(
      resolveStoreId({ fetch: fetchMock as any }, FAKE_SESSION, 'UNKNOWN-STORE'),
    ).rejects.toThrow(FocusDiscoveryError);
  });

  it('error message includes available store codes as a hint', async () => {
    const html = makeStoreListHtml([
      { value: '54321', label: 'ABC-12345' },
      { value: '99999', label: 'XYZ-99' },
    ]);
    const fetchMock = vi.fn().mockResolvedValueOnce({
      ok: true,
      status: 200,
      text: async () => html,
    });

    await expect(
      resolveStoreId({ fetch: fetchMock as any }, FAKE_SESSION, 'MYSTERY'),
    ).rejects.toThrow(/ABC-12345/);
  });

  it('throws FocusDiscoveryError when the store list page returns non-2xx', async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce({ ok: false, status: 403 });

    await expect(
      resolveStoreId({ fetch: fetchMock as any }, FAKE_SESSION, 'ABC-12345'),
    ).rejects.toThrow(FocusDiscoveryError);
  });

  it('throws FocusDiscoveryError when fetch rejects (network error)', async () => {
    const fetchMock = vi.fn().mockRejectedValueOnce(new TypeError('fetch failed'));

    await expect(
      resolveStoreId({ fetch: fetchMock as any }, FAKE_SESSION, 'ABC-12345'),
    ).rejects.toThrow(FocusDiscoveryError);
  });
});
