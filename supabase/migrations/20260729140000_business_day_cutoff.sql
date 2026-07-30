-- Per-restaurant business-day start hour.
--
-- An overnight shift belongs to the day the employee clocked IN, not the
-- calendar day they clocked out. Two orthogonal rules compose:
--   1. the attribution anchor is the shift's clock-in instant (client-side,
--      parseWorkPeriods already does this);
--   2. the cutoff maps that instant to a business day, below.
--
-- DEFAULT 0 reproduces "business day == restaurant-local calendar day", which
-- is today's intended semantics, so no restaurant's attribution changes on
-- deploy. Postgres 11+ materializes a non-volatile default without a table
-- rewrite, so DEFAULT 0 *is* the backfill for the existing rows.

ALTER TABLE public.restaurants
  ADD COLUMN business_day_start_hour SMALLINT NOT NULL DEFAULT 0;

-- Plain CHECK, not NOT VALID: added in the same migration as the column, so
-- every row satisfies it by construction, and restaurants is a ~35-row
-- settings table. The validating scan is sub-millisecond.
ALTER TABLE public.restaurants
  ADD CONSTRAINT restaurants_business_day_start_hour_range
  CHECK (business_day_start_hour BETWEEN 0 AND 11);

COMMENT ON COLUMN public.restaurants.business_day_start_hour IS
  'Hour (0-11, restaurant-local) at which the business day starts. Shifts '
  'clocking in before this hour are attributed to the previous business day. '
  '0 == calendar day. See docs/superpowers/specs/2026-07-29-business-day-cutoff-design.md';

CREATE OR REPLACE FUNCTION public.business_day(
  p_instant       TIMESTAMPTZ,
  p_restaurant_id UUID
) RETURNS DATE
LANGUAGE plpgsql
STABLE
SECURITY INVOKER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_tz   TEXT;
  v_hour SMALLINT;
BEGIN
  IF p_instant IS NULL THEN
    RETURN NULL;
  END IF;

  SELECT r.timezone, r.business_day_start_hour
    INTO v_tz, v_hour
  FROM public.restaurants r
  WHERE r.id = p_restaurant_id;

  -- Covers a NULL timezone, an empty string, and no-such-restaurant (where
  -- SELECT ... INTO leaves both OUT variables NULL). Under SECURITY INVOKER an
  -- RLS-invisible row is indistinguishable from a nonexistent one, and both
  -- resolve here to UTC/0 rather than raising. That is deliberate: identical
  -- output for both cases means this cannot be used to probe whether a foreign
  -- restaurant exists, and a bucketing helper is the wrong layer to enforce
  -- authorization. Pinned by test in supabase/tests/business_day_cutoff.test.sql.
  v_tz   := COALESCE(NULLIF(v_tz, ''), 'UTC');
  v_hour := COALESCE(v_hour, 0);

  -- An invalid IANA string raises invalid_parameter_value (22023) on first use.
  -- Probe once with a throwaway expression: the error depends only on the zone
  -- string, not on the timestamptz being converted. Deliberately NOT a
  -- pg_timezone_names lookup -- that is a ~1,200-row catalog scan at ~49ms
  -- versus ~0.4ms here (memory/lessons.md 2026-07-23). Reassigning v_tz itself
  -- -- the widest-scoped variable, not a local -- is what makes the RETURN safe
  -- (memory/lessons.md 2026-07-24).
  BEGIN
    PERFORM now() AT TIME ZONE v_tz;
  EXCEPTION WHEN invalid_parameter_value THEN
    v_tz := 'UTC';
  END;

  -- ORDER IS LOAD-BEARING. Converting first and then subtracting reads the
  -- wall clock the employee actually experienced. The other order,
  -- (p_instant - interval) AT TIME ZONE v_tz, subtracts *elapsed* time and
  -- disagrees by a full calendar day for any instant inside the fall-back
  -- repeated hour: America/Chicago, cutoff 2, 2026-11-01 07:30:00+00 gives
  -- 2026-10-31 here and 2026-11-01 there. See design doc section 4.1; the
  -- anti-regression test asserts the rejected form is wrong.
  RETURN ((p_instant AT TIME ZONE v_tz) - make_interval(hours => v_hour))::date;
END;
$$;

REVOKE ALL ON FUNCTION public.business_day(TIMESTAMPTZ, UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.business_day(TIMESTAMPTZ, UUID)
  TO authenticated, service_role;
