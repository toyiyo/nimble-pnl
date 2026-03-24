-- Add structured availability window data to conflict detection.
-- Must DROP first because RETURNS TABLE signature is changing.

DROP FUNCTION IF EXISTS check_availability_conflict(UUID, UUID, TIMESTAMPTZ, TIMESTAMPTZ);

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
) AS $$
DECLARE
  v_start_utc TIMESTAMP WITHOUT TIME ZONE;
  v_end_utc TIMESTAMP WITHOUT TIME ZONE;
  v_current_date DATE;
  v_end_date DATE;
  v_day_of_week INTEGER;
  v_prev_day_of_week INTEGER;
  v_shift_start_time TIME;
  v_shift_end_time TIME;
  v_exception RECORD;
  v_availability RECORD;
  v_has_availability BOOLEAN;
  v_match_found BOOLEAN;
  v_last_window_start TIME;
  v_last_window_end TIME;
BEGIN
  v_start_utc := p_start_time AT TIME ZONE 'UTC';
  v_end_utc := p_end_time AT TIME ZONE 'UTC';
  v_current_date := v_start_utc::DATE;
  IF v_end_utc::TIME = '00:00:00'::TIME AND v_end_utc > v_start_utc THEN
    v_end_date := (v_end_utc - INTERVAL '1 day')::DATE;
  ELSE
    v_end_date := v_end_utc::DATE;
  END IF;

  WHILE v_current_date <= v_end_date LOOP
    v_day_of_week := EXTRACT(DOW FROM v_current_date);
    v_prev_day_of_week := EXTRACT(DOW FROM v_current_date - INTERVAL '1 day');

    IF v_current_date = v_start_utc::DATE AND v_current_date = v_end_utc::DATE THEN
      v_shift_start_time := v_start_utc::TIME;
      v_shift_end_time := v_end_utc::TIME;
    ELSIF v_current_date = v_start_utc::DATE THEN
      v_shift_start_time := v_start_utc::TIME;
      v_shift_end_time := '23:59:59'::TIME;
    ELSIF v_current_date = v_end_utc::DATE THEN
      v_shift_start_time := '00:00:00'::TIME;
      v_shift_end_time := v_end_utc::TIME;
    ELSE
      v_shift_start_time := '00:00:00'::TIME;
      v_shift_end_time := '23:59:59'::TIME;
    END IF;

    -- Check for exception on this specific date
    SELECT * INTO v_exception
    FROM availability_exceptions
    WHERE employee_id = p_employee_id
      AND restaurant_id = p_restaurant_id
      AND date = v_current_date
    LIMIT 1;

    IF FOUND THEN
      IF NOT v_exception.is_available THEN
        RETURN QUERY SELECT true, 'exception'::TEXT,
          'Employee is unavailable on ' || v_current_date::TEXT ||
          COALESCE(' (' || v_exception.reason || ')', ''),
          NULL::TIME, NULL::TIME;
        RETURN;
      ELSIF v_exception.start_time IS NOT NULL THEN
        IF NOT time_within_window(v_shift_start_time, v_shift_end_time,
                                  v_exception.start_time, v_exception.end_time) THEN
          RETURN QUERY SELECT true, 'exception'::TEXT,
            'Shift on ' || v_current_date::TEXT || ' is outside employee availability window (' ||
            v_exception.start_time::TEXT || ' - ' || v_exception.end_time::TEXT || ')',
            v_exception.start_time, v_exception.end_time;
          RETURN;
        END IF;
      END IF;
    ELSE
      v_has_availability := false;
      v_match_found := false;
      v_last_window_start := NULL;
      v_last_window_end := NULL;

      FOR v_availability IN
        SELECT * FROM employee_availability
        WHERE employee_id = p_employee_id
          AND restaurant_id = p_restaurant_id
          AND day_of_week = v_day_of_week
      LOOP
        v_has_availability := true;
        IF NOT v_availability.is_available THEN
          RETURN QUERY SELECT true, 'recurring'::TEXT,
            'Employee is not available on this day of the week',
            NULL::TIME, NULL::TIME;
          RETURN;
        END IF;

        -- Store this window in case we need it for the conflict message
        v_last_window_start := v_availability.start_time;
        v_last_window_end := v_availability.end_time;

        IF time_within_window(v_shift_start_time, v_shift_end_time,
                              v_availability.start_time, v_availability.end_time) THEN
          v_match_found := true;
          EXIT;
        END IF;
      END LOOP;

      IF NOT v_match_found THEN
        FOR v_availability IN
          SELECT * FROM employee_availability
          WHERE employee_id = p_employee_id
            AND restaurant_id = p_restaurant_id
            AND day_of_week = v_prev_day_of_week
            AND is_available = true
            AND end_time < start_time
        LOOP
          v_has_availability := true;
          IF v_shift_start_time >= '00:00:00'::TIME AND v_shift_end_time <= v_availability.end_time THEN
            v_match_found := true;
            EXIT;
          END IF;
        END LOOP;
      END IF;

      IF v_has_availability AND NOT v_match_found THEN
        RETURN QUERY SELECT true, 'recurring'::TEXT,
          'Shift on ' || v_current_date::TEXT || ' is outside employee availability',
          v_last_window_start, v_last_window_end;
        RETURN;
      END IF;
    END IF;

    v_current_date := v_current_date + INTERVAL '1 day';
  END LOOP;

  RETURN;
END;
$$ LANGUAGE plpgsql STABLE;
