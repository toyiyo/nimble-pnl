/**
 * focusSyncDataHandler.test.ts
 *
 * Vitest unit tests for supabase/functions/_shared/focusSyncDataHandler.ts
 *
 * Coverage:
 *  - Auth: 401 when Authorization header missing
 *  - Auth: 401 when getUser() returns null
 *  - Body validation: 400 when restaurantId missing
 *  - Role check: 403 when user is not owner/manager
 *  - Connection lookup: 404 when no active focus_connections row
 *  - Backfill path (initial_sync_done=false):
 *      - computes date = today_in_tz - sync_cursor - 1 (review S4: tz-correct)
 *      - calls processReportDay for that date
 *      - increments sync_cursor
 *      - when sync_cursor reaches 90 sets initial_sync_done=true
 *      - returns { syncCursor, initialSyncDone, status }
 *  - Incremental path (initial_sync_done=true):
 *      - processes the last 2 business days in the connection's timezone
 *      - returns { syncCursor, initialSyncDone, status }
 *  - Updates last_sync_time via service-role client (review S3)
 *  - Manager role also succeeds
 *  - Status propagated from processReportDay (ok / empty / error)
 *
 * Design ref: plan Task 9; spec §8 (focus-sync-data); review S3, S4, S9.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  handleSyncData,
  type SyncDataDeps,
} from '../../supabase/functions/_shared/focusSyncDataHandler';

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

/** Minimal valid Revenue Center HTML — enough for the real parser to succeed. */
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

/** Fake focus_connections DB row — backfill in progress (cursor=5) */
const MOCK_CONNECTION_BACKFILL = {
  id: 'conn-uuid-1',
  restaurant_id: RESTAURANT_ID,
  report_base_url: 'https://mfprod-1.myfocuspos.com',
  report_path: '/ReportServer?/generalstorereports/revenuecenter',
  db_server: 'mfaz-rep-1',
  db_catalog: 'KAHALA2',
  report_user_id: 'sample.user',
  store_id: '15312',
  revenue_center: '',
  timezone: 'America/Chicago',
  initial_sync_done: false,
  sync_cursor: 5,
  username: 'sample.user',
  password_encrypted: 'enc',
};

/** Fake focus_connections DB row — incremental mode */
const MOCK_CONNECTION_INCREMENTAL = {
  ...MOCK_CONNECTION_BACKFILL,
  initial_sync_done: true,
  sync_cursor: 90,
};

// ── Mock builders ─────────────────────────────────────────────────────────────

function makeUserClientMock(opts: { user?: { id: string } | null; role?: string | null }) {
  const user = opts.user !== undefined ? opts.user : { id: USER_ID };
  const role = opts.role !== undefined ? opts.role : 'owner';

  const getUserMock = vi.fn().mockResolvedValue({ data: { user } });

  const singleMock = vi.fn().mockResolvedValue({
    data: user && role ? { role } : null,
    error: null,
  });
  const eq2Mock = vi.fn().mockReturnValue({ single: singleMock });
  const eq1Mock = vi.fn().mockReturnValue({ eq: eq2Mock });
  const selectMock = vi.fn().mockReturnValue({ eq: eq1Mock });
  const fromMock = vi.fn().mockReturnValue({ select: selectMock });

  return { auth: { getUser: getUserMock }, from: fromMock };
}

type MockConnection = typeof MOCK_CONNECTION_BACKFILL | null;

function makeServiceClientMock(opts: { connection?: MockConnection } = {}) {
  const conn = opts.connection !== undefined ? opts.connection : MOCK_CONNECTION_BACKFILL;

  // SELECT focus_connections
  const singleMock = vi.fn().mockResolvedValue({
    data: conn,
    error: conn === null ? { message: 'No rows' } : null,
  });
  const isActiveMock = vi.fn().mockReturnValue({ single: singleMock });
  const restaurantIdMock = vi.fn().mockReturnValue({ eq: isActiveMock });
  const selectMock = vi.fn().mockReturnValue({ eq: restaurantIdMock });

  // UPDATE focus_connections (for sync_cursor / initial_sync_done / last_sync_time)
  const eqUpdateMock = vi.fn().mockResolvedValue({ data: null, error: null });
  const updateMock = vi.fn().mockReturnValue({ eq: eqUpdateMock });

  // focus_daily_reports upsert (processReportDay goes through supabase.from())
  // onConflict is passed as an options object to upsert(), not a chained method
  const upsertSelectMock = vi.fn().mockResolvedValue({ data: [], error: null });
  const upsertMock = vi.fn().mockReturnValue({ select: upsertSelectMock });

  const fromMock = vi.fn().mockImplementation((table: string) => {
    if (table === 'focus_connections') {
      return { select: selectMock, update: updateMock };
    }
    if (table === 'focus_daily_reports') {
      return { upsert: upsertMock };
    }
    return { select: selectMock, update: updateMock, upsert: upsertMock };
  });

  return {
    client: { from: fromMock },
    mocks: {
      fromMock,
      selectMock,
      updateMock,
      eqUpdateMock,
      upsertMock,
      singleMock,
    },
  };
}

function makeFetchMock(html: string = VALID_HTML) {
  return vi.fn().mockResolvedValue({
    status: 200,
    headers: { get: () => null },
    text: () => Promise.resolve(html),
  });
}

function makeRequest(opts: {
  authHeader?: string | null;
  body?: Record<string, unknown>;
}): Request {
  const headers = new Headers();
  if (opts.authHeader !== null) {
    headers.set('Authorization', opts.authHeader ?? 'Bearer fake-jwt-token');
  }
  return new Request('https://example.com/functions/v1/focus-sync-data', {
    method: 'POST',
    headers,
    body: JSON.stringify(opts.body ?? { restaurantId: RESTAURANT_ID }),
  });
}

function makeDeps(opts: {
  userClientOpts?: Parameters<typeof makeUserClientMock>[0];
  serviceClientOpts?: Parameters<typeof makeServiceClientMock>[0];
  fetchHtml?: string;
  now?: Date;
}): { deps: SyncDataDeps; mocks: ReturnType<typeof makeServiceClientMock>['mocks'] } {
  const userClient = makeUserClientMock(opts.userClientOpts ?? {});
  const { client: serviceClient, mocks } = makeServiceClientMock(opts.serviceClientOpts ?? {});
  const fetchFn = makeFetchMock(opts.fetchHtml ?? VALID_HTML);

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

describe('handleSyncData', () => {
  // ── Auth header missing ────────────────────────────────────────────────────

  it('returns 401 when Authorization header is missing', async () => {
    const { deps } = makeDeps({});
    const req = makeRequest({ authHeader: null });
    const res = await handleSyncData(req, deps);

    expect(res.status).toBe(401);
    const body = await res.json();
    expect(body).toHaveProperty('error');
  });

  // ── Bad JWT ───────────────────────────────────────────────────────────────

  it('returns 401 when getUser() returns null user', async () => {
    const { deps } = makeDeps({ userClientOpts: { user: null } });
    const req = makeRequest({});
    const res = await handleSyncData(req, deps);

    expect(res.status).toBe(401);
  });

  // ── Missing restaurantId ──────────────────────────────────────────────────

  it('returns 400 when restaurantId is missing from the body', async () => {
    const { deps } = makeDeps({});
    const req = makeRequest({ body: {} });
    const res = await handleSyncData(req, deps);

    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toMatch(/restaurantId/i);
  });

  // ── Role check ─────────────────────────────────────────────────────────────

  it('returns 403 when user role is "staff"', async () => {
    const { deps } = makeDeps({ userClientOpts: { role: 'staff' } });
    const req = makeRequest({});
    const res = await handleSyncData(req, deps);

    expect(res.status).toBe(403);
  });

  it('returns 403 when user has no membership for the restaurant', async () => {
    const { deps } = makeDeps({ userClientOpts: { role: null } });
    const req = makeRequest({});
    const res = await handleSyncData(req, deps);

    expect(res.status).toBe(403);
  });

  // ── No active connection ──────────────────────────────────────────────────

  it('returns 404 when no active focus_connections row exists', async () => {
    const { deps } = makeDeps({ serviceClientOpts: { connection: null } });
    const req = makeRequest({});
    const res = await handleSyncData(req, deps);

    expect(res.status).toBe(404);
    const body = await res.json();
    expect(body).toHaveProperty('error');
  });

  // ── Auth gate: FocusAuthError → returns 200 {status:'error'} ─────────────────

  it('returns 200 {status:"error"} and sets connection_status="error" when loginToPortal throws FocusAuthError', async () => {
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
    const res = await handleSyncData(req, deps);

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toMatchObject({ status: 'error' });

    // Should have updated connection_status in DB
    const updateArg = mocks.updateMock.mock.calls[0][0] as Record<string, unknown>;
    expect(updateArg).toMatchObject({
      connection_status: 'error',
      last_error: 'Invalid Focus credentials',
    });
  });

  // ── Backfill path ─────────────────────────────────────────────────────────

  describe('backfill path (initial_sync_done=false)', () => {
    // now = 2026-06-27T14:00:00Z  (Chicago = UTC-5, so 2026-06-27 in Chicago)
    // sync_cursor = 5 → target date = today_in_tz - 5 - 1 = June 27 - 6 = June 21
    // → StartDate=06%2F21%2F2026

    let response: Response;
    let mocks: ReturnType<typeof makeServiceClientMock>['mocks'];
    let fetchSpy: ReturnType<typeof vi.fn>;

    beforeEach(async () => {
      const result = makeDeps({
        serviceClientOpts: { connection: MOCK_CONNECTION_BACKFILL },
        now: new Date('2026-06-27T14:00:00.000Z'), // Chicago = June 27
      });
      mocks = result.mocks;
      fetchSpy = result.deps.fetch as ReturnType<typeof vi.fn>;
      const req = makeRequest({});
      response = await handleSyncData(req, result.deps);
    });

    it('returns 200', () => {
      expect(response.status).toBe(200);
    });

    it('returns syncCursor incremented by 1 (5 → 6)', async () => {
      const body = await response.json();
      expect(body.syncCursor).toBe(6);
    });

    it('returns initialSyncDone=false when cursor has not reached 90', async () => {
      const body = await response.json();
      expect(body.initialSyncDone).toBe(false);
    });

    it('returns status from processReportDay (ok)', async () => {
      const body = await response.json();
      expect(body.status).toBe('ok');
    });

    it('fetches the tz-correct backfill date (today_in_tz − cursor − 1)', () => {
      // June 27 in Chicago − 6 days = June 21
      const fetchedUrl = fetchSpy.mock.calls[0][0] as string;
      expect(fetchedUrl).toContain('StartDate=06%2F21%2F2026');
      expect(fetchedUrl).toContain('EndDate=06%2F21%2F2026');
    });

    it('writes the incremented sync_cursor to focus_connections via service client', () => {
      expect(mocks.fromMock).toHaveBeenCalledWith('focus_connections');
      const updateArg = mocks.updateMock.mock.calls[0][0] as Record<string, unknown>;
      expect(updateArg.sync_cursor).toBe(6);
    });

    it('updates last_sync_time in the update payload', () => {
      const updateArg = mocks.updateMock.mock.calls[0][0] as Record<string, unknown>;
      expect(typeof updateArg.last_sync_time).toBe('string');
    });
  });

  // ── Backfill completion (cursor reaches 90) ───────────────────────────────

  it('sets initial_sync_done=true when sync_cursor reaches 90', async () => {
    const connectionAt89 = { ...MOCK_CONNECTION_BACKFILL, sync_cursor: 89 };
    const { deps } = makeDeps({
      serviceClientOpts: { connection: connectionAt89 },
    });
    const req = makeRequest({});
    const res = await handleSyncData(req, deps);

    expect(res.status).toBe(200);
    const body = await res.json();
    // cursor was 89 → after increment = 90
    expect(body.syncCursor).toBe(90);
    expect(body.initialSyncDone).toBe(true);
  });

  it('writes initial_sync_done=true to DB when cursor reaches 90', async () => {
    const connectionAt89 = { ...MOCK_CONNECTION_BACKFILL, sync_cursor: 89 };
    const { deps, mocks } = makeDeps({
      serviceClientOpts: { connection: connectionAt89 },
    });
    const req = makeRequest({});
    await handleSyncData(req, deps);

    const updateArg = mocks.updateMock.mock.calls[0][0] as Record<string, unknown>;
    expect(updateArg.initial_sync_done).toBe(true);
    expect(updateArg.sync_cursor).toBe(90);
  });

  // ── Incremental path ──────────────────────────────────────────────────────

  describe('incremental path (initial_sync_done=true)', () => {
    // now = 2026-06-27T14:00:00Z, Chicago = June 27
    // Last 2 business days in Chicago = June 26 and June 25
    // → StartDate fetch calls should contain 06/26/2026 and 06/25/2026

    let response: Response;
    let fetchSpy: ReturnType<typeof vi.fn>;

    beforeEach(async () => {
      const result = makeDeps({
        serviceClientOpts: { connection: MOCK_CONNECTION_INCREMENTAL },
        now: new Date('2026-06-27T14:00:00.000Z'), // Chicago = June 27
      });
      fetchSpy = result.deps.fetch as ReturnType<typeof vi.fn>;
      const req = makeRequest({});
      response = await handleSyncData(req, result.deps);
    });

    it('returns 200', () => {
      expect(response.status).toBe(200);
    });

    it('returns initialSyncDone=true', async () => {
      const body = await response.json();
      expect(body.initialSyncDone).toBe(true);
    });

    it('returns status ok after processing the 2 recent days', async () => {
      const body = await response.json();
      expect(body.status).toBe('ok');
    });

    it('fetches yesterday in the connection timezone (June 26 = June 27 − 1)', () => {
      const urls = fetchSpy.mock.calls.map((c) => c[0] as string);
      const hasYesterday = urls.some((u) => u.includes('StartDate=06%2F26%2F2026'));
      expect(hasYesterday).toBe(true);
    });

    it('fetches the day before yesterday in the connection timezone (June 25 = June 27 − 2)', () => {
      const urls = fetchSpy.mock.calls.map((c) => c[0] as string);
      const hasDayBefore = urls.some((u) => u.includes('StartDate=06%2F25%2F2026'));
      expect(hasDayBefore).toBe(true);
    });

    it('makes exactly 2 fetch calls (one per recent business day)', () => {
      // Each processReportDay call makes one fetch
      expect(fetchSpy.mock.calls.length).toBe(2);
    });
  });

  // ── Timezone: backfill date is computed in connection timezone ─────────────

  it('computes backfill date in connection timezone, not UTC', async () => {
    /**
     * Scenario: now=2026-06-27T02:00:00Z, tz='America/Chicago' (UTC-5)
     * UTC date: June 27 → Chicago date at 02:00 UTC = June 26 21:00 local
     * "today in Chicago" = June 26 → cursor 0 → target = June 26 − 0 − 1 = June 25
     * StartDate should contain 06/25/2026
     */
    const connection = { ...MOCK_CONNECTION_BACKFILL, sync_cursor: 0, timezone: 'America/Chicago' };
    const { deps } = makeDeps({
      serviceClientOpts: { connection },
      now: new Date('2026-06-27T02:00:00.000Z'), // Chicago = June 26
    });

    const fetchSpy = deps.fetch as ReturnType<typeof vi.fn>;
    const req = makeRequest({});
    await handleSyncData(req, deps);

    const fetchedUrl = fetchSpy.mock.calls[0][0] as string;
    // today_in_chicago = June 26; target = June 26 - 0 - 1 = June 25
    expect(fetchedUrl).toContain('StartDate=06%2F25%2F2026');
    expect(fetchedUrl).toContain('EndDate=06%2F25%2F2026');
  });

  // ── Uses service-role client for the update ─────────────────────────────

  it('uses service-role client for the connection update (review S3)', async () => {
    const { deps, mocks } = makeDeps({});
    const req = makeRequest({});
    await handleSyncData(req, deps);

    expect(mocks.fromMock).toHaveBeenCalledWith('focus_connections');
    expect(mocks.updateMock).toHaveBeenCalledTimes(1);
  });

  // ── Manager role also succeeds ────────────────────────────────────────────

  it('returns 200 when user role is "manager"', async () => {
    const { deps } = makeDeps({ userClientOpts: { role: 'manager' } });
    const req = makeRequest({});
    const res = await handleSyncData(req, deps);

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toHaveProperty('status');
  });

  // ── Error from processReportDay is surfaced ──────────────────────────────

  it('returns status="error" in response when processReportDay returns error', async () => {
    // Make fetch fail with 503
    const { deps } = makeDeps({});
    // Override fetch to return 503
    (deps.fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
      status: 503,
      headers: { get: () => null },
      text: () => Promise.resolve(''),
    });

    const req = makeRequest({});
    const res = await handleSyncData(req, deps);

    // Still 200 — the caller reads the status field
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.status).toBe('error');
  });

  // ── Backfill cursor is NOT advanced on error (Codex P1) ──────────────────

  it('does NOT advance sync_cursor when processReportDay returns error (backfill)', async () => {
    // MOCK_CONNECTION_BACKFILL has sync_cursor=5; fetch returns 503 → parse_error → error
    const { deps, mocks } = makeDeps({
      serviceClientOpts: { connection: MOCK_CONNECTION_BACKFILL },
    });
    // Override fetch to return 503 so processReportDay returns {status:'error'}
    (deps.fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
      status: 503,
      headers: { get: () => null },
      text: () => Promise.resolve(''),
    });

    const req = makeRequest({});
    const res = await handleSyncData(req, deps);

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.status).toBe('error');
    // Cursor must stay at 5 — not incremented to 6
    expect(body.syncCursor).toBe(5);
    // DB update payload must also have sync_cursor=5 (unchanged)
    const updateArg = mocks.updateMock.mock.calls[0][0] as Record<string, unknown>;
    expect(updateArg.sync_cursor).toBe(5);
  });
});
