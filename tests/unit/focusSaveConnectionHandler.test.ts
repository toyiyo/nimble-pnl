/**
 * focusSaveConnectionHandler.test.ts
 *
 * Vitest unit tests for supabase/functions/_shared/focusSaveConnectionHandler.ts
 *
 * Coverage:
 *  - JWT + role check: 401 when no Authorization header
 *  - JWT + role check: 401 when getUser returns null (bad token)
 *  - Body validation: 400 when restaurantId, username, password, or storeId missing
 *  - Role check: 403 when user is not owner/manager
 *  - Portal auth: 401 when loginToPortal throws FocusAuthError
 *  - Discovery error: saves with connection_status='error' when discoverReportRouting throws
 *  - Happy path: 200 with credentials upserted via service-role client
 *  - Happy path: upserts username, password_encrypted, store_id, report_base_url, report_path
 *  - Happy path: connection_status='pending' when discovery succeeds
 *  - Supabase upsert error → 500
 *
 * Design ref: plan Task 7; spec §8 (_shared/focusSaveConnectionHandler.ts)
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  handleSaveConnection,
  type SaveConnectionDeps,
} from '../../supabase/functions/_shared/focusSaveConnectionHandler';

// ── Mock portal client & encryption ──────────────────────────────────────────

vi.mock('../../supabase/functions/_shared/focusPortalClient', () => ({
  loginToPortal: vi.fn().mockResolvedValue({ cookie: 'session-cookie' }),
  discoverReportRouting: vi.fn().mockResolvedValue({
    baseUrl: 'https://mfprod-1.myfocuspos.com',
    reportPath: '/ReportServer?/generalstorereports/revenuecenter',
    dbServer: 'mfaz-rep-1',
    dbCatalog: 'KAHALA2',
  }),
  FocusAuthError: class FocusAuthError extends Error {
    constructor(m = '') { super(m); this.name = 'FocusAuthError'; }
  },
  FocusDiscoveryError: class FocusDiscoveryError extends Error {
    constructor(m = '') { super(m); this.name = 'FocusDiscoveryError'; }
  },
}));

vi.mock('../../supabase/functions/_shared/encryption', () => ({
  getEncryptionService: vi.fn().mockResolvedValue({
    encrypt: vi.fn().mockResolvedValue('encrypted-pw'),
    decrypt: vi.fn().mockResolvedValue('test-pass'),
  }),
}));

// ── Fixtures ──────────────────────────────────────────────────────────────────

const RESTAURANT_ID = '00000000-0000-0000-0000-000000000042';
const USER_ID = 'user-uuid-1234';
const USERNAME = 'sample.user';
const PASSWORD = 'test-pass';
const STORE_ID = '15312';

// ── Mock builders ─────────────────────────────────────────────────────────────

function makeUserClientMock(opts: {
  user?: { id: string } | null;
  role?: string;
}) {
  const user = opts.user !== undefined ? opts.user : { id: USER_ID };
  const role = opts.role ?? 'owner';

  const getUserMock = vi.fn().mockResolvedValue({ data: { user } });
  const userRoleSelectMock = vi.fn().mockResolvedValue({
    data: user && role ? { role } : null,
    error: null,
  });
  const userRoleEqRestMock = vi.fn().mockReturnValue({ single: () => userRoleSelectMock() });
  const userRoleEqUserMock = vi.fn().mockReturnValue({ eq: userRoleEqRestMock });
  const userRoleSelectFieldMock = vi.fn().mockReturnValue({ eq: userRoleEqUserMock });
  const userRoleFromMock = vi.fn().mockReturnValue({ select: userRoleSelectFieldMock });

  return {
    auth: { getUser: getUserMock },
    from: userRoleFromMock,
  };
}

function makeServiceClientMock(opts: { error?: string } = {}) {
  const selectMock = vi.fn().mockResolvedValue({
    data: opts.error ? null : [{ id: 'conn-uuid' }],
    error: opts.error ? { message: opts.error } : null,
  });
  const upsertMock = vi.fn().mockReturnValue({ select: selectMock });
  const fromMock = vi.fn().mockReturnValue({ upsert: upsertMock });

  return {
    client: { from: fromMock },
    mocks: { fromMock, upsertMock, selectMock },
  };
}

/** Build a minimal Request-like object the handler can consume. */
function makeRequest(opts: {
  authHeader?: string | null;
  body?: Record<string, unknown>;
}): Request {
  const headers = new Headers();
  if (opts.authHeader !== null) {
    headers.set('Authorization', opts.authHeader ?? 'Bearer fake-jwt-token');
  }
  return new Request('https://example.com/functions/v1/focus-save-connection', {
    method: 'POST',
    headers,
    body: JSON.stringify(
      opts.body ?? {
        restaurantId: RESTAURANT_ID,
        username: USERNAME,
        password: PASSWORD,
        storeId: STORE_ID,
      },
    ),
  });
}

/** Build default deps with injectable login/discover overrides. */
function makeDeps(opts: {
  userClientOpts?: Parameters<typeof makeUserClientMock>[0];
  serviceClientOpts?: Parameters<typeof makeServiceClientMock>[0];
  loginOverride?: SaveConnectionDeps['login'];
  discoverOverride?: SaveConnectionDeps['discover'];
} = {}): { deps: SaveConnectionDeps; mocks: ReturnType<typeof makeServiceClientMock>['mocks'] } {
  const userClient = makeUserClientMock(opts.userClientOpts ?? {});
  const { client: serviceClient, mocks } = makeServiceClientMock(opts.serviceClientOpts ?? {});

  return {
    deps: {
      userClient: userClient as any,
      serviceClient: serviceClient as any,
      fetch: vi.fn() as any,
      ...(opts.loginOverride !== undefined && { login: opts.loginOverride }),
      ...(opts.discoverOverride !== undefined && { discover: opts.discoverOverride }),
    },
    mocks,
  };
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('handleSaveConnection', () => {
  // ── Missing Authorization header ─────────────────────────────────────────────

  it('returns 401 when Authorization header is missing', async () => {
    const { deps } = makeDeps({ userClientOpts: { user: null } });

    const req = makeRequest({ authHeader: null });
    const res = await handleSaveConnection(req, deps);

    expect(res.status).toBe(401);
    const body = await res.json();
    expect(body).toHaveProperty('error');
  });

  // ── Bad / expired JWT ────────────────────────────────────────────────────────

  it('returns 401 when getUser returns null user', async () => {
    const { deps } = makeDeps({ userClientOpts: { user: null } });

    const req = makeRequest({});
    const res = await handleSaveConnection(req, deps);

    expect(res.status).toBe(401);
  });

  // ── Missing body fields ──────────────────────────────────────────────────────

  it('returns 400 when restaurantId is missing', async () => {
    const { deps } = makeDeps();

    const req = makeRequest({ body: { username: USERNAME, password: PASSWORD, storeId: STORE_ID } });
    const res = await handleSaveConnection(req, deps);

    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toMatch(/restaurantId/i);
  });

  it('returns 400 when username is missing', async () => {
    const { deps } = makeDeps();

    const req = makeRequest({ body: { restaurantId: RESTAURANT_ID, password: PASSWORD, storeId: STORE_ID } });
    const res = await handleSaveConnection(req, deps);

    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toMatch(/username/i);
  });

  it('returns 400 when password is missing', async () => {
    const { deps } = makeDeps();

    const req = makeRequest({ body: { restaurantId: RESTAURANT_ID, username: USERNAME, storeId: STORE_ID } });
    const res = await handleSaveConnection(req, deps);

    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toMatch(/password/i);
  });

  it('returns 400 when storeId is missing', async () => {
    const { deps } = makeDeps();

    const req = makeRequest({ body: { restaurantId: RESTAURANT_ID, username: USERNAME, password: PASSWORD } });
    const res = await handleSaveConnection(req, deps);

    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toMatch(/storeId/i);
  });

  // ── Non-owner / non-manager role ─────────────────────────────────────────────

  it('returns 403 when user role is "staff" (not owner/manager)', async () => {
    const { deps } = makeDeps({ userClientOpts: { role: 'staff' } });

    const req = makeRequest({});
    const res = await handleSaveConnection(req, deps);

    expect(res.status).toBe(403);
    const body = await res.json();
    expect(body).toHaveProperty('error');
  });

  it('returns 403 when user has no membership for the restaurant', async () => {
    const userClient = {
      auth: {
        getUser: vi.fn().mockResolvedValue({ data: { user: { id: USER_ID } } }),
      },
      from: vi.fn().mockReturnValue({
        select: vi.fn().mockReturnValue({
          eq: vi.fn().mockReturnValue({
            eq: vi.fn().mockReturnValue({
              single: vi.fn().mockResolvedValue({ data: null, error: null }),
            }),
          }),
        }),
      }),
    };
    const { client: serviceClient } = makeServiceClientMock();
    const deps: SaveConnectionDeps = {
      userClient: userClient as any,
      serviceClient: serviceClient as any,
      fetch: vi.fn() as any,
    };

    const req = makeRequest({});
    const res = await handleSaveConnection(req, deps);

    expect(res.status).toBe(403);
  });

  // ── Focus portal auth failure ─────────────────────────────────────────────────

  it('returns 401 when loginToPortal throws FocusAuthError', async () => {
    const { FocusAuthError: FocusAuthErrorClass } = await import(
      '../../supabase/functions/_shared/focusPortalClient'
    );
    const { deps } = makeDeps({
      loginOverride: vi.fn().mockRejectedValue(new FocusAuthErrorClass('bad creds')),
    });

    const req = makeRequest({});
    const res = await handleSaveConnection(req, deps);

    expect(res.status).toBe(401);
    const body = await res.json();
    expect(body.error).toMatch(/invalid focus credentials/i);
  });

  // ── Discovery error — saves with status='error' ───────────────────────────────

  it('saves with connection_status="error" when discoverReportRouting throws FocusDiscoveryError', async () => {
    const { FocusDiscoveryError: FocusDiscoveryErrorClass } = await import(
      '../../supabase/functions/_shared/focusPortalClient'
    );
    const { deps, mocks } = makeDeps({
      discoverOverride: vi.fn().mockRejectedValue(new FocusDiscoveryErrorClass('not found')),
    });

    const req = makeRequest({});
    const res = await handleSaveConnection(req, deps);

    // Still 200 — the connection was partially saved
    expect(res.status).toBe(200);

    // Upsert payload should have connection_status='error'
    const payload = mocks.upsertMock.mock.calls[0][0] as Record<string, unknown>;
    expect(payload).toHaveProperty('connection_status', 'error');
    // report_base_url and report_path should be null since discovery failed
    expect(payload.report_base_url).toBeNull();
    expect(payload.report_path).toBeNull();
  });

  // ── Happy path ───────────────────────────────────────────────────────────────

  describe('happy path (owner + valid credentials)', () => {
    let serviceClientMocks: ReturnType<typeof makeServiceClientMock>['mocks'];
    let response: Response;

    beforeEach(async () => {
      const { deps, mocks } = makeDeps();
      serviceClientMocks = mocks;

      const req = makeRequest({});
      response = await handleSaveConnection(req, deps);
    });

    it('returns 200', () => {
      expect(response.status).toBe(200);
    });

    it('responds with { success: true }', async () => {
      const body = await response.json();
      expect(body).toMatchObject({ success: true });
    });

    it('calls from("focus_connections") on the service-role client', () => {
      expect(serviceClientMocks.fromMock).toHaveBeenCalledWith('focus_connections');
    });

    it('upserts username', () => {
      const payload = serviceClientMocks.upsertMock.mock.calls[0][0] as Record<string, unknown>;
      expect(payload).toHaveProperty('username', USERNAME);
    });

    it('upserts password_encrypted', () => {
      const payload = serviceClientMocks.upsertMock.mock.calls[0][0] as Record<string, unknown>;
      expect(payload).toHaveProperty('password_encrypted', 'encrypted-pw');
    });

    it('upserts store_id from the request body', () => {
      const payload = serviceClientMocks.upsertMock.mock.calls[0][0] as Record<string, unknown>;
      expect(payload).toHaveProperty('store_id', STORE_ID);
    });

    it('upserts report_base_url from discovery result', () => {
      const payload = serviceClientMocks.upsertMock.mock.calls[0][0] as Record<string, unknown>;
      expect(payload).toHaveProperty('report_base_url', 'https://mfprod-1.myfocuspos.com');
    });

    it('upserts report_path from discovery result', () => {
      const payload = serviceClientMocks.upsertMock.mock.calls[0][0] as Record<string, unknown>;
      expect(payload).toHaveProperty('report_path');
      expect(String(payload.report_path)).toContain('/ReportServer');
    });

    it('upserts restaurant_id from the request body', () => {
      const payload = serviceClientMocks.upsertMock.mock.calls[0][0] as Record<string, unknown>;
      expect(payload).toHaveProperty('restaurant_id', RESTAURANT_ID);
    });

    it('sets connection_status to "pending" on successful discovery', () => {
      const payload = serviceClientMocks.upsertMock.mock.calls[0][0] as Record<string, unknown>;
      expect(payload).toHaveProperty('connection_status', 'pending');
    });

    it('passes onConflict("restaurant_id") option to upsert', () => {
      const upsertOptions = serviceClientMocks.upsertMock.mock.calls[0][1] as Record<string, string>;
      expect(upsertOptions?.onConflict).toBe('restaurant_id');
    });

    it('resets sync_cursor to 0 so a re-connected store triggers a full backfill', () => {
      const payload = serviceClientMocks.upsertMock.mock.calls[0][0] as Record<string, unknown>;
      expect(payload).toHaveProperty('sync_cursor', 0);
    });

    it('resets initial_sync_done to false on every save', () => {
      const payload = serviceClientMocks.upsertMock.mock.calls[0][0] as Record<string, unknown>;
      expect(payload).toHaveProperty('initial_sync_done', false);
    });

    it('resets last_sync_time to null on every save', () => {
      const payload = serviceClientMocks.upsertMock.mock.calls[0][0] as Record<string, unknown>;
      expect(payload).toHaveProperty('last_sync_time', null);
    });
  });

  // ── Manager role also succeeds ────────────────────────────────────────────────

  it('returns 200 when user role is "manager"', async () => {
    const { deps } = makeDeps({ userClientOpts: { role: 'manager' } });

    const req = makeRequest({});
    const res = await handleSaveConnection(req, deps);

    expect(res.status).toBe(200);
  });

  // ── Supabase upsert error ────────────────────────────────────────────────────

  it('returns 500 when the service-role upsert fails', async () => {
    const { deps } = makeDeps({ serviceClientOpts: { error: 'unique constraint violated' } });

    const req = makeRequest({});
    const res = await handleSaveConnection(req, deps);

    expect(res.status).toBe(500);
    const body = await res.json();
    expect(body).toHaveProperty('error');
  });
});
