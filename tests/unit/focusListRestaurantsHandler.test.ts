/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * focusListRestaurantsHandler.test.ts
 *
 * Vitest tests for the Focus POS focus-list-restaurants handler.
 *
 * The handler accepts credentials (apiKey, apiSecret) and a restaurantId in the
 * request body, calls GET /api/restaurants with HTTP Basic auth against the
 * Focus POS API, and returns a list of { restaurant_guid, restaurant_name }.
 *
 * Credentials are NEVER stored — used once and discarded.
 * Credentials must NEVER appear in console logs.
 *
 * Design ref: spec §4 (Increment A) + §8.6 (edge-function security).
 * Plan ref: A1.
 */

import { describe, it, expect, vi } from 'vitest';
import {
  handleListRestaurants,
  type ListRestaurantsDeps,
} from '../../supabase/functions/_shared/focusListRestaurantsHandler';

// ── Constants ────────────────────────────────────────────────────────────────

const RESTAURANT_ID = '00000000-0000-0000-0000-000000000042';
const USER_ID = 'user-1';
const API_KEY = 'test-api-key-value';
const API_SECRET = 'test-api-secret-value';

// ── Focus API response shapes ─────────────────────────────────────────────────

const FOCUS_RESTAURANTS_JSON = JSON.stringify({
  count: 2,
  request_count: 1,
  page_count: 1,
  items: [
    { restaurant_guid: 'guid-aaa', restaurant_name: 'Downtown Store' },
    { restaurant_guid: 'guid-bbb', restaurant_name: 'North Store' },
  ],
});

const FOCUS_RESTAURANTS_ONE_JSON = JSON.stringify({
  count: 1,
  items: [{ restaurant_guid: 'guid-only', restaurant_name: 'Only Store' }],
});

const FOCUS_RESTAURANTS_BLANK_NAME_JSON = JSON.stringify({
  count: 1,
  items: [{ restaurant_guid: 'guid-blank', restaurant_name: '' }],
});

const FOCUS_RESTAURANTS_MISSING_NAME_JSON = JSON.stringify({
  count: 1,
  items: [{ restaurant_guid: 'guid-missing' }],
});

const FOCUS_RESTAURANTS_EMPTY_JSON = JSON.stringify({ count: 0, items: [] });

// ── Mock builders ─────────────────────────────────────────────────────────────

function makeUserClientMock(
  opts: { user?: { id: string } | null; role?: string } = {},
) {
  const user = opts.user !== undefined ? opts.user : { id: USER_ID };
  const role = opts.role ?? 'owner';
  const single = vi
    .fn()
    .mockResolvedValue({ data: user && role ? { role } : null, error: null });
  const eqInner = vi.fn().mockReturnValue({ single });
  const eqOuter = vi.fn().mockReturnValue({ eq: eqInner });
  const select = vi.fn().mockReturnValue({ eq: eqOuter });
  return {
    auth: { getUser: vi.fn().mockResolvedValue({ data: { user } }) },
    from: vi.fn().mockReturnValue({ select }),
    _mocks: { select, eqOuter, eqInner, single },
  };
}

function mockFetch(res: { status: number; body?: string }) {
  return vi.fn(async () => ({
    status: res.status,
    ok: res.status >= 200 && res.status < 300,
    text: async () => res.body ?? '',
  })) as unknown as typeof fetch;
}

function makeRequest(
  opts: {
    authHeader?: string | null;
    body?: Record<string, unknown>;
  } = {},
): Request {
  const headers = new Headers();
  if (opts.authHeader !== null) {
    headers.set('Authorization', opts.authHeader ?? 'Bearer jwt');
  }
  return new Request('https://example.com/functions/v1/focus-list-restaurants', {
    method: 'POST',
    headers,
    body: JSON.stringify(
      opts.body ?? {
        restaurantId: RESTAURANT_ID,
        apiKey: API_KEY,
        apiSecret: API_SECRET,
      },
    ),
  });
}

function makeDeps(
  opts: {
    userClientOpts?: Parameters<typeof makeUserClientMock>[0];
    fetchFn?: typeof fetch;
    sandboxBaseUrl?: string;
  } = {},
): { deps: ListRestaurantsDeps; userClientMock: ReturnType<typeof makeUserClientMock> } {
  const userClientMock = makeUserClientMock(opts.userClientOpts ?? {});
  const deps: ListRestaurantsDeps = {
    userClient: userClientMock as any,
    fetch: opts.fetchFn ?? mockFetch({ status: 200, body: FOCUS_RESTAURANTS_JSON }),
    sandboxBaseUrl: opts.sandboxBaseUrl,
  };
  return { deps, userClientMock };
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('handleListRestaurants', () => {
  // ── Auth guards ─────────────────────────────────────────────────────────────

  it('returns 401 when Authorization header is missing', async () => {
    const { deps } = makeDeps();
    const res = await handleListRestaurants(makeRequest({ authHeader: null }), deps);
    expect(res.status).toBe(401);
  });

  it('returns 401 when getUser returns null (bad/expired JWT)', async () => {
    const { deps } = makeDeps({ userClientOpts: { user: null } });
    const res = await handleListRestaurants(makeRequest(), deps);
    expect(res.status).toBe(401);
  });

  // ── Input validation ─────────────────────────────────────────────────────────

  it('returns 400 when restaurantId is missing from body', async () => {
    const { deps } = makeDeps();
    const res = await handleListRestaurants(
      makeRequest({ body: { apiKey: API_KEY, apiSecret: API_SECRET } }),
      deps,
    );
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toMatch(/restaurantId/i);
  });

  it('returns 400 when apiKey is missing from body', async () => {
    const { deps } = makeDeps();
    const res = await handleListRestaurants(
      makeRequest({ body: { restaurantId: RESTAURANT_ID, apiSecret: API_SECRET } }),
      deps,
    );
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toMatch(/apiKey/i);
  });

  it('returns 400 when apiSecret is missing from body', async () => {
    const { deps } = makeDeps();
    const res = await handleListRestaurants(
      makeRequest({ body: { restaurantId: RESTAURANT_ID, apiKey: API_KEY } }),
      deps,
    );
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toMatch(/apiSecret/i);
  });

  it('returns 400 when apiKey is empty string', async () => {
    const { deps } = makeDeps();
    const res = await handleListRestaurants(
      makeRequest({ body: { restaurantId: RESTAURANT_ID, apiKey: '', apiSecret: API_SECRET } }),
      deps,
    );
    expect(res.status).toBe(400);
  });

  it('returns 400 for invalid JSON body', async () => {
    const { deps } = makeDeps();
    const headers = new Headers({ Authorization: 'Bearer jwt' });
    const req = new Request('https://example.com/functions/v1/focus-list-restaurants', {
      method: 'POST',
      headers,
      body: 'not-json',
    });
    const res = await handleListRestaurants(req, deps);
    expect(res.status).toBe(400);
  });

  // ── Role check ───────────────────────────────────────────────────────────────

  it('returns 403 when caller is neither owner nor manager', async () => {
    const { deps } = makeDeps({ userClientOpts: { role: 'staff' } });
    const res = await handleListRestaurants(makeRequest(), deps);
    expect(res.status).toBe(403);
  });

  it('returns 403 when caller is chef', async () => {
    const { deps } = makeDeps({ userClientOpts: { role: 'chef' } });
    const res = await handleListRestaurants(makeRequest(), deps);
    expect(res.status).toBe(403);
  });

  it('allows manager role through', async () => {
    const { deps } = makeDeps({ userClientOpts: { role: 'manager' } });
    const res = await handleListRestaurants(makeRequest(), deps);
    expect(res.status).toBe(200);
  });

  it('allows owner role through', async () => {
    const { deps } = makeDeps({ userClientOpts: { role: 'owner' } });
    const res = await handleListRestaurants(makeRequest(), deps);
    expect(res.status).toBe(200);
  });

  // ── Focus API call contract ───────────────────────────────────────────────────

  it('GETs /api/restaurants on pos-api.focuspos.com with Basic auth', async () => {
    const fetchFn = mockFetch({ status: 200, body: FOCUS_RESTAURANTS_JSON });
    const { deps } = makeDeps({ fetchFn });
    await handleListRestaurants(makeRequest(), deps);
    expect(fetchFn).toHaveBeenCalledTimes(1);
    const [url, init] = (fetchFn as any).mock.calls[0] as [string, RequestInit];
    expect(url).toBe('https://pos-api.focuspos.com/api/restaurants');
    expect((init.headers as Record<string, string>)['Authorization']).toBe(
      'Basic ' + btoa(`${API_KEY}:${API_SECRET}`),
    );
    expect((init.method as string | undefined)?.toUpperCase() ?? 'GET').toBe('GET');
    expect((init as any).redirect).toBe('error');
  });

  it('uses sandbox base URL when environment=sandbox and sandboxBaseUrl is provided', async () => {
    const fetchFn = mockFetch({ status: 200, body: FOCUS_RESTAURANTS_JSON });
    const { deps } = makeDeps({
      fetchFn,
      sandboxBaseUrl: 'https://sandbox.pos-api.focuspos.com',
    });
    await handleListRestaurants(
      makeRequest({
        body: {
          restaurantId: RESTAURANT_ID,
          apiKey: API_KEY,
          apiSecret: API_SECRET,
          environment: 'sandbox',
        },
      }),
      deps,
    );
    const [url] = (fetchFn as any).mock.calls[0] as [string];
    expect(url).toBe('https://sandbox.pos-api.focuspos.com/api/restaurants');
  });

  it('uses production base URL when environment is omitted', async () => {
    const fetchFn = mockFetch({ status: 200, body: FOCUS_RESTAURANTS_JSON });
    const { deps } = makeDeps({ fetchFn });
    await handleListRestaurants(makeRequest(), deps);
    const [url] = (fetchFn as any).mock.calls[0] as [string];
    expect(url).toBe('https://pos-api.focuspos.com/api/restaurants');
  });

  // ── Focus-side HTTP error → HTTP 200 {success:false, error} ──────────────────

  it('returns HTTP 200 {success:false} with friendly message when Focus returns 401', async () => {
    const { deps } = makeDeps({ fetchFn: mockFetch({ status: 401 }) });
    const res = await handleListRestaurants(makeRequest(), deps);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toMatchObject({ success: false });
    expect(body.error).toMatch(/api key|secret|credential|401/i);
  });

  it('returns HTTP 200 {success:false} with friendly message when Focus returns 403', async () => {
    const { deps } = makeDeps({ fetchFn: mockFetch({ status: 403 }) });
    const res = await handleListRestaurants(makeRequest(), deps);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toMatchObject({ success: false });
    expect(body.error).toMatch(/license|permission|403/i);
  });

  it('returns HTTP 200 {success:false} with friendly message when Focus returns 404', async () => {
    const { deps } = makeDeps({ fetchFn: mockFetch({ status: 404 }) });
    const res = await handleListRestaurants(makeRequest(), deps);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toMatchObject({ success: false });
    expect(body.error).toMatch(/environment|base url|404|url/i);
  });

  it('returns HTTP 200 {success:false} when Focus returns other non-2xx', async () => {
    const { deps } = makeDeps({ fetchFn: mockFetch({ status: 500 }) });
    const res = await handleListRestaurants(makeRequest(), deps);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toMatchObject({ success: false });
    expect(body.error).toMatch(/500/);
  });

  it('returns HTTP 200 {success:false} on network error', async () => {
    const throwingFetch = vi.fn(async () => {
      throw new Error('ECONNREFUSED');
    }) as unknown as typeof fetch;
    const { deps } = makeDeps({ fetchFn: throwingFetch });
    const res = await handleListRestaurants(makeRequest(), deps);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toMatchObject({ success: false });
    expect(body.error).toMatch(/network|ECONNREFUSED/i);
  });

  // ── SSRF guard ────────────────────────────────────────────────────────────────

  it('returns HTTP 200 {success:false} if sandboxBaseUrl is not a safe focuspos.com URL', async () => {
    const fetchFn = mockFetch({ status: 200, body: FOCUS_RESTAURANTS_JSON });
    const { deps } = makeDeps({
      fetchFn,
      sandboxBaseUrl: 'https://evil.internal.com',
    });
    const res = await handleListRestaurants(
      makeRequest({
        body: {
          restaurantId: RESTAURANT_ID,
          apiKey: API_KEY,
          apiSecret: API_SECRET,
          environment: 'sandbox',
        },
      }),
      deps,
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toMatchObject({ success: false });
    expect(body.error).toMatch(/url|ssrf|focuspos|safe/i);
    // The fetch must NOT be called when SSRF guard triggers
    expect(fetchFn).not.toHaveBeenCalled();
  });

  // ── Success: response shaping ─────────────────────────────────────────────────

  it('returns success with mapped restaurants array', async () => {
    const { deps } = makeDeps({
      fetchFn: mockFetch({ status: 200, body: FOCUS_RESTAURANTS_JSON }),
    });
    const res = await handleListRestaurants(makeRequest(), deps);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toMatchObject({ success: true });
    expect(body.restaurants).toHaveLength(2);
    expect(body.restaurants[0]).toEqual({
      restaurant_guid: 'guid-aaa',
      restaurant_name: 'Downtown Store',
    });
    expect(body.restaurants[1]).toEqual({
      restaurant_guid: 'guid-bbb',
      restaurant_name: 'North Store',
    });
  });

  it('returns success with single restaurant', async () => {
    const { deps } = makeDeps({
      fetchFn: mockFetch({ status: 200, body: FOCUS_RESTAURANTS_ONE_JSON }),
    });
    const res = await handleListRestaurants(makeRequest(), deps);
    const body = await res.json();
    expect(body).toMatchObject({ success: true });
    expect(body.restaurants).toHaveLength(1);
    expect(body.restaurants[0].restaurant_guid).toBe('guid-only');
  });

  it('returns success with empty restaurants array when items is empty', async () => {
    const { deps } = makeDeps({
      fetchFn: mockFetch({ status: 200, body: FOCUS_RESTAURANTS_EMPTY_JSON }),
    });
    const res = await handleListRestaurants(makeRequest(), deps);
    const body = await res.json();
    expect(body).toMatchObject({ success: true, restaurants: [] });
  });

  it('defaults restaurant_name to the GUID when restaurant_name is blank', async () => {
    const { deps } = makeDeps({
      fetchFn: mockFetch({ status: 200, body: FOCUS_RESTAURANTS_BLANK_NAME_JSON }),
    });
    const res = await handleListRestaurants(makeRequest(), deps);
    const body = await res.json();
    expect(body.restaurants[0].restaurant_name).toBe('guid-blank');
  });

  it('defaults restaurant_name to the GUID when restaurant_name is missing', async () => {
    const { deps } = makeDeps({
      fetchFn: mockFetch({ status: 200, body: FOCUS_RESTAURANTS_MISSING_NAME_JSON }),
    });
    const res = await handleListRestaurants(makeRequest(), deps);
    const body = await res.json();
    expect(body.restaurants[0].restaurant_name).toBe('guid-missing');
  });

  it('filters out items without a string restaurant_guid', async () => {
    const payload = JSON.stringify({
      items: [
        { restaurant_guid: 'guid-valid', restaurant_name: 'Valid' },
        { restaurant_name: 'No GUID' },
        { restaurant_guid: 42, restaurant_name: 'Number GUID' },
        null,
      ],
    });
    const { deps } = makeDeps({ fetchFn: mockFetch({ status: 200, body: payload }) });
    const res = await handleListRestaurants(makeRequest(), deps);
    const body = await res.json();
    expect(body.restaurants).toHaveLength(1);
    expect(body.restaurants[0].restaurant_guid).toBe('guid-valid');
  });

  // ── Security: credentials must never appear in console output ────────────────

  it('never logs apiKey or apiSecret to console', async () => {
    const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    const consoleWarnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    try {
      const { deps } = makeDeps({
        fetchFn: mockFetch({ status: 200, body: FOCUS_RESTAURANTS_JSON }),
      });
      await handleListRestaurants(makeRequest(), deps);

      const allLogs = [
        ...consoleSpy.mock.calls.flat(),
        ...consoleWarnSpy.mock.calls.flat(),
        ...consoleErrorSpy.mock.calls.flat(),
      ]
        .map((v) => (typeof v === 'string' ? v : JSON.stringify(v)))
        .join('\n');

      expect(allLogs).not.toContain(API_KEY);
      expect(allLogs).not.toContain(API_SECRET);
    } finally {
      consoleSpy.mockRestore();
      consoleWarnSpy.mockRestore();
      consoleErrorSpy.mockRestore();
    }
  });

  it('never logs apiKey or apiSecret on error paths', async () => {
    const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    const consoleWarnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    try {
      // Try multiple error paths
      const paths = [
        makeDeps({ fetchFn: mockFetch({ status: 401 }) }),
        makeDeps({ fetchFn: mockFetch({ status: 500 }) }),
        makeDeps({
          fetchFn: vi.fn(async () => {
            throw new Error('network fail');
          }) as unknown as typeof fetch,
        }),
      ];

      for (const { deps } of paths) {
        await handleListRestaurants(makeRequest(), deps);
      }

      const allLogs = [
        ...consoleSpy.mock.calls.flat(),
        ...consoleWarnSpy.mock.calls.flat(),
        ...consoleErrorSpy.mock.calls.flat(),
      ]
        .map((v) => (typeof v === 'string' ? v : JSON.stringify(v)))
        .join('\n');

      expect(allLogs).not.toContain(API_KEY);
      expect(allLogs).not.toContain(API_SECRET);
    } finally {
      consoleSpy.mockRestore();
      consoleWarnSpy.mockRestore();
      consoleErrorSpy.mockRestore();
    }
  });
});
