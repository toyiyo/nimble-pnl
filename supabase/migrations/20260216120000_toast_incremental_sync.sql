-- Toast Incremental Sync
--
-- Switches the 5-minute cron from full-table re-sync to incremental
-- date-range sync based on each connection's last_sync_time.
-- Adds missing toast_payments index for date-range queries.
--
-- Depends on: 20260215200000_fix_toast_sync_timeout.sql (GUC bypass, date-range overload)

-- ============================================================
-- Part 1: Add missing index on toast_payments
-- ============================================================
-- The date-range overload filters by payment_date. Without this index,
-- every sync does a sequential scan on the payments table.
CREATE INDEX IF NOT EXISTS idx_toast_payments_restaurant_date
  ON public.toast_payments (restaurant_id, payment_date);

-- ============================================================
-- Part 2: Redefine sync_all to use date-range overload
-- ============================================================
-- Previously called the single-arg overload (re-processes ALL orders).
-- Now reads last_sync_time from toast_connections and calls the
-- date-range overload with a 25-hour buffer.
--
-- Why 25 hours? Toast data can be corrected within 24 hours.
-- The 1-hour buffer prevents boundary misses at midnight.
--
-- NULL last_sync_time falls back to 90 days (initial sync window).
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

      restaurant_id := v_connection.restaurant_id;
      orders_synced := v_synced;
      RETURN NEXT;
    EXCEPTION WHEN OTHERS THEN
      RAISE WARNING 'Failed to sync restaurant %: %', v_connection.restaurant_id, SQLERRM;
    END;
  END LOOP;

  RETURN;
END;
$$;

COMMENT ON FUNCTION sync_all_toast_to_unified_sales IS
  'Incrementally syncs Toast orders to unified_sales for all active connections. '
  'Uses each connection''s last_sync_time with 25-hour buffer. '
  'Falls back to 90-day window for connections without last_sync_time. '
  'Runs every 5 minutes via cron. '
  'For full re-sync, call sync_toast_to_unified_sales(restaurant_id) directly.';
