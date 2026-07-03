-- =====================================================
-- Focus POS backfill reliability
-- =====================================================
-- Two production problems this fixes:
--
--   1. The focus-backfill-sync / focus-bulk-sync crons were rescheduled by
--      20260702160000 to build their URL from current_setting('app.settings.supabase_url').
--      That GUC is not set and CANNOT be set on Supabase (ALTER DATABASE ... SET is
--      permission-denied for the postgres role), so the cron body's `WHERE url <> ''`
--      guard is always false → the job "succeeds" with 0 rows and never calls the
--      worker. (The follow-up edit that hardcoded the URL changed an ALREADY-APPLIED
--      migration file, which Supabase skips — so it never took effect.) → Hardcode
--      the public project URL here, in a NEW migration, exactly like the toast/shift4
--      crons already do.
--
--   2. The backfill worker timed out (HTTP 546 / worker CPU limit) because it ran the
--      unified_sales aggregation RPC inside the edge function. → Move that aggregation
--      entirely into Postgres: the worker now only fetches + upserts focus_orders
--      (fast), and sync_all_focus_transactions_to_unified_sales() does a FULL-range
--      aggregation for still-backfilling connections, every 5 minutes, in-database
--      (no edge CPU limit). Companion edge change: processBackfillBatch no longer
--      calls the RPC.
--
-- Idempotent: unschedule guards precede every (re)schedule.
-- =====================================================

CREATE EXTENSION IF NOT EXISTS pg_cron;
CREATE EXTENSION IF NOT EXISTS pg_net;
GRANT USAGE ON SCHEMA cron TO postgres;

-- ─────────────────────────────────────────────────────────────────────────────
-- 1. Hardcoded-URL, gate-less cron reschedule (backfill every 5 min; bulk every 6 h)
-- ─────────────────────────────────────────────────────────────────────────────
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'focus-backfill-sync') THEN
    PERFORM cron.unschedule('focus-backfill-sync');
  END IF;
END $$;

SELECT cron.schedule(
  'focus-backfill-sync',
  '*/5 * * * *',
  $cron$
  SELECT net.http_post(
    url     := 'https://ncdujvdgqtaunuyigflp.supabase.co/functions/v1/focus-backfill-sync',
    headers := jsonb_build_object('Content-Type', 'application/json'),
    body    := '{}'::jsonb,
    timeout_milliseconds := 5000
  );
  $cron$
);

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'focus-bulk-sync') THEN
    PERFORM cron.unschedule('focus-bulk-sync');
  END IF;
END $$;

SELECT cron.schedule(
  'focus-bulk-sync',
  '30 1,7,13,19 * * *',
  $cron$
  SELECT net.http_post(
    url     := 'https://ncdujvdgqtaunuyigflp.supabase.co/functions/v1/focus-bulk-sync',
    headers := jsonb_build_object('Content-Type', 'application/json'),
    body    := '{}'::jsonb,
    timeout_milliseconds := 5000
  );
  $cron$
);

-- ─────────────────────────────────────────────────────────────────────────────
-- 2. unified_sales aggregation moves fully into Postgres.
--    Still-backfilling connections (initial_sync_done=false) get a FULL-range
--    aggregation (NULL date window ⇒ all dates in _impl); connections that have
--    finished backfilling get the light 3-day incremental window.
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.sync_all_focus_transactions_to_unified_sales()
RETURNS TABLE(restaurant_id uuid, rows_synced integer)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  r record;
BEGIN
  FOR r IN
    SELECT fc.restaurant_id, fc.initial_sync_done
    FROM public.focus_connections fc
    WHERE fc.is_active = true
    ORDER BY fc.last_sync_time ASC NULLS FIRST
    LIMIT 5
  LOOP
    BEGIN
      restaurant_id := r.restaurant_id;
      IF r.initial_sync_done THEN
        -- Incremental: 3-day lookback window (timezone-safe, matches prior behaviour).
        rows_synced := public._sync_focus_transactions_to_unified_sales_impl(
                         r.restaurant_id,
                         (CURRENT_DATE - interval '3 days')::date,
                         CURRENT_DATE
                       );
      ELSE
        -- Backfill in progress: aggregate ALL dates already stored in focus_orders,
        -- so the historical days the worker is importing reach unified_sales / P&L.
        -- NULL date bounds ⇒ full range (see _impl p_start_date/p_end_date IS NULL).
        rows_synced := public._sync_focus_transactions_to_unified_sales_impl(
                         r.restaurant_id, NULL, NULL
                       );
      END IF;
      RETURN NEXT;
    EXCEPTION WHEN OTHERS THEN
      RAISE WARNING
        'sync_all_focus_transactions_to_unified_sales: failed for restaurant %: %',
        r.restaurant_id, SQLERRM;
    END;
  END LOOP;
END;
$$;

GRANT EXECUTE ON FUNCTION public.sync_all_focus_transactions_to_unified_sales()
  TO service_role;

-- ─────────────────────────────────────────────────────────────────────────────
-- 3. Run the transaction→unified_sales aggregation every 5 minutes (was every 6 h),
--    so backfilled days appear in P&L within minutes while the import runs.
-- ─────────────────────────────────────────────────────────────────────────────
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'focus-transactions-unified-sales-sync') THEN
    PERFORM cron.unschedule('focus-transactions-unified-sales-sync');
  END IF;
END $$;

SELECT cron.schedule(
  'focus-transactions-unified-sales-sync',
  '*/5 * * * *',
  $$SELECT sync_all_focus_transactions_to_unified_sales()$$
);

-- ─────────────────────────────────────────────────────────────────────────────
-- 4. Populate unified_sales.sale_time from the Focus check timestamps.
--
--    The datafeed parser already captures TimeOpened/TimeClosed into
--    focus_orders.opened_at_local / closed_at_local (text, restaurant-local,
--    real feed format 'MM/DD/YYYY HH24:MI:SS'), but the impl never mapped them
--    to unified_sales.sale_time — so every Focus row had a NULL time and the
--    POS sales screen / busy-time (staffing) analysis had nothing to work with.
--    Toast populates sale_time; Focus now mirrors it.
--
--    sale_time is added to all three row kinds (sale, discount, tip) and to the
--    ON CONFLICT updates, so previously-imported rows self-heal on the next
--    full-range sync (which §2 runs every 5 min while backfilling).
-- ─────────────────────────────────────────────────────────────────────────────

-- Tolerant local-time parser. focus_orders.opened_at_local is free text; a
-- malformed value must yield NULL, never abort a sync batch.
--   Accepts:  '06/29/2026 12:26:06'  (real Lynk datafeed, MM/DD/YYYY)
--             '2026-06-29T12:26:06' / '2026-06-29 12:26:06'  (ISO variants)
CREATE OR REPLACE FUNCTION public._focus_parse_local_time(p_raw text)
RETURNS time
LANGUAGE plpgsql
IMMUTABLE
STRICT
AS $$
BEGIN
  IF p_raw ~ '^\d{1,2}/\d{1,2}/\d{4} \d{1,2}:\d{2}(:\d{2})?$' THEN
    RETURN to_timestamp(p_raw, 'MM/DD/YYYY HH24:MI:SS')::time;
  ELSIF p_raw ~ '^\d{4}-\d{2}-\d{2}[T ]\d{1,2}:\d{2}(:\d{2})?' THEN
    RETURN (replace(p_raw, 'T', ' ')::timestamp)::time;
  END IF;
  RETURN NULL;
EXCEPTION WHEN OTHERS THEN
  RETURN NULL;  -- belt-and-braces: any parse surprise degrades to NULL
END;
$$;

COMMENT ON FUNCTION public._focus_parse_local_time(text) IS
  'Parses a Focus POS local timestamp string (MM/DD/YYYY HH24:MI:SS or ISO) '
  'to a time-of-day. Returns NULL for NULL/malformed input — never raises.';

CREATE OR REPLACE FUNCTION public._sync_focus_transactions_to_unified_sales_impl(
  p_restaurant_id uuid,
  p_start_date    date,   -- NULL = all dates
  p_end_date      date    -- NULL = all dates
)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
SET statement_timeout = '120s'
AS $$
DECLARE
  v_count          integer := 0;
  v_row_count      integer;
  v_sync_start     timestamptz := clock_timestamp();
  v_store_id       text;
  v_order          record;
  v_order_id       text;
  v_sale_time      time;
  v_current_ids    text[];
BEGIN
  -- Fetch the store_id from the most-recently-created active connection.
  -- Filtering by is_active prevents stale/deleted connections from being used.
  -- ORDER BY + LIMIT 1 makes the query deterministic when multiple rows exist.
  SELECT fc.store_id INTO v_store_id
  FROM public.focus_connections fc
  WHERE fc.restaurant_id = p_restaurant_id
    AND fc.is_active = true
  ORDER BY fc.created_at DESC
  LIMIT 1;

  -- If no active connection found, there is nothing to key external_order_id on.
  -- Proceeding with a NULL store_id would produce orphan unified_sales rows
  -- (pattern: focus-unknown-YYYYMMDD-{check_id}) that can never be re-synced.
  IF v_store_id IS NULL THEN
    RAISE EXCEPTION
      'sync_focus_transactions_to_unified_sales: no active focus_connections row '
      'found for restaurant %', p_restaurant_id;
  END IF;

  -- GUC flag: skip per-row triggers during bulk sync (transaction-local).
  PERFORM set_config('app.skip_unified_sales_triggers', 'true', true);

  -- ── Iterate per check (focus_order) ────────────────────────────────────
  FOR v_order IN
    SELECT fo.business_date, fo.focus_check_id,
           fo.opened_at_local, fo.closed_at_local
    FROM public.focus_orders fo
    WHERE fo.restaurant_id = p_restaurant_id
      AND (p_start_date IS NULL OR fo.business_date >= p_start_date)
      AND (p_end_date   IS NULL OR fo.business_date <= p_end_date)
    ORDER BY fo.business_date, fo.focus_check_id
  LOOP
    v_order_id := 'focus-' || COALESCE(v_store_id, 'unknown')
                  || '-' || to_char(v_order.business_date, 'YYYYMMDD')
                  || '-' || v_order.focus_check_id;

    -- Time-of-day for this check: prefer TimeOpened (when the customer
    -- transacted — the busy-time signal), fall back to TimeClosed.
    v_sale_time := COALESCE(
      public._focus_parse_local_time(v_order.opened_at_local),
      public._focus_parse_local_time(v_order.closed_at_local)
    );

    -- ── Step 1: Collect current external_item_ids (sale rows) ──────────────
    SELECT ARRAY(
      SELECT v_order_id || '__' || foi.item_key
      FROM public.focus_order_items foi
      WHERE foi.restaurant_id  = p_restaurant_id
        AND foi.business_date  = v_order.business_date
        AND foi.focus_check_id = v_order.focus_check_id
        AND foi.price IS NOT NULL
        AND foi.price != 0
    ) INTO v_current_ids;

    -- ── Step 2: DELETE orphan sale rows no longer in focus_order_items ─────
    -- Only delete base (un-split) rows; parent_sale_id IS NULL guards user-
    -- managed split/child rows from being silently removed on every sync.
    DELETE FROM public.unified_sales us
    WHERE us.restaurant_id     = p_restaurant_id
      AND us.pos_system        = 'focus'
      AND us.item_type         = 'sale'
      AND us.sale_date         = v_order.business_date
      AND us.external_order_id = v_order_id
      AND us.parent_sale_id IS NULL
      AND NOT (us.external_item_id = ANY(v_current_ids));

    -- ── Step 3: UPSERT sale rows (one per priced item) ────────────────────
    INSERT INTO public.unified_sales (
      restaurant_id, pos_system,
      external_order_id, external_item_id,
      item_name, quantity, unit_price, total_price,
      sale_date, sale_time, pos_category, item_type, synced_at
    )
    SELECT
      foi.restaurant_id, 'focus',
      v_order_id, v_order_id || '__' || foi.item_key,
      foi.name, 1, foi.price, foi.price,
      foi.business_date, v_sale_time, foi.report_group_id, 'sale', now()
    FROM public.focus_order_items foi
    WHERE foi.restaurant_id  = p_restaurant_id
      AND foi.business_date  = v_order.business_date
      AND foi.focus_check_id = v_order.focus_check_id
      AND foi.price IS NOT NULL
      AND foi.price != 0
    ON CONFLICT (restaurant_id, pos_system, external_order_id, external_item_id)
      WHERE parent_sale_id IS NULL
    DO UPDATE SET
      item_name    = EXCLUDED.item_name,
      unit_price   = EXCLUDED.unit_price,
      total_price  = EXCLUDED.total_price,
      sale_date    = EXCLUDED.sale_date,
      sale_time    = EXCLUDED.sale_time,
      pos_category = EXCLUDED.pos_category,
      synced_at    = EXCLUDED.synced_at
      -- category_id + is_categorized intentionally omitted →
      -- preserves user-managed categorization on re-sync (design §4)
    ;

    GET DIAGNOSTICS v_row_count = ROW_COUNT;
    v_count := v_count + v_row_count;

    -- ── Step 4: UPSERT / DELETE discount offset rows ───────────────────────
    -- Upsert items that have a non-zero discount.
    -- Focus XML stores DiscountAmount as a negative value (e.g. -3.01).
    -- Use != 0 (not > 0) so that negative amounts are also captured.
    -- -ABS() normalises to negative regardless of stored sign.
    INSERT INTO public.unified_sales (
      restaurant_id, pos_system,
      external_order_id, external_item_id,
      item_name, quantity, unit_price, total_price,
      sale_date, sale_time, item_type, adjustment_type, synced_at
    )
    SELECT
      foi.restaurant_id, 'focus',
      v_order_id, v_order_id || '__' || foi.item_key || '_discount',
      'Discount - ' || COALESCE(foi.name, 'Item'), 1,
      -ABS(foi.discount_amount), -ABS(foi.discount_amount),
      foi.business_date, v_sale_time, 'discount', 'discount', now()
    FROM public.focus_order_items foi
    WHERE foi.restaurant_id  = p_restaurant_id
      AND foi.business_date  = v_order.business_date
      AND foi.focus_check_id = v_order.focus_check_id
      AND foi.discount_amount != 0
    ON CONFLICT (restaurant_id, pos_system, external_order_id, external_item_id)
      WHERE parent_sale_id IS NULL
    DO UPDATE SET
      item_name   = EXCLUDED.item_name,
      unit_price  = EXCLUDED.unit_price,
      total_price = EXCLUDED.total_price,
      sale_date   = EXCLUDED.sale_date,
      sale_time   = EXCLUDED.sale_time,
      synced_at   = EXCLUDED.synced_at;

    GET DIAGNOSTICS v_row_count = ROW_COUNT;
    v_count := v_count + v_row_count;

    -- Delete stale discount rows for items that no longer have a discount.
    -- parent_sale_id IS NULL guards user-managed split rows.
    DELETE FROM public.unified_sales us
    WHERE us.restaurant_id     = p_restaurant_id
      AND us.pos_system        = 'focus'
      AND us.item_type         = 'discount'
      AND us.sale_date         = v_order.business_date
      AND us.external_order_id = v_order_id
      AND us.parent_sale_id IS NULL
      AND us.external_item_id NOT IN (
        SELECT v_order_id || '__' || foi.item_key || '_discount'
        FROM public.focus_order_items foi
        WHERE foi.restaurant_id  = p_restaurant_id
          AND foi.business_date  = v_order.business_date
          AND foi.focus_check_id = v_order.focus_check_id
          AND foi.discount_amount != 0
      );

    -- ── Step 5: UPSERT / DELETE tip offset rows ────────────────────────────
    -- Upsert payments with a non-zero tip
    INSERT INTO public.unified_sales (
      restaurant_id, pos_system,
      external_order_id, external_item_id,
      item_name, quantity, unit_price, total_price,
      sale_date, sale_time, item_type, adjustment_type, synced_at
    )
    SELECT
      fp.restaurant_id, 'focus',
      v_order_id, v_order_id || '_' || fp.payment_key || '_tip',
      'Tip - ' || COALESCE(fp.name, 'Payment'), 1,
      fp.tip, fp.tip,
      fp.business_date, v_sale_time, 'tip', 'tip', now()
    FROM public.focus_payments fp
    WHERE fp.restaurant_id  = p_restaurant_id
      AND fp.business_date  = v_order.business_date
      AND fp.focus_check_id = v_order.focus_check_id
      AND fp.tip != 0
    ON CONFLICT (restaurant_id, pos_system, external_order_id, external_item_id)
      WHERE parent_sale_id IS NULL
    DO UPDATE SET
      item_name   = EXCLUDED.item_name,
      unit_price  = EXCLUDED.unit_price,
      total_price = EXCLUDED.total_price,
      sale_date   = EXCLUDED.sale_date,
      sale_time   = EXCLUDED.sale_time,
      synced_at   = EXCLUDED.synced_at;

    GET DIAGNOSTICS v_row_count = ROW_COUNT;
    v_count := v_count + v_row_count;

    -- Delete stale tip rows for payments that no longer have a tip.
    -- parent_sale_id IS NULL guards user-managed split rows.
    DELETE FROM public.unified_sales us
    WHERE us.restaurant_id     = p_restaurant_id
      AND us.pos_system        = 'focus'
      AND us.item_type         = 'tip'
      AND us.sale_date         = v_order.business_date
      AND us.external_order_id = v_order_id
      AND us.parent_sale_id IS NULL
      AND us.external_item_id NOT IN (
        SELECT v_order_id || '_' || fp.payment_key || '_tip'
        FROM public.focus_payments fp
        WHERE fp.restaurant_id  = p_restaurant_id
          AND fp.business_date  = v_order.business_date
          AND fp.focus_check_id = v_order.focus_check_id
          AND fp.tip != 0
      );

  END LOOP;  -- end per-check loop

  -- Reset GUC flag to re-enable per-row triggers
  PERFORM set_config('app.skip_unified_sales_triggers', 'false', true);

  -- Batch-categorize uncategorized sale rows (authenticated callers only;
  -- service-role callers defer to the apply-categorization-rules edge function)
  IF auth.uid() IS NOT NULL THEN
    PERFORM apply_rules_to_pos_sales(p_restaurant_id, 10000);
  ELSE
    RAISE LOG
      'sync_focus_transactions_to_unified_sales: skipping batch categorization (service-role caller)';
  END IF;

  -- Batch-aggregate daily totals for all dates touched in this sync
  PERFORM public.aggregate_unified_sales_to_daily(p_restaurant_id, d.sale_date)
  FROM (
    SELECT DISTINCT sale_date
    FROM public.unified_sales
    WHERE restaurant_id = p_restaurant_id
      AND pos_system    = 'focus'
      AND synced_at    >= v_sync_start
  ) d;

  RETURN v_count;
END;
$$;
