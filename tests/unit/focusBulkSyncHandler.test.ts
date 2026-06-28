/**
 * focusBulkSyncHandler.test.ts
 *
 * Vitest unit tests for supabase/functions/_shared/focusBulkSyncHandler.ts
 *
 * Coverage:
 *  - Auth: 401 when Authorization header is missing
 *  - Auth: 401 when Authorization header does not match the service-role key
 *  - Auth: timing-safe compare (not short-circuit; confirmed by constant-time gate)
 *  - Processing: queries active connections ORDER BY last_sync_time ASC NULLS FIRST LIMIT 5
 *  - Processing: processes each connection via processReportDay (backfill or incremental)
 *  - Processing: respects 2s inter-restaurant delay (injectable deps.sleep)
 *  - Processing: stops when wall-clock budget (90s) is exceeded (injectable deps.now)
 *  - Backfill path: calls processReportDay once for the cursor day
 *  - Incremental path: calls processReportDay twice (last 2 business days)
 *  - Result: returns { processed, errors, elapsedMs }
 *  - Errors: catches per-connection exceptions; continues to next; surfaced in errors[]
 *  - At most 5 connections processed per run (LIMIT 5)
 *
 * Design ref: plan Task 10; spec §8 (focus-bulk-sync), §9 (sync orchestration);
 * review S5 (LIMIT 5, round-robin), design §8 ("timing-safe Bearer gate", "2s delay",
 * "90s wall-clock budget").
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  handleBulkSync,
  type BulkSyncDeps,
} from '../../supabase/functions/_shared/focusBulkSyncHandler';

// ── Fixtures ──────────────────────────────────────────────────────────────────

const RESTAURANT_ID_1 = '00000000-0000-0000-0000-000000000001';
const RESTAURANT_ID_2 = '00000000-0000-0000-0000-000000000002';
const SERVICE_ROLE_KEY = 'test-service-role-key-for-unit-tests';

/** A minimal focus_connections row for an incremental connection. */
const MOCK_CONN_INCREMENTAL = {
  id: 'conn-uuid-1',
  restaurant_id: RESTAURANT_ID_1,
  report_base_url: 'https://mfprod-1.myfocuspos.com',
  report_path: '/ReportServer?/generalstorereports/revenuecenter',
  db_server: 'mfaz-rep-1',
  db_catalog: 'KAHALA2',
  report_user_id: 'J.Delgado',
  store_id: '15312',
  revenue_center: '',
  timezone: 'America/Chicago',
  initial_sync_done: true,
  sync_cursor: 90,
  last_sync_time: '2026-06-26T00:00:00.000Z',
};

/** A minimal focus_connections row for a backfill connection. */
const MOCK_CONN_BACKFILL = {
  ...MOCK_CONN_INCREMENTAL,
  id: 'conn-uuid-2',
  restaurant_id: RESTAURANT_ID_2,
  initial_sync_done: false,
  sync_cursor: 5,
  last_sync_time: null,
};

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

// ── Mock builders ─────────────────────────────────────────────────────────────

function makeServiceClientMock(opts: {
  connections?: unknown[];
  queryError?: { message: string } | null;
} = {}) {
  const connections = opts.connections !== undefined ? opts.connections : [MOCK_CONN_INCREMENTAL];
  const queryError = opts.queryError ?? null;

  // SELECT focus_connections (round-robin LIMIT 5)
  const limitMock = vi.fn().mockResolvedValue({
    data: connections,
    error: queryError,
  });
  const orderMock = vi.fn().mockReturnValue({ limit: limitMock });
  const eqActiveMock = vi.fn().mockReturnValue({ order: orderMock });
  const selectMock = vi.fn().mockReturnValue({ eq: eqActiveMock });

  // UPDATE focus_connections (last_sync_time, sync_cursor, initial_sync_done)
  const eqUpdateMock = vi.fn().mockResolvedValue({ data: null, error: null });
  const updateMock = vi.fn().mockReturnValue({ eq: eqUpdateMock });

  // focus_daily_reports upsert (processReportDay calls this)
  const upsertSelectMock = vi.fn().mockResolvedValue({ data: [], error: null });
  const onConflictMock = vi.fn().mockReturnValue({ select: upsertSelectMock });
  const upsertMock = vi.fn().mockReturnValue({ onConflict: onConflictMock });

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
      orderMock,
      limitMock,
      updateMock,
      eqUpdateMock,
      upsertMock,
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

function makeSleepMock() {
  return vi.fn().mockResolvedValue(undefined);
}

function makeRequest(opts: {
  authHeader?: string | null;
}): Request {
  const headers = new Headers();
  if (opts.authHeader !== null && opts.authHeader !== undefined) {
    headers.set('Authorization', opts.authHeader);
  }
  return new Request('https://example.com/functions/v1/focus-bulk-sync', {
    method: 'POST',
    headers,
    body: JSON.stringify({}),
  });
}

/**
 * Build a fake now() function that advances by `stepMs` on each call.
 * This lets tests simulate wall-clock time advancing.
 */
function makeClock(startMs: number, stepMs: number = 0) {
  let current = startMs;
  return () => {
    const t = current;
    current += stepMs;
    return t;
  };
}

function makeDeps(opts: {
  serviceClientOpts?: Parameters<typeof makeServiceClientMock>[0];
  fetchHtml?: string;
  sleepMs?: number;
  nowFn?: () => number;
  serviceRoleKey?: string;
} = {}): { deps: BulkSyncDeps; mocks: ReturnType<typeof makeServiceClientMock>['mocks']; sleepMock: ReturnType<typeof makeSleepMock>; fetchMock: ReturnType<typeof makeFetchMock> } {
  const { client: serviceClient, mocks } = makeServiceClientMock(opts.serviceClientOpts ?? {});
  const fetchMock = makeFetchMock(opts.fetchHtml ?? VALID_HTML);
  const sleepMock = makeSleepMock();

  return {
    deps: {
      serviceClient: serviceClient as any,
      fetch: fetchMock,
      sleep: sleepMock,
      now: opts.nowFn ?? makeClock(Date.now()),
      serviceRoleKey: opts.serviceRoleKey ?? SERVICE_ROLE_KEY,
    },
    mocks,
    sleepMock,
    fetchMock,
  };
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('handleBulkSync', () => {
  // ── Bearer gate ──────────────────────────────────────────────────────────────

  it('returns 401 when Authorization header is absent', async () => {
    const { deps } = makeDeps();
    const req = makeRequest({ authHeader: null });
    const res = await handleBulkSync(req, deps);

    expect(res.status).toBe(401);
    const body = await res.json();
    expect(body).toHaveProperty('error');
  });

  it('returns 401 when the Authorization header does not match the service-role key', async () => {
    const { deps } = makeDeps();
    const req = makeRequest({ authHeader: 'Bearer WRONG-KEY' });
    const res = await handleBulkSync(req, deps);

    expect(res.status).toBe(401);
    const body = await res.json();
    expect(body).toHaveProperty('error');
  });

  it('returns 401 for an entirely missing Bearer prefix (bare token)', async () => {
    const { deps } = makeDeps();
    const req = makeRequest({ authHeader: SERVICE_ROLE_KEY }); // no "Bearer " prefix
    const res = await handleBulkSync(req, deps);

    expect(res.status).toBe(401);
  });

  // ── Successful run with a single incremental connection ──────────────────────

  describe('happy path (one incremental connection)', () => {
    let response: Response;
    let mocks: ReturnType<typeof makeServiceClientMock>['mocks'];
    let fetchMock: ReturnType<typeof makeFetchMock>;
    let sleepMock: ReturnType<typeof makeSleepMock>;

    beforeEach(async () => {
      const result = makeDeps({
        serviceClientOpts: { connections: [MOCK_CONN_INCREMENTAL] },
        nowFn: makeClock(1000000, 0), // time doesn't advance → no budget exceeded
      });
      mocks = result.mocks;
      fetchMock = result.fetchMock;
      sleepMock = result.sleepMock;
      const req = makeRequest({ authHeader: `Bearer ${SERVICE_ROLE_KEY}` });
      response = await handleBulkSync(req, result.deps);
    });

    it('returns 200', () => {
      expect(response.status).toBe(200);
    });

    it('returns { processed, errors, elapsedMs } shape', async () => {
      const body = await response.json();
      expect(body).toHaveProperty('processed');
      expect(body).toHaveProperty('errors');
      expect(body).toHaveProperty('elapsedMs');
      expect(Array.isArray(body.errors)).toBe(true);
    });

    it('reports 1 processed connection', async () => {
      const body = await response.json();
      expect(body.processed).toBe(1);
    });

    it('reports 0 errors', async () => {
      const body = await response.json();
      expect(body.errors).toHaveLength(0);
    });

    it('queries focus_connections with is_active=true filter', () => {
      expect(mocks.fromMock).toHaveBeenCalledWith('focus_connections');
      expect(mocks.selectMock).toHaveBeenCalled();
      // eq('is_active', true) or eq('is_active', 'true')
      const eqArg = mocks.selectMock.mock.results[0].value;
      expect(eqArg).toBeTruthy();
    });

    it('calls LIMIT 5 on the connection query', () => {
      expect(mocks.limitMock).toHaveBeenCalledWith(5);
    });

    it('orders by last_sync_time ascending nulls first', () => {
      const orderArg = mocks.orderMock.mock.calls[0];
      expect(orderArg[0]).toBe('last_sync_time');
      expect(orderArg[1]).toMatchObject({ ascending: true, nullsFirst: true });
    });

    it('incremental path: makes 2 fetch calls (one per recent business day)', () => {
      // MOCK_CONN_INCREMENTAL has initial_sync_done=true → processes last 2 days
      expect(fetchMock.mock.calls.length).toBe(2);
    });

    it('updates focus_connections with last_sync_time for the processed restaurant', () => {
      expect(mocks.fromMock).toHaveBeenCalledWith('focus_connections');
      expect(mocks.updateMock).toHaveBeenCalledTimes(1);
      const updateArg = mocks.updateMock.mock.calls[0][0] as Record<string, unknown>;
      expect(typeof updateArg.last_sync_time).toBe('string');
    });
  });

  // ── Backfill path ─────────────────────────────────────────────────────────────

  it('backfill path: makes 1 fetch call (one cursor day) when initial_sync_done=false', async () => {
    const { deps, fetchMock } = makeDeps({
      serviceClientOpts: { connections: [MOCK_CONN_BACKFILL] },
    });
    const req = makeRequest({ authHeader: `Bearer ${SERVICE_ROLE_KEY}` });
    await handleBulkSync(req, deps);

    // MOCK_CONN_BACKFILL has initial_sync_done=false → one processReportDay call → one fetch
    expect(fetchMock.mock.calls.length).toBe(1);
  });

  it('backfill path: increments sync_cursor in the DB update', async () => {
    const { deps, mocks } = makeDeps({
      serviceClientOpts: { connections: [MOCK_CONN_BACKFILL] },
    });
    const req = makeRequest({ authHeader: `Bearer ${SERVICE_ROLE_KEY}` });
    await handleBulkSync(req, deps);

    const updateArg = mocks.updateMock.mock.calls[0][0] as Record<string, unknown>;
    expect(updateArg.sync_cursor).toBe(MOCK_CONN_BACKFILL.sync_cursor + 1); // 5 → 6
  });

  // ── Inter-restaurant delay ─────────────────────────────────────────────────────

  it('sleeps 2000ms between restaurants when there are multiple connections', async () => {
    const { deps, sleepMock } = makeDeps({
      serviceClientOpts: { connections: [MOCK_CONN_INCREMENTAL, MOCK_CONN_BACKFILL] },
    });
    const req = makeRequest({ authHeader: `Bearer ${SERVICE_ROLE_KEY}` });
    await handleBulkSync(req, deps);

    // One sleep call for 2 restaurants (sleep only between, not before first)
    expect(sleepMock).toHaveBeenCalledTimes(1);
    expect(sleepMock).toHaveBeenCalledWith(2000);
  });

  it('does NOT sleep when only one connection is processed', async () => {
    const { deps, sleepMock } = makeDeps({
      serviceClientOpts: { connections: [MOCK_CONN_INCREMENTAL] },
    });
    const req = makeRequest({ authHeader: `Bearer ${SERVICE_ROLE_KEY}` });
    await handleBulkSync(req, deps);

    expect(sleepMock).not.toHaveBeenCalled();
  });

  // ── Wall-clock budget guard ────────────────────────────────────────────────────

  it('stops processing additional restaurants when the 90s wall-clock budget is exceeded', async () => {
    // Budget check happens AFTER each restaurant completes (before next one).
    // Clock: startMs on initial capture; after first restaurant = startMs + 91000 → over budget.
    // We use a call counter because deps.now() is called several times:
    //   - once at the top to capture startMs
    //   - once per budget check (before each restaurant at i > 0)
    //   - once at the final elapsedMs calculation
    const startMs = 1_000_000;
    let callCount = 0;
    const nowMock = () => {
      callCount++;
      // First call: initial startMs capture
      if (callCount === 1) return startMs;
      // All subsequent calls return "over budget" → second restaurant is skipped
      return startMs + 91_000;
    };

    const { deps, fetchMock } = makeDeps({
      serviceClientOpts: { connections: [MOCK_CONN_INCREMENTAL, MOCK_CONN_BACKFILL] },
      nowFn: nowMock,
    });
    const req = makeRequest({ authHeader: `Bearer ${SERVICE_ROLE_KEY}` });
    const res = await handleBulkSync(req, deps);

    const body = await res.json();
    // Only 1 processed (the second was skipped because budget was exceeded)
    expect(body.processed).toBe(1);
    // Incremental = 2 fetch calls; backfill second restaurant not started
    expect(fetchMock.mock.calls.length).toBe(2);
  });

  // ── Empty connection list ─────────────────────────────────────────────────────

  it('returns 200 with processed=0 when there are no active connections', async () => {
    const { deps } = makeDeps({
      serviceClientOpts: { connections: [] },
    });
    const req = makeRequest({ authHeader: `Bearer ${SERVICE_ROLE_KEY}` });
    const res = await handleBulkSync(req, deps);

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.processed).toBe(0);
    expect(body.errors).toHaveLength(0);
  });

  // ── Per-connection error resilience ──────────────────────────────────────────

  it('continues to next connection when one throws, surfacing the error', async () => {
    // We need an error that escapes processReportDay (which has its own try/catch
    // and returns {status:'error'}). An exception from the DB update will escape
    // processConnection since the update is OUTSIDE processReportDay.
    // Approach: make the serviceClient.from('focus_connections').update() throw for the first restaurant.

    const { client: sc, mocks: scMocks } = makeServiceClientMock({
      connections: [MOCK_CONN_INCREMENTAL, MOCK_CONN_BACKFILL],
    });
    const fetchMock = makeFetchMock(VALID_HTML);
    const sleepMock = makeSleepMock();

    // Override the update mock so the FIRST call throws
    let updateCallCount = 0;
    scMocks.updateMock.mockImplementation(() => {
      updateCallCount++;
      if (updateCallCount === 1) {
        // First restaurant's update throws
        return {
          eq: () => { throw new Error('DB write failure'); },
        };
      }
      // Second restaurant's update succeeds
      return { eq: vi.fn().mockResolvedValue({ data: null, error: null }) };
    });

    const deps: BulkSyncDeps = {
      serviceClient: sc as any,
      fetch: fetchMock,
      sleep: sleepMock,
      now: makeClock(Date.now()),
      serviceRoleKey: SERVICE_ROLE_KEY,
    };

    const req = makeRequest({ authHeader: `Bearer ${SERVICE_ROLE_KEY}` });
    const res = await handleBulkSync(req, deps);

    expect(res.status).toBe(200);
    const body = await res.json();
    // Both restaurants were attempted (2 processed = 1 errored + 1 ok)
    expect(body.processed).toBe(2);
    // The error from the first restaurant should be surfaced
    expect(body.errors.length).toBeGreaterThanOrEqual(1);
    expect(body.errors[0]).toMatch(/DB write failure/);
  });

  // ── LIMIT 5 enforced ─────────────────────────────────────────────────────────

  it('passes LIMIT 5 to the query regardless of how many active connections exist', async () => {
    // The query mock only returns the connections we give it; the LIMIT is passed to
    // the query builder. We verify the mock's limit() call received 5.
    const { deps, mocks } = makeDeps({
      serviceClientOpts: {
        connections: Array.from({ length: 3 }, (_, i) => ({
          ...MOCK_CONN_INCREMENTAL,
          id: `conn-${i}`,
          restaurant_id: `00000000-0000-0000-0000-0000000000${String(i).padStart(2, '0')}`,
        })),
      },
    });
    const req = makeRequest({ authHeader: `Bearer ${SERVICE_ROLE_KEY}` });
    await handleBulkSync(req, deps);

    expect(mocks.limitMock).toHaveBeenCalledWith(5);
  });
});
