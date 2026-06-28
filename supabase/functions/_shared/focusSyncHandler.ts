/**
 * focusSyncHandler.ts
 *
 * Orchestrates a single business-day fetch-parse-upsert cycle for the
 * Focus POS Revenue Center report.
 *
 * Responsibilities:
 *  1. Build the report URL for the given business date (one-day window).
 *  2. Fetch the HTML via focusReportClient (SSRF-guarded, redirect-safe).
 *  3. Parse the HTML via focusReportParser (discriminated result union).
 *  4. Upsert into `focus_daily_reports` (ON CONFLICT restaurant_id,business_date,revenue_center):
 *       - ok:true  → full parsed data row; returns {status:'ok'}
 *       - ok:false, reason:'empty'  → zeroed row; returns {status:'empty'}
 *       - ok:false, reason:'parse_error' → skip upsert; returns {status:'error'}
 *  5. Propagate Supabase upsert errors as {status:'error', error: message}.
 *  6. Catch fetch / unexpected errors and return {status:'error', error: message}.
 *
 * Design references:
 *  - Plan Task 6
 *  - Spec §8 (_shared/focusSyncHandler.ts)
 *  - §16 S9 (discriminated result union from parser)
 *
 * Injectable deps (SyncDeps) make this module Vitest-coverable without real
 * network or Supabase connections — mirrors the Toast-integration split pattern.
 */

import {
  buildReportUrl,
  fetchReportHtml,
  isoToMmDdYyyy,
  type FocusConnection,
  type FetchDeps,
} from './focusReportClient.ts';

import { parseRevenueCenterReport } from './focusReportParser.ts';

// ── Types ─────────────────────────────────────────────────────────────────────

/** Minimal Supabase-client surface needed by this handler. */
export interface SupabaseDeps {
  from(table: string): {
    upsert(
      data: Record<string, unknown>,
      options?: Record<string, unknown>,
    ): {
      onConflict(columns: string): {
        select(): Promise<{ data: unknown; error: { message: string } | null }>;
      };
    };
  };
}

/**
 * Injectable dependencies for processReportDay.
 *
 * - `fetch`:         fetch-compatible function (globalThis.fetch in production;
 *                    vi.fn() in tests). Passed through to fetchReportHtml.
 * - `supabase`:      Supabase client (service-role in production; mock in tests).
 * - `restaurantId`:  UUID of the restaurant owning this connection.
 */
export interface SyncDeps {
  fetch: FetchDeps['fetch'];
  supabase: SupabaseDeps;
  restaurantId: string;
}

/** Discriminated result returned by processReportDay. */
export type SyncResult =
  | { status: 'ok' }
  | { status: 'empty' }
  | { status: 'error'; error?: string };

// ── Main export ───────────────────────────────────────────────────────────────

/**
 * Process one business day for a Focus POS connection.
 *
 * @param deps         Injectable fetch + supabase + restaurantId.
 * @param conn         Focus connection metadata (routing params).
 * @param businessDate ISO date string ('YYYY-MM-DD') to sync.
 */
export async function processReportDay(
  deps: SyncDeps,
  conn: FocusConnection,
  businessDate: string,
): Promise<SyncResult> {
  try {
    // 1. Build URL for a single-day range (StartDate === EndDate)
    const formattedDate = isoToMmDdYyyy(businessDate);
    const url = buildReportUrl(conn, formattedDate, formattedDate);

    // 2. Fetch the report HTML (SSRF-guarded, redirect-safe)
    const html = await fetchReportHtml({ fetch: deps.fetch }, url);

    // 3. Parse the HTML (discriminated result union)
    const parseResult = parseRevenueCenterReport(html, businessDate);

    // 4a. Parse error → skip upsert entirely
    if (!parseResult.ok && parseResult.reason === 'parse_error') {
      return { status: 'error', error: 'parse_error: no recognizable report structure' };
    }

    // 4b. Build the upsert payload
    let payload: Record<string, unknown>;

    if (parseResult.ok) {
      const { data } = parseResult;
      // Always use conn.revenueCenter as the conflict key.
      // For an all-centers fetch conn.revenueCenter is '' — using items[0].revenueCenter
      // would create a non-deterministic key (depends on HTML ordering) that could diverge
      // between syncs and create duplicate rows or mis-keyed external_item_ids in
      // unified_sales when items from multiple centers are collapsed into one report row.
      const revenueCenter = conn.revenueCenter ?? '';

      payload = {
        restaurant_id: deps.restaurantId,
        business_date: businessDate,
        revenue_center: revenueCenter,
        net_sales: data.totals.netSales,
        total_tax: data.totals.totalTax,
        subtotal_discounts: data.totals.subtotalDiscounts,
        retained_tips: data.totals.retainedTips,
        refunds: data.totals.refunds,
        total_sales: data.totals.totalSales,
        total_payments: data.payments.reduce((s, p) => s + p.amount, 0),
        items_json: data.items,
        payments_json: data.payments,
        order_types_json: data.orderTypes,
        raw_totals_json: data.totals,
        fetched_at: new Date().toISOString(),
      };
    } else {
      // 4c. Empty report → upsert a zeroed row (design S9: treat as 'connected')
      payload = {
        restaurant_id: deps.restaurantId,
        business_date: businessDate,
        revenue_center: conn.revenueCenter ?? '',
        net_sales: 0,
        total_tax: 0,
        subtotal_discounts: 0,
        retained_tips: 0,
        refunds: 0,
        total_sales: 0,
        total_payments: 0,
        items_json: [],
        payments_json: [],
        order_types_json: [],
        raw_totals_json: {},
        fetched_at: new Date().toISOString(),
      };
    }

    // 5. Upsert into focus_daily_reports
    const { error } = await deps.supabase
      .from('focus_daily_reports')
      .upsert(payload)
      .onConflict('restaurant_id,business_date,revenue_center')
      .select();

    if (error) {
      return { status: 'error', error: error.message };
    }

    return parseResult.ok ? { status: 'ok' } : { status: 'empty' };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return { status: 'error', error: message };
  }
}
