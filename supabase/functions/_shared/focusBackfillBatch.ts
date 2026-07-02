/**
 * focusBackfillBatch.ts
 *
 * Shared, pure helper for the Focus POS Lynk backfill loop.
 *
 * Processes up to `maxDays` days (newest-first, cursor-indexed) within a
 * wall-clock `budgetMs` window. Used by:
 *   - focusSyncDataHandler (manual kick: budgetMs=12_000, maxDays=5)
 *   - focusBackfillSyncHandler (cron: budgetMs≈50_000, maxDays=7)
 *
 * Design ref: spec §5.1 + §8.3.
 *
 * PURE: never writes to the database. All cursor / flag / last_sync_time
 * persistence is the caller's responsibility (with CAS per §8.1).
 */

import {
  todayInTz,
  subtractDays,
} from './focusReportClient.ts';
import {
  processDayTransactions,
  type TransactionSyncDeps,
  type TransactionSyncConfig,
  type TransactionSyncResult,
} from './focusTransactionSyncHandler.ts';

// ── Constants ─────────────────────────────────────────────────────────────────

/** Number of past days to backfill before marking initial_sync_done=true. */
export const TARGET_DAYS = 90;

// ── Types ─────────────────────────────────────────────────────────────────────

/**
 * Per-connection config — mirrors TransactionSyncConfig (same fields).
 * Re-exported so callers don't need to import from two places.
 */
export type BackfillBatchConfig = TransactionSyncConfig;

/**
 * Options controlling the batch loop.
 */
export interface BackfillBatchOpts {
  /** Current sync_cursor value from the connection row (days already processed). */
  syncCursor: number;
  /** IANA timezone for the restaurant (e.g. 'America/Chicago'). */
  timezone: string;
  /** Wall-clock anchor for today's date calculation (injectable for tests). */
  now: Date;
  /** Maximum milliseconds to spend processing days. Loop exits when elapsed >= budgetMs. */
  budgetMs: number;
  /** Maximum number of days to process in one call (hard cap). */
  maxDays: number;
  /**
   * Total days to backfill before setting initialSyncDone=true.
   * Defaults to TARGET_DAYS (90). Override only in tests.
   */
  targetDays?: number;
  /**
   * Injectable wall-clock function for budget tracking.
   * Defaults to Date.now. Override in tests for deterministic budget tests.
   */
  clock?: () => number;
}

/**
 * Injectable dependencies (mirrors TransactionSyncDeps plus an injectable
 * processDayTransactions to keep this module testable without network/DB).
 */
export interface BackfillBatchDeps extends TransactionSyncDeps {
  /**
   * Injectable per-day processor. Production: the imported processDayTransactions.
   * Tests: a vi.fn() mock returning controlled results.
   */
  processDayTransactions: typeof processDayTransactions;
}

/** Result returned to the caller. */
export interface BackfillBatchResult {
  /** New sync_cursor value to persist (un-advanced when last day errored). */
  syncCursor: number;
  /** True when cursor >= targetDays — caller should persist initial_sync_done=true. */
  initialSyncDone: boolean;
  /** Number of ok/empty days processed this call. */
  daysProcessed: number;
  /** Status of the last completed day ('ok' | 'empty') or 'error'. */
  status: 'ok' | 'empty' | 'error';
  /** Error message from the last failing day (only set when status='error'). */
  lastError?: string;
}

// ── Main export ───────────────────────────────────────────────────────────────

/**
 * Process up to `opts.maxDays` days of Focus POS Lynk backfill within
 * the given `opts.budgetMs` wall-clock window.
 *
 * Direction: newest-first (same as the existing single-day handlers).
 * `cursor=0` → yesterday; `cursor=1` → two days ago; etc.
 *
 * Loop exits when any of these is true:
 *   1. cursor >= targetDays (all days processed → initialSyncDone=true)
 *   2. daysProcessed >= maxDays
 *   3. elapsed >= budgetMs  (checked before each day)
 *   4. processDayTransactions returns 'error' (cursor NOT advanced)
 *   5. processDayTransactions returns 'inprogress' (cursor NOT advanced)
 *
 * Returns the updated cursor + flags; never touches the database.
 */
export async function processBackfillBatch(
  deps: BackfillBatchDeps,
  config: BackfillBatchConfig,
  opts: BackfillBatchOpts,
): Promise<BackfillBatchResult> {
  const targetDays = opts.targetDays ?? TARGET_DAYS;
  const clock = opts.clock ?? Date.now;

  let cursor = opts.syncCursor;
  let daysProcessed = 0;
  let lastStatus: 'ok' | 'empty' | 'error' = 'ok';
  let lastError: string | undefined;

  const startMs = clock();

  // If already done, return immediately without fetching anything.
  if (cursor >= targetDays) {
    return {
      syncCursor: cursor,
      initialSyncDone: true,
      daysProcessed: 0,
      status: 'ok',
    };
  }

  // todayStr is constant for the duration of this call (timezone + now never change).
  // Compute it once outside the loop to avoid recreating Intl.DateTimeFormat each iteration.
  const todayStr = todayInTz(opts.timezone, opts.now);

  while (cursor < targetDays && daysProcessed < opts.maxDays) {
    // Budget check before each day
    if (clock() - startMs >= opts.budgetMs) {
      break;
    }

    // Compute the target date: today_in_tz − (cursor + 1)
    // cursor=0 → yesterday, cursor=1 → two days ago, etc.
    const targetDate = subtractDays(todayStr, cursor + 1);

    // Call the injectable per-day processor
    const result: TransactionSyncResult = await deps.processDayTransactions(
      { supabase: deps.supabase, fetchDatafeed: deps.fetchDatafeed },
      config,
      targetDate,
      { skipUnifiedSalesSync: true },
    );

    if (result.status === 'error') {
      // Do NOT advance cursor — retry the same day next time.
      lastStatus = 'error';
      lastError = result.error;
      break;
    }

    if (result.status === 'inprogress') {
      // File is still being generated by Focus — retry same day next tick.
      // Don't update lastStatus (keep whatever it was from the previous day).
      break;
    }

    // ok or empty — advance cursor
    cursor++;
    daysProcessed++;
    lastStatus = result.status as 'ok' | 'empty';
  }

  const initialSyncDone = cursor >= targetDays;

  return {
    syncCursor: cursor,
    initialSyncDone,
    daysProcessed,
    status: lastStatus,
    ...(lastError !== undefined ? { lastError } : {}),
  };
}
