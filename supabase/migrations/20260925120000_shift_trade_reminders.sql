-- Shift trade reminders (design:
-- docs/superpowers/specs/2026-09-25-shift-trade-reminders-design.md, Part B).
--
-- This migration adds:
--   1. The send ledger public.shift_trade_reminders.
--   2. The time zone helper public.safe_restaurant_tz.
--   7. The two new notification types in the CHECK constraint.
--   3. The candidates RPC get_shift_trade_reminder_candidates.
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

-- ============================================================
-- 3. Candidates. One row for each (trade, stage) that is due at p_now.
--    All rules in design B1 apply here:
--    - Employee stages: 72h (24 < h <= 72), 24h (6 < h <= 24),
--      6h (0 < h <= 6). Skip a stage when the trade was created after
--      start - <stage hours>. Skip employee stages in block mode when
--      h <= trade_deadline_hours. Need push_enabled for
--      shift_trade_reminder.
--    - unclaimed: 0 < h <= E and the trade is at least 1 hour old.
--      E = 24, or GREATEST(24, trade_deadline_hours + 12) in block mode.
--      Needs push_enabled or email_enabled for shift_trade_unclaimed.
--    - Quiet hours: nothing is due from 22:00 to 08:00 restaurant time.
--    - Only open trades on scheduled or confirmed shifts.
--    - A missing settings row means the defaults (mode off, 24 h, channels on).
--    - A (trade, stage) that has a shift_trade_reminders row is not due.
--    The caller is service_role (BYPASSRLS), so SECURITY INVOKER is enough.
-- ============================================================
CREATE OR REPLACE FUNCTION public.get_shift_trade_reminder_candidates(
  p_now timestamptz,
  p_limit integer
)
RETURNS TABLE (
  shift_trade_id uuid,
  restaurant_id uuid,
  stage text,
  start_time timestamptz,
  end_time timestamptz,
  "position" text,
  is_published boolean,
  offered_by_employee_id uuid,
  offered_by_name text,
  offered_by_user_id uuid,
  target_employee_id uuid,
  restaurant_name text,
  restaurant_timezone text
)
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = public, pg_temp
AS $$
  WITH open_trades AS (
    SELECT
      t.id AS trade_id,
      t.restaurant_id AS rid,
      s.start_time AS s_start,
      s.end_time AS s_end,
      s."position" AS s_position,
      s.is_published AS s_published,
      t.offered_by_employee_id AS poster_id,
      e.name AS poster_name,
      e.user_id AS poster_user_id,
      t.target_employee_id AS target_id,
      r.name AS r_name,
      public.safe_restaurant_tz(r.timezone) AS tz,
      COALESCE(t.created_at, '-infinity'::timestamptz) AS created,
      COALESCE(ss.trade_deadline_mode, 'off') AS deadline_mode,
      COALESCE(ss.trade_deadline_hours, 24) AS deadline_hours,
      COALESCE(ncr.push_enabled, true) AS reminder_on,
      (COALESCE(ncu.push_enabled, true) OR COALESCE(ncu.email_enabled, true)) AS unclaimed_on
    FROM public.shift_trades t
    JOIN public.shifts s
      ON s.id = t.offered_shift_id
     AND s.restaurant_id = t.restaurant_id
    JOIN public.employees e ON e.id = t.offered_by_employee_id
    JOIN public.restaurants r ON r.id = t.restaurant_id
    LEFT JOIN public.staffing_settings ss ON ss.restaurant_id = t.restaurant_id
    LEFT JOIN public.notification_channel_settings ncr
      ON ncr.restaurant_id = t.restaurant_id
     AND ncr.notification_type = 'shift_trade_reminder'
    LEFT JOIN public.notification_channel_settings ncu
      ON ncu.restaurant_id = t.restaurant_id
     AND ncu.notification_type = 'shift_trade_unclaimed'
    WHERE t.status = 'open'
      AND s.status IN ('scheduled', 'confirmed')
      AND s.start_time > p_now
      -- The widest window: 72 h, or E when E is larger.
      AND s.start_time <= p_now + make_interval(
            hours => GREATEST(72, COALESCE(ss.trade_deadline_hours, 24) + 12))
  ),
  awake AS (
    SELECT o.*
    FROM open_trades o
    WHERE EXTRACT(HOUR FROM p_now AT TIME ZONE o.tz) BETWEEN 8 AND 21
  ),
  due AS (
    SELECT a.*, st.stage_name
    FROM awake a
    CROSS JOIN (VALUES ('72h', 72, 24), ('24h', 24, 6), ('6h', 6, 0))
      AS st(stage_name, hi, lo)
    WHERE a.reminder_on
      AND a.s_start > p_now + make_interval(hours => st.lo)
      AND a.s_start <= p_now + make_interval(hours => st.hi)
      -- Skip rule: the created notification covers this window.
      AND a.created <= a.s_start - make_interval(hours => st.hi)
      -- Block mode: employees cannot accept inside the deadline.
      AND NOT (a.deadline_mode = 'block'
               AND a.s_start <= p_now + make_interval(hours => a.deadline_hours))
    UNION ALL
    SELECT a.*, 'unclaimed'
    FROM awake a
    WHERE a.unclaimed_on
      AND a.s_start <= p_now + make_interval(hours =>
            CASE WHEN a.deadline_mode = 'block'
                 THEN GREATEST(24, a.deadline_hours + 12)
                 ELSE 24
            END)
      AND a.created <= p_now - interval '1 hour'
  )
  SELECT
    d.trade_id,
    d.rid,
    d.stage_name,
    d.s_start,
    d.s_end,
    d.s_position,
    d.s_published,
    d.poster_id,
    d.poster_name,
    d.poster_user_id,
    d.target_id,
    d.r_name,
    d.tz
  FROM due d
  WHERE NOT EXISTS (
    SELECT 1
    FROM public.shift_trade_reminders x
    WHERE x.shift_trade_id = d.trade_id
      AND x.stage = d.stage_name
  )
  ORDER BY d.s_start ASC, d.trade_id, d.stage_name
  LIMIT p_limit;
$$;

COMMENT ON FUNCTION public.get_shift_trade_reminder_candidates(timestamptz, integer) IS
  'Due (trade, stage) reminder rows at p_now for the shift-trade-reminders worker.';

REVOKE EXECUTE ON FUNCTION public.get_shift_trade_reminder_candidates(timestamptz, integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_shift_trade_reminder_candidates(timestamptz, integer) TO service_role;
