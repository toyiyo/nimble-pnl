/**
 * focusSaveConnectionHandler.test.ts
 *
 * Vitest unit tests for supabase/functions/_shared/focusSaveConnectionHandler.ts
 *
 * Coverage:
 *  - JWT + role check: 401 when no Authorization header
 *  - JWT + role check: 401 when getUser returns null (bad token)
 *  - JWT + role check: 400 when restaurantId or reportUrl missing from body
 *  - JWT + role check: 403 when user is not owner/manager
 *  - URL validation: 400 when reportUrl is invalid / non-myfocuspos.com / missing StoreID
 *  - URL validation: 400 when host fails assertAllowedHost (SSRF guard)
 *  - Happy path: 200 with parsed params upserted via service-role client
 *  - Happy path: upsert targets focus_connections via service-role client (not user client)
 *  - Upsert includes report_base_url, report_path, store_id, db_server, db_catalog, report_user_id
 *  - Supabase upsert error → 500
 *
 * Design ref: plan Task 7; spec §8 (_shared/focusSaveConnectionHandler.ts); review resolution S3
 * (service-role client for writes), S6 (JWT + role check).
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  handleSaveConnection,
  type SaveConnectionDeps,
} from '../../supabase/functions/_shared/focusSaveConnectionHandler';

// ── Fixtures ──────────────────────────────────────────────────────────────────

const RESTAURANT_ID = '00000000-0000-0000-0000-000000000042';
const USER_ID = 'user-uuid-1234';

/** A real-shaped Focus POS SSRS report URL (from live investigation 2026-06-27). */
const VALID_REPORT_URL =
  'https://mfprod-1.myfocuspos.com/ReportServer?/generalstorereports/revenuecenter' +
  '&dbServer=mfaz-rep-1&dbCatalog=KAHALA2&UserID=J.Delgado&StoreID=15312&rs:Command=render';

/** URL that fails the domain allowlist (not myfocuspos.com). */
const EVIL_URL =
  'https://evil.com/ReportServer?/generalstorereports/revenuecenter&StoreID=15312';

/** Non-https URL (rejected by parseFocusReportUrl). */
const HTTP_URL =
  'http://mfprod-1.myfocuspos.com/ReportServer?/generalstorereports/revenuecenter&StoreID=15312';

/** Valid myfocuspos URL but missing the required StoreID param. */
const NO_STORE_ID_URL =
  'https://mfprod-1.myfocuspos.com/ReportServer?/generalstorereports/revenuecenter&dbServer=mfaz-rep-1';

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
  const userRoleSingleMock = vi.fn().mockReturnValue(userRoleSelectMock());
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
  const onConflictMock = vi.fn().mockReturnValue({ select: selectMock });
  const upsertMock = vi.fn().mockReturnValue({ onConflict: onConflictMock });
  const fromMock = vi.fn().mockReturnValue({ upsert: upsertMock });

  return {
    client: { from: fromMock },
    mocks: { fromMock, upsertMock, onConflictMock, selectMock },
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
    body: JSON.stringify(opts.body ?? { restaurantId: RESTAURANT_ID, reportUrl: VALID_REPORT_URL }),
  });
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('handleSaveConnection', () => {
  // ── Missing Authorization header ─────────────────────────────────────────────

  it('returns 401 when Authorization header is missing', async () => {
    const { client: serviceClient } = makeServiceClientMock();
    const deps: SaveConnectionDeps = {
      userClient: makeUserClientMock({ user: null }) as any,
      serviceClient: serviceClient as any,
    };

    const req = makeRequest({ authHeader: null });
    const res = await handleSaveConnection(req, deps);

    expect(res.status).toBe(401);
    const body = await res.json();
    expect(body).toHaveProperty('error');
  });

  // ── Bad / expired JWT ────────────────────────────────────────────────────────

  it('returns 401 when getUser returns null user', async () => {
    const userClient = makeUserClientMock({ user: null });
    const { client: serviceClient } = makeServiceClientMock();
    const deps: SaveConnectionDeps = {
      userClient: userClient as any,
      serviceClient: serviceClient as any,
    };

    const req = makeRequest({});
    const res = await handleSaveConnection(req, deps);

    expect(res.status).toBe(401);
  });

  // ── Missing body fields ──────────────────────────────────────────────────────

  it('returns 400 when restaurantId is missing', async () => {
    const userClient = makeUserClientMock({});
    const { client: serviceClient } = makeServiceClientMock();
    const deps: SaveConnectionDeps = {
      userClient: userClient as any,
      serviceClient: serviceClient as any,
    };

    const req = makeRequest({ body: { reportUrl: VALID_REPORT_URL } });
    const res = await handleSaveConnection(req, deps);

    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toMatch(/restaurantId/i);
  });

  it('returns 400 when reportUrl is missing', async () => {
    const userClient = makeUserClientMock({});
    const { client: serviceClient } = makeServiceClientMock();
    const deps: SaveConnectionDeps = {
      userClient: userClient as any,
      serviceClient: serviceClient as any,
    };

    const req = makeRequest({ body: { restaurantId: RESTAURANT_ID } });
    const res = await handleSaveConnection(req, deps);

    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toMatch(/reportUrl/i);
  });

  // ── Non-owner / non-manager role ─────────────────────────────────────────────

  it('returns 403 when user role is "staff" (not owner/manager)', async () => {
    const userClient = makeUserClientMock({ role: 'staff' });
    const { client: serviceClient } = makeServiceClientMock();
    const deps: SaveConnectionDeps = {
      userClient: userClient as any,
      serviceClient: serviceClient as any,
    };

    const req = makeRequest({});
    const res = await handleSaveConnection(req, deps);

    expect(res.status).toBe(403);
    const body = await res.json();
    expect(body).toHaveProperty('error');
  });

  it('returns 403 when user has no membership for the restaurant', async () => {
    // user_restaurants returns null (no row)
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
    };

    const req = makeRequest({});
    const res = await handleSaveConnection(req, deps);

    expect(res.status).toBe(403);
  });

  // ── URL validation ───────────────────────────────────────────────────────────

  it('returns 400 when reportUrl is not a valid URL', async () => {
    const userClient = makeUserClientMock({ role: 'owner' });
    const { client: serviceClient } = makeServiceClientMock();
    const deps: SaveConnectionDeps = {
      userClient: userClient as any,
      serviceClient: serviceClient as any,
    };

    const req = makeRequest({ body: { restaurantId: RESTAURANT_ID, reportUrl: 'not-a-url' } });
    const res = await handleSaveConnection(req, deps);

    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toMatch(/invalid|url/i);
  });

  it('returns 400 when reportUrl host is not myfocuspos.com (SSRF guard)', async () => {
    const userClient = makeUserClientMock({ role: 'owner' });
    const { client: serviceClient } = makeServiceClientMock();
    const deps: SaveConnectionDeps = {
      userClient: userClient as any,
      serviceClient: serviceClient as any,
    };

    const req = makeRequest({ body: { restaurantId: RESTAURANT_ID, reportUrl: EVIL_URL } });
    const res = await handleSaveConnection(req, deps);

    expect(res.status).toBe(400);
  });

  it('returns 400 when reportUrl uses http:// instead of https://', async () => {
    const userClient = makeUserClientMock({ role: 'owner' });
    const { client: serviceClient } = makeServiceClientMock();
    const deps: SaveConnectionDeps = {
      userClient: userClient as any,
      serviceClient: serviceClient as any,
    };

    const req = makeRequest({ body: { restaurantId: RESTAURANT_ID, reportUrl: HTTP_URL } });
    const res = await handleSaveConnection(req, deps);

    expect(res.status).toBe(400);
  });

  it('returns 400 when StoreID is missing from the report URL', async () => {
    const userClient = makeUserClientMock({ role: 'owner' });
    const { client: serviceClient } = makeServiceClientMock();
    const deps: SaveConnectionDeps = {
      userClient: userClient as any,
      serviceClient: serviceClient as any,
    };

    const req = makeRequest({ body: { restaurantId: RESTAURANT_ID, reportUrl: NO_STORE_ID_URL } });
    const res = await handleSaveConnection(req, deps);

    expect(res.status).toBe(400);
  });

  // ── Happy path ───────────────────────────────────────────────────────────────

  describe('happy path (owner + valid URL)', () => {
    let serviceClientMocks: ReturnType<typeof makeServiceClientMock>['mocks'];
    let response: Response;

    beforeEach(async () => {
      const userClient = makeUserClientMock({ role: 'owner' });
      const { client: serviceClient, mocks } = makeServiceClientMock();
      serviceClientMocks = mocks;

      const deps: SaveConnectionDeps = {
        userClient: userClient as any,
        serviceClient: serviceClient as any,
      };

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

    it('upserts report_base_url', () => {
      const payload = serviceClientMocks.upsertMock.mock.calls[0][0] as Record<string, unknown>;
      expect(payload).toHaveProperty('report_base_url', 'https://mfprod-1.myfocuspos.com');
    });

    it('upserts report_path with catalog segment', () => {
      const payload = serviceClientMocks.upsertMock.mock.calls[0][0] as Record<string, unknown>;
      expect(payload).toHaveProperty('report_path');
      expect(String(payload.report_path)).toContain('/ReportServer');
    });

    it('upserts store_id parsed from the URL', () => {
      const payload = serviceClientMocks.upsertMock.mock.calls[0][0] as Record<string, unknown>;
      expect(payload).toHaveProperty('store_id', '15312');
    });

    it('upserts db_server parsed from the URL', () => {
      const payload = serviceClientMocks.upsertMock.mock.calls[0][0] as Record<string, unknown>;
      expect(payload).toHaveProperty('db_server', 'mfaz-rep-1');
    });

    it('upserts db_catalog parsed from the URL', () => {
      const payload = serviceClientMocks.upsertMock.mock.calls[0][0] as Record<string, unknown>;
      expect(payload).toHaveProperty('db_catalog', 'KAHALA2');
    });

    it('upserts report_user_id parsed from the URL', () => {
      const payload = serviceClientMocks.upsertMock.mock.calls[0][0] as Record<string, unknown>;
      expect(payload).toHaveProperty('report_user_id', 'J.Delgado');
    });

    it('upserts restaurant_id from the request body', () => {
      const payload = serviceClientMocks.upsertMock.mock.calls[0][0] as Record<string, unknown>;
      expect(payload).toHaveProperty('restaurant_id', RESTAURANT_ID);
    });

    it('sets connection_status to "pending" on new save', () => {
      const payload = serviceClientMocks.upsertMock.mock.calls[0][0] as Record<string, unknown>;
      expect(payload).toHaveProperty('connection_status', 'pending');
    });

    it('uses onConflict("restaurant_id") for upsert', () => {
      const conflictArg = serviceClientMocks.onConflictMock.mock.calls[0][0] as string;
      expect(conflictArg).toBe('restaurant_id');
    });
  });

  // ── Manager role also succeeds ────────────────────────────────────────────────

  it('returns 200 when user role is "manager"', async () => {
    const userClient = makeUserClientMock({ role: 'manager' });
    const { client: serviceClient } = makeServiceClientMock();
    const deps: SaveConnectionDeps = {
      userClient: userClient as any,
      serviceClient: serviceClient as any,
    };

    const req = makeRequest({});
    const res = await handleSaveConnection(req, deps);

    expect(res.status).toBe(200);
  });

  // ── Supabase upsert error ────────────────────────────────────────────────────

  it('returns 500 when the service-role upsert fails', async () => {
    const userClient = makeUserClientMock({ role: 'owner' });
    const { client: serviceClient } = makeServiceClientMock({ error: 'unique constraint violated' });
    const deps: SaveConnectionDeps = {
      userClient: userClient as any,
      serviceClient: serviceClient as any,
    };

    const req = makeRequest({});
    const res = await handleSaveConnection(req, deps);

    expect(res.status).toBe(500);
    const body = await res.json();
    expect(body).toHaveProperty('error');
  });
});
