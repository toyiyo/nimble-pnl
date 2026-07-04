/**
 * focusReportClient.test.ts
 *
 * Vitest unit tests for supabase/functions/_shared/focusReportClient.ts
 *
 * Coverage:
 * - buildReportUrl: URL construction with StartDate/EndDate, SSRS params
 * - assertAllowedHost: SSRF allow-list (accept + reject cases)
 * - fetchReportHtml: redirect-following (same-host 302 → re-validated),
 *   SSRF block when Location escapes the allow-list, hop limit, error paths
 */

import { describe, it, expect, vi } from 'vitest';
import {
  buildReportUrl,
  assertAllowedHost,
  fetchReportHtml,
  lynkIncrementalDates,
  type FocusConnection,
  type FetchDeps,
} from '../../supabase/functions/_shared/focusReportClient';

// ── Shared test connection fixture ────────────────────────────────────────────

const CONN: FocusConnection = {
  reportBaseUrl: 'https://mfprod-1.myfocuspos.com',
  reportPath: '/ReportServer?/generalstorereports/revenuecenter',
  dbServer: 'mfaz-rep-1',
  dbCatalog: 'KAHALA2',
  reportUserId: 'testuser',
  storeId: '99999',
  revenueCenter: '',
};

// ── buildReportUrl ────────────────────────────────────────────────────────────

describe('buildReportUrl', () => {
  it('includes StartDate and EndDate params URL-encoded', () => {
    const url = buildReportUrl(CONN, '06/27/2026', '06/27/2026');
    expect(url).toContain('StartDate=06%2F27%2F2026');
    expect(url).toContain('EndDate=06%2F27%2F2026');
  });

  it('forces rs:Command=Render and rs:Format=HTML4.0', () => {
    const url = buildReportUrl(CONN, '06/01/2026', '06/01/2026');
    expect(url).toContain('rs%3ACommand=Render');
    expect(url).toContain('rs%3AFormat=HTML4.0');
  });

  it('includes StoreID, dbServer, dbCatalog from the connection', () => {
    const url = buildReportUrl(CONN, '06/27/2026', '06/27/2026');
    expect(url).toContain('StoreID=99999');
    expect(url).toContain('dbServer=mfaz-rep-1');
    expect(url).toContain('dbCatalog=KAHALA2');
  });

  it('preserves the base URL host', () => {
    const url = buildReportUrl(CONN, '06/27/2026', '06/27/2026');
    expect(url).toMatch(/^https:\/\/mfprod-1\.myfocuspos\.com\//);
  });

  it('handles a connection with no dbServer/dbCatalog (optional fields)', () => {
    const minimal: FocusConnection = {
      ...CONN,
      dbServer: '',
      dbCatalog: '',
      reportUserId: '',
    };
    const url = buildReportUrl(minimal, '06/27/2026', '06/27/2026');
    // Must still have the required params
    expect(url).toContain('StoreID=99999');
    expect(url).toContain('StartDate=06%2F27%2F2026');
  });

  it('includes UserID when present', () => {
    const url = buildReportUrl(CONN, '06/27/2026', '06/27/2026');
    expect(url).toContain('UserID=testuser');
  });

  it('omits UserID when empty', () => {
    const conn = { ...CONN, reportUserId: '' };
    const url = buildReportUrl(conn, '06/27/2026', '06/27/2026');
    expect(url).not.toContain('UserID=');
  });

  it('handles start ≠ end (date range)', () => {
    const url = buildReportUrl(CONN, '06/01/2026', '06/30/2026');
    expect(url).toContain('StartDate=06%2F01%2F2026');
    expect(url).toContain('EndDate=06%2F30%2F2026');
  });
});

// ── assertAllowedHost ─────────────────────────────────────────────────────────

describe('assertAllowedHost', () => {
  it('accepts a valid myfocuspos.com URL', () => {
    expect(() =>
      assertAllowedHost('https://mfprod-1.myfocuspos.com/ReportServer'),
    ).not.toThrow();
  });

  it('accepts myfocuspos.com bare (no subdomain)', () => {
    expect(() =>
      assertAllowedHost('https://myfocuspos.com/ReportServer'),
    ).not.toThrow();
  });

  it('accepts alternate subdomain (mfprod-2)', () => {
    expect(() =>
      assertAllowedHost('https://mfprod-2.myfocuspos.com/ReportServer'),
    ).not.toThrow();
  });

  it('throws for http:// (non-https)', () => {
    expect(() =>
      assertAllowedHost('http://mfprod-1.myfocuspos.com/ReportServer'),
    ).toThrow();
  });

  it('throws for a host outside the allow-list (evil.com)', () => {
    expect(() =>
      assertAllowedHost('https://evil.com/path'),
    ).toThrow();
  });

  it('throws for subdomain-injection attack (evil.myfocuspos.com.attacker.com)', () => {
    expect(() =>
      assertAllowedHost(
        'https://evil.myfocuspos.com.attacker.com/ReportServer',
      ),
    ).toThrow();
  });

  it('throws when the URL carries embedded username+password (SSRF vector)', () => {
    expect(() =>
      assertAllowedHost(
        'https://user:pw@mfprod-1.myfocuspos.com/ReportServer',
      ),
    ).toThrow();
  });

  it('throws when the URL carries username only (no password)', () => {
    expect(() =>
      assertAllowedHost('https://admin@mfprod-1.myfocuspos.com/ReportServer'),
    ).toThrow();
  });

  it('throws for file:// scheme', () => {
    expect(() => assertAllowedHost('file:///etc/passwd')).toThrow();
  });
});

// ── fetchReportHtml ───────────────────────────────────────────────────────────

describe('fetchReportHtml', () => {
  it('returns body text on a direct 200 response', async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      status: 200,
      headers: { get: () => null },
      text: () => Promise.resolve('<html>Revenue Center Report</html>'),
    });
    const deps: FetchDeps = { fetch: mockFetch };
    const html = await fetchReportHtml(
      deps,
      'https://mfprod-1.myfocuspos.com/ReportServer',
    );
    expect(html).toBe('<html>Revenue Center Report</html>');
    expect(mockFetch).toHaveBeenCalledOnce();
  });

  it('follows a same-host 302 redirect and re-validates the Location', async () => {
    const REDIRECT_URL =
      'https://mfprod-1.myfocuspos.com/ReportViewer.aspx?session=abc';
    const mockFetch = vi
      .fn()
      // First call: 302 → same-host Location
      .mockResolvedValueOnce({
        status: 302,
        headers: {
          get: (k: string) => (k.toLowerCase() === 'location' ? REDIRECT_URL : null),
        },
        text: () => Promise.resolve(''),
      })
      // Second call: 200 with body
      .mockResolvedValueOnce({
        status: 200,
        headers: { get: () => null },
        text: () => Promise.resolve('<html>report</html>'),
      });
    const deps: FetchDeps = { fetch: mockFetch };
    const html = await fetchReportHtml(
      deps,
      'https://mfprod-1.myfocuspos.com/ReportServer',
    );
    expect(html).toBe('<html>report</html>');
    expect(mockFetch).toHaveBeenCalledTimes(2);
    // Second call must use the redirect Location URL
    expect(mockFetch.mock.calls[1][0]).toBe(REDIRECT_URL);
  });

  it('blocks a 302 redirect to an SSRF target (169.254.169.254)', async () => {
    const SSRF_URL = 'http://169.254.169.254/latest/meta-data/';
    const mockFetch = vi.fn().mockResolvedValue({
      status: 302,
      headers: {
        get: (k: string) => (k.toLowerCase() === 'location' ? SSRF_URL : null),
      },
      text: () => Promise.resolve(''),
    });
    const deps: FetchDeps = { fetch: mockFetch };
    await expect(
      fetchReportHtml(deps, 'https://mfprod-1.myfocuspos.com/ReportServer'),
    ).rejects.toThrow();
  });

  it('blocks a redirect that escapes to an unrelated HTTPS host', async () => {
    const BAD_URL = 'https://evil.com/steal-data';
    const mockFetch = vi.fn().mockResolvedValue({
      status: 302,
      headers: {
        get: (k: string) => (k.toLowerCase() === 'location' ? BAD_URL : null),
      },
      text: () => Promise.resolve(''),
    });
    const deps: FetchDeps = { fetch: mockFetch };
    await expect(
      fetchReportHtml(deps, 'https://mfprod-1.myfocuspos.com/ReportServer'),
    ).rejects.toThrow();
  });

  it('throws when the hop limit (5) is exceeded', async () => {
    // Every call returns a 302 back to itself → infinite redirect loop
    const SAME = 'https://mfprod-1.myfocuspos.com/loop';
    const mockFetch = vi.fn().mockResolvedValue({
      status: 302,
      headers: {
        get: (k: string) => (k.toLowerCase() === 'location' ? SAME : null),
      },
      text: () => Promise.resolve(''),
    });
    const deps: FetchDeps = { fetch: mockFetch };
    await expect(
      fetchReportHtml(deps, SAME),
    ).rejects.toThrow(/redirect/i);
    // Must have fetched exactly 5 times (the hop limit) + the initial → ≤6 calls
    expect(mockFetch.mock.calls.length).toBeLessThanOrEqual(6);
  });

  it('throws when the 302 response has no Location header', async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      status: 302,
      headers: { get: () => null }, // no Location
      text: () => Promise.resolve(''),
    });
    const deps: FetchDeps = { fetch: mockFetch };
    await expect(
      fetchReportHtml(deps, 'https://mfprod-1.myfocuspos.com/ReportServer'),
    ).rejects.toThrow();
  });

  it('throws on a non-200/non-3xx HTTP error (e.g. 503)', async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      status: 503,
      headers: { get: () => null },
      text: () => Promise.resolve('Service Unavailable'),
    });
    const deps: FetchDeps = { fetch: mockFetch };
    await expect(
      fetchReportHtml(deps, 'https://mfprod-1.myfocuspos.com/ReportServer'),
    ).rejects.toThrow(/503/);
  });

  it('propagates fetch network errors (e.g. connection refused)', async () => {
    const mockFetch = vi.fn().mockRejectedValue(new Error('connection refused'));
    const deps: FetchDeps = { fetch: mockFetch };
    await expect(
      fetchReportHtml(deps, 'https://mfprod-1.myfocuspos.com/ReportServer'),
    ).rejects.toThrow('connection refused');
  });
});

// ── lynkIncrementalDates ──────────────────────────────────────────────────────

describe('lynkIncrementalDates', () => {
  const tz = 'America/Chicago';
  // 2026-07-04 18:00 UTC = 13:00 in Chicago (CDT)
  const now = new Date('2026-07-04T18:00:00Z');

  it('returns [today, yesterday] when yesterday has never been fetched', () => {
    expect(lynkIncrementalDates(tz, now, null)).toEqual(['2026-07-04', '2026-07-03']);
  });

  it('returns [today, yesterday] when yesterday was fetched ≥ 6h ago', () => {
    expect(lynkIncrementalDates(tz, now, '2026-07-04T11:59:00Z')).toEqual(['2026-07-04', '2026-07-03']);
  });

  it('returns [today] only when yesterday was fetched < 6h ago', () => {
    expect(lynkIncrementalDates(tz, now, '2026-07-04T13:00:00Z')).toEqual(['2026-07-04']);
  });

  it('treats an unparseable fetchedAt as stale (fail toward re-fetching)', () => {
    expect(lynkIncrementalDates(tz, now, 'not-a-date')).toEqual(['2026-07-04', '2026-07-03']);
  });
});
