import { describe, it, expect, vi } from 'vitest';
import {
  basicAuthHeader,
  buildDatafeedUrl,
  fetchDatafeed,
  type FocusDatafeedConfig,
} from '../../supabase/functions/_shared/focusDatafeed.ts';

const CONFIG: FocusDatafeedConfig = {
  baseUrl: 'https://focuslink.focuspos.com/v2',
  storeId: '24329',
  apiKey: 'license-key',
  apiSecret: 'license-secret',
};

/** Minimal fetch double returning a Response-like object. */
function mockFetch(res: { status: number; body?: string; throws?: boolean }) {
  return vi.fn(async () => {
    if (res.throws) throw new Error('network down');
    return {
      status: res.status,
      ok: res.status >= 200 && res.status < 300,
      text: async () => res.body ?? '',
    } as Response;
  });
}

describe('basicAuthHeader', () => {
  it('builds an HTTP Basic header from key:secret', () => {
    expect(basicAuthHeader('license-key', 'license-secret')).toBe(
      'Basic ' + btoa('license-key:license-secret'),
    );
  });
});

describe('buildDatafeedUrl', () => {
  it('builds /stores/{storeId}/datafeed?date=', () => {
    expect(buildDatafeedUrl('https://focuslink.focuspos.com/v2', '24329', '2026-06-29')).toBe(
      'https://focuslink.focuspos.com/v2/stores/24329/datafeed?date=2026-06-29',
    );
  });

  it('url-encodes the store identifier (so a GUID is path-safe)', () => {
    const guid = 'a/b c';
    expect(buildDatafeedUrl('https://focuslink.focuspos.com/v2', guid, '2026-06-29')).toBe(
      `https://focuslink.focuspos.com/v2/stores/${encodeURIComponent(guid)}/datafeed?date=2026-06-29`,
    );
  });

  it('tolerates a trailing slash on the base URL', () => {
    expect(buildDatafeedUrl('https://focuslink.focuspos.com/v2/', '24329', '2026-06-29')).toBe(
      'https://focuslink.focuspos.com/v2/stores/24329/datafeed?date=2026-06-29',
    );
  });

  it('rejects a malformed date (must be YYYY-MM-DD)', () => {
    expect(() => buildDatafeedUrl('https://focuslink.focuspos.com/v2', '24329', '06/29/2026')).toThrow(
      /YYYY-MM-DD/,
    );
  });
});

describe('fetchDatafeed', () => {
  it('returns ok + parsed JSON on 200', async () => {
    const fetchFn = mockFetch({ status: 200, body: JSON.stringify({ checks: [{ id: 1 }] }) });
    const r = await fetchDatafeed({ fetch: fetchFn }, CONFIG, '2026-06-29');
    expect(r).toEqual({ ok: true, status: 200, data: { checks: [{ id: 1 }] } });
  });

  it('sends Basic auth + Accept: application/json to the datafeed URL', async () => {
    const fetchFn = mockFetch({ status: 200, body: '{}' });
    await fetchDatafeed({ fetch: fetchFn }, CONFIG, '2026-06-29');
    const [url, init] = fetchFn.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('https://focuslink.focuspos.com/v2/stores/24329/datafeed?date=2026-06-29');
    const headers = init.headers as Record<string, string>;
    expect(headers['Authorization']).toBe('Basic ' + btoa('license-key:license-secret'));
    expect(headers['Accept']).toBe('application/json');
  });

  it('maps 401 "License not found or inactive" to kind=license', async () => {
    const fetchFn = mockFetch({ status: 401, body: '"License not found or inactive"' });
    const r = await fetchDatafeed({ fetch: fetchFn }, CONFIG, '2026-06-29');
    expect(r).toMatchObject({ ok: false, status: 401, kind: 'license' });
  });

  it('maps 401 "Auth header missing" to kind=auth', async () => {
    const fetchFn = mockFetch({ status: 401, body: '"Auth header missing"' });
    const r = await fetchDatafeed({ fetch: fetchFn }, CONFIG, '2026-06-29');
    expect(r).toMatchObject({ ok: false, status: 401, kind: 'auth' });
  });

  it('maps 404 to kind=not_found', async () => {
    const fetchFn = mockFetch({ status: 404, body: '{"error":"Route not found"}' });
    const r = await fetchDatafeed({ fetch: fetchFn }, CONFIG, '2026-06-29');
    expect(r).toMatchObject({ ok: false, status: 404, kind: 'not_found' });
  });

  it('maps other non-2xx to kind=http', async () => {
    const fetchFn = mockFetch({ status: 500, body: 'oops' });
    const r = await fetchDatafeed({ fetch: fetchFn }, CONFIG, '2026-06-29');
    expect(r).toMatchObject({ ok: false, status: 500, kind: 'http' });
  });

  it('maps a thrown fetch to kind=network', async () => {
    const fetchFn = mockFetch({ status: 0, throws: true });
    const r = await fetchDatafeed({ fetch: fetchFn }, CONFIG, '2026-06-29');
    expect(r).toMatchObject({ ok: false, kind: 'network' });
  });

  it('maps invalid JSON on 200 to kind=parse', async () => {
    const fetchFn = mockFetch({ status: 200, body: 'not json{' });
    const r = await fetchDatafeed({ fetch: fetchFn }, CONFIG, '2026-06-29');
    expect(r).toMatchObject({ ok: false, status: 200, kind: 'parse' });
  });

  it('refuses a non-focuspos base URL without calling fetch (SSRF guard)', async () => {
    const fetchFn = mockFetch({ status: 200, body: '{}' });
    const r = await fetchDatafeed({ fetch: fetchFn }, { ...CONFIG, baseUrl: 'https://evil.com/v2' }, '2026-06-29');
    expect(r).toMatchObject({ ok: false, kind: 'config' });
    expect(fetchFn).not.toHaveBeenCalled();
  });

  it('refuses a non-https base URL (SSRF guard)', async () => {
    const fetchFn = mockFetch({ status: 200, body: '{}' });
    const r = await fetchDatafeed({ fetch: fetchFn }, { ...CONFIG, baseUrl: 'http://focuslink.focuspos.com/v2' }, '2026-06-29');
    expect(r).toMatchObject({ ok: false, kind: 'config' });
    expect(fetchFn).not.toHaveBeenCalled();
  });
});
