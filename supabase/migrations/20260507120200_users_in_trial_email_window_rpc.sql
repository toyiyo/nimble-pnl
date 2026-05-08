-- Candidate query for trial-expiry email sends.
--
-- Returns one row per (restaurant_id, owner user_id, email_type) that is due
-- for sending right now. Encapsulates every filter so the edge function loop
-- can stay dumb:
--   * status = 'trialing' (skips paid, canceled, grandfathered)
--   * trial_day in (7, 11, 13, 15) computed in UTC
--   * activated = TRUE iff a row exists in any POS connection table for
--     this restaurant (square / toast / clover / shift4)
--   * internal-team email exclusion (@easyshifthq.com, @camiluke.com)
--   * dedupe via NOT EXISTS in trial_emails_sent
--   * unsubscribe via NOT EXISTS in email_unsubscribes (list = trial_lifecycle or all)
--
-- TZ-safe: cron fires at 09:00 UTC daily; day arithmetic is UTC-anchored
-- end-to-end so the same restaurant lands on the same day-N row regardless
-- of host TZ. (See lessons.md 2026-05-03 for why this matters.)

CREATE OR REPLACE FUNCTION public.users_in_trial_email_window()
RETURNS TABLE (
  restaurant_id UUID,
  user_id UUID,
  email TEXT,
  full_name TEXT,
  trial_day INTEGER,
  activated BOOLEAN,
  email_type TEXT
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  RETURN QUERY
  WITH day_map(d, t) AS (
    VALUES
      (7,  'halfway'),
      (11, '3_days'),
      (13, 'tomorrow'),
      (15, 'expired')
  ),
  candidates AS (
    SELECT
      r.id AS restaurant_id,
      ur.user_id,
      u.email::TEXT AS email,
      COALESCE(p.full_name, u.raw_user_meta_data->>'full_name', '')::TEXT AS full_name,
      ((NOW() AT TIME ZONE 'UTC')::DATE - (r.created_at AT TIME ZONE 'UTC')::DATE)::INTEGER AS trial_day,
      (
        EXISTS (SELECT 1 FROM public.square_connections sc WHERE sc.restaurant_id = r.id)
        OR EXISTS (SELECT 1 FROM public.toast_connections tc WHERE tc.restaurant_id = r.id)
        OR EXISTS (SELECT 1 FROM public.clover_connections cc WHERE cc.restaurant_id = r.id)
        OR EXISTS (SELECT 1 FROM public.shift4_connections s4 WHERE s4.restaurant_id = r.id)
      ) AS activated
    FROM public.restaurants r
    JOIN public.user_restaurants ur
      ON ur.restaurant_id = r.id AND ur.role = 'owner'
    JOIN auth.users u
      ON u.id = ur.user_id
    LEFT JOIN public.profiles p
      ON p.user_id = u.id
    WHERE r.subscription_status = 'trialing'
      AND u.email IS NOT NULL
      -- Case-insensitive: users may have signed up with mixed-case domains
      AND u.email NOT ILIKE '%@easyshifthq.com'
      AND u.email NOT ILIKE '%@camiluke.com'
  )
  SELECT
    c.restaurant_id,
    c.user_id,
    c.email,
    c.full_name,
    c.trial_day,
    c.activated,
    dm.t AS email_type
  FROM candidates c
  JOIN day_map dm ON dm.d = c.trial_day
  WHERE NOT EXISTS (
    SELECT 1 FROM public.trial_emails_sent tes
    WHERE tes.restaurant_id = c.restaurant_id
      AND tes.user_id = c.user_id
      AND tes.email_type = dm.t
  )
  AND NOT EXISTS (
    SELECT 1 FROM public.email_unsubscribes eu
    WHERE eu.user_id = c.user_id
      AND eu.list IN ('trial_lifecycle', 'all')
  );
END;
$$;

COMMENT ON FUNCTION public.users_in_trial_email_window() IS
  'Returns trial restaurants × owners × email_type ready to send today. Caller: trial-expiry-emails edge function.';

-- Edge function calls this via the service-role key; lock the surface area.
REVOKE ALL ON FUNCTION public.users_in_trial_email_window() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.users_in_trial_email_window() FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION public.users_in_trial_email_window() TO service_role;
