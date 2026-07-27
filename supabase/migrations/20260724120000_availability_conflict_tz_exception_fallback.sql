-- Perf: replace the pg_timezone_names catalog probe in check_availability_conflict
-- with an EXCEPTION-based fallback, mirroring the already-deployed sibling
-- 20260723180000_timeoff_conflict_local_tz.sql (check_timeoff_conflict / PR #647).
--
-- Why: pg_timezone_names is a set-returning catalog function that materializes
-- ~1,200 rows via a sequential filter scan on every call — measured ~49ms/call
-- locally vs ~0.4ms for the `AT TIME ZONE v_tz` cast the function performs anyway
-- (~100x cheaper). This is the O(rows x catalog) blowup called out in
-- memory/lessons.md (lines ~1358, ~1514). On the happy path (valid IANA tz) we now
-- pay only the plain cast; only a truly invalid zone pays for the subtransaction,
-- and that path is effectively unreachable in prod (every restaurant row is a
-- real IANA name per memory/lessons.md).
--
-- CRITICAL — do not simplify this to "just recast the two locals in the handler"
-- like the timeoff sibling does. check_timeoff_conflict has only the two
-- `AT TIME ZONE v_tz` casts in its whole body, so its handler can recast just
-- v_start_local/v_end_local. check_availability_conflict reuses v_tz in MANY
-- downstream casts: the exception-window branch, the recurring-availability loop,
-- and the previous-local-day overnight carry-over. If the handler only fixed the
-- two top-level locals, those later casts would still reference the invalid v_tz
-- and raise `time zone "..." not recognized` deeper in the function body —
-- defeating the whole fallback. So the handler reassigns v_tz := 'UTC' itself;
-- every downstream reference then resolves safely. (Caught in Phase 2.5 design
-- review; see docs/superpowers/specs/2026-07-24-conflict-check-perf-design.md.)
--
-- Behaviour is preserved exactly: both the old catalog probe and this EXCEPTION
-- block resolve an invalid/unparseable tz to UTC. The rest of the function body
-- (the local-frame walk) is copied verbatim from 20260712120000 — no other
-- semantics change. One accepted trade-off: fixed-offset strings like '+05:00'
-- now parse successfully under `AT TIME ZONE` (they are not in pg_timezone_names,
-- but are valid fixed-offset syntax), so such a restaurant gets fixed-offset math
-- instead of being coerced to UTC. This matches the deployed timeoff sibling and
-- is pinned by CASE 7 in supabase/tests/availability_conflict_local_tz.sql. Truly
-- unparseable garbage (e.g. 'Not/AZone') still falls back to UTC (CASE 4).
--
-- Signature/return shape/volatility/search_path unchanged from 20260712120000, so
-- no DROP is required and no client change is needed.

CREATE OR REPLACE FUNCTION check_availability_conflict(
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
  available_end TIME
)
LANGUAGE plpgsql
STABLE
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
BEGIN
  -- 1. Resolve the restaurant timezone (fallback UTC for null/blank).
  SELECT timezone INTO v_tz FROM restaurants WHERE id = p_restaurant_id;
  v_tz := COALESCE(NULLIF(v_tz, ''), 'UTC');

  -- 2. Shift instants -> restaurant-local wall clock. A garbage timezone makes
  --    AT TIME ZONE raise invalid_parameter_value; catch it and degrade to UTC
  --    (the old behaviour) instead of failing the whole conflict check. v_tz
  --    itself is reassigned (not just the locals) because it is reused in every
  --    downstream AT TIME ZONE cast below (exception window, recurring loop,
  --    previous-day overnight carry-over) — see header note.
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
          NULL::time, NULL::time;
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
            v_exception.start_time, v_exception.end_time;
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
        v_w_start_tod := (((v_current_date + v_avail.start_time)::timestamp
                            AT TIME ZONE 'UTC') AT TIME ZONE v_tz)::time;
        v_w_end_tod   := (((v_current_date + v_avail.end_time)::timestamp
                            AT TIME ZONE 'UTC') AT TIME ZONE v_tz)::time;
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
          v_w_start_tod := (((v_prev_date + v_avail.start_time)::timestamp
                              AT TIME ZONE 'UTC') AT TIME ZONE v_tz)::time;
          v_w_end_tod   := (((v_prev_date + v_avail.end_time)::timestamp
                              AT TIME ZONE 'UTC') AT TIME ZONE v_tz)::time;
          IF v_w_end_tod <= v_w_start_tod THEN  -- overnight local window spills into today
            v_has_window := true;
            IF v_last_start IS NULL THEN
              v_last_start := v_avail.start_time;
              v_last_end := v_avail.end_time;
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
            v_last_start, v_last_end;
          RETURN;
        ELSIF v_has_unavailable THEN
          RETURN QUERY SELECT true, 'recurring'::text,
            'Employee is not available on this day of the week',
            NULL::time, NULL::time;
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
