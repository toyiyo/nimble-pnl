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
 *       b. Upsert focus_order_items (skip kitchen-comment lines — PII).
 *       c. Upsert focus_payments (one row per payment).
 *  4. Call sync_focus_transactions_to_unified_sales RPC (unless skipUnifiedSalesSync).
 *  5. Return a discriminated result: ok / empty / inprogress / error.
 *
 * Design ref: spec §4 (sync flow), §3 (data model), §7 (testing); plan Task 4.
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
      data: Record<string, unknown>,
      options?: Record<string, unknown>,
    ): {
      select(): Promise<{ data: unknown; error: { message: string } | null }>;
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

// ── Helpers ───────────────────────────────────────────────────────────────────

/** Extract the last 4 digits from a masked card number (e.g. "XXXXXXXXXXXX1234" → "1234"). */
function cardLast4(masked: string | null): string | null {
  if (!masked) return null;
  const m = masked.match(/(\d{4})\s*$/);
  return m ? m[1] : null;
}

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

async function upsertItems(
  supabase: TransactionSupabaseDeps,
  check: FocusCheck,
  restaurantId: string,
  businessDate: string,
): Promise<void> {
  for (const item of check.items) {
    // Skip kitchen-comment lines (PII — customer names / phones / addresses).
    if (item.isKitchenComment) continue;

    const { error } = await supabase
      .from('focus_order_items')
      .upsert(
        {
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
        },
        { onConflict: 'restaurant_id,business_date,focus_check_id,item_key' },
      )
      .select();

    if (error) {
      throw new Error(`focus_order_items upsert failed: ${error.message}`);
    }
  }
}

async function upsertPayments(
  supabase: TransactionSupabaseDeps,
  check: FocusCheck,
  restaurantId: string,
  businessDate: string,
): Promise<void> {
  for (const payment of check.payments) {
    const { error } = await supabase
      .from('focus_payments')
      .upsert(
        {
          restaurant_id: restaurantId,
          business_date: businessDate,
          focus_check_id: check.checkId,
          payment_key: payment.key,
          payment_id: payment.paymentId,
          name: payment.name,
          amount: payment.amount,
          tip: payment.tip,
          card_last4: cardLast4(payment.cardLast4),
        },
        { onConflict: 'restaurant_id,business_date,focus_check_id,payment_key' },
      )
      .select();

    if (error) {
      throw new Error(`focus_payments upsert failed: ${error.message}`);
    }
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

    const { checks } = parseFocusDatafeed(result.xml);

    if (checks.length === 0) {
      return { status: 'empty' };
    }

    // ── 4. Upsert checks → items → payments ──────────────────────────────────

    for (const check of checks) {
      await upsertOrder(deps.supabase, check, config.restaurantId, businessDate);
      await upsertItems(deps.supabase, check, config.restaurantId, businessDate);
      await upsertPayments(deps.supabase, check, config.restaurantId, businessDate);
    }

    // ── 5. Sync to unified_sales ──────────────────────────────────────────────

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
