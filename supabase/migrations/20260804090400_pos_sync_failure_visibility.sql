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
  -- Error bookkeeping must never mask the original failure or stop the loop.
  NULL;
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
