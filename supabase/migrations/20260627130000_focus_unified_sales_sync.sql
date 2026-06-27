-- =====================================================================
-- FOCUS POS → unified_sales sync RPCs
--
-- Mirrors Toast's sync_toast_to_unified_sales pattern (GUC trigger
-- bypass, SECURITY DEFINER, 120s timeout, batch categorize + aggregate).
--
-- Two public RPCs:
--   sync_focus_to_unified_sales(p_restaurant_id)              — all dates
--   sync_focus_to_unified_sales(p_restaurant_id, start, end)  — date range
-- One cron RPC:
--   sync_all_focus_to_unified_sales() → TABLE(restaurant_id, rows_synced)
--
-- Row model (gross + offsets), per business day, from focus_daily_reports:
--   sale     (NULL)        each item in items_json
--   tax      ('tax')       total_tax          (skipped if zero)
--   tip      ('tip')       retained_tips      (skipped if zero)
--   discount ('discount')  subtotal_discounts (negative; skipped if zero)
--   refund   (NULL)        refunds            (negative; skipped if zero)
--
-- external_order_id  = 'focus-{store_id}-{YYYYMMDD}'
-- external_item_id (sale)    = slug(revenue_center)||'_'||slug(item_name)
-- external_item_id (offset)  = external_order_id || '_tax|_tip|_discount|_refund'
--
-- Write strategy (design §7 / S2):
--   Per (restaurant_id, sale_date):
--     1. DELETE orphan sale rows no longer present in items_json.
--     2. UPSERT sale rows — preserves category_id + is_categorized.
--     3. Upsert/delete offset rows.
-- =====================================================================

-- ─────────────────────────────────────────────────────────────────────────────
-- Slug helper: lowercase, strip non-alphanumeric, collapse hyphens
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.focus_slug(p_text text)
RETURNS text
LANGUAGE sql
IMMUTABLE
SET search_path = public
AS $$
  SELECT regexp_replace(
           regexp_replace(lower(trim(p_text)), '[^a-z0-9]+', '-', 'g'),
           '-+', '-', 'g')
$$;

-- ─────────────────────────────────────────────────────────────────────────────
-- Internal implementation shared by both overloads
-- (not exported; both public overloads are independent entry points)
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
  v_sync_start     timestamptz := clock_timestamp();
  v_report         record;
  v_store_id       text;
  v_order_id       text;
  v_revenue_center text;
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

    -- ── Step 3: TAX offset row ────────────────────────────────────────────
    IF COALESCE(v_report.total_tax, 0) != 0 THEN
      INSERT INTO public.unified_sales (
        restaurant_id, pos_system,
        external_order_id, external_item_id,
        item_name, quantity, unit_price, total_price,
        sale_date, item_type, adjustment_type, synced_at
      ) VALUES (
        p_restaurant_id, 'focus',
        v_order_id, v_order_id || '_tax',
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
        AND external_item_id = v_order_id || '_tax'
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
        v_order_id, v_order_id || '_tip',
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
        AND external_item_id = v_order_id || '_tip'
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
        v_order_id, v_order_id || '_discount',
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
        AND external_item_id = v_order_id || '_discount'
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
        v_order_id, v_order_id || '_refund',
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
        AND external_item_id = v_order_id || '_refund'
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
-- sync_focus_to_unified_sales(uuid) — all-dates overload
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.sync_focus_to_unified_sales(
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

  RETURN public._sync_focus_to_unified_sales_impl(p_restaurant_id, NULL, NULL);
END;
$$;

-- ─────────────────────────────────────────────────────────────────────────────
-- sync_focus_to_unified_sales(uuid, date, date) — date-range overload
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.sync_focus_to_unified_sales(
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

  RETURN public._sync_focus_to_unified_sales_impl(p_restaurant_id, p_start_date, p_end_date);
END;
$$;

-- ─────────────────────────────────────────────────────────────────────────────
-- sync_all_focus_to_unified_sales()
--
-- Called by the 5-min pg_cron job. Processes up to 5 active connections
-- ordered by last_sync_time ASC NULLS FIRST (round-robin fairness, design S5).
-- Uses the last 2 business days window for incremental syncs.
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
      rows_synced   := public._sync_focus_to_unified_sales_impl(
                         r.restaurant_id,
                         (CURRENT_DATE - interval '2 days')::date,
                         CURRENT_DATE
                       );
      RETURN NEXT;
    EXCEPTION WHEN OTHERS THEN
      RAISE WARNING 'sync_all_focus_to_unified_sales: failed for restaurant %: %',
        r.restaurant_id, SQLERRM;
    END;
  END LOOP;
END;
$$;

-- ─────────────────────────────────────────────────────────────────────────────
-- Grants
-- ─────────────────────────────────────────────────────────────────────────────
GRANT EXECUTE ON FUNCTION public.focus_slug(text)
  TO authenticated, service_role;

GRANT EXECUTE ON FUNCTION public.sync_focus_to_unified_sales(uuid)
  TO authenticated, service_role;

GRANT EXECUTE ON FUNCTION public.sync_focus_to_unified_sales(uuid, date, date)
  TO authenticated, service_role;

GRANT EXECUTE ON FUNCTION public.sync_all_focus_to_unified_sales()
  TO authenticated, service_role;

-- ─────────────────────────────────────────────────────────────────────────────
-- Comments
-- ─────────────────────────────────────────────────────────────────────────────
COMMENT ON FUNCTION public.sync_focus_to_unified_sales(uuid) IS
  'Syncs Focus POS daily reports to unified_sales (all dates) for one restaurant. '
  'Skips per-row triggers via GUC flag, orphan-deletes removed items, '
  'then batch-categorizes and aggregates daily totals.';

COMMENT ON FUNCTION public.sync_focus_to_unified_sales(uuid, date, date) IS
  'Syncs Focus POS daily reports to unified_sales for a date range. '
  'Called by sync_all_focus_to_unified_sales for incremental cron syncs.';

COMMENT ON FUNCTION public.sync_all_focus_to_unified_sales() IS
  'Round-robin incremental sync for all active Focus connections '
  '(ORDER BY last_sync_time ASC NULLS FIRST LIMIT 5, last 2 business days). '
  'Runs every 5 minutes via pg_cron.';
