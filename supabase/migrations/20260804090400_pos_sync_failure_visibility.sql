-- Make a per-restaurant POS sync failure visible instead of silent.
--
-- Every sync_all_* cron wrapper caught errors with `EXCEPTION WHEN OTHERS THEN
-- RAISE WARNING` and nothing else. Two consequences, both observed in
-- production: (1) WHEN OTHERS does not catch query_canceled (57014), so a
-- statement_timeout in one restaurant aborted the entire cron run -- 733
-- aborted runs over four days in Feb 2026 with no user-visible signal;
-- (2) even for caught errors, a RAISE WARNING into the Postgres log is not a
-- surface anyone watches.
--
-- Fix: name query_canceled explicitly, and record both arms on the existing
-- connection_status / last_error / last_error_at columns that already back the
-- integrations UI.
--
-- Design: docs/superpowers/specs/2026-08-03-pos-sync-categorization-rescan-design.md §3.7

CREATE OR REPLACE FUNCTION public.record_pos_sync_error(
  p_pos           TEXT,
  p_restaurant_id UUID,
  p_message       TEXT
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
BEGIN
  -- Deliberately no `SET LOCAL statement_timeout` guard here. Postgres arms
  -- statement_timeout once, at the start of each client-issued statement;
  -- changing it inside a function does not re-arm a timer for that function's
  -- own statements, so the guard would be a no-op that also leaked a shortened
  -- timeout to the rest of the caller's transaction.
  --
  -- p_pos is supplied only as a literal by the four sync_all_* wrappers, never
  -- from user input; format(%I) is belt-and-braces.
  EXECUTE format(
    'UPDATE public.%I SET connection_status = ''error'',
                          last_error = left($1, 500),
                          last_error_at = now()
      WHERE restaurant_id = $2',
    p_pos || '_connections')
  USING p_message, p_restaurant_id;
EXCEPTION WHEN OTHERS THEN
  -- Error bookkeeping must never mask the original failure or stop the loop,
  -- but a break in the bookkeeping itself (e.g. a future POS's _connections
  -- table missing these columns) should still leave a trace in the logs
  -- rather than vanishing silently.
  RAISE WARNING 'record_pos_sync_error: failed to record % error for restaurant %: %',
    p_pos, p_restaurant_id, SQLERRM;
END;
$$;

COMMENT ON FUNCTION public.record_pos_sync_error(text, uuid, text) IS
  'Records a POS sync failure on <p_pos>_connections. Service-role only -- it '
  'writes another tenant''s row by construction, so it must never be reachable '
  'from PostgREST.';

-- MANDATORY. Supabase's default ACL on schema public grants EXECUTE on new
-- functions to anon and authenticated. Without this REVOKE, this SECURITY
-- DEFINER function is callable with the public anon key, letting any caller set
-- connection_status = 'error' and an attacker-controlled last_error on ANY
-- restaurant's connection row -- a cross-tenant write that bypasses RLS.
REVOKE EXECUTE ON FUNCTION public.record_pos_sync_error(text, uuid, text)
  FROM PUBLIC, anon, authenticated;
GRANT  EXECUTE ON FUNCTION public.record_pos_sync_error(text, uuid, text)
  TO service_role;

-- ---------------------------------------------------------------------------
-- Toast. Body copied from 20260216120000_toast_incremental_sync.sql:28 (the
-- latest definition; 20260127000000 carries an older one).
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION sync_all_toast_to_unified_sales()
RETURNS TABLE(restaurant_id UUID, orders_synced INTEGER)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_connection RECORD;
  v_synced INTEGER;
  v_start_date DATE;
BEGIN
  FOR v_connection IN
    SELECT tc.restaurant_id, tc.last_sync_time
    FROM public.toast_connections tc
    WHERE tc.is_active = true
  LOOP
    BEGIN
      -- Compute start date from last_sync_time with 25-hour buffer
      -- Fall back to 90 days if NULL (new connection, initial sync not done)
      v_start_date := COALESCE(
        (v_connection.last_sync_time - INTERVAL '25 hours')::DATE,
        (CURRENT_DATE - INTERVAL '90 days')::DATE
      );

      -- Use date-range overload (only processes orders in window)
      -- CURRENT_DATE is evaluated in server timezone (UTC on Supabase).
      -- Since UTC is ahead of all US timezones, CURRENT_DATE always
      -- covers the restaurant's local "today."
      SELECT sync_toast_to_unified_sales(
        v_connection.restaurant_id,
        v_start_date,
        CURRENT_DATE
      ) INTO v_synced;

      -- Clear a stale failure, but only when there is one to clear -- this loop
      -- runs every 5 minutes and should not churn updated_at for nothing.
      UPDATE public.toast_connections
         SET connection_status = 'connected', last_error = NULL, last_error_at = NULL
       WHERE toast_connections.restaurant_id = v_connection.restaurant_id
         AND (connection_status IS DISTINCT FROM 'connected' OR last_error IS NOT NULL);

      restaurant_id := v_connection.restaurant_id;
      orders_synced := v_synced;
      RETURN NEXT;
    EXCEPTION
      -- WHEN OTHERS does NOT catch query_canceled (57014); name it explicitly
      -- so a timed-out restaurant is skipped instead of aborting the whole run.
      WHEN query_canceled THEN
        RAISE WARNING 'sync_all_toast_to_unified_sales: timed out for restaurant %: %',
          v_connection.restaurant_id, SQLERRM;
        PERFORM public.record_pos_sync_error('toast', v_connection.restaurant_id, SQLERRM);
      WHEN OTHERS THEN
        RAISE WARNING 'Failed to sync restaurant %: %', v_connection.restaurant_id, SQLERRM;
        PERFORM public.record_pos_sync_error('toast', v_connection.restaurant_id, SQLERRM);
    END;
  END LOOP;

  RETURN;
END;
$$;

-- ---------------------------------------------------------------------------
-- Shift4. Body copied from
-- 20260127100000_shift4_lighthouse_sync_enhancements.sql:49.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION sync_all_shift4_to_unified_sales()
RETURNS TABLE(restaurant_id UUID, rows_synced INTEGER)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_connection RECORD;
  v_synced INTEGER;
BEGIN
  -- Loop through all active Shift4 connections
  FOR v_connection IN
    SELECT sc.restaurant_id
    FROM public.shift4_connections sc
    WHERE sc.is_active = true
  LOOP
    BEGIN
      -- Call the existing sync function for this restaurant
      SELECT public.sync_shift4_to_unified_sales(v_connection.restaurant_id) INTO v_synced;

      UPDATE public.shift4_connections
         SET connection_status = 'connected', last_error = NULL, last_error_at = NULL
       WHERE shift4_connections.restaurant_id = v_connection.restaurant_id
         AND (connection_status IS DISTINCT FROM 'connected' OR last_error IS NOT NULL);

      restaurant_id := v_connection.restaurant_id;
      rows_synced := v_synced;
      RETURN NEXT;
    EXCEPTION
      WHEN query_canceled THEN
        RAISE WARNING 'sync_all_shift4_to_unified_sales: timed out for restaurant %: %',
          v_connection.restaurant_id, SQLERRM;
        PERFORM public.record_pos_sync_error('shift4', v_connection.restaurant_id, SQLERRM);
      WHEN OTHERS THEN
        -- Log error but continue with other restaurants
        RAISE WARNING 'Failed to sync Shift4 restaurant %: %',
          v_connection.restaurant_id, SQLERRM;
        PERFORM public.record_pos_sync_error('shift4', v_connection.restaurant_id, SQLERRM);
    END;
  END LOOP;

  RETURN;
END;
$$;

GRANT EXECUTE ON FUNCTION sync_all_shift4_to_unified_sales() TO service_role;

-- ---------------------------------------------------------------------------
-- Focus (legacy sales rollup). Body copied from
-- 20260705003631_focus_legacy_cron_no_claim_bump.sql:30.
--
-- Note: this wrapper and sync_all_focus_transactions_to_unified_sales below
-- both write focus_connections for the same restaurant, so the status is
-- last-writer-wins between them. Accepted -- either failing is worth surfacing,
-- and the two run on different schedules.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.sync_all_focus_to_unified_sales()
RETURNS TABLE(restaurant_id uuid, rows_synced integer)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
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
      -- NO last_sync_time bump here: that column is the claim scheduler's
      -- due-marker (20260704200320). Bumping it from an aggregation-only job
      -- starves claim_focus_sync_batch — connections never become due.
      UPDATE public.focus_connections
         SET connection_status = 'connected', last_error = NULL, last_error_at = NULL
       WHERE focus_connections.restaurant_id = r.restaurant_id
         AND (connection_status IS DISTINCT FROM 'connected' OR last_error IS NOT NULL);
      RETURN NEXT;
    EXCEPTION
      WHEN query_canceled THEN
        RAISE WARNING 'sync_all_focus_to_unified_sales: timed out for restaurant %: %',
          r.restaurant_id, SQLERRM;
        PERFORM public.record_pos_sync_error('focus', r.restaurant_id, SQLERRM);
      WHEN OTHERS THEN
        RAISE WARNING 'sync_all_focus_to_unified_sales: failed for restaurant %: %',
          r.restaurant_id, SQLERRM;
        PERFORM public.record_pos_sync_error('focus', r.restaurant_id, SQLERRM);
    END;
  END LOOP;
END;
$$;

-- ---------------------------------------------------------------------------
-- Focus (transactions rollup). Body copied from
-- 20260703120000_focus_backfill_reliability.sql:80.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.sync_all_focus_transactions_to_unified_sales()
RETURNS TABLE(restaurant_id uuid, rows_synced integer)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  r record;
  v_full_range boolean;
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

      -- Full-range when the backfill is still running, OR when HISTORICAL rows
      -- (older than the 3-day incremental window) were written recently.
      -- The second condition closes the completion race (Codex P1, PR #567):
      -- the worker's FINAL batch writes ~5 historical days and flips
      -- initial_sync_done=true between two cron ticks — without this, those
      -- days would fall to the 3-day branch and never reach unified_sales.
      -- It also picks up custom-range re-imports of old dates for free.
      v_full_range := (NOT r.initial_sync_done) OR EXISTS (
        SELECT 1
        FROM public.focus_orders fo
        WHERE fo.restaurant_id = r.restaurant_id
          AND fo.updated_at   > now() - interval '15 minutes'
          AND fo.business_date < (CURRENT_DATE - 3)
      );

      IF v_full_range THEN
        -- Aggregate ALL dates stored in focus_orders (NULL bounds ⇒ full range).
        rows_synced := public._sync_focus_transactions_to_unified_sales_impl(
                         r.restaurant_id, NULL, NULL
                       );
      ELSE
        -- Incremental: 3-day lookback window (timezone-safe, matches prior behaviour).
        rows_synced := public._sync_focus_transactions_to_unified_sales_impl(
                         r.restaurant_id,
                         (CURRENT_DATE - interval '3 days')::date,
                         CURRENT_DATE
                       );
      END IF;

      UPDATE public.focus_connections
         SET connection_status = 'connected', last_error = NULL, last_error_at = NULL
       WHERE focus_connections.restaurant_id = r.restaurant_id
         AND (connection_status IS DISTINCT FROM 'connected' OR last_error IS NOT NULL);

      RETURN NEXT;
    EXCEPTION
      WHEN query_canceled THEN
        RAISE WARNING
          'sync_all_focus_transactions_to_unified_sales: timed out for restaurant %: %',
          r.restaurant_id, SQLERRM;
        PERFORM public.record_pos_sync_error('focus', r.restaurant_id, SQLERRM);
      WHEN OTHERS THEN
        RAISE WARNING
          'sync_all_focus_transactions_to_unified_sales: failed for restaurant %: %',
          r.restaurant_id, SQLERRM;
        PERFORM public.record_pos_sync_error('focus', r.restaurant_id, SQLERRM);
    END;
  END LOOP;
END;
$$;

GRANT EXECUTE ON FUNCTION public.sync_all_focus_transactions_to_unified_sales()
  TO service_role;

-- ---------------------------------------------------------------------------
-- Revel: run the categorization sweep the other POS syncs already run.
-- Body copied from 20260721160000_revel_rpc_sold_at_self_heal.sql:177.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.sync_revel_to_unified_sales(
  p_restaurant_id UUID,
  p_start_date DATE DEFAULT NULL,
  p_end_date DATE DEFAULT NULL
)
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_synced_count INTEGER := 0;
  v_rows INTEGER := 0;
BEGIN
  IF auth.uid() IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM public.user_restaurants
    WHERE restaurant_id = p_restaurant_id AND user_id = auth.uid()
  ) THEN
    RAISE EXCEPTION 'Unauthorized: user does not have access to this restaurant';
  END IF;

  -- Suppress per-row aggregation trigger during this multi-row upsert;
  -- batch-aggregate the touched dates once below instead.
  PERFORM set_config('app.skip_unified_sales_triggers', 'true', true);

  -- 1) Sale rows: non-voided line items (total_price includes modifiers)
  INSERT INTO public.unified_sales (
    restaurant_id, pos_system, external_order_id, external_item_id,
    item_name, quantity, unit_price, total_price,
    sale_date, sale_time, sold_at, pos_category, item_type, raw_data, synced_at
  )
  SELECT
    oi.restaurant_id, 'revel', oi.revel_order_id, oi.revel_item_id,
    oi.item_name, oi.quantity, oi.unit_price, oi.total_price,
    o.order_date, o.order_time, o.sold_at, oi.menu_category, 'sale', oi.raw_json, now()
  FROM public.revel_order_items oi
  INNER JOIN public.revel_orders o ON oi.revel_order_id_fk = o.id
  WHERE oi.restaurant_id = p_restaurant_id
    AND oi.is_voided = false
    AND (p_start_date IS NULL OR o.order_date >= p_start_date)
    AND (p_end_date IS NULL OR o.order_date <= p_end_date)
  ON CONFLICT (restaurant_id, pos_system, external_order_id, external_item_id)
    WHERE parent_sale_id IS NULL
  DO UPDATE SET sold_at = COALESCE(EXCLUDED.sold_at, unified_sales.sold_at)
    WHERE unified_sales.sold_at IS DISTINCT FROM COALESCE(EXCLUDED.sold_at, unified_sales.sold_at);
  GET DIAGNOSTICS v_rows = ROW_COUNT; v_synced_count := v_synced_count + v_rows;

  -- 2) Per-order reconciliation to Revel's authoritative header subtotal.
  --    Revel removes/refunds some items from the subtotal without an item-level flag;
  --    this labeled line makes each order's sale total match the POS exactly.
  INSERT INTO public.unified_sales (
    restaurant_id, pos_system, external_order_id, external_item_id, item_name,
    quantity, unit_price, total_price, sale_date, sale_time, sold_at, item_type, synced_at)
  SELECT g.restaurant_id, 'revel', g.revel_order_id, g.revel_order_id || ':reconcile', 'POS sales adjustment',
         1, g.adj, g.adj, g.order_date, g.order_time, g.sold_at, 'sale', now()
  FROM (
    SELECT o.restaurant_id, o.revel_order_id, o.order_date, o.order_time, o.sold_at,
           round(COALESCE(o.subtotal_amount,0) - COALESCE(sum(oi.total_price) FILTER (WHERE oi.is_voided = false), 0), 2) AS adj
    FROM public.revel_orders o
    LEFT JOIN public.revel_order_items oi ON oi.revel_order_id_fk = o.id
    WHERE o.restaurant_id = p_restaurant_id
      AND (p_start_date IS NULL OR o.order_date >= p_start_date)
      AND (p_end_date IS NULL OR o.order_date <= p_end_date)
    GROUP BY o.restaurant_id, o.revel_order_id, o.order_date, o.order_time, o.sold_at, o.subtotal_amount
  ) g
  WHERE g.adj <> 0
  ON CONFLICT (restaurant_id, pos_system, external_order_id, external_item_id)
    WHERE parent_sale_id IS NULL
  DO UPDATE SET sold_at = COALESCE(EXCLUDED.sold_at, unified_sales.sold_at)
    WHERE unified_sales.sold_at IS DISTINCT FROM COALESCE(EXCLUDED.sold_at, unified_sales.sold_at);
  GET DIAGNOSTICS v_rows = ROW_COUNT; v_synced_count := v_synced_count + v_rows;

  -- 3) Tax (header)
  INSERT INTO public.unified_sales (
    restaurant_id, pos_system, external_order_id, external_item_id, item_name,
    quantity, unit_price, total_price, sale_date, sale_time, sold_at, item_type, adjustment_type, synced_at)
  SELECT o.restaurant_id, 'revel', o.revel_order_id, o.revel_order_id || ':tax', 'Tax',
         1, o.tax_amount, o.tax_amount, o.order_date, o.order_time, o.sold_at, 'tax', 'tax', now()
  FROM public.revel_orders o
  WHERE o.restaurant_id = p_restaurant_id AND COALESCE(o.tax_amount, 0) <> 0
    AND (p_start_date IS NULL OR o.order_date >= p_start_date)
    AND (p_end_date IS NULL OR o.order_date <= p_end_date)
  ON CONFLICT (restaurant_id, pos_system, external_order_id, external_item_id)
    WHERE parent_sale_id IS NULL
  DO UPDATE SET sold_at = COALESCE(EXCLUDED.sold_at, unified_sales.sold_at)
    WHERE unified_sales.sold_at IS DISTINCT FROM COALESCE(EXCLUDED.sold_at, unified_sales.sold_at);
  GET DIAGNOSTICS v_rows = ROW_COUNT; v_synced_count := v_synced_count + v_rows;

  -- 3) Tip / gratuity (header; on top of final_total)
  INSERT INTO public.unified_sales (
    restaurant_id, pos_system, external_order_id, external_item_id, item_name,
    quantity, unit_price, total_price, sale_date, sale_time, sold_at, item_type, adjustment_type, synced_at)
  SELECT o.restaurant_id, 'revel', o.revel_order_id, o.revel_order_id || ':tip', 'Tip',
         1, o.tip_amount, o.tip_amount, o.order_date, o.order_time, o.sold_at, 'tip', 'tip', now()
  FROM public.revel_orders o
  WHERE o.restaurant_id = p_restaurant_id AND COALESCE(o.tip_amount, 0) <> 0
    AND (p_start_date IS NULL OR o.order_date >= p_start_date)
    AND (p_end_date IS NULL OR o.order_date <= p_end_date)
  ON CONFLICT (restaurant_id, pos_system, external_order_id, external_item_id)
    WHERE parent_sale_id IS NULL
  DO UPDATE SET sold_at = COALESCE(EXCLUDED.sold_at, unified_sales.sold_at)
    WHERE unified_sales.sold_at IS DISTINCT FROM COALESCE(EXCLUDED.sold_at, unified_sales.sold_at);
  GET DIAGNOSTICS v_rows = ROW_COUNT; v_synced_count := v_synced_count + v_rows;

  -- 4) Discount (header; stored negative)
  INSERT INTO public.unified_sales (
    restaurant_id, pos_system, external_order_id, external_item_id, item_name,
    quantity, unit_price, total_price, sale_date, sale_time, sold_at, item_type, adjustment_type, synced_at)
  SELECT o.restaurant_id, 'revel', o.revel_order_id, o.revel_order_id || ':discount', 'Discount',
         1, -abs(o.discount_amount), -abs(o.discount_amount), o.order_date, o.order_time, o.sold_at, 'discount', 'discount', now()
  FROM public.revel_orders o
  WHERE o.restaurant_id = p_restaurant_id AND COALESCE(o.discount_amount, 0) <> 0
    AND (p_start_date IS NULL OR o.order_date >= p_start_date)
    AND (p_end_date IS NULL OR o.order_date <= p_end_date)
  ON CONFLICT (restaurant_id, pos_system, external_order_id, external_item_id)
    WHERE parent_sale_id IS NULL
  DO UPDATE SET sold_at = COALESCE(EXCLUDED.sold_at, unified_sales.sold_at)
    WHERE unified_sales.sold_at IS DISTINCT FROM COALESCE(EXCLUDED.sold_at, unified_sales.sold_at);
  GET DIAGNOSTICS v_rows = ROW_COUNT; v_synced_count := v_synced_count + v_rows;

  -- 5) Service charge (header)
  INSERT INTO public.unified_sales (
    restaurant_id, pos_system, external_order_id, external_item_id, item_name,
    quantity, unit_price, total_price, sale_date, sale_time, sold_at, item_type, adjustment_type, synced_at)
  SELECT o.restaurant_id, 'revel', o.revel_order_id, o.revel_order_id || ':service_charge', 'Service Charge',
         1, o.service_charge_amount, o.service_charge_amount, o.order_date, o.order_time, o.sold_at, 'service_charge', 'service_charge', now()
  FROM public.revel_orders o
  WHERE o.restaurant_id = p_restaurant_id AND COALESCE(o.service_charge_amount, 0) <> 0
    AND (p_start_date IS NULL OR o.order_date >= p_start_date)
    AND (p_end_date IS NULL OR o.order_date <= p_end_date)
  ON CONFLICT (restaurant_id, pos_system, external_order_id, external_item_id)
    WHERE parent_sale_id IS NULL
  DO UPDATE SET sold_at = COALESCE(EXCLUDED.sold_at, unified_sales.sold_at)
    WHERE unified_sales.sold_at IS DISTINCT FROM COALESCE(EXCLUDED.sold_at, unified_sales.sold_at);
  GET DIAGNOSTICS v_rows = ROW_COUNT; v_synced_count := v_synced_count + v_rows;

  -- 6/7/8) Informational adjustment lines (Voided / Returned / Refunds). These mirror Revel's
  -- Sales Summary "Adjustments" section. They use item_type 'other'/'refund' (NOT 'sale'), so
  -- they never enter Net Sales — which stays exact — but are available for the audit/report.
  -- Split rule: a voided item whose order was refunded (has a negative payment) = "Returned";
  -- otherwise = "Voided". Refunds = payments with a negative amount.

  -- 6) Voided items (voided, order NOT refunded)
  INSERT INTO public.unified_sales (
    restaurant_id, pos_system, external_order_id, external_item_id, item_name,
    quantity, unit_price, total_price, sale_date, sale_time, sold_at, pos_category, item_type, raw_data, synced_at)
  SELECT oi.restaurant_id, 'revel', oi.revel_order_id, oi.revel_item_id || ':void', 'Voided item - ' || oi.item_name,
         oi.quantity, -oi.unit_price, -oi.total_price, o.order_date, o.order_time, o.sold_at, oi.menu_category, 'other', oi.raw_json, now()
  FROM public.revel_order_items oi
  JOIN public.revel_orders o ON oi.revel_order_id_fk = o.id
  WHERE oi.restaurant_id = p_restaurant_id AND oi.is_voided = true
    AND NOT EXISTS (SELECT 1 FROM public.revel_payments p
                    WHERE p.restaurant_id = oi.restaurant_id AND p.revel_order_id = oi.revel_order_id
                      AND (p.raw_json->>'amount')::numeric < 0)
    AND (p_start_date IS NULL OR o.order_date >= p_start_date)
    AND (p_end_date IS NULL OR o.order_date <= p_end_date)
  ON CONFLICT (restaurant_id, pos_system, external_order_id, external_item_id)
    WHERE parent_sale_id IS NULL
  DO UPDATE SET sold_at = COALESCE(EXCLUDED.sold_at, unified_sales.sold_at)
    WHERE unified_sales.sold_at IS DISTINCT FROM COALESCE(EXCLUDED.sold_at, unified_sales.sold_at);
  GET DIAGNOSTICS v_rows = ROW_COUNT; v_synced_count := v_synced_count + v_rows;

  -- 7) Returned items (voided, order WAS refunded)
  INSERT INTO public.unified_sales (
    restaurant_id, pos_system, external_order_id, external_item_id, item_name,
    quantity, unit_price, total_price, sale_date, sale_time, sold_at, pos_category, item_type, raw_data, synced_at)
  SELECT oi.restaurant_id, 'revel', oi.revel_order_id, oi.revel_item_id || ':return', 'Returned item - ' || oi.item_name,
         oi.quantity, -oi.unit_price, -oi.total_price, o.order_date, o.order_time, o.sold_at, oi.menu_category, 'other', oi.raw_json, now()
  FROM public.revel_order_items oi
  JOIN public.revel_orders o ON oi.revel_order_id_fk = o.id
  WHERE oi.restaurant_id = p_restaurant_id AND oi.is_voided = true
    AND EXISTS (SELECT 1 FROM public.revel_payments p
                WHERE p.restaurant_id = oi.restaurant_id AND p.revel_order_id = oi.revel_order_id
                  AND (p.raw_json->>'amount')::numeric < 0)
    AND (p_start_date IS NULL OR o.order_date >= p_start_date)
    AND (p_end_date IS NULL OR o.order_date <= p_end_date)
  ON CONFLICT (restaurant_id, pos_system, external_order_id, external_item_id)
    WHERE parent_sale_id IS NULL
  DO UPDATE SET sold_at = COALESCE(EXCLUDED.sold_at, unified_sales.sold_at)
    WHERE unified_sales.sold_at IS DISTINCT FROM COALESCE(EXCLUDED.sold_at, unified_sales.sold_at);
  GET DIAGNOSTICS v_rows = ROW_COUNT; v_synced_count := v_synced_count + v_rows;

  -- 8) Refunds (payments with a negative amount)
  INSERT INTO public.unified_sales (
    restaurant_id, pos_system, external_order_id, external_item_id, item_name,
    quantity, unit_price, total_price, sale_date, sale_time, sold_at, item_type, raw_data, synced_at)
  SELECT p.restaurant_id, 'revel', p.revel_order_id, p.revel_payment_id || ':refund', 'Refund',
         1, (p.raw_json->>'amount')::numeric, (p.raw_json->>'amount')::numeric, o.order_date, o.order_time, o.sold_at, 'refund', p.raw_json, now()
  FROM public.revel_payments p
  JOIN public.revel_orders o ON p.revel_order_id = o.revel_order_id AND p.restaurant_id = o.restaurant_id
  WHERE p.restaurant_id = p_restaurant_id AND (p.raw_json->>'amount')::numeric < 0
    AND (p_start_date IS NULL OR o.order_date >= p_start_date)
    AND (p_end_date IS NULL OR o.order_date <= p_end_date)
  ON CONFLICT (restaurant_id, pos_system, external_order_id, external_item_id)
    WHERE parent_sale_id IS NULL
  DO UPDATE SET sold_at = COALESCE(EXCLUDED.sold_at, unified_sales.sold_at)
    WHERE unified_sales.sold_at IS DISTINCT FROM COALESCE(EXCLUDED.sold_at, unified_sales.sold_at);
  GET DIAGNOSTICS v_rows = ROW_COUNT; v_synced_count := v_synced_count + v_rows;

  -- Re-enable the trigger, then batch-aggregate only the dates touched by
  -- this sync window (both callers — revel-sync-data, revel-bulk-sync —
  -- always pass a bounded p_start_date/p_end_date) once each, instead of
  -- once per unified_sales row upserted above. Skip entirely when nothing
  -- changed (the no-op guards wrote 0 rows) so a recurring sync over an
  -- overlapping window doesn't re-aggregate the whole window for no reason.
  PERFORM set_config('app.skip_unified_sales_triggers', 'false', true);

  -- Revel suppressed auto_categorize_pos_sale for the upsert above but, unlike
  -- Toast and Focus, never ran the batch sweep afterwards -- so Revel rows were
  -- inserted uncategorized and stayed that way. Same call, same batch size, same
  -- position in the sequence as the other POS syncs.
  PERFORM public.apply_rules_to_pos_sales_internal(p_restaurant_id, 10000);

  IF v_synced_count > 0 THEN
    PERFORM public.aggregate_unified_sales_to_daily(p_restaurant_id, d.sale_date)
    FROM (
      SELECT DISTINCT sale_date FROM public.unified_sales
      WHERE restaurant_id = p_restaurant_id AND pos_system = 'revel'
        AND (p_start_date IS NULL OR sale_date >= p_start_date)
        AND (p_end_date IS NULL OR sale_date <= p_end_date)
    ) d;
  END IF;

  RETURN v_synced_count;
END;
$$;
