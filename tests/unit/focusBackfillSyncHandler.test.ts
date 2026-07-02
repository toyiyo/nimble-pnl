/**
 * focusBackfillSyncHandler.test.ts
 *
 * Vitest unit tests for supabase/functions/_shared/focusBackfillSyncHandler.ts
 *
 * Coverage:
 *  - Bearer gate: 401 when Authorization header is absent
 *  - Bearer gate: 401 when token does not match the service-role key
 *  - Bearer gate: 401 for bare token (no "Bearer " prefix)
 *  - Query: selects only is_active=true AND initial_sync_done=false AND api_key IS NOT NULL
 *  - Query: ORDER BY last_sync_time ASC NULLS FIRST LIMIT 5
 *  - Processing: calls processBackfillBatch per restaurant with { maxDays:7 }
 *  - Processing: CAS write after each restaurant (sync_cursor unchanged → filters old cursor)
 *  - Processing: on batch error → writes connection_status='error' + last_error
 *  - Processing: 2s inter-restaurant sleep (injectable deps.sleep)
 *  - Processing: stops before new restaurants when 80s wall budget exceeded
 *  - Processing: per-restaurant error isolated → continues to next; errors[] surfaced
 *  - Returns 200 { processed, errors, elapsedMs }
 *  - Returns 200 { processed:0, errors:[] } when no backfilling Lynk connections found
 *
 * Design ref: plan B4; spec §5.3 (focusBackfillSyncHandler) + §8.1 (CAS) + §8.3 (error status).
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  handleBackfillSync,
  type BackfillSyncDeps,
} from '../../supabase/functions/_shared/focusBackfillSyncHandler';

// ── Mock encryption (handler decrypts api_secret_encrypted) ──────────────────

vi.mock('../../supabase/functions/_shared/encryption', () => ({
  getEncryptionService: vi.fn().mockResolvedValue({
    encrypt: vi.fn().mockResolvedValue('encrypted-secret'),
    decrypt: vi.fn().mockResolvedValue('test-api-secret'),
  }),
}));

// ── Mock processBackfillBatch ─────────────────────────────────────────────────
// We mock at module level so tests can override per-test.

vi.mock('../../supabase/functions/_shared/focusBackfillBatch', () => ({
  processBackfillBatch: vi.fn().mockResolvedValue({
    syncCursor: 7,
    initialSyncDone: false,
    daysProcessed: 7,
    status: 'ok' as const,
  }),
  TARGET_DAYS: 90,
}));

// ── Fixtures ──────────────────────────────────────────────────────────────────

const RESTAURANT_ID_1 = '00000000-0000-0000-0000-000000000001';
const RESTAURANT_ID_2 = '00000000-0000-0000-0000-000000000002';
const SERVICE_ROLE_KEY = 'test-service-role-key-b4';

/** A minimal focus_connections row for a backfilling Lynk connection. */
const MOCK_LYNK_BACKFILLING = {
  id: 'conn-backfill-1',
  restaurant_id: RESTAURANT_ID_1,
  store_id: 'store-001',
  timezone: 'America/Chicago',
  initial_sync_done: false,
  sync_cursor: 0,
  last_sync_time: null,
  api_key: 'api-key-1',
  api_secret_encrypted: 'encrypted-secret-1',
  environment: 'production',
};

const MOCK_LYNK_BACKFILLING_2 = {
  ...MOCK_LYNK_BACKFILLING,
  id: 'conn-backfill-2',
  restaurant_id: RESTAURANT_ID_2,
  sync_cursor: 14,
  last_sync_time: '2026-07-01T00:00:00Z',
  api_key: 'api-key-2',
  api_secret_encrypted: 'encrypted-secret-2',
};

// ── Builders ──────────────────────────────────────────────────────────────────

/**
 * Build a service client mock that supports the chained query the handler uses:
 *   .from('focus_connections').select(...).eq('is_active',true)
 *     .eq('initial_sync_done',false).not('api_key','is',null)
 *     .order(...).limit(5)
 *
 * And the CAS update chain:
 *   .from('focus_connections').update(data).eq('id',...).eq('restaurant_id',...).eq('sync_cursor',old).select()
 */
function makeServiceClientMock(opts: {
  connections?: unknown[];
  queryError?: { message: string } | null;
  casRowCount?: number; // 1 = CAS succeeded, 0 = another tick won
} = {}) {
  const connections = opts.connections !== undefined ? opts.connections : [MOCK_LYNK_BACKFILLING];
  const queryError = opts.queryError ?? null;
  const casRowCount = opts.casRowCount ?? 1;

  // SELECT chain: .select(...).eq('is_active',...).eq('initial_sync_done',...).not(...).order(...).limit(5)
  const limitMock = vi.fn().mockResolvedValue({ data: connections, error: queryError });
  const orderMock = vi.fn().mockReturnValue({ limit: limitMock });
  const notMock = vi.fn().mockReturnValue({ order: orderMock });
  const eqInitialSyncMock = vi.fn().mockReturnValue({ not: notMock });
  const eqActiveMock = vi.fn().mockReturnValue({ eq: eqInitialSyncMock });
  const selectQueryMock = vi.fn().mockReturnValue({ eq: eqActiveMock });

  // CAS UPDATE chain: .update(data).eq('id',...).eq('restaurant_id',...).eq('sync_cursor',old).select()
  const casSelectMock = vi.fn().mockResolvedValue({
    data: casRowCount === 0 ? [] : [{ id: 'conn-backfill-1' }],
    error: null,
  });
  const casEq3Mock = vi.fn().mockReturnValue({ select: casSelectMock });
  const casEq2Mock = vi.fn().mockReturnValue({ eq: casEq3Mock });
  const casEq1Mock = vi.fn().mockReturnValue({ eq: casEq2Mock });
  const updateMock = vi.fn().mockReturnValue({ eq: casEq1Mock });

  const fromMock = vi.fn().mockImplementation((table: string) => {
    if (table === 'focus_connections') {
      return {
        select: selectQueryMock,
        update: updateMock,
      };
    }
    return { select: selectQueryMock, update: updateMock };
  });

  return {
    client: { from: fromMock },
    mocks: {
      fromMock,
      selectQueryMock,
      eqActiveMock,
      eqInitialSyncMock,
      notMock,
      orderMock,
      limitMock,
      updateMock,
      casEq1Mock,
      casEq2Mock,
      casEq3Mock,
      casSelectMock,
    },
  };
}

function makeSleepMock() {
  return vi.fn().mockResolvedValue(undefined);
}

function makeClock(startMs: number, stepMs = 0) {
  let current = startMs;
  return () => {
    const t = current;
    current += stepMs;
    return t;
  };
}

function makeRequest(opts: { authHeader?: string | null } = {}): Request {
  const headers = new Headers();
  if (opts.authHeader !== null && opts.authHeader !== undefined) {
    headers.set('Authorization', opts.authHeader);
  }
  return new Request('https://example.com/functions/v1/focus-backfill-sync', {
    method: 'POST',
    headers,
    body: JSON.stringify({}),
  });
}

function makeDeps(opts: {
  serviceClientOpts?: Parameters<typeof makeServiceClientMock>[0];
  nowFn?: () => number;
  serviceRoleKey?: string;
} = {}): { deps: BackfillSyncDeps; mocks: ReturnType<typeof makeServiceClientMock>['mocks']; sleepMock: ReturnType<typeof makeSleepMock> } {
  const { client: serviceClient, mocks } = makeServiceClientMock(opts.serviceClientOpts ?? {});
  const sleepMock = makeSleepMock();

  return {
    deps: {
      serviceClient: serviceClient as BackfillSyncDeps['serviceClient'],
      sleep: sleepMock,
      now: opts.nowFn ?? makeClock(Date.now()),
      serviceRoleKey: opts.serviceRoleKey ?? SERVICE_ROLE_KEY,
    },
    mocks,
    sleepMock,
  };
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('handleBackfillSync', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  // ── Bearer gate ──────────────────────────────────────────────────────────────

  it('returns 401 when Authorization header is absent', async () => {
    const { deps } = makeDeps();
    const req = makeRequest({ authHeader: null });
    const res = await handleBackfillSync(req, deps);

    expect(res.status).toBe(401);
    const body = await res.json();
    expect(body).toHaveProperty('error');
  });

  it('returns 401 when the Bearer token does not match the service-role key', async () => {
    const { deps } = makeDeps();
    const req = makeRequest({ authHeader: 'Bearer WRONG-KEY' });
    const res = await handleBackfillSync(req, deps);

    expect(res.status).toBe(401);
    const body = await res.json();
    expect(body).toHaveProperty('error');
  });

  it('returns 401 for a bare token without the "Bearer " prefix', async () => {
    const { deps } = makeDeps();
    const req = makeRequest({ authHeader: SERVICE_ROLE_KEY }); // no prefix
    const res = await handleBackfillSync(req, deps);

    expect(res.status).toBe(401);
  });

  // ── Connection query ──────────────────────────────────────────────────────────

  describe('query shape (backfilling Lynk rows only)', () => {
    let mocks: ReturnType<typeof makeServiceClientMock>['mocks'];

    beforeEach(async () => {
      const result = makeDeps({
        serviceClientOpts: { connections: [MOCK_LYNK_BACKFILLING] },
      });
      mocks = result.mocks;
      const req = makeRequest({ authHeader: `Bearer ${SERVICE_ROLE_KEY}` });
      await handleBackfillSync(req, result.deps);
    });

    it('queries focus_connections table', () => {
      expect(mocks.fromMock).toHaveBeenCalledWith('focus_connections');
    });

    it('filters by is_active=true', () => {
      expect(mocks.eqActiveMock).toHaveBeenCalledWith('is_active', true);
    });

    it('filters by initial_sync_done=false (only backfilling rows)', () => {
      expect(mocks.eqInitialSyncMock).toHaveBeenCalledWith('initial_sync_done', false);
    });

    it('excludes rows where api_key IS NULL (Lynk path only)', () => {
      expect(mocks.notMock).toHaveBeenCalledWith('api_key', 'is', null);
    });

    it('orders by last_sync_time ASC NULLS FIRST (round-robin)', () => {
      const orderCall = mocks.orderMock.mock.calls[0];
      expect(orderCall[0]).toBe('last_sync_time');
      expect(orderCall[1]).toMatchObject({ ascending: true, nullsFirst: true });
    });

    it('limits to 5 connections per run', () => {
      expect(mocks.limitMock).toHaveBeenCalledWith(5);
    });
  });

  // ── Happy path ────────────────────────────────────────────────────────────────

  describe('happy path (one backfilling connection)', () => {
    let response: Response;
    let mocks: ReturnType<typeof makeServiceClientMock>['mocks'];

    beforeEach(async () => {
      const result = makeDeps({
        serviceClientOpts: { connections: [MOCK_LYNK_BACKFILLING] },
        nowFn: makeClock(1_000_000, 0),
      });
      mocks = result.mocks;
      const req = makeRequest({ authHeader: `Bearer ${SERVICE_ROLE_KEY}` });
      response = await handleBackfillSync(req, result.deps);
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
  });

  // ── processBackfillBatch integration ──────────────────────────────────────────

  it('calls processBackfillBatch with maxDays=7 for each connection', async () => {
    const { processBackfillBatch: mockBatch } = await import(
      '../../supabase/functions/_shared/focusBackfillBatch'
    );

    const { deps } = makeDeps({
      serviceClientOpts: { connections: [MOCK_LYNK_BACKFILLING] },
    });
    const req = makeRequest({ authHeader: `Bearer ${SERVICE_ROLE_KEY}` });
    await handleBackfillSync(req, deps);

    expect(mockBatch).toHaveBeenCalledTimes(1);
    const callOpts = (mockBatch as ReturnType<typeof vi.fn>).mock.calls[0][2] as Record<string, unknown>;
    expect(callOpts.maxDays).toBe(7);
  });

  // ── CAS write ────────────────────────────────────────────────────────────────

  it('writes cursor update with CAS filter on the old sync_cursor value', async () => {
    const { deps, mocks } = makeDeps({
      serviceClientOpts: { connections: [MOCK_LYNK_BACKFILLING] },
    });
    const req = makeRequest({ authHeader: `Bearer ${SERVICE_ROLE_KEY}` });
    await handleBackfillSync(req, deps);

    // Should update focus_connections
    expect(mocks.updateMock).toHaveBeenCalledTimes(1);

    // CAS chain: .eq('id', ...).eq('restaurant_id', ...).eq('sync_cursor', oldCursor).select()
    // The third eq() call carries the CAS cursor filter
    expect(mocks.casEq3Mock).toHaveBeenCalledWith('sync_cursor', MOCK_LYNK_BACKFILLING.sync_cursor);
    expect(mocks.casSelectMock).toHaveBeenCalledTimes(1);
  });

  it('persists the new sync_cursor returned by processBackfillBatch', async () => {
    const { deps, mocks } = makeDeps({
      serviceClientOpts: { connections: [MOCK_LYNK_BACKFILLING] },
    });
    const req = makeRequest({ authHeader: `Bearer ${SERVICE_ROLE_KEY}` });
    await handleBackfillSync(req, deps);

    // processBackfillBatch mock returns syncCursor=7
    const updateArg = mocks.updateMock.mock.calls[0][0] as Record<string, unknown>;
    expect(updateArg.sync_cursor).toBe(7);
  });

  // ── Error status write ────────────────────────────────────────────────────────

  it('writes connection_status=error and last_error when processBackfillBatch returns error', async () => {
    const { processBackfillBatch: mockBatch } = await import(
      '../../supabase/functions/_shared/focusBackfillBatch'
    );
    (mockBatch as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      syncCursor: 0,
      initialSyncDone: false,
      daysProcessed: 0,
      status: 'error' as const,
      lastError: 'Lynk API timeout',
    });

    const { deps, mocks } = makeDeps({
      serviceClientOpts: { connections: [MOCK_LYNK_BACKFILLING] },
    });
    const req = makeRequest({ authHeader: `Bearer ${SERVICE_ROLE_KEY}` });
    await handleBackfillSync(req, deps);

    const updateArg = mocks.updateMock.mock.calls[0][0] as Record<string, unknown>;
    expect(updateArg.connection_status).toBe('error');
    expect(updateArg.last_error).toBe('Lynk API timeout');
    expect(typeof updateArg.last_error_at).toBe('string');
  });

  // ── Inter-restaurant delay ─────────────────────────────────────────────────────

  it('sleeps 2000ms between restaurants (not before first)', async () => {
    const { deps, sleepMock } = makeDeps({
      serviceClientOpts: {
        connections: [MOCK_LYNK_BACKFILLING, MOCK_LYNK_BACKFILLING_2],
      },
    });
    const req = makeRequest({ authHeader: `Bearer ${SERVICE_ROLE_KEY}` });
    await handleBackfillSync(req, deps);

    expect(sleepMock).toHaveBeenCalledTimes(1);
    expect(sleepMock).toHaveBeenCalledWith(2000);
  });

  it('does not sleep when only one connection is processed', async () => {
    const { deps, sleepMock } = makeDeps({
      serviceClientOpts: { connections: [MOCK_LYNK_BACKFILLING] },
    });
    const req = makeRequest({ authHeader: `Bearer ${SERVICE_ROLE_KEY}` });
    await handleBackfillSync(req, deps);

    expect(sleepMock).not.toHaveBeenCalled();
  });

  // ── Wall-clock budget guard ────────────────────────────────────────────────────

  it('stops processing additional restaurants when 80s wall budget is exceeded', async () => {
    // After the first restaurant, clock returns startMs + 81_000 → over 80s budget
    const startMs = 2_000_000;
    let callCount = 0;
    const nowMock = () => {
      callCount++;
      if (callCount === 1) return startMs; // initial startMs capture
      return startMs + 81_000; // subsequent calls → over budget
    };

    const { processBackfillBatch: mockBatch } = await import(
      '../../supabase/functions/_shared/focusBackfillBatch'
    );

    const { deps } = makeDeps({
      serviceClientOpts: {
        connections: [MOCK_LYNK_BACKFILLING, MOCK_LYNK_BACKFILLING_2],
      },
      nowFn: nowMock,
    });
    const req = makeRequest({ authHeader: `Bearer ${SERVICE_ROLE_KEY}` });
    const res = await handleBackfillSync(req, deps);

    const body = await res.json();
    // Only 1 processed (second skipped due to budget)
    expect(body.processed).toBe(1);
    // processBackfillBatch called only once
    expect(mockBatch).toHaveBeenCalledTimes(1);
  });

  // ── Per-restaurant error isolation ────────────────────────────────────────────

  it('continues to next connection when one throws, surfacing the error in errors[]', async () => {
    const { processBackfillBatch: mockBatch } = await import(
      '../../supabase/functions/_shared/focusBackfillBatch'
    );
    // First call throws, second returns ok
    (mockBatch as ReturnType<typeof vi.fn>)
      .mockRejectedValueOnce(new Error('Decryption failed'))
      .mockResolvedValueOnce({
        syncCursor: 7,
        initialSyncDone: false,
        daysProcessed: 7,
        status: 'ok' as const,
      });

    const { deps } = makeDeps({
      serviceClientOpts: {
        connections: [MOCK_LYNK_BACKFILLING, MOCK_LYNK_BACKFILLING_2],
      },
    });
    const req = makeRequest({ authHeader: `Bearer ${SERVICE_ROLE_KEY}` });
    const res = await handleBackfillSync(req, deps);

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.processed).toBe(1);
    expect(body.errors).toHaveLength(1);
    expect(body.errors[0]).toMatch(/Decryption failed/);
  });

  // ── No connections ─────────────────────────────────────────────────────────────

  it('returns 200 with processed=0 when no backfilling Lynk connections exist', async () => {
    const { deps } = makeDeps({
      serviceClientOpts: { connections: [] },
    });
    const req = makeRequest({ authHeader: `Bearer ${SERVICE_ROLE_KEY}` });
    const res = await handleBackfillSync(req, deps);

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.processed).toBe(0);
    expect(body.errors).toHaveLength(0);
  });

  // ── DB query error ─────────────────────────────────────────────────────────────

  it('returns 500 when the connection query fails', async () => {
    const { deps } = makeDeps({
      serviceClientOpts: {
        connections: null as unknown as unknown[],
        queryError: { message: 'DB connection refused' },
      },
    });
    const req = makeRequest({ authHeader: `Bearer ${SERVICE_ROLE_KEY}` });
    const res = await handleBackfillSync(req, deps);

    expect(res.status).toBe(500);
  });

  // ── Two connections both processed ────────────────────────────────────────────

  it('processes two connections and reports processed=2', async () => {
    const { processBackfillBatch: mockBatch } = await import(
      '../../supabase/functions/_shared/focusBackfillBatch'
    );

    const { deps } = makeDeps({
      serviceClientOpts: {
        connections: [MOCK_LYNK_BACKFILLING, MOCK_LYNK_BACKFILLING_2],
      },
      nowFn: makeClock(1_000_000, 0), // time doesn't advance → no budget exceeded
    });
    const req = makeRequest({ authHeader: `Bearer ${SERVICE_ROLE_KEY}` });
    const res = await handleBackfillSync(req, deps);

    const body = await res.json();
    expect(body.processed).toBe(2);
    expect(body.errors).toHaveLength(0);
    expect(mockBatch).toHaveBeenCalledTimes(2);
  });

  // ── CAS miss: another tick already won ───────────────────────────────────────

  it('does NOT increment processed when CAS write returns 0 rows (concurrent tick won)', async () => {
    const { deps } = makeDeps({
      serviceClientOpts: {
        connections: [MOCK_LYNK_BACKFILLING],
        casRowCount: 0, // 0 rows → another tick already advanced the cursor
      },
    });
    const req = makeRequest({ authHeader: `Bearer ${SERVICE_ROLE_KEY}` });
    const res = await handleBackfillSync(req, deps);

    expect(res.status).toBe(200);
    const body = await res.json();
    // CAS miss → not counted as processed
    expect(body.processed).toBe(0);
    expect(body.errors).toHaveLength(0);
  });

  // ── Sandbox URL threading ─────────────────────────────────────────────────────

  it('uses sandboxBaseUrl as baseUrl when environment=sandbox', async () => {
    const { processBackfillBatch: mockBatch } = await import(
      '../../supabase/functions/_shared/focusBackfillBatch'
    );

    const sandboxConn = { ...MOCK_LYNK_BACKFILLING, environment: 'sandbox' };
    const { deps } = makeDeps({
      serviceClientOpts: { connections: [sandboxConn] },
    });
    // Provide a sandboxBaseUrl dep
    const depsWithSandbox = { ...deps, sandboxBaseUrl: 'https://sandbox.focuspos.com' };

    const req = makeRequest({ authHeader: `Bearer ${SERVICE_ROLE_KEY}` });
    await handleBackfillSync(req, depsWithSandbox);

    // processBackfillBatch receives the txConfig. The config's baseUrl should
    // use the sandbox URL since environment='sandbox' and sandboxBaseUrl is set.
    expect(mockBatch).toHaveBeenCalledTimes(1);
    const txConfig = (mockBatch as ReturnType<typeof vi.fn>).mock.calls[0][1] as { baseUrl: string };
    expect(txConfig.baseUrl).toBe('https://sandbox.focuspos.com');
  });

  // ── Guard completeness: api_key included ─────────────────────────────────────

  it('throws and writes error state when api_key is missing (guard completeness)', async () => {
    // Row matches query filter (api_key IS NOT NULL) but mock can return one without it
    // to simulate an edge-case or future query-filter gap.
    const rowWithoutApiKey = { ...MOCK_LYNK_BACKFILLING, api_key: null };
    const { deps, mocks } = makeDeps({
      serviceClientOpts: { connections: [rowWithoutApiKey] },
    });
    const req = makeRequest({ authHeader: `Bearer ${SERVICE_ROLE_KEY}` });
    const res = await handleBackfillSync(req, deps);

    expect(res.status).toBe(200);
    const body = await res.json();
    // Connection is in errors[] because guard threw
    expect(body.errors).toHaveLength(1);
    expect(body.errors[0]).toMatch(/api_key/);
    // processed is 0 (guard threw before CAS)
    expect(body.processed).toBe(0);
    // Best-effort error-state write was fired (update was called for the error path)
    expect(mocks.updateMock).toHaveBeenCalled();
  });

  // ── Starvation prevention: error path writes last_sync_time ──────────────────

  it('writes last_sync_time + connection_status=error when processing throws, to prevent round-robin starvation', async () => {
    const { processBackfillBatch: mockBatch } = await import(
      '../../supabase/functions/_shared/focusBackfillBatch'
    );
    (mockBatch as ReturnType<typeof vi.fn>).mockRejectedValueOnce(new Error('Decryption failed'));

    const { deps, mocks } = makeDeps({
      serviceClientOpts: { connections: [MOCK_LYNK_BACKFILLING] },
    });
    const req = makeRequest({ authHeader: `Bearer ${SERVICE_ROLE_KEY}` });
    await handleBackfillSync(req, deps);

    // Best-effort update must have been called (fires-and-forgets from catch block)
    expect(mocks.updateMock).toHaveBeenCalled();
    const updateArg = mocks.updateMock.mock.calls[0][0] as Record<string, unknown>;
    expect(typeof updateArg.last_sync_time).toBe('string');
    expect(updateArg.connection_status).toBe('error');
    expect(typeof updateArg.last_error).toBe('string');
  });
});
