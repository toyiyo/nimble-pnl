-- check_availability_conflict reads the restaurant-local columns (PR 1).
-- The recurring and previous-day loops use start_time_local and end_time_local
-- with no conversion. The exception branch keeps its UTC conversion.
-- Two new return columns: available_start_local and available_end_local.
-- available_start and available_end keep their legacy UTC values for stale clients.
-- Design: docs/superpowers/specs/2026-11-05-availability-local-time-design.md section 7.5.

BEGIN;

DROP FUNCTION IF EXISTS public.check_availability_conflict(uuid, uuid, timestamptz, timestamptz);

CREATE FUNCTION public.check_availability_conflict(
  p_employee_id UUID,
  p_restaurant_id UUID,
  p_start_time TIMESTAMP WITH TIME ZONE,
  p_end_time TIMESTAMP WITH TIME ZONE
)
RETURNS TABLE (
  has_conflict BOOLEAN,
  conflict_type TEXT,
  message TEXT,
  available_start TIME,
  available_end TIME,
  available_start_local TIME,
  available_end_local TIME
)
LANGUAGE plpgsql
STABLE
SECURITY INVOKER
SET search_path = public, pg_catalog
AS $$
DECLARE
  v_tz TEXT;
  v_start_local TIMESTAMP;
  v_end_local TIMESTAMP;
  v_current_date DATE;
  v_end_date DATE;
  v_prev_date DATE;
  v_dow INTEGER;
  v_seg_start TIMESTAMP;
  v_seg_end TIMESTAMP;
  v_exception RECORD;
  v_avail RECORD;
  v_w_start_tod TIME;
  v_w_end_tod TIME;
  v_w_start_ts TIMESTAMP;
  v_w_end_ts TIMESTAMP;
  v_match BOOLEAN;
  v_has_unavailable BOOLEAN;
  v_has_window BOOLEAN;
  v_last_start TIME;
  v_last_end TIME;
  v_last_start_local TIME;
  v_last_end_local TIME;
BEGIN
  -- 1. Resolve the restaurant timezone (fallback UTC for null/blank).
  SELECT timezone INTO v_tz FROM restaurants WHERE id = p_restaurant_id;
  v_tz := COALESCE(NULLIF(v_tz, ''), 'UTC');

  -- 2. Shift instants -> restaurant-local wall clock. A garbage timezone makes
  --    AT TIME ZONE raise invalid_parameter_value; catch it and degrade to UTC
  --    (the old behaviour) instead of failing the whole conflict check. v_tz
  --    itself is reassigned (not just the locals) because it is reused in every
  --    downstream AT TIME ZONE cast below (exception window, recurring loop,
  --    previous-day overnight carry-over).
  BEGIN
    v_start_local := p_start_time AT TIME ZONE v_tz;
    v_end_local   := p_end_time   AT TIME ZONE v_tz;
  EXCEPTION WHEN invalid_parameter_value THEN
    v_tz := 'UTC';
    v_start_local := p_start_time AT TIME ZONE v_tz;
    v_end_local   := p_end_time   AT TIME ZONE v_tz;
  END;

  v_current_date := v_start_local::date;
  IF v_end_local::time = TIME '00:00:00' AND v_end_local > v_start_local THEN
    v_end_date := (v_end_local - INTERVAL '1 day')::date;
  ELSE
    v_end_date := v_end_local::date;
  END IF;

  -- 3. Walk each LOCAL date the shift covers.
  WHILE v_current_date <= v_end_date LOOP
    v_dow := EXTRACT(DOW FROM v_current_date)::int;
    v_prev_date := v_current_date - 1;

    v_seg_start := GREATEST(v_start_local, v_current_date::timestamp);
    v_seg_end   := LEAST(v_end_local, (v_current_date + 1)::timestamp);

    -- 3a. Exception overrides recurring for this exact local date.
    SELECT * INTO v_exception
    FROM availability_exceptions
    WHERE employee_id = p_employee_id
      AND restaurant_id = p_restaurant_id
      AND date = v_current_date
    LIMIT 1;  -- multi-slot exceptions not modeled (see design follow-up)

    IF FOUND THEN
      IF NOT v_exception.is_available THEN
        RETURN QUERY SELECT true, 'exception'::text,
          'Employee is unavailable on ' || v_current_date::text ||
            COALESCE(' (' || v_exception.reason || ')', ''),
          NULL::time, NULL::time, NULL::time, NULL::time;
        RETURN;
      ELSIF v_exception.start_time IS NOT NULL THEN
        v_w_start_tod := (((v_current_date + v_exception.start_time)::timestamp
                            AT TIME ZONE 'UTC') AT TIME ZONE v_tz)::time;
        v_w_end_tod   := (((v_current_date + v_exception.end_time)::timestamp
                            AT TIME ZONE 'UTC') AT TIME ZONE v_tz)::time;
        v_w_start_ts := v_current_date + v_w_start_tod;
        v_w_end_ts   := v_current_date + v_w_end_tod
                        + (CASE WHEN v_w_end_tod <= v_w_start_tod
                                THEN INTERVAL '1 day' ELSE INTERVAL '0' END);
        IF NOT (v_seg_start >= v_w_start_ts AND v_seg_end <= v_w_end_ts) THEN
          RETURN QUERY SELECT true, 'exception'::text,
            'Shift on ' || v_current_date::text || ' is outside employee availability',
            v_exception.start_time, v_exception.end_time,
            v_w_start_tod, v_w_end_tod;
          RETURN;
        END IF;
      END IF;
    ELSE
      -- 3b. Recurring availability for this local weekday.
      v_match := false;
      v_has_unavailable := false;
      v_has_window := false;
      v_last_start := NULL;
      v_last_end := NULL;
      v_last_start_local := NULL;
      v_last_end_local := NULL;

      FOR v_avail IN
        SELECT * FROM employee_availability
        WHERE employee_id = p_employee_id
          AND restaurant_id = p_restaurant_id
          AND day_of_week = v_dow
      LOOP
        IF NOT v_avail.is_available THEN
          v_has_unavailable := true;
          CONTINUE;
        END IF;
        v_has_window := true;
        v_last_start := v_avail.start_time;
        v_last_end := v_avail.end_time;
        v_last_start_local := v_avail.start_time_local;
        v_last_end_local := v_avail.end_time_local;
        v_w_start_tod := v_avail.start_time_local;
        v_w_end_tod   := v_avail.end_time_local;
        v_w_start_ts := v_current_date + v_w_start_tod;
        v_w_end_ts   := v_current_date + v_w_end_tod
                        + (CASE WHEN v_w_end_tod <= v_w_start_tod
                                THEN INTERVAL '1 day' ELSE INTERVAL '0' END);
        IF v_seg_start >= v_w_start_ts AND v_seg_end <= v_w_end_ts THEN
          v_match := true;
          EXIT;
        END IF;
      END LOOP;

      -- 3c. Previous local day's overnight windows can cover the early hours of today.
      IF NOT v_match THEN
        FOR v_avail IN
          SELECT * FROM employee_availability
          WHERE employee_id = p_employee_id
            AND restaurant_id = p_restaurant_id
            AND day_of_week = EXTRACT(DOW FROM v_prev_date)::int
            AND is_available = true
        LOOP
          v_w_start_tod := v_avail.start_time_local;
          v_w_end_tod   := v_avail.end_time_local;
          IF v_w_end_tod <= v_w_start_tod AND v_w_end_tod <> TIME '00:00:00' THEN  -- overnight local window spills into today
            v_has_window := true;
            IF v_last_start IS NULL THEN
              v_last_start := v_avail.start_time;
              v_last_end := v_avail.end_time;
              v_last_start_local := v_avail.start_time_local;
              v_last_end_local := v_avail.end_time_local;
            END IF;
            v_w_start_ts := v_prev_date + v_w_start_tod;
            v_w_end_ts   := v_prev_date + v_w_end_tod + INTERVAL '1 day';
            IF v_seg_start >= v_w_start_ts AND v_seg_end <= v_w_end_ts THEN
              v_match := true;
              EXIT;
            END IF;
          END IF;
        END LOOP;
      END IF;

      IF NOT v_match THEN
        IF v_has_window THEN
          RETURN QUERY SELECT true, 'recurring'::text,
            'Shift on ' || v_current_date::text || ' is outside employee availability',
            v_last_start, v_last_end, v_last_start_local, v_last_end_local;
          RETURN;
        ELSIF v_has_unavailable THEN
          RETURN QUERY SELECT true, 'recurring'::text,
            'Employee is not available on this day of the week',
            NULL::time, NULL::time, NULL::time, NULL::time;
          RETURN;
        END IF;
        -- else: no recurring data for this weekday -> unknown -> no conflict.
      END IF;
    END IF;

    v_current_date := v_current_date + 1;
  END LOOP;

  RETURN;  -- no conflict
END;
$$;

REVOKE ALL ON FUNCTION public.check_availability_conflict(uuid, uuid, timestamptz, timestamptz) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.check_availability_conflict(uuid, uuid, timestamptz, timestamptz) TO authenticated, service_role;

COMMIT;

NOTIFY pgrst, 'reload schema';
