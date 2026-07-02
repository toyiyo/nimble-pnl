/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * focusSaveConnectionHandler.test.ts
 *
 * Vitest unit tests for the FocusLink (Shift4 API) save-connection handler.
 *
 * The handler no longer logs into the portal — it simply validates the caller,
 * encrypts the API secret, and upserts the per-connection credentials
 * (api_key, api_secret_encrypted, store_id, mid, environment). Credential
 * VALIDATION is the job of focus-test-connection (one datafeed call).
 */

import { describe, it, expect, vi } from 'vitest';
import {
  handleSaveConnection,
  type SaveConnectionDeps,
} from '../../supabase/functions/_shared/focusSaveConnectionHandler';

vi.mock('../../supabase/functions/_shared/encryption', () => ({
  getEncryptionService: vi.fn().mockResolvedValue({
    encrypt: vi.fn().mockResolvedValue('encrypted-secret'),
    decrypt: vi.fn().mockResolvedValue('plain-secret'),
  }),
}));

// ── Fixtures ──────────────────────────────────────────────────────────────────

const RESTAURANT_ID = '00000000-0000-0000-0000-000000000042';
const USER_ID = 'user-uuid-1234';
const VALID_BODY = {
  restaurantId: RESTAURANT_ID,
  apiKey: 'license-key',
  apiSecret: 'license-secret',
  restaurantGuid: '24329abc-0000-0000-0000-000000000001',
  mid: '0023042280',
  environment: 'production',
};

// ── Mock builders ─────────────────────────────────────────────────────────────

function makeUserClientMock(opts: { user?: { id: string } | null; role?: string }) {
  const user = opts.user !== undefined ? opts.user : { id: USER_ID };
  const role = opts.role ?? 'owner';
  const single = vi.fn().mockResolvedValue({ data: user && role ? { role } : null, error: null });
  const eqRest = vi.fn().mockReturnValue({ single });
  const eqUser = vi.fn().mockReturnValue({ eq: eqRest });
  const select = vi.fn().mockReturnValue({ eq: eqUser });
  return {
    auth: { getUser: vi.fn().mockResolvedValue({ data: { user } }) },
    from: vi.fn().mockReturnValue({ select }),
  };
}

function makeServiceClientMock(opts: { error?: string } = {}) {
  const selectMock = vi.fn().mockResolvedValue({
    data: opts.error ? null : [{ id: 'conn-uuid' }],
    error: opts.error ? { message: opts.error } : null,
  });
  const upsertMock = vi.fn().mockReturnValue({ select: selectMock });
  const fromMock = vi.fn().mockReturnValue({ upsert: upsertMock });
  return { client: { from: fromMock }, mocks: { fromMock, upsertMock, selectMock } };
}

function makeRequest(opts: { authHeader?: string | null; body?: Record<string, unknown> }): Request {
  const headers = new Headers();
  if (opts.authHeader !== null) headers.set('Authorization', opts.authHeader ?? 'Bearer fake-jwt');
  return new Request('https://example.com/functions/v1/focus-save-connection', {
    method: 'POST',
    headers,
    body: JSON.stringify(opts.body ?? VALID_BODY),
  });
}

function makeDeps(opts: {
  userClientOpts?: Parameters<typeof makeUserClientMock>[0];
  serviceClientOpts?: Parameters<typeof makeServiceClientMock>[0];
} = {}): { deps: SaveConnectionDeps; mocks: ReturnType<typeof makeServiceClientMock>['mocks'] } {
  const userClient = makeUserClientMock(opts.userClientOpts ?? {});
  const { client: serviceClient, mocks } = makeServiceClientMock(opts.serviceClientOpts ?? {});
  return { deps: { userClient: userClient as any, serviceClient: serviceClient as any }, mocks };
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('handleSaveConnection (FocusLink API)', () => {
  it('returns 401 when the Authorization header is missing', async () => {
    const { deps } = makeDeps();
    const res = await handleSaveConnection(makeRequest({ authHeader: null }), deps);
    expect(res.status).toBe(401);
  });

  it('returns 401 when getUser returns no user', async () => {
    const { deps } = makeDeps({ userClientOpts: { user: null } });
    const res = await handleSaveConnection(makeRequest({}), deps);
    expect(res.status).toBe(401);
  });

  it.each(['restaurantId', 'apiKey', 'apiSecret', 'restaurantGuid'])(
    'returns 400 when %s is missing',
    async (field) => {
      const body: Record<string, unknown> = { ...VALID_BODY };
      delete body[field];
      const { deps } = makeDeps();
      const res = await handleSaveConnection(makeRequest({ body }), deps);
      expect(res.status).toBe(400);
    },
  );

  it('returns 400 when environment is not sandbox|production', async () => {
    const { deps } = makeDeps();
    const res = await handleSaveConnection(makeRequest({ body: { ...VALID_BODY, environment: 'staging' } }), deps);
    expect(res.status).toBe(400);
  });

  it('returns 403 when the caller is not owner/manager', async () => {
    const { deps } = makeDeps({ userClientOpts: { role: 'staff' } });
    const res = await handleSaveConnection(makeRequest({}), deps);
    expect(res.status).toBe(403);
  });

  it('upserts encrypted API credentials and returns 200', async () => {
    const { deps, mocks } = makeDeps();
    const res = await handleSaveConnection(makeRequest({}), deps);

    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ success: true });

    expect(mocks.fromMock).toHaveBeenCalledWith('focus_connections');
    const [payload, options] = mocks.upsertMock.mock.calls[0];
    expect(options).toEqual({ onConflict: 'restaurant_id' });
    expect(payload).toMatchObject({
      restaurant_id: RESTAURANT_ID,
      api_key: 'license-key',
      api_secret_encrypted: 'encrypted-secret', // never the plaintext secret
      store_id: '24329abc-0000-0000-0000-000000000001',
      mid: '0023042280',
      environment: 'production',
      connection_status: 'pending',
      is_active: true,
    });
    expect(payload).not.toHaveProperty('apiSecret');
    expect(JSON.stringify(payload)).not.toContain('license-secret');
  });

  it('defaults environment to production when omitted', async () => {
    const body = { ...VALID_BODY };
    delete (body as Record<string, unknown>).environment;
    const { deps, mocks } = makeDeps();
    const res = await handleSaveConnection(makeRequest({ body }), deps);
    expect(res.status).toBe(200);
    expect(mocks.upsertMock.mock.calls[0][0]).toMatchObject({ environment: 'production' });
  });

  it('resets sync state on save so a reconnect re-backfills', async () => {
    const { deps, mocks } = makeDeps();
    await handleSaveConnection(makeRequest({}), deps);
    expect(mocks.upsertMock.mock.calls[0][0]).toMatchObject({
      sync_cursor: 0,
      initial_sync_done: false,
      last_sync_time: null,
    });
  });

  it('returns 500 when the upsert fails', async () => {
    const { deps } = makeDeps({ serviceClientOpts: { error: 'unique constraint violated' } });
    const res = await handleSaveConnection(makeRequest({}), deps);
    expect(res.status).toBe(500);
  });
});
