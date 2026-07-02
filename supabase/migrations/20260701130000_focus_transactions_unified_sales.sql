-- =====================================================================
-- FOCUS POS TRANSACTION → unified_sales sync RPCs
--
-- Mirrors sync_toast_to_unified_sales: syncs focus_orders /
-- focus_order_items / focus_payments → unified_sales for item-level
-- sales data (supersedes the daily-aggregate focus_daily_reports path
-- for restaurants that have the Lynk datafeed integrated).
--
-- Three public entry points:
--   sync_focus_transactions_to_unified_sales(uuid)
--       → all dates for one restaurant
--   sync_focus_transactions_to_unified_sales(uuid, date, date)
--       → date range for one restaurant
--   sync_all_focus_transactions_to_unified_sales()
--       → cron wrapper: round-robin, up to 5 active connections,
--         yesterday + today window
--
-- external_order_id pattern  : focus-{store_id}-{YYYYMMDD}-{check_id}
-- external_item_id (sale)    : {external_order_id}__{item_key}
-- external_item_id (discount): {external_order_id}__{item_key}_discount
-- external_item_id (tip)     : {external_order_id}_{payment_key}_tip
--
-- Row model:
--   sale     item_type='sale'     — per priced item (price != 0, including
--                                   modifiers with a non-zero price);
--                                   category via report_group_id
--   tip      item_type='tip'      — per payment where tip > 0
--   discount item_type='discount' — per item where discount_amount > 0
--                                   (stored as negative amount)
--
-- Note: focus_orders does not carry an explicit tax_amount field (the XML
-- provides taxable_sales, not the computed tax). Tax offset rows are
-- therefore omitted; they can be added when/if tax columns are stored.
--
-- Write strategy (mirrors Toast / design §4):
--   Per (restaurant_id, business_date, check_id):
--     1. DELETE orphan sale rows whose item_key no longer exists in
--        focus_order_items for this check.
--     2. UPSERT sale rows — preserves category_id + is_categorized.
--     3. UPSERT / DELETE discount offset rows per item.
--     4. UPSERT / DELETE tip offset rows per payment.
--
-- GUC flag 'app.skip_unified_sales_triggers' bypasses per-row triggers
-- during bulk writes (same pattern as sync_focus_to_unified_sales).
-- =====================================================================

-- ─────────────────────────────────────────────────────────────────────────────
-- Internal implementation — shared by both public overloads
-- ─────────────────────────────────────────────────────────────────────────────
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
    SELECT fo.business_date, fo.focus_check_id
    FROM public.focus_orders fo
    WHERE fo.restaurant_id = p_restaurant_id
      AND (p_start_date IS NULL OR fo.business_date >= p_start_date)
      AND (p_end_date   IS NULL OR fo.business_date <= p_end_date)
    ORDER BY fo.business_date, fo.focus_check_id
  LOOP
    v_order_id := 'focus-' || COALESCE(v_store_id, 'unknown')
                  || '-' || to_char(v_order.business_date, 'YYYYMMDD')
                  || '-' || v_order.focus_check_id;

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
    DELETE FROM public.unified_sales us
    WHERE us.restaurant_id     = p_restaurant_id
      AND us.pos_system        = 'focus'
      AND us.item_type         = 'sale'
      AND us.sale_date         = v_order.business_date
      AND us.external_order_id = v_order_id
      AND NOT (us.external_item_id = ANY(v_current_ids));

    -- ── Step 3: UPSERT sale rows (one per priced item) ────────────────────
    INSERT INTO public.unified_sales (
      restaurant_id, pos_system,
      external_order_id, external_item_id,
      item_name, quantity, unit_price, total_price,
      sale_date, pos_category, item_type, synced_at
    )
    SELECT
      foi.restaurant_id, 'focus',
      v_order_id, v_order_id || '__' || foi.item_key,
      foi.name, 1, foi.price, foi.price,
      foi.business_date, foi.report_group_id, 'sale', now()
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
      pos_category = EXCLUDED.pos_category,
      synced_at    = EXCLUDED.synced_at
      -- category_id + is_categorized intentionally omitted →
      -- preserves user-managed categorization on re-sync (design §4)
    ;

    GET DIAGNOSTICS v_row_count = ROW_COUNT;
    v_count := v_count + v_row_count;

    -- ── Step 4: UPSERT / DELETE discount offset rows ───────────────────────
    -- Upsert items that have a non-zero discount
    INSERT INTO public.unified_sales (
      restaurant_id, pos_system,
      external_order_id, external_item_id,
      item_name, quantity, unit_price, total_price,
      sale_date, item_type, adjustment_type, synced_at
    )
    SELECT
      foi.restaurant_id, 'focus',
      v_order_id, v_order_id || '__' || foi.item_key || '_discount',
      'Discount - ' || COALESCE(foi.name, 'Item'), 1,
      -ABS(foi.discount_amount), -ABS(foi.discount_amount),
      foi.business_date, 'discount', 'discount', now()
    FROM public.focus_order_items foi
    WHERE foi.restaurant_id  = p_restaurant_id
      AND foi.business_date  = v_order.business_date
      AND foi.focus_check_id = v_order.focus_check_id
      AND foi.discount_amount > 0
    ON CONFLICT (restaurant_id, pos_system, external_order_id, external_item_id)
      WHERE parent_sale_id IS NULL
    DO UPDATE SET
      item_name   = EXCLUDED.item_name,
      unit_price  = EXCLUDED.unit_price,
      total_price = EXCLUDED.total_price,
      sale_date   = EXCLUDED.sale_date,
      synced_at   = EXCLUDED.synced_at;

    GET DIAGNOSTICS v_row_count = ROW_COUNT;
    v_count := v_count + v_row_count;

    -- Delete stale discount rows for items that no longer have a discount
    DELETE FROM public.unified_sales us
    WHERE us.restaurant_id     = p_restaurant_id
      AND us.pos_system        = 'focus'
      AND us.item_type         = 'discount'
      AND us.sale_date         = v_order.business_date
      AND us.external_order_id = v_order_id
      AND us.external_item_id NOT IN (
        SELECT v_order_id || '__' || foi.item_key || '_discount'
        FROM public.focus_order_items foi
        WHERE foi.restaurant_id  = p_restaurant_id
          AND foi.business_date  = v_order.business_date
          AND foi.focus_check_id = v_order.focus_check_id
          AND foi.discount_amount > 0
      );

    -- ── Step 5: UPSERT / DELETE tip offset rows ────────────────────────────
    -- Upsert payments with a non-zero tip
    INSERT INTO public.unified_sales (
      restaurant_id, pos_system,
      external_order_id, external_item_id,
      item_name, quantity, unit_price, total_price,
      sale_date, item_type, adjustment_type, synced_at
    )
    SELECT
      fp.restaurant_id, 'focus',
      v_order_id, v_order_id || '_' || fp.payment_key || '_tip',
      'Tip - ' || COALESCE(fp.name, 'Payment'), 1,
      fp.tip, fp.tip,
      fp.business_date, 'tip', 'tip', now()
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
      synced_at   = EXCLUDED.synced_at;

    GET DIAGNOSTICS v_row_count = ROW_COUNT;
    v_count := v_count + v_row_count;

    -- Delete stale tip rows for payments that no longer have a tip
    DELETE FROM public.unified_sales us
    WHERE us.restaurant_id     = p_restaurant_id
      AND us.pos_system        = 'focus'
      AND us.item_type         = 'tip'
      AND us.sale_date         = v_order.business_date
      AND us.external_order_id = v_order_id
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

-- ─────────────────────────────────────────────────────────────────────────────
-- sync_focus_transactions_to_unified_sales(uuid) — all-dates overload
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.sync_focus_transactions_to_unified_sales(
  p_restaurant_id uuid
)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
SET statement_timeout = '120s'
AS $$
BEGIN
  -- Authorization check: skip when called from service role (auth.uid() is NULL)
  IF auth.uid() IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM public.user_restaurants
    WHERE restaurant_id = p_restaurant_id
      AND user_id = auth.uid()
  ) THEN
    RAISE EXCEPTION 'Unauthorized: user does not have access to this restaurant';
  END IF;

  RETURN public._sync_focus_transactions_to_unified_sales_impl(
    p_restaurant_id, NULL, NULL
  );
END;
$$;

-- ─────────────────────────────────────────────────────────────────────────────
-- sync_focus_transactions_to_unified_sales(uuid, date, date) — date-range overload
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.sync_focus_transactions_to_unified_sales(
  p_restaurant_id uuid,
  p_start_date    date,
  p_end_date      date
)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
SET statement_timeout = '120s'
AS $$
BEGIN
  -- Authorization check: skip when called from service role (auth.uid() is NULL)
  IF auth.uid() IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM public.user_restaurants
    WHERE restaurant_id = p_restaurant_id
      AND user_id = auth.uid()
  ) THEN
    RAISE EXCEPTION 'Unauthorized: user does not have access to this restaurant';
  END IF;

  RETURN public._sync_focus_transactions_to_unified_sales_impl(
    p_restaurant_id, p_start_date, p_end_date
  );
END;
$$;

-- ─────────────────────────────────────────────────────────────────────────────
-- sync_all_focus_transactions_to_unified_sales()
--
-- Called by the pg_cron job. Processes up to 5 active connections,
-- ordered by last_sync_time ASC NULLS FIRST (round-robin fairness,
-- design §4 / mirror of sync_all_focus_to_unified_sales pattern).
-- Uses last 2 business days for incremental syncs.
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
    SELECT fc.restaurant_id
    FROM public.focus_connections fc
    WHERE fc.is_active = true
    ORDER BY fc.last_sync_time ASC NULLS FIRST
    LIMIT 5
  LOOP
    BEGIN
      restaurant_id := r.restaurant_id;
      -- Use a conservative 3-day lookback window rather than UTC-derived dates.
      -- Focus business dates are stored in the restaurant's local timezone (e.g.
      -- America/Chicago). UTC midnight on July 1 can be June 30 in Chicago, so
      -- a 1-day UTC window misses the most recent local business date.
      -- A 3-day window covers all US timezones (UTC-12 to UTC-12) safely and
      -- matches the existing sync_all_focus_to_unified_sales pattern.
      rows_synced   := public._sync_focus_transactions_to_unified_sales_impl(
                         r.restaurant_id,
                         (CURRENT_DATE - interval '3 days')::date,
                         CURRENT_DATE
                       );
      RETURN NEXT;
    EXCEPTION WHEN OTHERS THEN
      RAISE WARNING
        'sync_all_focus_transactions_to_unified_sales: failed for restaurant %: %',
        r.restaurant_id, SQLERRM;
    END;
  END LOOP;
END;
$$;

-- ─────────────────────────────────────────────────────────────────────────────
-- Grants
-- ─────────────────────────────────────────────────────────────────────────────
GRANT EXECUTE ON FUNCTION public.sync_focus_transactions_to_unified_sales(uuid)
  TO authenticated, service_role;

GRANT EXECUTE ON FUNCTION public.sync_focus_transactions_to_unified_sales(uuid, date, date)
  TO authenticated, service_role;

-- sync_all_focus_transactions_to_unified_sales is a cron wrapper only —
-- service_role exclusively (matches the precedent set by
-- sync_all_focus_to_unified_sales in 20260627150000_focus_sync_hardening.sql).
-- Granting to authenticated would let any logged-in user trigger a cross-restaurant
-- bulk sync that iterates ALL active focus_connections regardless of ownership.
GRANT EXECUTE ON FUNCTION public.sync_all_focus_transactions_to_unified_sales()
  TO service_role;

-- ─────────────────────────────────────────────────────────────────────────────
-- Comments
-- ─────────────────────────────────────────────────────────────────────────────
COMMENT ON FUNCTION public._sync_focus_transactions_to_unified_sales_impl(uuid, date, date) IS
  'Internal implementation for sync_focus_transactions_to_unified_sales. '
  'Iterates focus_orders for the date range, upserts sale + discount + tip rows '
  'into unified_sales, orphan-deletes removed items, then batch-categorizes and '
  'aggregates daily totals. Not called directly — use the public overloads.';

COMMENT ON FUNCTION public.sync_focus_transactions_to_unified_sales(uuid) IS
  'Syncs all Focus POS transaction items to unified_sales (all dates) for one '
  'restaurant. GUC-bypasses per-row triggers, orphan-deletes removed items, '
  'then batch-categorizes and aggregates. Requires user_restaurants membership.';

COMMENT ON FUNCTION public.sync_focus_transactions_to_unified_sales(uuid, date, date) IS
  'Syncs Focus POS transaction items to unified_sales within a date range. '
  'Called by sync_all_focus_transactions_to_unified_sales for incremental cron syncs.';

COMMENT ON FUNCTION public.sync_all_focus_transactions_to_unified_sales() IS
  'Round-robin incremental sync for all active Focus connections '
  '(ORDER BY last_sync_time ASC NULLS FIRST LIMIT 5, last 2 business days). '
  'Designed to run via pg_cron alongside sync_all_focus_to_unified_sales.';
