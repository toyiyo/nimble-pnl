-- Shift trade reminders (design:
-- docs/superpowers/specs/2026-09-25-shift-trade-reminders-design.md, Part B).
--
-- This migration adds:
--   1. The send ledger public.shift_trade_reminders.
--   2. The time zone helper public.safe_restaurant_tz.
--   7. The two new notification types in the CHECK constraint.
--
-- Each function sets search_path, revokes EXECUTE from PUBLIC, anon and
-- authenticated, and grants EXECUTE to service_role only.

-- ============================================================
-- 1. Send ledger. One row for each (trade, stage) that the worker claims.
--    The worker writes the row BEFORE it sends (claim first). A crash after
--    the claim loses one reminder. A crash never sends a stage two times.
-- ============================================================
CREATE TABLE IF NOT EXISTS public.shift_trade_reminders (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  restaurant_id uuid NOT NULL REFERENCES public.restaurants(id) ON DELETE CASCADE,
  shift_trade_id uuid NOT NULL REFERENCES public.shift_trades(id) ON DELETE CASCADE,
  stage text NOT NULL CHECK (stage IN ('72h', '24h', '6h', 'unclaimed')),
  sent_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT shift_trade_reminders_once UNIQUE (shift_trade_id, stage)
);

COMMENT ON TABLE public.shift_trade_reminders IS
  'Claim ledger for the shift-trade-reminders worker. One row per (trade, '
  'stage). The worker inserts the row before it sends, so a stage sends at '
  'most one time.';

CREATE INDEX IF NOT EXISTS shift_trade_reminders_restaurant_idx
  ON public.shift_trade_reminders (restaurant_id);

-- RLS is on and no policy exists. Only service_role (BYPASSRLS) uses the table.
ALTER TABLE public.shift_trade_reminders ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON public.shift_trade_reminders FROM anon, authenticated;
GRANT ALL ON public.shift_trade_reminders TO service_role;

-- ============================================================
-- 2. Time zone helper. One bad restaurants.timezone value must not stop the
--    candidate query for all tenants. The zone table can change, so the
--    function is STABLE, not IMMUTABLE.
-- ============================================================
CREATE OR REPLACE FUNCTION public.safe_restaurant_tz(p_tz text)
RETURNS text
LANGUAGE plpgsql
STABLE
SET search_path = public, pg_temp
AS $$
DECLARE
  v_tz text := COALESCE(NULLIF(p_tz, ''), 'America/Chicago');
BEGIN
  PERFORM now() AT TIME ZONE v_tz;
  RETURN v_tz;
EXCEPTION WHEN invalid_parameter_value THEN
  RETURN 'America/Chicago';
END;
$$;

COMMENT ON FUNCTION public.safe_restaurant_tz(text) IS
  'Returns the zone, or America/Chicago when the zone is NULL, empty or not valid.';

REVOKE EXECUTE ON FUNCTION public.safe_restaurant_tz(text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.safe_restaurant_tz(text) TO service_role;

-- ============================================================
-- 7. Notification types: add shift_trade_reminder and shift_trade_unclaimed.
--    Keep this list the same as src/lib/notificationTypes.ts and
--    supabase/functions/_shared/resolveChannels.ts. A CHECK constraint
--    cannot change in place, so drop it and add it again.
-- ============================================================
ALTER TABLE public.notification_channel_settings
  DROP CONSTRAINT IF EXISTS notification_channel_settings_type_check;

ALTER TABLE public.notification_channel_settings
  ADD CONSTRAINT notification_channel_settings_type_check
    CHECK (notification_type IN (
      'schedule_published',
      'shift_created',
      'shift_modified',
      'shift_deleted',
      'open_shifts_broadcast',
      'shift_trade_created',
      'shift_trade_accepted',
      'shift_trade_approved',
      'shift_trade_rejected',
      'shift_trade_cancelled',
      'time_off_requested',
      'time_off_approved',
      'time_off_rejected',
      'pin_reset',
      'availability_reminder',
      'open_shift_claim_reviewed',
      'bank_reauth_required',
      'shift_trade_reminder',
      'shift_trade_unclaimed'
    ));

COMMENT ON COLUMN public.notification_channel_settings.notification_type IS
  'One of the 19 catalog keys in src/lib/notificationTypes.ts. Keep it the '
  'same as the CHECK constraint above. (team_invite is not in the list: a '
  'transactional invite email always sends.)';
