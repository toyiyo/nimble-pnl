/**
 * focusTestConnectionHandler.test.ts
 *
 * Vitest unit tests for supabase/functions/_shared/focusTestConnectionHandler.ts
 *
 * Coverage:
 *  - JWT + role check: 401 when Authorization header missing
 *  - JWT + role check: 401 when getUser() returns null
 *  - Body validation: 400 when restaurantId missing
 *  - Role check: 403 when user is not owner/manager
 *  - Connection lookup: 404 when no active focus_connections row
 *  - Happy path (ok:true): sets connection_status='connected', clears last_error, returns 200
 *  - Happy path (reason:'empty'): also sets 'connected' (new/closed store, no sales)
 *  - Failure path (parse_error): sets connection_status='error', stores last_error, returns 200
 *  - Failure path (HTTP error from fetch): sets connection_status='error', returns 200
 *  - Uses service-role client for the status write (review S3)
 *  - Fetches yesterday's report in the connection's timezone (review S4)
 *  - "Yesterday" is computed in the connection's IANA timezone via Intl.DateTimeFormat
 *  - Staff role → 403
 *
 * Design ref: plan Task 8; spec §8 (focus-test-connection); review S3 (service-role write),
 *   S4 (business-date timezone), S6 (JWT + role), S9 (parse_error vs empty → connected).
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  handleTestConnection,
  type TestConnectionDeps,
} from '../../supabase/functions/_shared/focusTestConnectionHandler';

// ── Mock portal client & encryption ──────────────────────────────────────────

vi.mock('../../supabase/functions/_shared/focusPortalClient', () => ({
  loginToPortal: vi.fn().mockResolvedValue({ cookie: 'session-cookie' }),
  FocusAuthError: class FocusAuthError extends Error {
    constructor(m = '') { super(m); this.name = 'FocusAuthError'; }
  },
}));

vi.mock('../../supabase/functions/_shared/encryption', () => ({
  getEncryptionService: vi.fn().mockResolvedValue({
    encrypt: vi.fn().mockResolvedValue('encrypted-pw'),
    decrypt: vi.fn().mockResolvedValue('test-pass'),
  }),
}));

// ── Fixtures ──────────────────────────────────────────────────────────────────

const RESTAURANT_ID = '00000000-0000-0000-0000-000000000099';
const USER_ID = 'user-uuid-test';

/** Minimal valid Revenue Center HTML that the real parser can successfully parse */
const VALID_HTML = `<html><body><table>
<tr><td>Revenue Center</td><td>Units</td><td>Sales</td></tr>
<tr><td>Dine-In</td><td></td><td></td></tr>
<tr><td>Scoop Single</td><td>10</td><td>$29.90</td></tr>
<tr><td>Net Sales</td><td></td><td>$29.90</td></tr>
<tr><td>Inclusive Tax</td><td></td><td>$2.39</td></tr>
<tr><td>Subtotal Discounts</td><td></td><td>$0.00</td></tr>
<tr><td>Retained Tips</td><td></td><td>$3.00</td></tr>
<tr><td>Refunds</td><td></td><td>$0.00</td></tr>
<tr><td>Total Sales</td><td></td><td>$32.29</td></tr>
<tr><td>Payments By Tender</td><td></td><td></td></tr>
<tr><td>Cash</td><td></td><td>$32.29</td></tr>
<tr><td>Sales By Order Type</td><td></td><td></td></tr>
<tr><td>Eat In</td><td></td><td>$32.29</td></tr>
</table></body></html>`;

/** HTML that has no recognizable report structure (parse_error) */
const GARBAGE_HTML = '<html><body><p>Nothing to see here</p></body></html>';

/** Fake focus_connections DB row returned by the service client. */
const MOCK_CONNECTION = {
  id: 'conn-uuid-1',
  restaurant_id: RESTAURANT_ID,
  report_base_url: 'https://mfprod-1.myfocuspos.com',
  report_path: '/ReportServer?/generalstorereports/revenuecenter',
  db_server: 'mfaz-rep-1',
  db_catalog: 'KAHALA2',
  report_user_id: 'sample.user',
  store_id: '99999',
  revenue_center: '',
  timezone: 'America/Chicago',
  username: 'sample.user',
  password_encrypted: 'enc',
};

// ── Mock builders ─────────────────────────────────────────────────────────────

/**
 * Build a minimal user-client mock (JWT validation + role check).
 */
function makeUserClientMock(opts: {
  user?: { id: string } | null;
  role?: string | null;
}) {
  const user = opts.user !== undefined ? opts.user : { id: USER_ID };
  const role = opts.role !== undefined ? opts.role : 'owner';

  const getUserMock = vi.fn().mockResolvedValue({ data: { user } });

  // Chain: .from().select().eq().eq().single()
  const singleMock = vi.fn().mockResolvedValue({
    data: user && role ? { role } : null,
    error: null,
  });
  const eq2Mock = vi.fn().mockReturnValue({ single: singleMock });
  const eq1Mock = vi.fn().mockReturnValue({ eq: eq2Mock });
  const selectMock = vi.fn().mockReturnValue({ eq: eq1Mock });
  const fromMock = vi.fn().mockReturnValue({ select: selectMock });

  return {
    auth: { getUser: getUserMock },
    from: fromMock,
  };
}

/**
 * Build a service-client mock that handles both:
 *  - Reading focus_connections (SELECT ... .single())
 *  - Writing connection_status (UPDATE ... .eq())
 */
function makeServiceClientMock(opts: {
  connection?: typeof MOCK_CONNECTION | null;
  connectionError?: string;
  updateError?: string;
} = {}) {
  const conn = opts.connection !== undefined ? opts.connection : MOCK_CONNECTION;

  // Track update calls
  const eqUpdateMock = vi.fn().mockResolvedValue({
    data: null,
    error: opts.updateError ? { message: opts.updateError } : null,
  });
  const updateMock = vi.fn().mockReturnValue({ eq: eqUpdateMock });

  // Track SELECT calls for focus_connections
  const singleMock = vi.fn().mockResolvedValue({
    data: conn,
    error: opts.connectionError ? { message: opts.connectionError } : null,
  });
  const isActiveMock = vi.fn().mockReturnValue({ single: singleMock });
  const eq1Mock = vi.fn().mockReturnValue({ eq: isActiveMock });
  const selectMock = vi.fn().mockReturnValue({ eq: eq1Mock });

  const fromMock = vi.fn().mockImplementation((table: string) => {
    if (table === 'focus_connections') {
      return {
        select: selectMock,
        update: updateMock,
      };
    }
    // Fallback
    return { select: selectMock, update: updateMock };
  });

  return {
    client: { from: fromMock },
    mocks: { fromMock, selectMock, updateMock, eqUpdateMock, singleMock },
  };
}

/**
 * Build a fetch mock that returns the given HTML (simulating a direct 200 response).
 */
function makeFetchMock(html: string) {
  return vi.fn().mockResolvedValue({
    status: 200,
    headers: { get: () => null },
    text: () => Promise.resolve(html),
  });
}

/**
 * Build a fetch mock that returns an HTTP error status.
 */
function makeFetchErrorMock(status: number) {
  return vi.fn().mockResolvedValue({
    status,
    headers: { get: () => null },
    text: () => Promise.resolve(''),
  });
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
  return new Request('https://example.com/functions/v1/focus-test-connection', {
    method: 'POST',
    headers,
    body: JSON.stringify(opts.body ?? { restaurantId: RESTAURANT_ID }),
  });
}

/** Build a full deps object for the handler. */
function makeDeps(opts: {
  userClientOpts?: Parameters<typeof makeUserClientMock>[0];
  serviceClientOpts?: Parameters<typeof makeServiceClientMock>[0];
  fetchHtml?: string;
  fetchStatus?: number;
  now?: Date;
}): { deps: TestConnectionDeps; mocks: ReturnType<typeof makeServiceClientMock>['mocks'] } {
  const userClient = makeUserClientMock(opts.userClientOpts ?? {});
  const { client: serviceClient, mocks } = makeServiceClientMock(opts.serviceClientOpts ?? {});

  const fetchFn =
    opts.fetchStatus !== undefined
      ? makeFetchErrorMock(opts.fetchStatus)
      : makeFetchMock(opts.fetchHtml ?? VALID_HTML);

  return {
    deps: {
      userClient: userClient as any,
      serviceClient: serviceClient as any,
      fetch: fetchFn,
      now: opts.now ?? new Date('2026-06-27T14:00:00.000Z'),
    },
    mocks,
  };
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('handleTestConnection', () => {
  // ── Auth header missing ──────────────────────────────────────────────────────

  it('returns 401 when Authorization header is missing', async () => {
    const { deps } = makeDeps({});
    const req = makeRequest({ authHeader: null });
    const res = await handleTestConnection(req, deps);

    expect(res.status).toBe(401);
    const body = await res.json();
    expect(body).toHaveProperty('error');
  });

  // ── Bad JWT ──────────────────────────────────────────────────────────────────

  it('returns 401 when getUser() returns null user', async () => {
    const { deps } = makeDeps({ userClientOpts: { user: null } });
    const req = makeRequest({});
    const res = await handleTestConnection(req, deps);

    expect(res.status).toBe(401);
  });

  // ── Missing restaurantId ─────────────────────────────────────────────────────

  it('returns 400 when restaurantId is missing from the body', async () => {
    const { deps } = makeDeps({});
    const req = makeRequest({ body: {} });
    const res = await handleTestConnection(req, deps);

    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toMatch(/restaurantId/i);
  });

  // ── Role check ───────────────────────────────────────────────────────────────

  it('returns 403 when user role is "staff"', async () => {
    const { deps } = makeDeps({ userClientOpts: { role: 'staff' } });
    const req = makeRequest({});
    const res = await handleTestConnection(req, deps);

    expect(res.status).toBe(403);
  });

  it('returns 403 when user has no membership for the restaurant', async () => {
    const { deps } = makeDeps({ userClientOpts: { role: null } });
    const req = makeRequest({});
    const res = await handleTestConnection(req, deps);

    expect(res.status).toBe(403);
  });

  // ── No active connection ─────────────────────────────────────────────────────

  it('returns 404 when no active focus_connections row exists', async () => {
    const { deps } = makeDeps({ serviceClientOpts: { connection: null } });
    const req = makeRequest({});
    const res = await handleTestConnection(req, deps);

    expect(res.status).toBe(404);
    const body = await res.json();
    expect(body).toHaveProperty('error');
  });

  // ── Auth gate: FocusAuthError → connection_status='error' ────────────────────

  it('sets connection_status="error" and returns 200 {success:false} when loginToPortal throws FocusAuthError', async () => {
    const { loginToPortal: mockLoginToPortal } = await import(
      '../../supabase/functions/_shared/focusPortalClient'
    );
    const { FocusAuthError: FocusAuthErrorClass } = await import(
      '../../supabase/functions/_shared/focusPortalClient'
    );
    (mockLoginToPortal as ReturnType<typeof vi.fn>).mockRejectedValueOnce(
      new FocusAuthErrorClass('bad creds'),
    );

    const { deps, mocks } = makeDeps({});
    const req = makeRequest({});
    const res = await handleTestConnection(req, deps);

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toMatchObject({ success: false, status: 'error' });

    // Should have updated connection_status in DB
    const updateArg = mocks.updateMock.mock.calls[0][0] as Record<string, unknown>;
    expect(updateArg).toMatchObject({
      connection_status: 'error',
      last_error: 'Invalid Focus credentials',
    });
  });

  // ── Happy path: successful parse ─────────────────────────────────────────────

  describe('happy path (ok:true from parser)', () => {
    let response: Response;
    let mocks: ReturnType<typeof makeServiceClientMock>['mocks'];

    beforeEach(async () => {
      const result = makeDeps({ fetchHtml: VALID_HTML });
      mocks = result.mocks;
      const req = makeRequest({});
      response = await handleTestConnection(req, result.deps);
    });

    it('returns 200', () => {
      expect(response.status).toBe(200);
    });

    it('responds with { success: true, status: "connected" }', async () => {
      const body = await response.json();
      expect(body).toMatchObject({ success: true, status: 'connected' });
    });

    it('writes connection_status="connected" to focus_connections via service client', () => {
      expect(mocks.fromMock).toHaveBeenCalledWith('focus_connections');
      const updateArg = mocks.updateMock.mock.calls[0][0] as Record<string, unknown>;
      expect(updateArg).toMatchObject({
        connection_status: 'connected',
        last_error: null,
        last_error_at: null,
      });
    });

    it('filters the update by connection id', () => {
      const idArg = mocks.eqUpdateMock.mock.calls[0];
      expect(idArg[0]).toBe('id');
      expect(idArg[1]).toBe(MOCK_CONNECTION.id);
    });
  });

  // ── Happy path: empty report (ok:false, reason:'empty') ─────────────────────

  it('sets status="connected" when parser returns reason:"empty" (new/closed store)', async () => {
    // An HTML that has the structure header but no item rows → empty
    const emptyHtml = `<html><body><table>
<tr><td>Revenue Center</td><td>Units</td><td>Sales</td></tr>
<tr><td>Net Sales</td><td></td><td>$0.00</td></tr>
<tr><td>Inclusive Tax</td><td></td><td>$0.00</td></tr>
<tr><td>Subtotal Discounts</td><td></td><td>$0.00</td></tr>
<tr><td>Retained Tips</td><td></td><td>$0.00</td></tr>
<tr><td>Refunds</td><td></td><td>$0.00</td></tr>
<tr><td>Total Sales</td><td></td><td>$0.00</td></tr>
<tr><td>Payments By Tender</td><td></td><td></td></tr>
<tr><td>Sales By Order Type</td><td></td><td></td></tr>
</table></body></html>`;

    const { deps, mocks } = makeDeps({ fetchHtml: emptyHtml });
    const req = makeRequest({});
    const res = await handleTestConnection(req, deps);

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toMatchObject({ success: true, status: 'connected' });

    const updateArg = mocks.updateMock.mock.calls[0][0] as Record<string, unknown>;
    expect(updateArg).toMatchObject({ connection_status: 'connected' });
  });

  // ── Failure path: parse_error ────────────────────────────────────────────────

  it('sets connection_status="error" when parser returns reason:"parse_error"', async () => {
    const { deps, mocks } = makeDeps({ fetchHtml: GARBAGE_HTML });
    const req = makeRequest({});
    const res = await handleTestConnection(req, deps);

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toMatchObject({ success: false, status: 'error' });
    expect(body).toHaveProperty('error');

    const updateArg = mocks.updateMock.mock.calls[0][0] as Record<string, unknown>;
    expect(updateArg).toMatchObject({ connection_status: 'error' });
    expect(typeof updateArg.last_error).toBe('string');
    expect(updateArg.last_error).toBeTruthy();
    expect(typeof updateArg.last_error_at).toBe('string');
  });

  // ── Failure path: HTTP error from fetch ─────────────────────────────────────

  it('sets connection_status="error" when the report fetch returns HTTP 503', async () => {
    const { deps, mocks } = makeDeps({ fetchStatus: 503 });
    const req = makeRequest({});
    const res = await handleTestConnection(req, deps);

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toMatchObject({ success: false, status: 'error' });

    const updateArg = mocks.updateMock.mock.calls[0][0] as Record<string, unknown>;
    expect(updateArg).toMatchObject({ connection_status: 'error' });
  });

  // ── Timezone: yesterday in connection's IANA tz ──────────────────────────────

  it('fetches yesterday relative to the connection timezone, not UTC', async () => {
    /**
     * Scenario: now=2026-06-27T02:00:00Z, tz='America/Chicago' (UTC-5).
     * UTC date: June 27. Chicago date: June 26 at 21:00 → "today in Chicago" = June 26.
     * Yesterday in Chicago = June 25 → StartDate should contain "06/25/2026".
     */
    const nowInUtc = new Date('2026-06-27T02:00:00.000Z');

    const mockConn = {
      ...MOCK_CONNECTION,
      timezone: 'America/Chicago',
    };
    const { deps } = makeDeps({
      serviceClientOpts: { connection: mockConn },
      now: nowInUtc,
    });

    const fetchSpy = deps.fetch as ReturnType<typeof vi.fn>;
    const req = makeRequest({});
    await handleTestConnection(req, deps);

    // The fetch should have been called with a URL containing 06/25/2026
    const fetchedUrl = fetchSpy.mock.calls[0][0] as string;
    expect(fetchedUrl).toContain('StartDate=06%2F25%2F2026');
    expect(fetchedUrl).toContain('EndDate=06%2F25%2F2026');
  });

  it('fetches yesterday in the connection timezone when now is after midnight UTC but still yesterday locally', async () => {
    /**
     * Scenario: now=2026-06-27T23:00:00Z, tz='America/New_York' (UTC-4 in summer).
     * UTC date: June 27 23:00. NY date: June 27 19:00 → "today in NY" = June 27.
     * Yesterday in NY = June 26 → StartDate should contain "06/26/2026".
     */
    const nowInUtc = new Date('2026-06-27T23:00:00.000Z');

    const mockConn = {
      ...MOCK_CONNECTION,
      timezone: 'America/New_York',
    };
    const { deps } = makeDeps({
      serviceClientOpts: { connection: mockConn },
      now: nowInUtc,
    });

    const fetchSpy = deps.fetch as ReturnType<typeof vi.fn>;
    const req = makeRequest({});
    await handleTestConnection(req, deps);

    const fetchedUrl = fetchSpy.mock.calls[0][0] as string;
    expect(fetchedUrl).toContain('StartDate=06%2F26%2F2026');
    expect(fetchedUrl).toContain('EndDate=06%2F26%2F2026');
  });

  // ── Service-role client is used for writes ────────────────────────────────────

  it('uses the service-role client for the connection_status write (review S3)', async () => {
    const { deps, mocks } = makeDeps({});
    const req = makeRequest({});
    await handleTestConnection(req, deps);

    // serviceClient.from('focus_connections').update(...) should have been called
    expect(mocks.fromMock).toHaveBeenCalledWith('focus_connections');
    expect(mocks.updateMock).toHaveBeenCalledTimes(1);
  });

  // ── Manager role also succeeds ────────────────────────────────────────────────

  it('returns 200 when user role is "manager"', async () => {
    const { deps } = makeDeps({ userClientOpts: { role: 'manager' } });
    const req = makeRequest({});
    const res = await handleTestConnection(req, deps);

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.success).toBe(true);
  });
});
