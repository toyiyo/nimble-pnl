-- Skip the Toast rollup when the source did not move.
--
-- The 5-minute cron re-upserted a 25-hour unified_sales window per active
-- restaurant on every tick (~1.0 s per tick, cron.job_run_details jobid 4,
-- 2026-08-05..14). New Toast source rows arrive at most every 2 hours
-- (toast-bulk-sync) or on a manual sync. So ~23 of 24 ticks rewrote
-- identical rows. This wrapper now skips a restaurant when the newest
-- source marker did not move since the last successful rollup.
--
-- Body copied from 20260804090400_pos_sync_failure_visibility.sql:72 (the
-- latest definition; verified against production pg_get_functiondef on
-- 2026-08-14).
--
-- Design: docs/superpowers/specs/2026-08-14-toast-rollup-watermark-design.md
CREATE OR REPLACE FUNCTION sync_all_toast_to_unified_sales()
RETURNS TABLE(restaurant_id UUID, orders_synced INTEGER)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_connection RECORD;
  v_synced INTEGER;
  v_start_date DATE;
  v_source_max TIMESTAMPTZ;
BEGIN
  FOR v_connection IN
    SELECT tc.restaurant_id, tc.last_sync_time, tc.rollup_source_watermark
    FROM public.toast_connections tc
    WHERE tc.is_active = true
  LOOP
    BEGIN
      -- Newest source marker for this restaurant. GREATEST ignores NULL
      -- arguments and returns NULL only when every input is NULL.
      -- last_sync_time is the fourth input: a completed edge sync that
      -- wrote zero rows still triggers exactly one rollup, which bounds
      -- edge-clock skew on synced_at to one 2-hour edge cycle.
      v_source_max := GREATEST(
        (SELECT max(o.synced_at) FROM public.toast_orders o
          WHERE o.restaurant_id = v_connection.restaurant_id),
        (SELECT max(i.synced_at) FROM public.toast_order_items i
          WHERE i.restaurant_id = v_connection.restaurant_id),
        (SELECT max(p.synced_at) FROM public.toast_payments p
          WHERE p.restaurant_id = v_connection.restaurant_id),
        v_connection.last_sync_time
      );

      -- Skip when nothing moved since the last successful rollup.
      -- v_source_max is captured BEFORE the sync; the success path stores
      -- this captured value, never a fresh max. A row written during the
      -- sync carries a later marker, so the next tick picks it up.
      IF v_source_max IS NOT DISTINCT FROM v_connection.rollup_source_watermark THEN
        CONTINUE;
      END IF;

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

      -- One merged write per successful sync: advance the watermark and
      -- clear a stale failure. The old separate clear-UPDATE carried a
      -- WHERE guard against 5-minute churn; the skip above removes that
      -- churn at the loop level, so the guard is gone with it.
      UPDATE public.toast_connections tc2
         SET rollup_source_watermark = v_source_max,
             connection_status = 'connected',
             last_error = NULL,
             last_error_at = NULL
       WHERE tc2.restaurant_id = v_connection.restaurant_id;

      restaurant_id := v_connection.restaurant_id;
      orders_synced := v_synced;
      RETURN NEXT;
    EXCEPTION
      -- WHEN OTHERS does NOT catch query_canceled (57014); name it explicitly
      -- so a timed-out restaurant is skipped instead of aborting the whole run.
      -- Both arms leave rollup_source_watermark unchanged: the next tick
      -- sees the same moved marker and retries.
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

COMMENT ON FUNCTION sync_all_toast_to_unified_sales() IS
  'Runs the date-range Toast rollup for every active connection. Skips a '
  'restaurant when GREATEST(max(synced_at) over the three Toast source '
  'tables, last_sync_time) did not move past rollup_source_watermark. '
  'Advances the watermark only after a successful sync.';

-- CREATE OR REPLACE keeps the current ACL, but a replay against a fresh
-- database creates the function with the default public-schema EXECUTE
-- grants. Restate the grants (pattern:
-- 20260804091000_standing_categorization_sweep.sql:201).
REVOKE EXECUTE ON FUNCTION sync_all_toast_to_unified_sales()
  FROM PUBLIC, anon, authenticated;
GRANT  EXECUTE ON FUNCTION sync_all_toast_to_unified_sales() TO service_role;
