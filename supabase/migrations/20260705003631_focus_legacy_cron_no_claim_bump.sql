-- ═════════════════════════════════════════════════════════════════════════════
-- Fix: legacy daily-report cron starves the new claim scheduler (PR #579).
--
-- sync_all_focus_to_unified_sales() — the every-5-min focus-unified-sales-sync
-- job serving the legacy SSRS daily-report path — contained
--
--     -- Fix 2: advance last_sync_time so the round-robin ORDER BY progresses
--     UPDATE public.focus_connections SET last_sync_time = now() ...
--
-- That was correct when last_sync_time was only this job's rotation cursor.
-- Since 20260704200320_focus_sync_frequency.sql, last_sync_time is the claim
-- scheduler's due-marker (`_focus_connection_is_due`: due when last_sync_time
-- ≤ now() − sync_interval_minutes). A bump every 5 minutes means no connection
-- is EVER due — incremental Focus ingestion stops entirely (observed in prod
-- immediately after the #579 deploy).
--
-- This migration re-creates the function WITHOUT the bump, transcribed from
-- the live prod definition (pg_get_functiondef, 2026-07-05). Rotation note:
-- without a bump this job re-selects the same oldest-5 connections each tick.
-- Lynk connections still rotate (the claim scheduler and manual syncs advance
-- last_sync_time); a hypothetical fleet of >5 pure-SSRS connections would
-- re-aggregate the oldest five every tick — idempotent, bounded (2-day
-- window), and acceptable for a dormant path.
--
-- Also (re)schedules the focus-unified-sales-sync job idempotently: the
-- immediate prod mitigation was `SELECT cron.unschedule('focus-unified-sales-sync')`,
-- so this migration must converge both from the mitigated and unmitigated state.
-- ═════════════════════════════════════════════════════════════════════════════

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
      RETURN NEXT;
    EXCEPTION WHEN OTHERS THEN
      RAISE WARNING 'sync_all_focus_to_unified_sales: failed for restaurant %: %',
        r.restaurant_id, SQLERRM;
    END;
  END LOOP;
END;
$$;

-- Idempotent (re)schedule — converges whether or not the manual mitigation
-- (cron.unschedule) ran first.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'focus-unified-sales-sync') THEN
    PERFORM cron.unschedule('focus-unified-sales-sync');
  END IF;
END $$;

SELECT cron.schedule(
  'focus-unified-sales-sync',
  '*/5 * * * *',
  $$SELECT public.sync_all_focus_to_unified_sales()$$
);
