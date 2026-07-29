-- Timezone-aware week bucketing for publish_schedule / unpublish_schedule.
--
-- PROVENANCE: both functions are re-declared here IN FULL. Their sole previous
-- definition is supabase/migrations/20251123000000_schedule_publishing.sql
-- (verified with:
--    grep -rlE "FUNCTION\s+(public\.)?(publish_schedule|unpublish_schedule)\b" \
--      supabase/migrations/
-- which returns only that file). CREATE OR REPLACE rewrites the whole body, so
-- everything from that migration is carried forward verbatim except the three
-- date-bucketing predicates and the hardening noted below.
--
-- BUG: shifts were selected with `start_time::date`. Casting a timestamptz to
-- date resolves against the DATABASE SESSION TimeZone, not the restaurant's
-- IANA zone. No migration sets a non-default TimeZone, so on Supabase that is
-- UTC. For a restaurant behind UTC -- America/Chicago at UTC-5 -- a closing
-- shift starting 22:00 local already falls on the NEXT UTC calendar day, so it
-- landed on the wrong side of p_week_start / p_week_end: excluded at the end of
-- its own week, included at the start of the next one. East of UTC the slip
-- mirrors (06:00 Monday in Asia/Tokyo is 21:00 Sunday UTC).
--
-- FIX: resolve the restaurant's zone into v_tz and bucket with
-- (start_time AT TIME ZONE v_tz)::date -- the same expression get_open_shifts
-- already uses (20260529120000_fix_open_shifts_capacity_one.sql:107-109), so
-- the publish path and the read path now agree about which shifts a week owns.
--
-- CARRIED ALONG (safe to do only because we are re-declaring anyway):
--   * SET search_path on these SECURITY DEFINER functions (Supabase advisor
--     lint; CREATE OR REPLACE does not carry SECURITY DEFINER forward either,
--     so it is restated explicitly).
--   * Schema-qualified table references.
--   * An EXECUTE privilege boundary. Neither function has ever had a
--     GRANT/REVOKE, so both still carried Postgres's default PUBLIC EXECUTE
--     while being SECURITY DEFINER -- an anonymous caller holding only the
--     publishable key could publish-and-lock or unpublish any restaurant's
--     week. Template: 20260723170000_link_invited_employee.sql:165-166.
--
-- NOT DONE HERE: an in-body check that the caller belongs to p_restaurant_id.
-- Any authenticated user can still pass a foreign restaurant UUID. That needs
-- its own decision about which roles may publish and is a tracked follow-up --
-- see docs/superpowers/specs/2026-07-28-publish-schedule-tz-bucketing-design.md.

CREATE OR REPLACE FUNCTION public.publish_schedule(
  p_restaurant_id UUID,
  p_week_start DATE,
  p_week_end DATE,
  p_notes TEXT DEFAULT NULL
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_shift_count INTEGER;
  v_publication_id UUID;
  v_tz TEXT;
BEGIN
  -- Resolve the restaurant's IANA zone ONCE, before any use of v_tz below.
  SELECT r.timezone INTO v_tz
  FROM public.restaurants r
  WHERE r.id = p_restaurant_id;

  -- Covers both a NULL timezone and an empty string; also covers no such
  -- restaurant, where SELECT ... INTO leaves v_tz NULL.
  v_tz := COALESCE(NULLIF(v_tz, ''), 'UTC');

  -- An invalid IANA string raises invalid_parameter_value (22023) on first use,
  -- which would abort the whole publish. Probe once with a throwaway
  -- expression: the error depends only on the zone string, not on the
  -- timestamptz being converted, so now() raises exactly when s.start_time
  -- would. Reassigning v_tz itself is what makes every later reference safe.
  BEGIN
    PERFORM now() AT TIME ZONE v_tz;
  EXCEPTION WHEN invalid_parameter_value THEN
    v_tz := 'UTC';
  END;

  -- Count shifts to be published
  SELECT COUNT(*) INTO v_shift_count
  FROM public.shifts s
  WHERE s.restaurant_id = p_restaurant_id
    AND (s.start_time AT TIME ZONE v_tz)::date >= p_week_start
    AND (s.start_time AT TIME ZONE v_tz)::date <= p_week_end
    AND s.is_published = false;

  -- Update shifts to published
  UPDATE public.shifts s
  SET
    is_published = true,
    locked = true,
    published_at = NOW(),
    published_by = auth.uid()
  WHERE s.restaurant_id = p_restaurant_id
    AND (s.start_time AT TIME ZONE v_tz)::date >= p_week_start
    AND (s.start_time AT TIME ZONE v_tz)::date <= p_week_end
    AND s.is_published = false;

  -- Create publication record
  INSERT INTO public.schedule_publications (
    restaurant_id,
    week_start_date,
    week_end_date,
    published_by,
    shift_count,
    notes
  ) VALUES (
    p_restaurant_id,
    p_week_start,
    p_week_end,
    auth.uid(),
    v_shift_count,
    p_notes
  ) RETURNING id INTO v_publication_id;

  RETURN v_publication_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.unpublish_schedule(
  p_restaurant_id UUID,
  p_week_start DATE,
  p_week_end DATE,
  p_reason TEXT DEFAULT NULL
)
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_shift_count INTEGER;
  v_tz TEXT;
BEGIN
  -- Same resolution as publish_schedule; see the comment there.
  SELECT r.timezone INTO v_tz
  FROM public.restaurants r
  WHERE r.id = p_restaurant_id;

  v_tz := COALESCE(NULLIF(v_tz, ''), 'UTC');

  BEGIN
    PERFORM now() AT TIME ZONE v_tz;
  EXCEPTION WHEN invalid_parameter_value THEN
    v_tz := 'UTC';
  END;

  -- Update shifts to unpublished
  UPDATE public.shifts s
  SET
    is_published = false,
    locked = false,
    published_at = NULL,
    published_by = NULL
  WHERE s.restaurant_id = p_restaurant_id
    AND (s.start_time AT TIME ZONE v_tz)::date >= p_week_start
    AND (s.start_time AT TIME ZONE v_tz)::date <= p_week_end
    AND s.is_published = true;

  -- Get the count of updated rows
  GET DIAGNOSTICS v_shift_count = ROW_COUNT;

  -- Log the unpublish action
  INSERT INTO public.schedule_change_logs (
    restaurant_id,
    change_type,
    changed_by,
    reason
  ) VALUES (
    p_restaurant_id,
    'unpublished',
    auth.uid(),
    COALESCE(p_reason, 'Schedule unpublished for date range: ' || p_week_start || ' to ' || p_week_end)
  );

  RETURN v_shift_count;
END;
$$;

-- Least privilege. Supabase's default privileges grant EXECUTE on public
-- functions to anon as well as authenticated, so revoking PUBLIC alone is not
-- enough -- anon must be named. service_role is granted so a future edge
-- function does not silently break.
REVOKE ALL ON FUNCTION public.publish_schedule(UUID, DATE, DATE, TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.publish_schedule(UUID, DATE, DATE, TEXT) TO authenticated, service_role;

REVOKE ALL ON FUNCTION public.unpublish_schedule(UUID, DATE, DATE, TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.unpublish_schedule(UUID, DATE, DATE, TEXT) TO authenticated, service_role;

COMMENT ON FUNCTION public.publish_schedule(UUID, DATE, DATE, TEXT) IS
  'Publishes all shifts in a date range and locks them. Buckets shifts by the '
  'restaurant''s IANA timezone (restaurants.timezone, falling back to UTC), not '
  'the database session timezone, so late-night shifts belong to the local '
  'calendar day they start on.';

COMMENT ON FUNCTION public.unpublish_schedule(UUID, DATE, DATE, TEXT) IS
  'Unpublishes shifts in a date range (for corrections only). Uses the same '
  'restaurant-local date bucketing as publish_schedule.';
