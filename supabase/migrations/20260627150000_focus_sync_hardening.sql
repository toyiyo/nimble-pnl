-- =====================================================================
-- Focus POS sync hardening (CodeRabbit Phase 7c fixes)
--
-- Fix 1: Revoke PUBLIC/anon execute on SECURITY DEFINER RPCs.
--        PostgreSQL grants EXECUTE to PUBLIC by default; explicit
--        REVOKE + targeted GRANT ensures anon callers cannot bypass
--        the wrapper auth checks.
--
-- Fix 2: Update last_sync_time in sync_all_focus_to_unified_sales()
--        so the round-robin ORDER BY advances and all active restaurants
--        eventually get synced (previously only the same 5 were selected).
--
-- Fix 3: Include revenue_center in offset row external_item_ids so that
--        tax/tip/discount/refund rows from different revenue centers for
--        the same store/date do not overwrite each other in unified_sales.
--
-- Fix 4: Drive aggregation from focus_daily_reports (all processed dates)
--        instead of synced_at >= v_sync_start (misses delete-only syncs).
-- =====================================================================

-- ─────────────────────────────────────────────────────────────────────────────
-- Fix 1: Revoke default PUBLIC execute on SECURITY DEFINER functions
-- ─────────────────────────────────────────────────────────────────────────────
REVOKE ALL ON FUNCTION public._sync_focus_to_unified_sales_impl(uuid, date, date)
  FROM PUBLIC, anon, authenticated;

REVOKE ALL ON FUNCTION public.sync_focus_to_unified_sales(uuid)
  FROM PUBLIC, anon;

REVOKE ALL ON FUNCTION public.sync_focus_to_unified_sales(uuid, date, date)
  FROM PUBLIC, anon;

REVOKE ALL ON FUNCTION public.sync_all_focus_to_unified_sales()
  FROM PUBLIC, anon, authenticated;

-- Re-grant only the intended roles
GRANT EXECUTE ON FUNCTION public._sync_focus_to_unified_sales_impl(uuid, date, date)
  TO service_role;

GRANT EXECUTE ON FUNCTION public.sync_focus_to_unified_sales(uuid)
  TO authenticated, service_role;

GRANT EXECUTE ON FUNCTION public.sync_focus_to_unified_sales(uuid, date, date)
  TO authenticated, service_role;

-- sync_all_focus_to_unified_sales is a cron wrapper — service_role only
GRANT EXECUTE ON FUNCTION public.sync_all_focus_to_unified_sales()
  TO service_role;


-- ─────────────────────────────────────────────────────────────────────────────
-- Fix 2 + Fix 3 + Fix 4: Replace _sync_focus_to_unified_sales_impl
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public._sync_focus_to_unified_sales_impl(
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
  v_report         record;
  v_store_id       text;
  v_order_id       text;
  v_revenue_center text;
  v_rc_slug        text;       -- slug of revenue_center (Fix 3: used in offset IDs)
  v_item           jsonb;
  v_item_id        text;
  v_current_ids    text[];
BEGIN
  -- Fetch the store_id for this restaurant (needed for external_order_id)
  SELECT fc.store_id INTO v_store_id
  FROM public.focus_connections fc
  WHERE fc.restaurant_id = p_restaurant_id
  LIMIT 1;

  -- GUC flag: skip per-row triggers during bulk sync (transaction-local).
  PERFORM set_config('app.skip_unified_sales_triggers', 'true', true);

  -- Iterate over each business day in focus_daily_reports for this restaurant
  FOR v_report IN
    SELECT fdr.business_date,
           fdr.revenue_center,
           fdr.total_tax,
           fdr.subtotal_discounts,
           fdr.retained_tips,
           fdr.refunds,
           fdr.items_json
    FROM public.focus_daily_reports fdr
    WHERE fdr.restaurant_id = p_restaurant_id
      AND (p_start_date IS NULL OR fdr.business_date >= p_start_date)
      AND (p_end_date   IS NULL OR fdr.business_date <= p_end_date)
    ORDER BY fdr.business_date
  LOOP
    v_revenue_center := COALESCE(v_report.revenue_center, '');
    v_rc_slug        := COALESCE(NULLIF(focus_slug(v_revenue_center), ''), 'default');
    v_order_id       := 'focus-' || COALESCE(v_store_id, 'unknown') || '-'
                        || to_char(v_report.business_date, 'YYYYMMDD');

    -- ── Build current external_item_id set for orphan detection ───────────
    SELECT ARRAY(
      SELECT focus_slug(v_revenue_center) || '_' || focus_slug(el->>'name')
      FROM jsonb_array_elements(v_report.items_json) el
      WHERE (el->>'name') IS NOT NULL
    ) INTO v_current_ids;

    -- ── Step 1: DELETE orphan sale rows no longer in items_json ───────────
    DELETE FROM public.unified_sales us
    WHERE us.restaurant_id   = p_restaurant_id
      AND us.pos_system      = 'focus'
      AND us.item_type       = 'sale'
      AND us.sale_date       = v_report.business_date
      AND us.external_order_id = v_order_id
      AND NOT (us.external_item_id = ANY(v_current_ids));

    -- ── Step 2: UPSERT sale rows (one per item in items_json) ─────────────
    FOR v_item IN SELECT * FROM jsonb_array_elements(v_report.items_json)
    LOOP
      CONTINUE WHEN (v_item->>'name') IS NULL;

      v_item_id := focus_slug(v_revenue_center) || '_' || focus_slug(v_item->>'name');

      INSERT INTO public.unified_sales (
        restaurant_id, pos_system,
        external_order_id, external_item_id,
        item_name, quantity, unit_price, total_price,
        sale_date, item_type, synced_at
      ) VALUES (
        p_restaurant_id, 'focus',
        v_order_id, v_item_id,
        v_item->>'name', 1,
        (v_item->>'sales')::numeric,
        (v_item->>'sales')::numeric,
        v_report.business_date, 'sale', now()
      )
      ON CONFLICT (restaurant_id, pos_system, external_order_id, external_item_id)
        WHERE parent_sale_id IS NULL
      DO UPDATE SET
        item_name   = EXCLUDED.item_name,
        unit_price  = EXCLUDED.unit_price,
        total_price = EXCLUDED.total_price,
        sale_date   = EXCLUDED.sale_date,
        synced_at   = EXCLUDED.synced_at
        -- category_id + is_categorized intentionally omitted →
        -- preserves user-managed categorization on re-sync (design §7 / S2)
      ;

      GET DIAGNOSTICS v_row_count = ROW_COUNT;
      v_count := v_count + v_row_count;
    END LOOP;

    -- Fix 3: Offset row external_item_ids now include v_rc_slug so that
    -- tax/tip/discount/refund rows from different revenue centers for the
    -- same store/date each get a unique key and do not overwrite each other.

    -- ── Step 3: TAX offset row ────────────────────────────────────────────
    IF COALESCE(v_report.total_tax, 0) != 0 THEN
      INSERT INTO public.unified_sales (
        restaurant_id, pos_system,
        external_order_id, external_item_id,
        item_name, quantity, unit_price, total_price,
        sale_date, item_type, adjustment_type, synced_at
      ) VALUES (
        p_restaurant_id, 'focus',
        v_order_id, v_order_id || '_' || v_rc_slug || '_tax',
        'Sales Tax', 1,
        v_report.total_tax, v_report.total_tax,
        v_report.business_date, 'tax', 'tax', now()
      )
      ON CONFLICT (restaurant_id, pos_system, external_order_id, external_item_id)
        WHERE parent_sale_id IS NULL
      DO UPDATE SET
        total_price = EXCLUDED.total_price,
        unit_price  = EXCLUDED.unit_price,
        sale_date   = EXCLUDED.sale_date,
        synced_at   = EXCLUDED.synced_at;

      GET DIAGNOSTICS v_row_count = ROW_COUNT;
      v_count := v_count + v_row_count;
    ELSE
      DELETE FROM public.unified_sales
      WHERE restaurant_id    = p_restaurant_id
        AND pos_system       = 'focus'
        AND external_item_id = v_order_id || '_' || v_rc_slug || '_tax'
        AND sale_date        = v_report.business_date;
    END IF;

    -- ── Step 4: TIP offset row ────────────────────────────────────────────
    IF COALESCE(v_report.retained_tips, 0) != 0 THEN
      INSERT INTO public.unified_sales (
        restaurant_id, pos_system,
        external_order_id, external_item_id,
        item_name, quantity, unit_price, total_price,
        sale_date, item_type, adjustment_type, synced_at
      ) VALUES (
        p_restaurant_id, 'focus',
        v_order_id, v_order_id || '_' || v_rc_slug || '_tip',
        'Retained Tips', 1,
        v_report.retained_tips, v_report.retained_tips,
        v_report.business_date, 'tip', 'tip', now()
      )
      ON CONFLICT (restaurant_id, pos_system, external_order_id, external_item_id)
        WHERE parent_sale_id IS NULL
      DO UPDATE SET
        total_price = EXCLUDED.total_price,
        unit_price  = EXCLUDED.unit_price,
        sale_date   = EXCLUDED.sale_date,
        synced_at   = EXCLUDED.synced_at;

      GET DIAGNOSTICS v_row_count = ROW_COUNT;
      v_count := v_count + v_row_count;
    ELSE
      DELETE FROM public.unified_sales
      WHERE restaurant_id    = p_restaurant_id
        AND pos_system       = 'focus'
        AND external_item_id = v_order_id || '_' || v_rc_slug || '_tip'
        AND sale_date        = v_report.business_date;
    END IF;

    -- ── Step 5: DISCOUNT offset row (negative) ────────────────────────────
    IF COALESCE(v_report.subtotal_discounts, 0) != 0 THEN
      INSERT INTO public.unified_sales (
        restaurant_id, pos_system,
        external_order_id, external_item_id,
        item_name, quantity, unit_price, total_price,
        sale_date, item_type, adjustment_type, synced_at
      ) VALUES (
        p_restaurant_id, 'focus',
        v_order_id, v_order_id || '_' || v_rc_slug || '_discount',
        'Subtotal Discounts', 1,
        -ABS(v_report.subtotal_discounts), -ABS(v_report.subtotal_discounts),
        v_report.business_date, 'discount', 'discount', now()
      )
      ON CONFLICT (restaurant_id, pos_system, external_order_id, external_item_id)
        WHERE parent_sale_id IS NULL
      DO UPDATE SET
        total_price = EXCLUDED.total_price,
        unit_price  = EXCLUDED.unit_price,
        sale_date   = EXCLUDED.sale_date,
        synced_at   = EXCLUDED.synced_at;

      GET DIAGNOSTICS v_row_count = ROW_COUNT;
      v_count := v_count + v_row_count;
    ELSE
      DELETE FROM public.unified_sales
      WHERE restaurant_id    = p_restaurant_id
        AND pos_system       = 'focus'
        AND external_item_id = v_order_id || '_' || v_rc_slug || '_discount'
        AND sale_date        = v_report.business_date;
    END IF;

    -- ── Step 6: REFUND offset row (negative) ─────────────────────────────
    IF COALESCE(v_report.refunds, 0) != 0 THEN
      INSERT INTO public.unified_sales (
        restaurant_id, pos_system,
        external_order_id, external_item_id,
        item_name, quantity, unit_price, total_price,
        sale_date, item_type, synced_at
      ) VALUES (
        p_restaurant_id, 'focus',
        v_order_id, v_order_id || '_' || v_rc_slug || '_refund',
        'Refunds', 1,
        -ABS(v_report.refunds), -ABS(v_report.refunds),
        v_report.business_date, 'refund', now()
      )
      ON CONFLICT (restaurant_id, pos_system, external_order_id, external_item_id)
        WHERE parent_sale_id IS NULL
      DO UPDATE SET
        total_price = EXCLUDED.total_price,
        unit_price  = EXCLUDED.unit_price,
        sale_date   = EXCLUDED.sale_date,
        synced_at   = EXCLUDED.synced_at;

      GET DIAGNOSTICS v_row_count = ROW_COUNT;
      v_count := v_count + v_row_count;
    ELSE
      DELETE FROM public.unified_sales
      WHERE restaurant_id    = p_restaurant_id
        AND pos_system       = 'focus'
        AND external_item_id = v_order_id || '_' || v_rc_slug || '_refund'
        AND sale_date        = v_report.business_date;
    END IF;

  END LOOP;  -- end per-date loop

  -- Reset GUC flag to re-enable per-row triggers
  PERFORM set_config('app.skip_unified_sales_triggers', 'false', true);

  -- Batch-categorize uncategorized sale rows (only for authenticated users;
  -- service-role callers defer to the apply-categorization-rules edge function)
  IF auth.uid() IS NOT NULL THEN
    PERFORM apply_rules_to_pos_sales(p_restaurant_id, 10000);
  ELSE
    RAISE LOG 'sync_focus_to_unified_sales: skipping batch categorization (service-role caller)';
  END IF;

  -- Fix 4: Drive aggregation from focus_daily_reports rather than
  -- unified_sales.synced_at >= v_sync_start.  The synced_at approach missed
  -- delete-only syncs (where all rows for a date were removed and no
  -- synced_at update remained).  Using focus_daily_reports ensures every
  -- processed date — including those whose items were fully deleted — gets
  -- its daily totals recalculated.
  PERFORM public.aggregate_unified_sales_to_daily(p_restaurant_id, d.sale_date)
  FROM (
    SELECT DISTINCT fdr.business_date AS sale_date
    FROM public.focus_daily_reports fdr
    WHERE fdr.restaurant_id = p_restaurant_id
      AND (p_start_date IS NULL OR fdr.business_date >= p_start_date)
      AND (p_end_date   IS NULL OR fdr.business_date <= p_end_date)
  ) d;

  RETURN v_count;
END;
$$;


-- ─────────────────────────────────────────────────────────────────────────────
-- Fix 2: Replace sync_all_focus_to_unified_sales to update last_sync_time
-- after each successful sync so the round-robin ORDER BY advances and
-- all active restaurants eventually get processed (previously the same 5
-- restaurants with the oldest last_sync_time could be selected every run).
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.sync_all_focus_to_unified_sales()
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
    LIMIT 5        -- S5: bound cron work per invocation
  LOOP
    BEGIN
      restaurant_id := r.restaurant_id;
      -- Use yesterday UTC as the end date instead of CURRENT_DATE.
      -- CURRENT_DATE (UTC) may be ahead of a restaurant's local date when that
      -- restaurant is in a negative UTC offset (e.g. America/Los_Angeles at 01:00
      -- UTC is still the previous day locally), which would push partial-day data
      -- into unified_sales before the business day has closed.  Capping to
      -- (NOW() AT TIME ZONE 'UTC')::date - 1 keeps the window to completed days.
      rows_synced   := public._sync_focus_to_unified_sales_impl(
                         r.restaurant_id,
                         ((NOW() AT TIME ZONE 'UTC')::date - interval '2 days')::date,
                         ((NOW() AT TIME ZONE 'UTC')::date - interval '1 day')::date
                       );
      -- Fix 2: advance last_sync_time so the round-robin ORDER BY progresses
      UPDATE public.focus_connections fc
      SET last_sync_time = now()
      WHERE fc.restaurant_id = r.restaurant_id;
      RETURN NEXT;
    EXCEPTION WHEN OTHERS THEN
      RAISE WARNING 'sync_all_focus_to_unified_sales: failed for restaurant %: %',
        r.restaurant_id, SQLERRM;
    END;
  END LOOP;
END;
$$;

-- Re-apply grant on the replaced functions (REVOKE above strips them)
GRANT EXECUTE ON FUNCTION public._sync_focus_to_unified_sales_impl(uuid, date, date)
  TO service_role;

GRANT EXECUTE ON FUNCTION public.sync_all_focus_to_unified_sales()
  TO service_role;
