-- Timezone-aware rewrite of check_timeoff_conflict.
-- Prior version (20251123100050) bucketed the shift by its UTC calendar date:
--   DATE(p_start_time AT TIME ZONE 'UTC') BETWEEN tor.start_date AND tor.end_date
-- but time_off_requests.start_date/end_date are plain DATE columns holding the
-- RESTAURANT-LOCAL days the employee requested off. Comparing a UTC-derived date
-- against a local DATE is a frame mismatch, and every restaurant on the platform
-- sits west of UTC, so any evening shift rolls forward a day:
--   * false positive — a 7-11 PM shift the day BEFORE time off matched it;
--   * false negative — a 7-11 PM shift ON an approved day off matched nothing,
--     silently scheduling over approved time off.
-- This evaluates both sides in the restaurant-local frame, mirroring
-- 20260712120000_availability_conflict_local_tz.sql (same class of bug in
-- check_availability_conflict). Signature/return shape unchanged, so no DROP is
-- required and no client change is needed.
--
-- Timezone source: the function takes no p_restaurant_id, so it resolves the
-- timezone from the EMPLOYEE's own restaurant. A time-off request belongs to the
-- employee, so the employee's restaurant is the correct frame — and unlike
-- check_availability_conflict's client-supplied p_restaurant_id, it cannot be
-- pointed at the wrong restaurant by the caller. employees.restaurant_id is
-- NOT NULL REFERENCES restaurants(id) ON DELETE CASCADE, so the join is total.
--
-- Also adds SET search_path (the original had a mutable search_path). Stays
-- SECURITY INVOKER so RLS on time_off_requests continues to apply to the caller.

CREATE OR REPLACE FUNCTION check_timeoff_conflict(
  p_employee_id UUID,
  p_start_time TIMESTAMP WITH TIME ZONE,
  p_end_time TIMESTAMP WITH TIME ZONE
)
RETURNS TABLE (
  has_conflict BOOLEAN,
  time_off_id UUID,
  start_date DATE,
  end_date DATE,
  status TEXT
)
LANGUAGE plpgsql
STABLE
SET search_path = public, pg_catalog
AS $$
DECLARE
  v_tz TEXT;
  v_start_local TIMESTAMP;
  v_end_local TIMESTAMP;
  v_start_date DATE;
  v_end_date DATE;
BEGIN
  -- 1. Resolve + validate the employee's restaurant timezone (fallback UTC, so a
  --    null/blank/garbage value degrades to the old behaviour instead of raising).
  SELECT r.timezone INTO v_tz
  FROM employees e
  JOIN restaurants r ON r.id = e.restaurant_id
  WHERE e.id = p_employee_id;

  v_tz := COALESCE(NULLIF(v_tz, ''), 'UTC');
  IF NOT EXISTS (SELECT 1 FROM pg_timezone_names WHERE name = v_tz) THEN
    v_tz := 'UTC';
  END IF;

  -- 2. Shift instants -> restaurant-local wall clock -> local calendar dates.
  v_start_local := p_start_time AT TIME ZONE v_tz;
  v_end_local   := p_end_time   AT TIME ZONE v_tz;

  v_start_date := v_start_local::date;
  -- A shift ending exactly at local midnight belongs to the day it started;
  -- without this a 6 PM-midnight shift would claim the next day and reintroduce
  -- the same false positive one day later. Mirrors check_availability_conflict.
  IF v_end_local::time = TIME '00:00:00' AND v_end_local > v_start_local THEN
    v_end_date := (v_end_local - INTERVAL '1 day')::date;
  ELSE
    v_end_date := v_end_local::date;
  END IF;

  -- 3. Standard closed-interval overlap. Equivalent to the prior three-way OR
  --    (each of its branches is one endpoint-containment case) but symmetric.
  RETURN QUERY
  SELECT
    true AS has_conflict,
    tor.id AS time_off_id,
    tor.start_date,
    tor.end_date,
    tor.status
  FROM time_off_requests tor
  WHERE tor.employee_id = p_employee_id
    AND tor.status IN ('approved', 'pending')
    AND tor.start_date <= v_end_date
    AND tor.end_date >= v_start_date;
END;
$$;
