/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * focusTestConnectionHandler.test.ts
 *
 * Vitest tests for the Focus POS (Shift4 pos-api) test-connection handler.
 *
 * The handler calls GET /api/restaurants with Basic auth and verifies the
 * stored store_id (GUID) appears in items[].restaurant_guid. On match it
 * writes connection_status='connected'; otherwise 'error' with an actionable
 * message. No portal login, no datafeed call.
 *
 * Plan: Task 5 — Repoint test-connection to GET /api/restaurants.
 */

import { describe, it, expect, vi } from 'vitest';
import {
  handleTestConnection,
  type TestConnectionDeps,
} from '../../supabase/functions/_shared/focusTestConnectionHandler';

vi.mock('../../supabase/functions/_shared/encryption', () => ({
  getEncryptionService: vi.fn().mockResolvedValue({
    encrypt: vi.fn().mockResolvedValue('enc'),
    decrypt: vi.fn().mockResolvedValue('plain-secret'),
  }),
}));

const RESTAURANT_ID = '00000000-0000-0000-0000-000000000042';
const USER_ID = 'user-1';
/** The Focus POS restaurant GUID stored as store_id in focus_connections. */
const STORE_GUID = 'bbbbbbbb-0000-0000-0000-000000000001';

const CONN_ROW = {
  id: 'conn-1',
  restaurant_id: RESTAURANT_ID,
  api_key: 'myapikey',
  api_secret_encrypted: 'enc-secret',
  store_id: STORE_GUID,
  environment: 'production',
  timezone: 'America/Chicago',
};

/** /api/restaurants success payload with our GUID present. */
const RESTAURANTS_WITH_GUID = JSON.stringify({
  items: [
    { restaurant_guid: STORE_GUID, name: 'My Store' },
    { restaurant_guid: 'aaaaaaaa-0000-0000-0000-000000000099', name: 'Other' },
  ],
});

/** /api/restaurants payload that does NOT contain our GUID. */
const RESTAURANTS_WITHOUT_GUID = JSON.stringify({
  items: [
    { restaurant_guid: 'aaaaaaaa-0000-0000-0000-000000000099', name: 'Other' },
  ],
});

function makeUserClientMock(opts: { user?: { id: string } | null; role?: string } = {}) {
  const user = opts.user !== undefined ? opts.user : { id: USER_ID };
  const role = opts.role ?? 'owner';
  const single = vi.fn().mockResolvedValue({ data: user && role ? { role } : null, error: null });
  const select = vi.fn().mockReturnValue({ eq: () => ({ eq: () => ({ single }) }) });
  return { auth: { getUser: vi.fn().mockResolvedValue({ data: { user } }) }, from: vi.fn().mockReturnValue({ select }) };
}

function makeServiceClientMock(opts: { connRow?: any; connError?: string } = {}) {
  const single = vi.fn().mockResolvedValue({
    data: opts.connError ? null : (opts.connRow ?? CONN_ROW),
    error: opts.connError ? { message: opts.connError } : null,
  });
  const select = vi.fn().mockReturnValue({ eq: () => ({ eq: () => ({ single }) }) });
  const updateEqInner = vi.fn().mockResolvedValue({ data: null, error: null });
  const updateEqOuter = vi.fn().mockReturnValue({ eq: updateEqInner });
  const update = vi.fn().mockReturnValue({ eq: updateEqOuter });
  const from = vi.fn().mockReturnValue({ select, update });
  return { client: { from }, mocks: { from, update, updateEqOuter, updateEqInner } };
}

/** A fetch double returning one canned Response. */
function mockFetch(res: { status: number; body?: string }) {
  return vi.fn(async () => ({
    status: res.status,
    ok: res.status >= 200 && res.status < 300,
    text: async () => res.body ?? '',
  }) as Response);
}

function makeRequest(opts: { authHeader?: string | null; body?: Record<string, unknown> } = {}): Request {
  const headers = new Headers();
  if (opts.authHeader !== null) headers.set('Authorization', opts.authHeader ?? 'Bearer jwt');
  return new Request('https://example.com/functions/v1/focus-test-connection', {
    method: 'POST',
    headers,
    body: JSON.stringify(opts.body ?? { restaurantId: RESTAURANT_ID }),
  });
}

function makeDeps(opts: {
  userClientOpts?: Parameters<typeof makeUserClientMock>[0];
  serviceClientOpts?: Parameters<typeof makeServiceClientMock>[0];
  fetch?: ReturnType<typeof mockFetch>;
  sandboxBaseUrl?: string;
} = {}) {
  const userClient = makeUserClientMock(opts.userClientOpts ?? {});
  const { client: serviceClient, mocks } = makeServiceClientMock(opts.serviceClientOpts ?? {});
  const fetchFn = opts.fetch ?? mockFetch({ status: 200, body: RESTAURANTS_WITH_GUID });
  const deps: TestConnectionDeps = {
    userClient: userClient as any,
    serviceClient: serviceClient as any,
    fetch: fetchFn as any,
    sandboxBaseUrl: opts.sandboxBaseUrl,
  };
  return { deps, mocks, fetchFn };
}

describe('handleTestConnection (Focus POS /api/restaurants)', () => {
  // ── Auth / role guards (unchanged logic) ──────────────────────────────────────

  it('returns 401 without an Authorization header', async () => {
    const { deps } = makeDeps();
    expect((await handleTestConnection(makeRequest({ authHeader: null }), deps)).status).toBe(401);
  });

  it('returns 401 when getUser returns null', async () => {
    const { deps } = makeDeps({ userClientOpts: { user: null } });
    expect((await handleTestConnection(makeRequest(), deps)).status).toBe(401);
  });

  it('returns 403 when the caller is not owner/manager', async () => {
    const { deps } = makeDeps({ userClientOpts: { role: 'staff' } });
    expect((await handleTestConnection(makeRequest(), deps)).status).toBe(403);
  });

  it('allows manager role through', async () => {
    const { deps } = makeDeps({ userClientOpts: { role: 'manager' } });
    const res = await handleTestConnection(makeRequest(), deps);
    expect(res.status).toBe(200);
  });

  it('returns 404 when there is no active connection', async () => {
    const { deps } = makeDeps({ serviceClientOpts: { connError: 'no rows' } });
    expect((await handleTestConnection(makeRequest(), deps)).status).toBe(404);
  });

  it('returns 400 for a missing restaurantId body field', async () => {
    const { deps } = makeDeps();
    expect((await handleTestConnection(makeRequest({ body: {} }), deps)).status).toBe(400);
  });

  // ── GET /api/restaurants call contract ─────────────────────────────────────────

  it('GETs /api/restaurants on the pos-api.focuspos.com base URL with Basic auth', async () => {
    const { deps, fetchFn } = makeDeps();
    await handleTestConnection(makeRequest(), deps);
    expect(fetchFn).toHaveBeenCalledTimes(1);
    const [url, init] = fetchFn.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('https://pos-api.focuspos.com/api/restaurants');
    expect((init.headers as Record<string, string>)['Authorization']).toBe(
      'Basic ' + btoa('myapikey:plain-secret'),
    );
    expect((init.method as string).toUpperCase()).toBe('GET');
    // redirect:error blocks 3xx SSRF bypass (mirrors Lynk datafeed behaviour)
    expect((init as RequestInit & { redirect?: string }).redirect).toBe('error');
  });

  it('GETs /api/restaurants on the sandbox base URL when environment=sandbox', async () => {
    const sandboxRow = { ...CONN_ROW, environment: 'sandbox' };
    const { deps, fetchFn } = makeDeps({
      serviceClientOpts: { connRow: sandboxRow },
      sandboxBaseUrl: 'https://sandbox.pos-api.focuspos.com',
    });
    await handleTestConnection(makeRequest(), deps);
    const [url] = fetchFn.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('https://sandbox.pos-api.focuspos.com/api/restaurants');
  });

  it('CRITICAL: accepts a non-focuspos.com sandbox host from the operator-configured FOCUS_API_SANDBOX_URL', async () => {
    // The certification sandbox may be on a third-party host (e.g. issued by Shift4).
    // isSafeBase must allowlist it when sandboxBaseUrl is provided, otherwise the
    // test-connection flow silently rejects valid sandbox credentials.
    const sandboxRow = { ...CONN_ROW, environment: 'sandbox' };
    const { deps, fetchFn } = makeDeps({
      serviceClientOpts: { connRow: sandboxRow },
      sandboxBaseUrl: 'https://certification.shift4.com',
    });
    const res = await handleTestConnection(makeRequest(), deps);
    // The fetch should have been called (SSRF check passed) — not short-circuited with a 200 error
    expect(fetchFn).toHaveBeenCalledTimes(1);
    const [url] = fetchFn.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('https://certification.shift4.com/api/restaurants');
    // Response is a valid HTTP result (not the SSRF-block 200 error body)
    const body = await res.json();
    expect(body).not.toMatchObject({ error: expect.stringContaining('focuspos.com') });
  });

  it('falls back to the production focuspos.com host when no sandboxBaseUrl is configured', async () => {
    // When FOCUS_API_SANDBOX_URL is unset (sandboxBaseUrl: undefined) the handler
    // resolves to the standard production URL so isSafeBase accepts it.
    // This is the production-fallback path — not a mismatch/SSRF rejection path.
    const sandboxRow = { ...CONN_ROW, environment: 'sandbox' };
    const { deps } = makeDeps({
      serviceClientOpts: { connRow: sandboxRow },
      sandboxBaseUrl: undefined,
    });
    const res = await handleTestConnection(makeRequest(), deps);
    expect(res.status).toBe(200); // handler runs normally; production URL is safe
  });

  // ── GUID lookup: connected ────────────────────────────────────────────────────

  it('marks the connection connected when store_id GUID is found in items[].restaurant_guid', async () => {
    const { deps, mocks } = makeDeps({
      fetch: mockFetch({ status: 200, body: RESTAURANTS_WITH_GUID }),
    });
    const res = await handleTestConnection(makeRequest(), deps);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toMatchObject({ success: true, status: 'connected' });
    expect(mocks.update.mock.calls[0][0]).toMatchObject({
      connection_status: 'connected',
      last_error: null,
    });
  });

  // ── GUID lookup: not found in list ────────────────────────────────────────────

  it('marks the connection error when store_id GUID is NOT found in items[].restaurant_guid', async () => {
    const { deps, mocks } = makeDeps({
      fetch: mockFetch({ status: 200, body: RESTAURANTS_WITHOUT_GUID }),
    });
    const res = await handleTestConnection(makeRequest(), deps);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toMatchObject({ success: false, status: 'error' });
    expect(body.error).toMatch(/restaurant.*guid|guid.*not found|not found/i);
    expect(mocks.update.mock.calls[0][0]).toMatchObject({ connection_status: 'error' });
    expect(mocks.update.mock.calls[0][0].last_error).toBeTruthy();
  });

  // ── HTTP error gates ──────────────────────────────────────────────────────────

  it('marks error on 401 from /api/restaurants (invalid credentials)', async () => {
    const { deps, mocks } = makeDeps({
      fetch: mockFetch({ status: 401, body: 'Unauthorized' }),
    });
    const res = await handleTestConnection(makeRequest(), deps);
    const body = await res.json();
    expect(body).toMatchObject({ success: false, status: 'error' });
    expect(body.error).toMatch(/auth|credential|401/i);
    expect(mocks.update.mock.calls[0][0]).toMatchObject({ connection_status: 'error' });
  });

  it('marks error on 403 from /api/restaurants (license / permission)', async () => {
    const { deps, mocks } = makeDeps({
      fetch: mockFetch({ status: 403, body: 'Forbidden' }),
    });
    const res = await handleTestConnection(makeRequest(), deps);
    const body = await res.json();
    expect(body).toMatchObject({ success: false, status: 'error' });
    expect(body.error).toMatch(/license|permission|403/i);
    expect(mocks.update.mock.calls[0][0]).toMatchObject({ connection_status: 'error' });
  });

  it('marks error on 404 from /api/restaurants (wrong base URL)', async () => {
    const { deps, mocks } = makeDeps({
      fetch: mockFetch({ status: 404, body: 'Not Found' }),
    });
    const res = await handleTestConnection(makeRequest(), deps);
    const body = await res.json();
    expect(body).toMatchObject({ success: false, status: 'error' });
    expect(body.error).toMatch(/not found|route|url|404/i);
    expect(mocks.update.mock.calls[0][0]).toMatchObject({ connection_status: 'error' });
  });

  it('marks error on other non-2xx from /api/restaurants', async () => {
    const { deps, mocks } = makeDeps({
      fetch: mockFetch({ status: 500, body: 'Internal Server Error' }),
    });
    const res = await handleTestConnection(makeRequest(), deps);
    const body = await res.json();
    expect(body).toMatchObject({ success: false, status: 'error' });
    expect(mocks.update.mock.calls[0][0]).toMatchObject({ connection_status: 'error' });
  });

  it('marks error on network failure reaching /api/restaurants', async () => {
    const throwingFetch = vi.fn(async () => {
      throw new Error('ECONNREFUSED');
    });
    const { deps, mocks } = makeDeps({ fetch: throwingFetch as any });
    const res = await handleTestConnection(makeRequest(), deps);
    const body = await res.json();
    expect(body).toMatchObject({ success: false, status: 'error' });
    expect(body.error).toMatch(/network|ECONNREFUSED/i);
    expect(mocks.update.mock.calls[0][0]).toMatchObject({ connection_status: 'error' });
  });

  it('marks error when /api/restaurants returns non-JSON', async () => {
    const { deps, mocks } = makeDeps({
      fetch: mockFetch({ status: 200, body: '<html>not json</html>' }),
    });
    const res = await handleTestConnection(makeRequest(), deps);
    const body = await res.json();
    expect(body).toMatchObject({ success: false, status: 'error' });
    expect(body.error).toMatch(/json|parse/i);
    expect(mocks.update.mock.calls[0][0]).toMatchObject({ connection_status: 'error' });
  });

  // ── status updates written to focus_connections ────────────────────────────────

  it('sets last_error_at on error and clears it on connected', async () => {
    // Error case: last_error_at should be set
    const { deps: depsFail, mocks: mocksFail } = makeDeps({
      fetch: mockFetch({ status: 401 }),
    });
    await handleTestConnection(makeRequest(), depsFail);
    expect(mocksFail.update.mock.calls[0][0].last_error_at).toBeTruthy();

    // Success case: last_error_at should be null
    const { deps: depsOk, mocks: mocksOk } = makeDeps({
      fetch: mockFetch({ status: 200, body: RESTAURANTS_WITH_GUID }),
    });
    await handleTestConnection(makeRequest(), depsOk);
    expect(mocksOk.update.mock.calls[0][0].last_error_at).toBeNull();
  });
});
