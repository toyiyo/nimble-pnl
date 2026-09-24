-- Shift Protection: auto-expire open trades whose shift already started.
--
-- Only restaurants with staffing_settings.trade_auto_expire = true opt
-- in. An expired trade moves to 'cancelled' (allowed by the status CHECK,
-- 20260104120000_create_shift_trades.sql) with reviewed_at = now() and
-- manager_note = 'auto_expired'. The marker matters: the poster activity
-- query excludes plain self-cancels but includes this combination and
-- shows it as an "Expired" outcome (src/hooks/useShiftTrades.ts), so the
-- poster learns the shift is still theirs. Self-cancels never set
-- manager_note, so the deliberate exclusion of plain cancels holds.
--
-- pending_approval trades stay: approve_shift_trade carries the
-- shift_started finding for them (20260903034800).
--
-- Design: docs/superpowers/specs/2026-09-03-shift-protection-design.md

CREATE OR REPLACE FUNCTION expire_stale_shift_trades()
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_expired INTEGER;
BEGIN
  UPDATE shift_trades t
  SET status = 'cancelled',
      reviewed_at = now(),
      manager_note = 'auto_expired',
      updated_at = now()
  FROM shifts s, staffing_settings ss
  WHERE t.status = 'open'
    AND s.id = t.offered_shift_id
    AND s.start_time <= now()
    AND ss.restaurant_id = t.restaurant_id
    AND ss.trade_auto_expire = true;

  GET DIAGNOSTICS v_expired = ROW_COUNT;
  RETURN v_expired;
END;
$$;

-- Cron-only: no client calls this.
REVOKE ALL ON FUNCTION public.expire_stale_shift_trades() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.expire_stale_shift_trades() TO service_role;

COMMENT ON FUNCTION expire_stale_shift_trades() IS
  'Shift Protection: cancel open trades whose shift started, for opted-in restaurants (cron)';

-- Schedule. Unschedule-then-schedule converges from any prior state
-- (pattern: 20260804091000_standing_categorization_sweep.sql).
CREATE EXTENSION IF NOT EXISTS pg_cron;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'shift-protection-trade-expiry') THEN
    PERFORM cron.unschedule('shift-protection-trade-expiry');
  END IF;
  PERFORM cron.schedule(
    'shift-protection-trade-expiry',
    '*/30 * * * *',
    'SELECT public.expire_stale_shift_trades()'
  );
END $$;
