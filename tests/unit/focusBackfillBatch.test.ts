/**
 * focusBackfillBatch.test.ts
 *
 * Vitest unit tests for supabase/functions/_shared/focusBackfillBatch.ts
 *
 * Coverage:
 *  - advances cursor N days for N ok-days within budget
 *  - stops at maxDays cap; returns cursor advanced by maxDays
 *  - stops at budgetMs using injectable clock (via opts.clock)
 *  - stops + returns un-advanced cursor + lastError on a day error
 *  - stops (no advance) on day inprogress
 *  - sets initialSyncDone when cursor >= targetDays
 *  - targetDays param honored (test uses small value)
 *  - pure: never calls DB/serviceClient directly
 *  - daysProcessed reflects only ok/empty days
 *
 * Design ref: plan §B1; spec §5.1 + §8.3.
 */

import { describe, it, expect, vi } from 'vitest';
import {
  processBackfillBatch,
  TARGET_DAYS,
  type BackfillBatchConfig,
  type BackfillBatchOpts,
  type BackfillBatchDeps,
} from '../../supabase/functions/_shared/focusBackfillBatch';
import type { TransactionSyncDeps, TransactionSyncConfig } from '../../supabase/functions/_shared/focusTransactionSyncHandler';
import type { TransactionSyncResult } from '../../supabase/functions/_shared/focusTransactionSyncHandler';

// ── Fixtures ──────────────────────────────────────────────────────────────────

const RESTAURANT_ID = '00000000-0000-0000-0000-000000000099';

const MOCK_CONFIG: BackfillBatchConfig = {
  restaurantId: RESTAURANT_ID,
  storeId: 'store-123',
  apiKey: 'api-key',
  apiSecret: 'api-secret',
  baseUrl: 'https://pos-api.focuspos.com',
};

const BASE_OPTS: BackfillBatchOpts = {
  syncCursor: 0,
  timezone: 'America/Chicago',
  now: new Date('2026-07-02T14:00:00Z'), // Chicago noon: 2026-07-02
  budgetMs: 60_000,
  maxDays: 5,
  // targetDays defaults to TARGET_DAYS (90)
};

// ── Builders ──────────────────────────────────────────────────────────────────

/**
 * Build injectable deps + a clock spy for budget tests.
 *
 * `clockTimes` — if provided, the clock spy returns those values in sequence.
 * The clock is passed as `opts.clock` when calling processBackfillBatch.
 */
function makeDeps(
  dayResults: TransactionSyncResult[],
  clockTimes: number[] = [],
): { deps: BackfillBatchDeps; clock: ReturnType<typeof vi.fn> } {
  let callIndex = 0;

  const processDayTransactions = vi.fn(async (): Promise<TransactionSyncResult> => {
    const result = dayResults[callIndex] ?? { status: 'ok', checksWritten: 0 };
    callIndex++;
    return result;
  });

  // Clock spy — passed via opts.clock in budget tests
  let clockCallIndex = 0;
  const clock = clockTimes.length > 0
    ? vi.fn(() => clockTimes[clockCallIndex++] ?? clockTimes[clockTimes.length - 1])
    : vi.fn(() => Date.now()); // real time (fast tests won't exceed budget)

  // Minimal mock supabase — processBackfillBatch must never call it directly
  const mockSupabase = {
    from: vi.fn(() => { throw new Error('processBackfillBatch must not call supabase directly'); }),
    rpc: vi.fn(() => { throw new Error('processBackfillBatch must not call supabase directly'); }),
  } as unknown as TransactionSyncDeps['supabase'];

  const mockFetchDatafeed = vi.fn(() => {
    throw new Error('processBackfillBatch must not call fetchDatafeed directly');
  }) as unknown as TransactionSyncDeps['fetchDatafeed'];

  const deps: BackfillBatchDeps = {
    supabase: mockSupabase,
    fetchDatafeed: mockFetchDatafeed,
    processDayTransactions,
  };

  return { deps, clock };
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('TARGET_DAYS constant', () => {
  it('equals 90', () => {
    expect(TARGET_DAYS).toBe(90);
  });
});

describe('processBackfillBatch', () => {
  // ── Advances cursor for ok days ────────────────────────────────────────────

  it('advances cursor by 1 when one ok day is processed', async () => {
    const { deps } = makeDeps([{ status: 'ok', checksWritten: 3 }]);
    const result = await processBackfillBatch(
      deps,
      MOCK_CONFIG,
      { ...BASE_OPTS, maxDays: 1 },
    );

    expect(result.syncCursor).toBe(1);
    expect(result.daysProcessed).toBe(1);
    expect(result.status).toBe('ok');
    expect(result.initialSyncDone).toBe(false);
  });

  it('advances cursor by N for N consecutive ok days (N=3)', async () => {
    const { deps } = makeDeps([
      { status: 'ok', checksWritten: 1 },
      { status: 'ok', checksWritten: 2 },
      { status: 'ok', checksWritten: 3 },
    ]);
    const result = await processBackfillBatch(
      deps,
      MOCK_CONFIG,
      { ...BASE_OPTS, maxDays: 3 },
    );

    expect(result.syncCursor).toBe(3);
    expect(result.daysProcessed).toBe(3);
    expect(result.status).toBe('ok');
  });

  it('counts empty days in daysProcessed and advances cursor', async () => {
    const { deps } = makeDeps([
      { status: 'ok', checksWritten: 1 },
      { status: 'empty' },
      { status: 'ok', checksWritten: 2 },
    ]);
    const result = await processBackfillBatch(
      deps,
      MOCK_CONFIG,
      { ...BASE_OPTS, maxDays: 3 },
    );

    expect(result.syncCursor).toBe(3);
    expect(result.daysProcessed).toBe(3);
  });

  // ── Stops at maxDays cap ───────────────────────────────────────────────────

  it('stops at maxDays (5 ok days, maxDays=5)', async () => {
    const { deps } = makeDeps(Array(10).fill({ status: 'ok', checksWritten: 1 }));
    const result = await processBackfillBatch(
      deps,
      MOCK_CONFIG,
      { ...BASE_OPTS, maxDays: 5 },
    );

    expect(result.daysProcessed).toBe(5);
    expect(result.syncCursor).toBe(5);
    expect((deps.processDayTransactions as ReturnType<typeof vi.fn>).mock.calls.length).toBe(5);
  });

  it('stops at maxDays=1 after processing exactly one day', async () => {
    const { deps } = makeDeps(Array(5).fill({ status: 'ok', checksWritten: 1 }));
    const result = await processBackfillBatch(
      deps,
      MOCK_CONFIG,
      { ...BASE_OPTS, maxDays: 1 },
    );

    expect(result.daysProcessed).toBe(1);
    expect(result.syncCursor).toBe(1);
  });

  // ── Stops when cursor reaches targetDays ──────────────────────────────────

  it('stops when cursor reaches targetDays even if maxDays not hit (small targetDays)', async () => {
    const { deps } = makeDeps(Array(10).fill({ status: 'ok', checksWritten: 1 }));
    // cursor=3, targetDays=5 → can advance at most 2 more days
    const result = await processBackfillBatch(
      deps,
      MOCK_CONFIG,
      { ...BASE_OPTS, syncCursor: 3, maxDays: 10, targetDays: 5 },
    );

    expect(result.syncCursor).toBe(5);
    expect(result.daysProcessed).toBe(2);
    expect(result.initialSyncDone).toBe(true);
  });

  // ── Sets initialSyncDone when cursor reaches targetDays ───────────────────

  it('sets initialSyncDone=true when cursor reaches 90 (default TARGET_DAYS)', async () => {
    // Start at 89, one ok day → cursor becomes 90
    const { deps } = makeDeps([{ status: 'ok', checksWritten: 1 }]);
    const result = await processBackfillBatch(
      deps,
      MOCK_CONFIG,
      { ...BASE_OPTS, syncCursor: 89, maxDays: 5 },
    );

    expect(result.syncCursor).toBe(90);
    expect(result.initialSyncDone).toBe(true);
    expect(result.daysProcessed).toBe(1);
  });

  it('sets initialSyncDone=true at a custom targetDays value', async () => {
    const { deps } = makeDeps([
      { status: 'ok', checksWritten: 1 },
      { status: 'ok', checksWritten: 1 },
    ]);
    const result = await processBackfillBatch(
      deps,
      MOCK_CONFIG,
      { ...BASE_OPTS, syncCursor: 0, maxDays: 5, targetDays: 2 },
    );

    expect(result.syncCursor).toBe(2);
    expect(result.initialSyncDone).toBe(true);
  });

  it('does not set initialSyncDone when cursor stays below targetDays', async () => {
    const { deps } = makeDeps([{ status: 'ok', checksWritten: 1 }]);
    const result = await processBackfillBatch(
      deps,
      MOCK_CONFIG,
      { ...BASE_OPTS, syncCursor: 5, maxDays: 1, targetDays: 90 },
    );

    expect(result.syncCursor).toBe(6);
    expect(result.initialSyncDone).toBe(false);
  });

  // ── Stops on budgetMs using injectable clock (opts.clock) ─────────────────

  it('stops when elapsed exceeds budgetMs (injectable clock)', async () => {
    // Clock sequence: start=0, after day1 check=5000, after day2 check=12001 (>12s budget)
    const clockTimes = [0, 5_000, 12_001, 15_000];
    const { deps, clock } = makeDeps(
      Array(5).fill({ status: 'ok', checksWritten: 1 }),
      clockTimes,
    );

    const result = await processBackfillBatch(
      deps,
      MOCK_CONFIG,
      { ...BASE_OPTS, maxDays: 5, budgetMs: 12_000, clock },
    );

    // Should have processed only 1 day (budget exceeded before day 2 starts)
    expect(result.daysProcessed).toBe(1);
    expect(result.syncCursor).toBe(1);
  });

  it('processes all maxDays when budget is generous', async () => {
    // Clock increments 100ms per call — well within 60s budget
    let t = 0;
    const clockTimes = Array(20).fill(null).map(() => (t += 100));
    const { deps, clock } = makeDeps(
      Array(5).fill({ status: 'ok', checksWritten: 1 }),
      clockTimes,
    );

    const result = await processBackfillBatch(
      deps,
      MOCK_CONFIG,
      { ...BASE_OPTS, maxDays: 5, budgetMs: 60_000, clock },
    );

    expect(result.daysProcessed).toBe(5);
  });

  // ── Stops on error: un-advanced cursor, lastError set ─────────────────────

  it('stops on error and returns un-advanced cursor', async () => {
    const { deps } = makeDeps([
      { status: 'ok', checksWritten: 2 },
      { status: 'error', error: 'timeout fetching datafeed' },
      { status: 'ok', checksWritten: 1 },
    ]);
    const result = await processBackfillBatch(
      deps,
      MOCK_CONFIG,
      { ...BASE_OPTS, syncCursor: 3, maxDays: 5 },
    );

    // ok day: cursor→4; error day: stops, cursor stays at 4 (NOT advanced past error)
    expect(result.syncCursor).toBe(4);
    expect(result.daysProcessed).toBe(1);
    expect(result.status).toBe('error');
    expect(result.lastError).toBe('timeout fetching datafeed');
  });

  it('does not call processDayTransactions after an error day', async () => {
    const { deps } = makeDeps([
      { status: 'error', error: 'network failure' },
      { status: 'ok', checksWritten: 1 },
    ]);
    await processBackfillBatch(
      deps,
      MOCK_CONFIG,
      { ...BASE_OPTS, syncCursor: 0, maxDays: 5 },
    );

    expect((deps.processDayTransactions as ReturnType<typeof vi.fn>).mock.calls.length).toBe(1);
  });

  it('preserves lastError message from processDayTransactions', async () => {
    const { deps } = makeDeps([
      { status: 'error', error: 'Focus returned HTTP 503' },
    ]);
    const result = await processBackfillBatch(
      deps,
      MOCK_CONFIG,
      { ...BASE_OPTS, maxDays: 1 },
    );

    expect(result.lastError).toBe('Focus returned HTTP 503');
  });

  // ── Stops on inprogress: no advance ───────────────────────────────────────

  it('stops on inprogress and does not advance cursor', async () => {
    const { deps } = makeDeps([
      { status: 'ok', checksWritten: 1 },
      { status: 'inprogress' },
    ]);
    const result = await processBackfillBatch(
      deps,
      MOCK_CONFIG,
      { ...BASE_OPTS, syncCursor: 2, maxDays: 5 },
    );

    // ok day: cursor→3; inprogress: stops, cursor stays at 3
    expect(result.syncCursor).toBe(3);
    expect(result.daysProcessed).toBe(1);
    expect(result.status).toBe('ok'); // last completed day was ok
  });

  it('does not call processDayTransactions after an inprogress day', async () => {
    const { deps } = makeDeps([
      { status: 'inprogress' },
      { status: 'ok', checksWritten: 1 },
    ]);
    await processBackfillBatch(
      deps,
      MOCK_CONFIG,
      { ...BASE_OPTS, maxDays: 5 },
    );

    expect((deps.processDayTransactions as ReturnType<typeof vi.fn>).mock.calls.length).toBe(1);
  });

  // ── Calls processDayTransactions with correct date ────────────────────────

  it('calls processDayTransactions with the correct business date (cursor-based, newest-first)', async () => {
    const { deps } = makeDeps([{ status: 'ok', checksWritten: 1 }]);
    // now = 2026-07-02T14:00:00Z (Chicago = 2026-07-02)
    // cursor=0 → target = todayInTz - (0+1) = 2026-07-02 - 1 = 2026-07-01
    await processBackfillBatch(deps, MOCK_CONFIG, { ...BASE_OPTS, syncCursor: 0, maxDays: 1 });

    const calls = (deps.processDayTransactions as ReturnType<typeof vi.fn>).mock.calls;
    expect(calls.length).toBe(1);
    // Third arg is the business date
    expect(calls[0][2]).toBe('2026-07-01');
  });

  it('passes skipUnifiedSalesSync=true to processDayTransactions', async () => {
    const { deps } = makeDeps([{ status: 'ok', checksWritten: 1 }]);
    await processBackfillBatch(deps, MOCK_CONFIG, { ...BASE_OPTS, maxDays: 1 });

    const calls = (deps.processDayTransactions as ReturnType<typeof vi.fn>).mock.calls;
    const options = calls[0][3] as { skipUnifiedSalesSync?: boolean } | undefined;
    expect(options?.skipUnifiedSalesSync).toBe(true);
  });

  it('passes config (restaurantId, storeId, apiKey, baseUrl) to processDayTransactions', async () => {
    const { deps } = makeDeps([{ status: 'ok', checksWritten: 1 }]);
    await processBackfillBatch(deps, MOCK_CONFIG, { ...BASE_OPTS, maxDays: 1 });

    const calls = (deps.processDayTransactions as ReturnType<typeof vi.fn>).mock.calls;
    const config = calls[0][1] as BackfillBatchConfig;
    expect(config.restaurantId).toBe(RESTAURANT_ID);
    expect(config.storeId).toBe('store-123');
    expect(config.apiKey).toBe('api-key');
    expect(config.baseUrl).toBe('https://pos-api.focuspos.com');
  });

  // ── Pure: no direct DB access ──────────────────────────────────────────────

  it('never calls supabase.from directly (pure — DB writes are caller responsibility)', async () => {
    // The mockSupabase.from throws — if processBackfillBatch calls it we'll get an error
    const { deps } = makeDeps([{ status: 'ok', checksWritten: 1 }]);
    await expect(
      processBackfillBatch(deps, MOCK_CONFIG, { ...BASE_OPTS, maxDays: 1 }),
    ).resolves.not.toThrow();
    expect((deps.supabase.from as ReturnType<typeof vi.fn>).mock.calls.length).toBe(0);
  });

  // ── Starting cursor is already at or beyond targetDays ────────────────────

  it('returns initialSyncDone=true immediately when starting cursor >= targetDays', async () => {
    const { deps } = makeDeps([{ status: 'ok', checksWritten: 1 }]);
    const result = await processBackfillBatch(
      deps,
      MOCK_CONFIG,
      { ...BASE_OPTS, syncCursor: 90, maxDays: 5 }, // cursor already at TARGET_DAYS
    );

    expect(result.initialSyncDone).toBe(true);
    expect(result.daysProcessed).toBe(0);
    expect((deps.processDayTransactions as ReturnType<typeof vi.fn>).mock.calls.length).toBe(0);
  });

  // ── Status reflects last completed day ────────────────────────────────────

  it('returns status="empty" when last completed day was empty', async () => {
    const { deps } = makeDeps([
      { status: 'ok', checksWritten: 2 },
      { status: 'empty' },
    ]);
    const result = await processBackfillBatch(
      deps,
      MOCK_CONFIG,
      { ...BASE_OPTS, maxDays: 2 },
    );

    expect(result.status).toBe('empty');
    expect(result.daysProcessed).toBe(2);
  });
});
