/**
 * focusTransactionSyncHandler.ts
 *
 * Orchestrates a single business-day fetch-parse-upsert cycle for Focus POS
 * item-level transactions (checks → items → payments) using the Lynk Legacy
 * Datafeed API.
 *
 * Responsibilities:
 *  1. Call fetchDatafeed (focusLynkClient) for the given business date.
 *  2. Parse the returned XML with parseFocusDatafeed.
 *  3. For each check:
 *       a. Upsert focus_orders (one row per check).
 *       b. Upsert focus_order_items as ONE array per check (skip kitchen-comment lines — PII).
 *       c. Upsert focus_payments as ONE array per check.
 *  4. Call sync_focus_transactions_to_unified_sales RPC (unless skipUnifiedSalesSync).
 *  5. Return a discriminated result: ok / empty / inprogress / error.
 *
 * Design ref: spec §4 (sync flow), §3 (data model), §7 (testing), §8.4 (batch upserts);
 *             plan Tasks B2.
 *
 * Injectable deps (TransactionSyncDeps) make this fully Vitest-testable without
 * real network or Supabase connections — mirrors the existing focusSyncHandler.ts pattern.
 */

import {
  fetchDatafeed,
  type FocusLynkDeps,
  type FocusLynkConfig,
} from './focusLynkClient.ts';

import {
  parseFocusDatafeed,
  type FocusCheck,
} from './focusDatafeedParser.ts';

// ── Types ─────────────────────────────────────────────────────────────────────

/** Minimal Supabase client surface needed by this handler. */
export interface TransactionSupabaseDeps {
  from(table: string): {
    upsert(
      data: Record<string, unknown> | Record<string, unknown>[],
      options?: Record<string, unknown>,
    ): {
      select(): Promise<{ data: unknown; error: { message: string } | null }>;
    };
    delete(): {
      eq(col: string, val: string): {
        eq(col: string, val: string): {
          eq(col: string, val: string): Promise<{ error: { message: string } | null }>;
        };
      };
    };
  };
  rpc(
    fn: string,
    args: Record<string, unknown>,
  ): Promise<{ data: unknown; error: { message: string } | null }>;
}

/**
 * Injectable dependencies for processDayTransactions.
 *
 * - supabase:      Supabase client (service-role in production; mock in tests).
 * - fetchDatafeed: The Lynk client function. Injectable for tests.
 */
export interface TransactionSyncDeps {
  supabase: TransactionSupabaseDeps;
  /** Injectable Lynk fetcher — production: the imported fetchDatafeed from focusLynkClient. */
  fetchDatafeed: typeof fetchDatafeed;
}

/**
 * Extended deps for processDateRangeTransactions: includes an injectable
 * processDayTransactions so the function can be tested without real network
 * calls. Production callers omit it (falls back to the module's own impl).
 */
export interface DateRangeSyncDeps extends TransactionSyncDeps {
  /**
   * Injectable per-day processor. Production: the module's processDayTransactions.
   * Tests: a vi.fn() mock returning controlled results.
   */
  processDayTransactions?: typeof processDayTransactions;
}

/**
 * Per-connection config for the Lynk API.
 * Drawn from the focus_connections row.
 */
export interface TransactionSyncConfig {
  restaurantId: string;
  /** Restaurant GUID (UUID) — the `store_id` column on focus_connections. */
  storeId: string;
  apiKey: string;
  apiSecret: string;
  /** Base URL for the Focus POS API, e.g. https://pos-api.focuspos.com */
  baseUrl: string;
}

/** Options for controlling unified_sales behaviour during bulk imports. */
export interface TransactionSyncOptions {
  /** Skip the unified_sales RPC — set true during bulk backfill (call at end). */
  skipUnifiedSalesSync?: boolean;
}

/** Discriminated result from processDayTransactions. */
export type TransactionSyncResult =
  | { status: 'ok'; checksWritten: number }
  | { status: 'empty' }
  | { status: 'inprogress' }
  | { status: 'error'; error?: string };

/** Result from processDateRangeTransactions. */
export type DateRangeSyncResult =
  | { status: 'ok'; daysSynced: number }
  | { status: 'empty'; daysSynced: number }
  | { status: 'error'; error?: string; daysSynced: number };

// ── Upsert helpers ────────────────────────────────────────────────────────────

async function upsertOrder(
  supabase: TransactionSupabaseDeps,
  check: FocusCheck,
  restaurantId: string,
  businessDate: string,
): Promise<void> {
  const { error } = await supabase
    .from('focus_orders')
    .upsert(
      {
        restaurant_id: restaurantId,
        business_date: businessDate,
        focus_check_id: check.checkId,
        opened_at_local: check.openedAt,
        closed_at_local: check.closedAt,
        order_type_id: check.orderTypeId,
        revenue_center_id: check.revenueCenterId,
        guests: check.guests,
        total: check.total,
        discount_total: check.discountTotal,
        taxable_sales: check.taxableSales,
      },
      { onConflict: 'restaurant_id,business_date,focus_check_id' },
    )
    .select();

  if (error) {
    throw new Error(`focus_orders upsert failed: ${error.message}`);
  }
}

/**
 * Upsert all non-kitchen-comment items for a check as a single array upsert
 * (§8.4 — collapses per-item round-trips into two per check).
 */
async function upsertItems(
  supabase: TransactionSupabaseDeps,
  check: FocusCheck,
  restaurantId: string,
  businessDate: string,
): Promise<void> {
  const rows = check.items
    .filter((item) => !item.isKitchenComment)
    .map((item) => ({
      restaurant_id: restaurantId,
      business_date: businessDate,
      focus_check_id: check.checkId,
      item_key: item.key,
      record_number: item.recordNumber,
      item_code: item.code,
      name: item.name,
      report_group_id: item.reportGroupId,
      price: item.price,
      parent_key: item.parentKey,
      is_modifier: item.isModifier,
      discount_amount: item.discountAmount,
    }));

  if (rows.length === 0) return;

  const { error } = await supabase
    .from('focus_order_items')
    .upsert(rows, { onConflict: 'restaurant_id,business_date,focus_check_id,item_key' })
    .select();

  if (error) {
    throw new Error(`focus_order_items upsert failed: ${error.message}`);
  }
}

/**
 * Upsert all payments for a check as a single array upsert (§8.4).
 */
async function upsertPayments(
  supabase: TransactionSupabaseDeps,
  check: FocusCheck,
  restaurantId: string,
  businessDate: string,
): Promise<void> {
  const rows = check.payments.map((payment) => ({
    restaurant_id: restaurantId,
    business_date: businessDate,
    focus_check_id: check.checkId,
    payment_key: payment.key,
    payment_id: payment.paymentId,
    name: payment.name,
    amount: payment.amount,
    tip: payment.tip,
    card_last4: payment.cardLast4,
  }));

  if (rows.length === 0) return;

  const { error } = await supabase
    .from('focus_payments')
    .upsert(rows, { onConflict: 'restaurant_id,business_date,focus_check_id,payment_key' })
    .select();

  if (error) {
    throw new Error(`focus_payments upsert failed: ${error.message}`);
  }
}

// ── Main export ───────────────────────────────────────────────────────────────

/**
 * Process one business day of Focus POS transaction data.
 *
 * @param deps         Injectable supabase + fetchDatafeed.
 * @param config       Per-connection Lynk API config.
 * @param businessDate ISO date string ('YYYY-MM-DD') to sync.
 * @param options      Optional flags (skipUnifiedSalesSync).
 */
export async function processDayTransactions(
  deps: TransactionSyncDeps,
  config: TransactionSyncConfig,
  businessDate: string,
  options: TransactionSyncOptions = {},
): Promise<TransactionSyncResult> {
  try {
    // ── 1. Build the Lynk config from the connection ─────────────────────────

    const lynkConfig: FocusLynkConfig = {
      baseUrl: config.baseUrl,
      restaurantGuid: config.storeId,
      apiKey: config.apiKey,
      apiSecret: config.apiSecret,
    };

    // ── 2. Fetch the datafeed XML ─────────────────────────────────────────────

    const lynkDeps: FocusLynkDeps = { fetch: globalThis.fetch };
    const result = await deps.fetchDatafeed(lynkDeps, lynkConfig, businessDate);

    if (!result.ok) {
      if (result.kind === 'inprogress') {
        return { status: 'inprogress' };
      }
      return {
        status: 'error',
        error: result.error,
      };
    }

    // ── 3. Parse the XML ──────────────────────────────────────────────────────

    const { checks, deletedCheckIds } = parseFocusDatafeed(result.xml);

    if (checks.length === 0 && deletedCheckIds.length === 0) {
      return { status: 'empty' };
    }

    // ── 4. Delete voided checks (DeleteRecord entries) ────────────────────────
    // Voided checks are removed from focus_orders; ON DELETE CASCADE cleans up
    // focus_order_items and focus_payments automatically.
    // unified_sales orphan-delete is handled by _sync_focus_transactions_to_unified_sales_impl.

    for (const voidedCheckId of deletedCheckIds) {
      const { error: delError } = await deps.supabase
        .from('focus_orders')
        .delete()
        .eq('restaurant_id', config.restaurantId)
        .eq('business_date', businessDate)
        .eq('focus_check_id', voidedCheckId);
      if (delError) {
        // Non-fatal: log and continue — the check may not exist locally yet.
        console.warn(
          `focus_orders delete (voided check ${voidedCheckId}): ${delError.message}`,
        );
      }
    }

    // ── 5. Upsert active checks → items (batched) → payments (batched) ────────
    // §8.4: replace per-item/per-payment await loops with one array upsert per check.

    for (const check of checks) {
      await upsertOrder(deps.supabase, check, config.restaurantId, businessDate);
      await upsertItems(deps.supabase, check, config.restaurantId, businessDate);
      await upsertPayments(deps.supabase, check, config.restaurantId, businessDate);
    }

    // ── 6. Sync to unified_sales ──────────────────────────────────────────────

    if (!options.skipUnifiedSalesSync) {
      const { error: rpcError } = await deps.supabase.rpc(
        'sync_focus_transactions_to_unified_sales',
        {
          p_restaurant_id: config.restaurantId,
          p_start_date: businessDate,
          p_end_date: businessDate,
        },
      );
      if (rpcError) {
        // Log but do not abort — data is written, RPC failure is not fatal here.
        console.warn(
          `sync_focus_transactions_to_unified_sales warning: ${rpcError.message}`,
        );
      }
    }

    return { status: 'ok', checksWritten: checks.length };
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    return { status: 'error', error: message };
  }
}

// ── processDateRangeTransactions ──────────────────────────────────────────────

/**
 * Generate the list of ISO date strings between startDate and endDate inclusive,
 * in ascending order.
 */
function dateRange(startDate: string, endDate: string): string[] {
  const dates: string[] = [];
  const start = new Date(startDate + 'T00:00:00Z');
  const end = new Date(endDate + 'T00:00:00Z');
  const current = new Date(start);
  while (current <= end) {
    dates.push(current.toISOString().slice(0, 10));
    current.setUTCDate(current.getUTCDate() + 1);
  }
  return dates;
}

/**
 * Process an explicit date range of Focus POS transaction data.
 *
 * Iterates each date in [startDate, endDate] inclusive, calling
 * processDayTransactions for each with skipUnifiedSalesSync=true (each
 * per-day upsert lands in focus_orders/focus_order_items/focus_payments
 * immediately, so partial progress survives a mid-range worker crash).
 *
 * The unified_sales aggregation is intentionally NOT performed here.
 * A 5-minute pg_cron job (focus-transactions-unified-sales-sync) runs
 * sync_all_focus_transactions_to_unified_sales() in Postgres, which picks up
 * recently written focus_orders rows automatically. Removing the in-worker
 * RPC call is the fix for HTTP 546 edge-worker CPU-limit errors on 6-day
 * custom-range syncs: parsing N × 4.5 MB XML documents was already near the
 * limit, and the final RPC over that many rows pushed the invocation over.
 *
 * Stops early on a day error.
 *
 * Design ref: spec §5.2 / §8.2 (custom range, synchronous, capped at 14 days by caller).
 *
 * @param deps         Injectable supabase + fetchDatafeed + optional processDayTransactions.
 * @param config       Per-connection Lynk API config.
 * @param startDate    ISO date string ('YYYY-MM-DD') — range start (inclusive).
 * @param endDate      ISO date string ('YYYY-MM-DD') — range end (inclusive).
 * @param options      Optional flags (skipUnifiedSalesSync — kept for API compat but unused here).
 */
export async function processDateRangeTransactions(
  deps: DateRangeSyncDeps,
  config: TransactionSyncConfig,
  startDate: string,
  endDate: string,
  options: TransactionSyncOptions = {},
): Promise<DateRangeSyncResult> {
  // Resolve the injectable per-day processor (production: this module's impl).
  const dayProcessor = deps.processDayTransactions ?? processDayTransactions;

  // options.skipUnifiedSalesSync is accepted but no longer acted upon — the
  // range path never calls the RPC regardless (see doc comment above).
  void options;

  const dates = dateRange(startDate, endDate);
  let daysSynced = 0;
  let lastStatus: 'ok' | 'empty' = 'ok';

  for (const date of dates) {
    const result = await dayProcessor(
      { supabase: deps.supabase, fetchDatafeed: deps.fetchDatafeed },
      config,
      date,
      { skipUnifiedSalesSync: true },
    );

    if (result.status === 'error') {
      return {
        status: 'error',
        error: (result as { error?: string }).error,
        daysSynced,
      };
    }

    if (result.status === 'inprogress') {
      // Treat inprogress as a soft error for the range — stop without any RPC.
      return { status: 'error', error: 'InProgress on ' + date, daysSynced };
    }

    daysSynced++;
    lastStatus = result.status as 'ok' | 'empty';
  }

  // unified_sales aggregation is handled by the Postgres cron
  // (focus-transactions-unified-sales-sync), not here. See doc comment above.

  return { status: lastStatus, daysSynced };
}
