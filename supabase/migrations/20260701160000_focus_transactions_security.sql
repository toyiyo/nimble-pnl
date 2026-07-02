-- =====================================================================
-- FOCUS POS TRANSACTION SECURITY HARDENING
--
-- 1. Revoke direct PUBLIC EXECUTE on the SECURITY DEFINER _impl helper
--    so callers are forced through the auth-checked public overloads.
--    PostgreSQL grants EXECUTE to PUBLIC by default on new functions;
--    this migration corrects that for the already-deployed _impl.
--
-- 2. Re-create _impl with discount_amount != 0 predicate fix.
--    The original migration used > 0, which silently missed the common
--    case where Focus stores DiscountAmount as a negative value (e.g. -3.01).
--    Applies to both the UPSERT filter and the stale-row DELETE filter.
-- =====================================================================

-- ─────────────────────────────────────────────────────────────────────────────
-- 1. Revoke PUBLIC EXECUTE on the internal _impl helper
-- ─────────────────────────────────────────────────────────────────────────────
-- Must run before or after CREATE OR REPLACE — same result either way.
REVOKE ALL ON FUNCTION public._sync_focus_transactions_to_unified_sales_impl(uuid, date, date)
  FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION public._sync_focus_transactions_to_unified_sales_impl(uuid, date, date)
  TO service_role;

-- ─────────────────────────────────────────────────────────────────────────────
-- 2. Re-create _impl with corrected discount_amount predicate (!= 0)
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
    -- Upsert items that have a non-zero discount.
    -- Focus XML stores DiscountAmount as a negative value (e.g. -3.01).
    -- Use != 0 (not > 0) so that negative amounts are also captured.
    -- -ABS() normalises to negative regardless of stored sign.
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
      AND foi.discount_amount != 0
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

-- Re-apply privilege restriction after CREATE OR REPLACE (which resets grants)
REVOKE ALL ON FUNCTION public._sync_focus_transactions_to_unified_sales_impl(uuid, date, date)
  FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION public._sync_focus_transactions_to_unified_sales_impl(uuid, date, date)
  TO service_role;
