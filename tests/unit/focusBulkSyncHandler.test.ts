/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * focusBulkSyncHandler.test.ts
 *
 * Vitest unit tests for supabase/functions/_shared/focusBulkSyncHandler.ts
 *
 * Coverage:
 *  - Gate-less: processes with no Authorization header (matches toast/shift4)
 *  - Processing: selects connections via the atomic claim_focus_sync_batch RPC
 *    (p_limit 5) — the RPC's own ORDER BY last_sync_time ASC NULLS FIRST +
 *    SKIP LOCKED is covered by pgTAP (supabase/tests/51_focus_sync_scheduler.sql).
 *  - Processing: processes each connection via processReportDay (backfill or incremental)
 *  - Processing: respects 2s inter-restaurant delay (injectable deps.sleep)
 *  - Processing: stops when wall-clock budget (90s) is exceeded (injectable deps.now)
 *  - Backfill path: calls processReportDay once for the cursor day
 *  - Incremental path: calls processReportDay twice (last 2 business days)
 *  - Result: returns { processed, errors, elapsedMs }
 *  - Errors: catches per-connection exceptions; continues to next; surfaced in errors[]
 *  - Backoff contract: a failed connection writes consecutive_failures+1 and a
 *    future next_attempt_at (capped at 6h); a success resets both to 0 / null.
 *    The claim RPC already bumped last_sync_time, so the failure path no
 *    longer bumps it separately.
 *
 * Design ref: plan Task 5; design doc §2 ("Worker changes"), design review #1
 * (atomic claim) and #4 (backoff contract). Gate-less cron worker: matches
 * toast-bulk-sync / shift4-bulk-sync (no Bearer).
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  handleBulkSync,
  type BulkSyncDeps,
} from '../../supabase/functions/_shared/focusBulkSyncHandler';

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

// ── Mock Lynk transaction handler (B5: bulk-sync skip guard) ────────────────
// processDayTransactions is called by the Lynk path in processConnection.
// Mocked so tests can assert call counts without network.
// vi.mock factories are hoisted, so we cannot reference outer const here —
// use vi.fn() inline and retrieve via vi.mocked() in tests.

vi.mock('../../supabase/functions/_shared/focusTransactionSyncHandler', async (importOriginal) => {
  const original = await importOriginal<typeof import('../../supabase/functions/_shared/focusTransactionSyncHandler')>();
  return {
    ...original,
    processDayTransactions: vi.fn().mockResolvedValue({ status: 'ok' }),
  };
});

// ── Mock Lynk client (focusApiBaseUrl + fetchDatafeed) ───────────────────────
vi.mock('../../supabase/functions/_shared/focusLynkClient', () => ({
  focusApiBaseUrl: vi.fn().mockReturnValue('https://api.focuspos.com'),
  fetchDatafeed: vi.fn().mockResolvedValue({ status: 'ok' }),
}));

// ── Fixtures ──────────────────────────────────────────────────────────────────

const RESTAURANT_ID_1 = '00000000-0000-0000-0000-000000000001';
const RESTAURANT_ID_2 = '00000000-0000-0000-0000-000000000002';
const SERVICE_ROLE_KEY = 'test-service-role-key-for-unit-tests';

/**
 * A minimal focus_connections row for an incremental connection.
 *
 * claim_focus_sync_batch returns SETOF focus_connections (full rows), so
 * fixtures carry the scheduling columns the claim RPC guarantees are present:
 * sync_interval_minutes / next_attempt_at / consecutive_failures. Consumed
 * by column name only (never positionally) per design review #9.
 */
const MOCK_CONN_INCREMENTAL = {
  id: 'conn-uuid-1',
  restaurant_id: RESTAURANT_ID_1,
  report_base_url: 'https://mfprod-1.myfocuspos.com',
  report_path: '/ReportServer?/generalstorereports/revenuecenter',
  db_server: 'mfaz-rep-1',
  db_catalog: 'KAHALA2',
  report_user_id: 'sample.user',
  store_id: '99999',
  revenue_center: '',
  timezone: 'America/Chicago',
  initial_sync_done: true,
  sync_cursor: 90,
  last_sync_time: '2026-06-26T00:00:00.000Z',
  username: 'sample.user',
  password_encrypted: 'enc',
  sync_interval_minutes: 30,
  next_attempt_at: null as string | null,
  consecutive_failures: 0,
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

/** A Lynk API row that is still backfilling (initial_sync_done=false, api_key set). */
const MOCK_LYNK_BACKFILLING = {
  id: 'conn-lynk-backfill',
  restaurant_id: RESTAURANT_ID_2,
  report_base_url: null,
  report_path: null,
  db_server: null,
  db_catalog: null,
  report_user_id: null,
  store_id: 'store-001',
  revenue_center: '',
  timezone: 'America/Chicago',
  initial_sync_done: false,
  sync_cursor: 10,
  last_sync_time: null,
  username: null,
  password_encrypted: null,
  api_key: 'lynk-api-key',
  api_secret_encrypted: 'encrypted-secret-for-lynk',
  environment: 'production',
  sync_interval_minutes: 30,
  next_attempt_at: null as string | null,
  consecutive_failures: 0,
};

/** A Lynk API row that has completed backfill (initial_sync_done=true, api_key set). */
const MOCK_LYNK_INCREMENTAL = {
  ...MOCK_LYNK_BACKFILLING,
  id: 'conn-lynk-incremental',
  restaurant_id: RESTAURANT_ID_1,
  initial_sync_done: true,
  sync_cursor: 90,
  last_sync_time: '2026-07-01T00:00:00Z',
};

/** Convenience builder for the backoff-contract tests: a claimed incremental Lynk row. */
function lynkRow(overrides: Partial<typeof MOCK_LYNK_INCREMENTAL> = {}) {
  return { ...MOCK_LYNK_INCREMENTAL, ...overrides };
}

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
  /** Rows returned by claim_focus_sync_batch (replaces the old select-chain). */
  claimRows?: unknown[];
  claimError?: { message: string } | null;
} = {}) {
  const claimRows = opts.claimRows !== undefined ? opts.claimRows : [MOCK_CONN_INCREMENTAL];
  const claimError = opts.claimError ?? null;

  // rpc('claim_focus_sync_batch', { p_limit }) — atomic UPDATE…SKIP LOCKED…
  // RETURNING claim (supabase/migrations/20260704200320_focus_sync_frequency.sql).
  // Its own ORDER BY last_sync_time ASC NULLS FIRST + SKIP LOCKED semantics are
  // exercised by pgTAP (supabase/tests/51_focus_sync_scheduler.sql), not here.
  const rpcMock = vi.fn().mockResolvedValue({ data: claimRows, error: claimError });

  // UPDATE focus_connections (backoff / success reset / error-state / legacy auth-error)
  // Chain supports two .eq() calls: .eq('id', ...).eq('restaurant_id', ...)
  const eqUpdate2Mock = vi.fn().mockResolvedValue({ data: null, error: null });
  const eqUpdateMock = vi.fn().mockReturnValue({ eq: eqUpdate2Mock });
  const updateMock = vi.fn().mockReturnValue({ eq: eqUpdateMock });

  // focus_daily_reports upsert (processReportDay calls this)
  // onConflict is passed as an options object to upsert(), not a chained method
  const upsertSelectMock = vi.fn().mockResolvedValue({ data: [], error: null });
  const upsertMock = vi.fn().mockReturnValue({ select: upsertSelectMock });

  const fromMock = vi.fn().mockImplementation((table: string) => {
    if (table === 'focus_connections') {
      return { update: updateMock };
    }
    if (table === 'focus_daily_reports') {
      return { upsert: upsertMock };
    }
    return { update: updateMock, upsert: upsertMock };
  });

  return {
    client: { from: fromMock, rpc: rpcMock },
    mocks: {
      fromMock,
      rpcMock,
      updateMock,
      eqUpdateMock,
      upsertMock,
      /** Flattened view of every focus_connections update payload, in call order. */
      get updateCalls() {
        return updateMock.mock.calls.map(([payload]: [Record<string, unknown>]) => ({ payload }));
      },
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

/** Fixed "now" used by tests that assert on absolute next_attempt_at timestamps. */
const NOW_MS = 1_720_000_000_000; // 2026-07-03T09:46:40.000Z — arbitrary, fixed instant

function makeDeps(opts: {
  serviceClientOpts?: Parameters<typeof makeServiceClientMock>[0];
  fetchHtml?: string;
  sleepMs?: number;
  nowFn?: () => number;
} = {}): { deps: BulkSyncDeps; mocks: ReturnType<typeof makeServiceClientMock>['mocks']; sleepMock: ReturnType<typeof makeSleepMock>; fetchMock: ReturnType<typeof makeFetchMock> } {
  const { client: serviceClient, mocks } = makeServiceClientMock(opts.serviceClientOpts ?? {});
  const fetchMock = makeFetchMock(opts.fetchHtml ?? VALID_HTML);
  const sleepMock = makeSleepMock();

  return {
    deps: {
      serviceClient: serviceClient as any,
      fetch: fetchMock,
      sleep: sleepMock,
      now: opts.nowFn ?? makeClock(NOW_MS),
    },
    mocks,
    sleepMock,
    fetchMock,
  };
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('handleBulkSync', () => {
  // ── Gate-less: processes with no Authorization header (matches toast/shift4) ──

  it('processes with NO Authorization header (no Bearer gate)', async () => {
    const { deps } = makeDeps({ serviceClientOpts: { claimRows: [] } });
    const req = makeRequest({ authHeader: null });
    const res = await handleBulkSync(req, deps);

    // No 401 — the worker runs and returns its normal 200 result shape.
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toHaveProperty('processed');
    expect(body).toHaveProperty('elapsedMs');
  });

  // ── Successful run with a single incremental connection ──────────────────────

  describe('happy path (one incremental connection)', () => {
    let response: Response;
    let mocks: ReturnType<typeof makeServiceClientMock>['mocks'];
    let fetchMock: ReturnType<typeof makeFetchMock>;
    let sleepMock: ReturnType<typeof makeSleepMock>;

    beforeEach(async () => {
      const result = makeDeps({
        serviceClientOpts: { claimRows: [MOCK_CONN_INCREMENTAL] },
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

    it('selects the claim batch via the claim_focus_sync_batch RPC with p_limit 5', () => {
      expect(mocks.rpcMock).toHaveBeenCalledWith('claim_focus_sync_batch', { p_limit: 5 });
    });

    it('incremental path: makes 2 fetch calls (one per recent business day)', () => {
      // MOCK_CONN_INCREMENTAL has initial_sync_done=true → processes last 2 days
      expect(fetchMock.mock.calls.length).toBe(2);
    });

    it('updates focus_connections resetting consecutive_failures/next_attempt_at for the processed restaurant', () => {
      expect(mocks.fromMock).toHaveBeenCalledWith('focus_connections');
      expect(mocks.updateMock).toHaveBeenCalledTimes(1);
      const updateArg = mocks.updateMock.mock.calls[0][0] as Record<string, unknown>;
      expect(updateArg.consecutive_failures).toBe(0);
      expect(updateArg.next_attempt_at).toBeNull();
    });
  });

  // ── Backfill path ─────────────────────────────────────────────────────────────

  it('backfill path: makes 1 fetch call (one cursor day) when initial_sync_done=false', async () => {
    const { deps, fetchMock } = makeDeps({
      serviceClientOpts: { claimRows: [MOCK_CONN_BACKFILL] },
    });
    const req = makeRequest({ authHeader: `Bearer ${SERVICE_ROLE_KEY}` });
    await handleBulkSync(req, deps);

    // MOCK_CONN_BACKFILL has initial_sync_done=false → one processReportDay call → one fetch
    expect(fetchMock.mock.calls.length).toBe(1);
  });

  it('backfill path: increments sync_cursor in the DB update', async () => {
    const { deps, mocks } = makeDeps({
      serviceClientOpts: { claimRows: [MOCK_CONN_BACKFILL] },
    });
    const req = makeRequest({ authHeader: `Bearer ${SERVICE_ROLE_KEY}` });
    await handleBulkSync(req, deps);

    const updateArg = mocks.updateMock.mock.calls[0][0] as Record<string, unknown>;
    expect(updateArg.sync_cursor).toBe(MOCK_CONN_BACKFILL.sync_cursor + 1); // 5 → 6
  });

  // ── Inter-restaurant delay ─────────────────────────────────────────────────────

  it('sleeps 2000ms between restaurants when there are multiple connections', async () => {
    const { deps, sleepMock } = makeDeps({
      serviceClientOpts: { claimRows: [MOCK_CONN_INCREMENTAL, MOCK_CONN_BACKFILL] },
    });
    const req = makeRequest({ authHeader: `Bearer ${SERVICE_ROLE_KEY}` });
    await handleBulkSync(req, deps);

    // One sleep call for 2 restaurants (sleep only between, not before first)
    expect(sleepMock).toHaveBeenCalledTimes(1);
    expect(sleepMock).toHaveBeenCalledWith(2000);
  });

  it('does NOT sleep when only one connection is processed', async () => {
    const { deps, sleepMock } = makeDeps({
      serviceClientOpts: { claimRows: [MOCK_CONN_INCREMENTAL] },
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
      serviceClientOpts: { claimRows: [MOCK_CONN_INCREMENTAL, MOCK_CONN_BACKFILL] },
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
      serviceClientOpts: { claimRows: [] },
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
      claimRows: [MOCK_CONN_INCREMENTAL, MOCK_CONN_BACKFILL],
    });
    const fetchMock = makeFetchMock(VALID_HTML);
    const sleepMock = makeSleepMock();

    // Override the update mock so the FIRST call throws.
    // Handler now chains two .eq() calls: .eq('id', ...).eq('restaurant_id', ...).
    // The throw must happen at the end of the chain (second .eq), not the first.
    let updateCallCount = 0;
    scMocks.updateMock.mockImplementation(() => {
      updateCallCount++;
      if (updateCallCount === 1) {
        // First restaurant's update throws on the second .eq() (terminal)
        return {
          eq: () => ({
            eq: () => { throw new Error('DB write failure'); },
          }),
        };
      }
      // Second restaurant's update succeeds
      return {
        eq: vi.fn().mockReturnValue({
          eq: vi.fn().mockResolvedValue({ data: null, error: null }),
        }),
      };
    });

    const deps: BulkSyncDeps = {
      serviceClient: sc as any,
      fetch: fetchMock,
      sleep: sleepMock,
      now: makeClock(Date.now()),
    };

    const req = makeRequest({ authHeader: `Bearer ${SERVICE_ROLE_KEY}` });
    const res = await handleBulkSync(req, deps);

    expect(res.status).toBe(200);
    const body = await res.json();
    // processed counts only SUCCEEDED restaurants; errored ones are in errors[].
    // First restaurant errored → processed=1, errors=[1 item].
    // Total attempted = processed + errors.length = 2.
    expect(body.processed).toBe(1);
    // The error from the first restaurant should be surfaced
    expect(body.errors.length).toBeGreaterThanOrEqual(1);
    expect(body.errors[0]).toMatch(/DB write failure/);
  });

  // ── p_limit 5 enforced regardless of batch size returned ────────────────────
  // (equivalent of the old "LIMIT 5 enforced" test: the RPC's own LIMIT/SKIP
  // LOCKED shape means the p_limit argument doesn't vary with the fixture's
  // row count — see "selects the claim batch via the claim_focus_sync_batch
  // RPC with p_limit 5" in the happy-path describe above.)

  it('calls the claim RPC with p_limit 5 regardless of how many connections the claim returns', async () => {
    const { deps, mocks } = makeDeps({
      serviceClientOpts: {
        claimRows: Array.from({ length: 3 }, (_, i) => ({
          ...MOCK_CONN_INCREMENTAL,
          id: `conn-${i}`,
          restaurant_id: `00000000-0000-0000-0000-0000000000${String(i).padStart(2, '0')}`,
        })),
      },
    });
    const req = makeRequest({ authHeader: `Bearer ${SERVICE_ROLE_KEY}` });
    await handleBulkSync(req, deps);

    expect(mocks.rpcMock).toHaveBeenCalledWith('claim_focus_sync_batch', { p_limit: 5 });
  });

  // ── Auth gate: FocusAuthError → restaurant skipped, surfaces in errors[] ────────

  it('skips restaurant and adds to errors[] when loginToPortal throws FocusAuthError', async () => {
    const { loginToPortal: mockLoginToPortal } = await import(
      '../../supabase/functions/_shared/focusPortalClient'
    );
    const { FocusAuthError: FocusAuthErrorClass } = await import(
      '../../supabase/functions/_shared/focusPortalClient'
    );

    // Make loginToPortal fail for the FIRST call (first restaurant) only
    (mockLoginToPortal as ReturnType<typeof vi.fn>)
      .mockRejectedValueOnce(new FocusAuthErrorClass('bad creds'))
      .mockResolvedValue({ cookie: 'session-cookie' });

    const { deps, mocks } = makeDeps({
      serviceClientOpts: { claimRows: [MOCK_CONN_INCREMENTAL, MOCK_CONN_BACKFILL] },
    });

    const req = makeRequest({ authHeader: `Bearer ${SERVICE_ROLE_KEY}` });
    const res = await handleBulkSync(req, deps);

    expect(res.status).toBe(200);
    const body = await res.json();

    // First restaurant errored (auth failure) → NOT counted in processed
    // Second restaurant should still be processed
    expect(body.processed).toBe(1);
    expect(body.errors.length).toBeGreaterThanOrEqual(1);

    // The error message should contain something about auth / credentials
    const errorMsg = body.errors[0] as string;
    expect(errorMsg).toContain(RESTAURANT_ID_1);
  });

  // ── Backfill cursor is NOT advanced on fetch error (Codex P1) ────────────────

  it('does NOT advance sync_cursor when backfill fetch returns 503', async () => {
    // MOCK_CONN_BACKFILL has sync_cursor=5; fetch returns 503 → error → cursor unchanged
    const { deps, mocks } = makeDeps({
      serviceClientOpts: { claimRows: [MOCK_CONN_BACKFILL] },
      fetchHtml: '', // will be overridden below
    });
    // Return 503 so processReportDay returns {status:'error'}
    (deps.fetch as ReturnType<typeof makeFetchMock>).mockResolvedValue({
      status: 503,
      headers: { get: () => null },
      text: () => Promise.resolve(''),
    });

    const req = makeRequest({ authHeader: `Bearer ${SERVICE_ROLE_KEY}` });
    await handleBulkSync(req, deps);

    const updateArg = mocks.updateMock.mock.calls[0][0] as Record<string, unknown>;
    // Cursor must stay at 5 (MOCK_CONN_BACKFILL.sync_cursor) — not incremented
    expect(updateArg.sync_cursor).toBe(MOCK_CONN_BACKFILL.sync_cursor);
  });

  // ── B5: focus-bulk-sync cedes Lynk backfill to focus-backfill-sync cron ──────
  //
  // The 6-h bulk-sync must NOT advance Lynk backfill rows (that's the 5-min
  // focus-backfill-sync cron's job). The skip guard sits at the top of the
  // isLynkPath block before any decrypt / datafeed fetch.

  describe('B5 — bulk-sync cedes Lynk backfill', () => {
    // Access the hoisted mock via vi.mocked so beforeEach can clear it.
    let mockedProcessDayTransactions: ReturnType<typeof vi.fn>;

    beforeEach(async () => {
      const txModule = await import('../../supabase/functions/_shared/focusTransactionSyncHandler');
      mockedProcessDayTransactions = vi.mocked(txModule.processDayTransactions);
      mockedProcessDayTransactions.mockClear();
      // Ensure it resolves successfully for incremental tests
      mockedProcessDayTransactions.mockResolvedValue({ status: 'ok' });
    });

    it('skips a backfilling Lynk row: no datafeed fetch AND no DB write (owned by focus-backfill-sync)', async () => {
      const { deps, mocks } = makeDeps({
        serviceClientOpts: { claimRows: [MOCK_LYNK_BACKFILLING] },
      });
      const req = makeRequest({ authHeader: `Bearer ${SERVICE_ROLE_KEY}` });
      await handleBulkSync(req, deps);

      // processDayTransactions must NOT have been called
      expect(mockedProcessDayTransactions).not.toHaveBeenCalled();

      // The row must NOT be written at all. Writing row.sync_cursor here could
      // regress a newer cursor that focus-backfill-sync advanced between our read
      // and this write, and would spuriously bump last_sync_time (CodeRabbit Major, 9d).
      expect(mocks.updateMock).not.toHaveBeenCalled();
    });

    it('counts a skipped backfilling Lynk row as processed (no error)', async () => {
      const { deps } = makeDeps({
        serviceClientOpts: { claimRows: [MOCK_LYNK_BACKFILLING] },
      });
      const req = makeRequest({ authHeader: `Bearer ${SERVICE_ROLE_KEY}` });
      const res = await handleBulkSync(req, deps);

      const body = await res.json();
      expect(body.processed).toBe(1);
      expect(body.errors).toHaveLength(0);
    });

    it('still processes an incremental Lynk row (initial_sync_done=true): processDayTransactions IS called', async () => {
      const { deps } = makeDeps({
        serviceClientOpts: { claimRows: [MOCK_LYNK_INCREMENTAL] },
      });
      const req = makeRequest({ authHeader: `Bearer ${SERVICE_ROLE_KEY}` });
      await handleBulkSync(req, deps);

      // Incremental path calls processDayTransactions twice (last 2 business days)
      expect(mockedProcessDayTransactions).toHaveBeenCalledTimes(2);
    });

    it('still processes a portal backfilling row (no api_key): fetch IS called', async () => {
      const { deps, fetchMock } = makeDeps({
        serviceClientOpts: { claimRows: [MOCK_CONN_BACKFILL] },
      });
      const req = makeRequest({ authHeader: `Bearer ${SERVICE_ROLE_KEY}` });
      await handleBulkSync(req, deps);

      // Portal path calls fetch (for processReportDay)
      expect(fetchMock).toHaveBeenCalled();
      // processDayTransactions is NOT called for portal rows
      expect(mockedProcessDayTransactions).not.toHaveBeenCalled();
    });

    it('persists connection_status="error" when Lynk incremental processDayTransactions fails (9d fix)', async () => {
      // Make the incremental sync fail on both days
      mockedProcessDayTransactions.mockResolvedValue({ status: 'error', error: 'Lynk API 503' });

      const { deps, mocks } = makeDeps({
        serviceClientOpts: { claimRows: [MOCK_LYNK_INCREMENTAL] },
      });
      const req = makeRequest({ authHeader: `Bearer ${SERVICE_ROLE_KEY}` });
      await handleBulkSync(req, deps);

      // Best-effort error-state write fires asynchronously; wait for microtasks
      await Promise.resolve();

      // The best-effort update must write connection_status='error'
      const updateCalls = mocks.updateMock.mock.calls as [Record<string, unknown>][];
      const errorWrite = updateCalls.find(
        ([payload]: [Record<string, unknown>]) => payload.connection_status === 'error',
      );
      expect(errorWrite).toBeDefined();
      const errorPayload = errorWrite![0] as Record<string, unknown>;
      expect(typeof errorPayload.last_error).toBe('string');
    });

    it('writes exponential backoff (consecutive_failures/next_attempt_at) on failed connections instead of bumping last_sync_time (9d fix, superseded by the backoff contract)', async () => {
      // Make the incremental sync fail so the catch block runs
      mockedProcessDayTransactions.mockResolvedValue({ status: 'error', error: 'Network error' });

      const { deps, mocks } = makeDeps({
        serviceClientOpts: { claimRows: [MOCK_LYNK_INCREMENTAL] },
      });
      const req = makeRequest({ authHeader: `Bearer ${SERVICE_ROLE_KEY}` });
      const res = await handleBulkSync(req, deps);

      // The sync counts as an error, not processed
      const body = await res.json();
      expect(body.processed).toBe(0);
      expect(body.errors.length).toBeGreaterThan(0);

      // Backoff write fires asynchronously; wait for microtasks
      await Promise.resolve();

      // update must have been called at least once for the backoff write.
      // The claim already bumped last_sync_time, so the failure path writes
      // consecutive_failures/next_attempt_at instead — never last_sync_time
      // (round-robin starvation prevention is now handled by the claim itself).
      expect(mocks.updateMock).toHaveBeenCalled();
      const updateCalls = mocks.updateMock.mock.calls as [Record<string, unknown>][];
      const backoffCall = updateCalls.find(
        ([payload]: [Record<string, unknown>]) =>
          payload.consecutive_failures !== undefined && payload.connection_status === undefined,
      );
      expect(backoffCall).toBeDefined();
      const backoffPayload = backoffCall![0] as Record<string, unknown>;
      expect(backoffPayload.last_sync_time).toBeUndefined();
      expect(typeof backoffPayload.next_attempt_at).toBe('string');
    });
  });

  // ── Claim-RPC selection (design review #1: atomic UPDATE…SKIP LOCKED…RETURNING) ──

  describe('claim-based selection', () => {
    it('selects connections via claim_focus_sync_batch RPC with p_limit 5', async () => {
      const { deps, mocks } = makeDeps({ serviceClientOpts: { claimRows: [lynkRow()] } });
      const req = makeRequest({ authHeader: `Bearer ${SERVICE_ROLE_KEY}` });
      await handleBulkSync(req, deps);
      expect(mocks.rpcMock).toHaveBeenCalledWith('claim_focus_sync_batch', { p_limit: 5 });
    });

    it('returns 500 when the claim RPC errors', async () => {
      const { deps } = makeDeps({ serviceClientOpts: { claimRows: [], claimError: { message: 'rpc down' } } });
      const req = makeRequest({ authHeader: `Bearer ${SERVICE_ROLE_KEY}` });
      const res = await handleBulkSync(req, deps);
      expect(res.status).toBe(500);
    });

    it('returns processed:0 when the claim returns no rows', async () => {
      const { deps } = makeDeps({ serviceClientOpts: { claimRows: [] } });
      const req = makeRequest({ authHeader: `Bearer ${SERVICE_ROLE_KEY}` });
      const res = await handleBulkSync(req, deps);
      expect(await res.json()).toMatchObject({ processed: 0, errors: [] });
    });
  });

  // ── Backoff contract (design review #4) ─────────────────────────────────────────
  //
  // The claim RPC bumps last_sync_time unconditionally when it claims a row, so
  // backoff only exists if the worker's failure path POSITIVELY writes both
  // consecutive_failures and next_attempt_at — this replaces the old best-effort
  // "bump last_sync_time on failure" (deleted; see the B5 test above for the
  // pre-change behavior this supersedes).

  describe('backoff contract (design review #4)', () => {
    beforeEach(async () => {
      const txModule = await import('../../supabase/functions/_shared/focusTransactionSyncHandler');
      vi.mocked(txModule.processDayTransactions).mockResolvedValue({ status: 'ok' });
    });

    it('a failed connection writes consecutive_failures+1 and a future next_attempt_at (NOT a bare last_sync_time bump)', async () => {
      const txModule = await import('../../supabase/functions/_shared/focusTransactionSyncHandler');
      vi.mocked(txModule.processDayTransactions).mockResolvedValue({ status: 'error', error: 'boom' });

      const { deps, mocks } = makeDeps({
        serviceClientOpts: { claimRows: [lynkRow({ consecutive_failures: 1 })] },
      });
      const req = makeRequest({ authHeader: `Bearer ${SERVICE_ROLE_KEY}` });
      await handleBulkSync(req, deps);
      await Promise.resolve(); // best-effort writes fire asynchronously

      const update = mocks.updateCalls.find((c) => c.payload.consecutive_failures !== undefined);
      expect(update).toBeDefined();
      expect(update!.payload.consecutive_failures).toBe(2);
      // 15 min × 2^2 = 60 min
      const delta = Date.parse(update!.payload.next_attempt_at as string) - NOW_MS;
      expect(delta).toBeGreaterThanOrEqual(59 * 60 * 1000);
      expect(delta).toBeLessThanOrEqual(61 * 60 * 1000);
      expect(update!.payload.last_sync_time).toBeUndefined(); // claim already bumped it
    });

    it('backoff caps at 6 hours', async () => {
      const txModule = await import('../../supabase/functions/_shared/focusTransactionSyncHandler');
      vi.mocked(txModule.processDayTransactions).mockResolvedValue({ status: 'error', error: 'boom' });

      const { deps, mocks } = makeDeps({
        serviceClientOpts: { claimRows: [lynkRow({ consecutive_failures: 9 })] },
      });
      const req = makeRequest({ authHeader: `Bearer ${SERVICE_ROLE_KEY}` });
      await handleBulkSync(req, deps);
      await Promise.resolve();

      const update = mocks.updateCalls.find((c) => c.payload.consecutive_failures !== undefined);
      expect(update).toBeDefined();
      expect(Date.parse(update!.payload.next_attempt_at as string) - NOW_MS).toBe(6 * 60 * 60 * 1000);
    });

    it('a successful connection resets consecutive_failures to 0 and next_attempt_at to null', async () => {
      const { deps, mocks } = makeDeps({
        serviceClientOpts: {
          claimRows: [lynkRow({ consecutive_failures: 3, next_attempt_at: '2026-07-04T12:00:00Z' })],
        },
      });
      const req = makeRequest({ authHeader: `Bearer ${SERVICE_ROLE_KEY}` });
      await handleBulkSync(req, deps);

      const update = mocks.updateCalls.find((c) => c.payload.initial_sync_done !== undefined);
      expect(update).toBeDefined();
      expect(update!.payload.consecutive_failures).toBe(0);
      expect(update!.payload.next_attempt_at).toBeNull();
    });
  });
});
