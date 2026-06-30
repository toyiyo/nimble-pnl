/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * focusTestConnectionHandler.test.ts
 *
 * Vitest tests for the FocusLink (Shift4 API) test-connection handler.
 *
 * The handler decrypts the stored API secret, makes ONE datafeed call for
 * yesterday, and writes connection_status accordingly. No portal login, no HTML.
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
const CONN_ROW = {
  id: 'conn-1',
  restaurant_id: RESTAURANT_ID,
  api_key: 'license-key',
  api_secret_encrypted: 'enc-secret',
  store_id: '24329',
  environment: 'production',
  timezone: 'America/Chicago',
};

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
  const updateEq = vi.fn().mockResolvedValue({ data: null, error: null });
  const update = vi.fn().mockReturnValue({ eq: updateEq });
  const from = vi.fn().mockReturnValue({ select, update });
  return { client: { from }, mocks: { from, update, updateEq } };
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
} = {}) {
  const userClient = makeUserClientMock(opts.userClientOpts ?? {});
  const { client: serviceClient, mocks } = makeServiceClientMock(opts.serviceClientOpts ?? {});
  const fetchFn = opts.fetch ?? mockFetch({ status: 200, body: '{"checks":[]}' });
  const deps: TestConnectionDeps = {
    userClient: userClient as any,
    serviceClient: serviceClient as any,
    fetch: fetchFn as any,
    now: new Date('2026-06-30T12:00:00Z'),
  };
  return { deps, mocks, fetchFn };
}

describe('handleTestConnection (FocusLink API)', () => {
  it('returns 401 without an Authorization header', async () => {
    const { deps } = makeDeps();
    expect((await handleTestConnection(makeRequest({ authHeader: null }), deps)).status).toBe(401);
  });

  it('returns 403 when the caller is not owner/manager', async () => {
    const { deps } = makeDeps({ userClientOpts: { role: 'staff' } });
    expect((await handleTestConnection(makeRequest(), deps)).status).toBe(403);
  });

  it('returns 404 when there is no active connection', async () => {
    const { deps } = makeDeps({ serviceClientOpts: { connError: 'no rows' } });
    expect((await handleTestConnection(makeRequest(), deps)).status).toBe(404);
  });

  it('calls the datafeed for YESTERDAY in the store timezone with Basic auth', async () => {
    const { deps, fetchFn } = makeDeps();
    await handleTestConnection(makeRequest(), deps);
    const [url, init] = fetchFn.mock.calls[0] as [string, RequestInit];
    // 2026-06-30T12:00:00Z is 2026-06-30 in America/Chicago → yesterday = 2026-06-29
    expect(url).toBe('https://focuslink.focuspos.com/v2/stores/24329/datafeed?date=2026-06-29');
    expect((init.headers as Record<string, string>)['Authorization']).toBe('Basic ' + btoa('license-key:plain-secret'));
  });

  it('marks the connection connected on a 200 datafeed', async () => {
    const { deps, mocks } = makeDeps({ fetch: mockFetch({ status: 200, body: '{"checks":[]}' }) });
    const res = await handleTestConnection(makeRequest(), deps);
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ success: true, status: 'connected' });
    expect(mocks.update.mock.calls[0][0]).toMatchObject({ connection_status: 'connected', last_error: null });
  });

  it('surfaces the License error and marks the connection in error', async () => {
    const { deps, mocks } = makeDeps({ fetch: mockFetch({ status: 401, body: '"License not found or inactive"' }) });
    const res = await handleTestConnection(makeRequest(), deps);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toMatchObject({ success: false, status: 'error' });
    expect(body.error).toMatch(/license/i);
    expect(mocks.update.mock.calls[0][0]).toMatchObject({ connection_status: 'error' });
    expect(mocks.update.mock.calls[0][0].last_error).toMatch(/license/i);
  });

  it('marks the connection in error on other datafeed failures', async () => {
    const { deps, mocks } = makeDeps({ fetch: mockFetch({ status: 500, body: 'boom' }) });
    const res = await handleTestConnection(makeRequest(), deps);
    expect(await res.json()).toMatchObject({ success: false, status: 'error' });
    expect(mocks.update.mock.calls[0][0]).toMatchObject({ connection_status: 'error' });
  });
});
