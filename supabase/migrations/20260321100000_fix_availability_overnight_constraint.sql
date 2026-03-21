-- Fix availability constraints to allow overnight UTC windows
-- When a restaurant in CST sets availability 8 AM-11 PM local,
-- UTC conversion produces 13:00-04:00 which crosses midnight.
-- The old constraint (end_time > start_time) rejects this.
-- New constraint: only reject when start_time = end_time (zero-length window).

ALTER TABLE employee_availability DROP CONSTRAINT IF EXISTS valid_time;
ALTER TABLE employee_availability ADD CONSTRAINT valid_time CHECK (end_time != start_time);

ALTER TABLE availability_exceptions DROP CONSTRAINT IF EXISTS valid_exception_time;
ALTER TABLE availability_exceptions ADD CONSTRAINT valid_exception_time CHECK (
  (start_time IS NULL AND end_time IS NULL) OR
  (start_time IS NOT NULL AND end_time IS NOT NULL AND end_time != start_time)
);

-- Helper: check if a shift time range falls within an availability window.
-- For overnight windows (end < start, e.g. 13:00-04:00), the unavailable gap
-- is [end_time, start_time]. The shift is within the window if it doesn't
-- overlap the gap: shift_start >= window_start OR shift_end <= window_end.
CREATE OR REPLACE FUNCTION time_within_window(
  p_shift_start TIME,
  p_shift_end TIME,
  p_window_start TIME,
  p_window_end TIME
) RETURNS BOOLEAN AS $$
BEGIN
  IF p_window_end < p_window_start THEN
    -- Overnight window: shift must not overlap the gap [end, start]
    RETURN p_shift_start >= p_window_start OR p_shift_end <= p_window_end;
  ELSE
    -- Normal window
    RETURN p_shift_start >= p_window_start AND p_shift_end <= p_window_end;
  END IF;
END;
$$ LANGUAGE plpgsql IMMUTABLE;

-- Replace conflict detection function to handle overnight UTC windows.
CREATE OR REPLACE FUNCTION check_availability_conflict(
  p_employee_id UUID,
  p_restaurant_id UUID,
  p_start_time TIMESTAMP WITH TIME ZONE,
  p_end_time TIMESTAMP WITH TIME ZONE
)
RETURNS TABLE (
  has_conflict BOOLEAN,
  conflict_type TEXT,
  message TEXT
) AS $$
DECLARE
  v_current_date DATE;
  v_end_date DATE;
  v_day_of_week INTEGER;
  v_shift_start_time TIME;
  v_shift_end_time TIME;
  v_exception RECORD;
  v_availability RECORD;
  v_has_availability BOOLEAN;
  v_match_found BOOLEAN;
BEGIN
  v_current_date := DATE(p_start_time);
  v_end_date := DATE(p_end_time);

  WHILE v_current_date <= v_end_date LOOP
    v_day_of_week := EXTRACT(DOW FROM v_current_date);

    IF v_current_date = DATE(p_start_time) AND v_current_date = DATE(p_end_time) THEN
      v_shift_start_time := (p_start_time)::TIME;
      v_shift_end_time := (p_end_time)::TIME;
    ELSIF v_current_date = DATE(p_start_time) THEN
      v_shift_start_time := (p_start_time)::TIME;
      v_shift_end_time := '23:59:59'::TIME;
    ELSIF v_current_date = DATE(p_end_time) THEN
      v_shift_start_time := '00:00:00'::TIME;
      v_shift_end_time := (p_end_time)::TIME;
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
          COALESCE(' (' || v_exception.reason || ')', '');
        RETURN;
      ELSIF v_exception.start_time IS NOT NULL THEN
        IF NOT time_within_window(v_shift_start_time, v_shift_end_time,
                                  v_exception.start_time, v_exception.end_time) THEN
          RETURN QUERY SELECT true, 'exception'::TEXT,
            'Shift on ' || v_current_date::TEXT || ' is outside employee availability window (' ||
            v_exception.start_time::TEXT || ' - ' || v_exception.end_time::TEXT || ')';
          RETURN;
        END IF;
      END IF;
    ELSE
      v_has_availability := false;
      v_match_found := false;
      FOR v_availability IN
        SELECT * FROM employee_availability
        WHERE employee_id = p_employee_id
          AND restaurant_id = p_restaurant_id
          AND day_of_week = v_day_of_week
      LOOP
        v_has_availability := true;
        IF NOT v_availability.is_available THEN
          RETURN QUERY SELECT true, 'recurring'::TEXT,
            'Employee is not available on this day of the week';
          RETURN;
        END IF;

        -- Shift fits within at least one availability window → no conflict
        IF time_within_window(v_shift_start_time, v_shift_end_time,
                              v_availability.start_time, v_availability.end_time) THEN
          v_match_found := true;
          EXIT;
        END IF;
      END LOOP;

      IF v_has_availability AND NOT v_match_found THEN
        RETURN QUERY SELECT true, 'recurring'::TEXT,
          'Shift on ' || v_current_date::TEXT || ' is outside employee availability';
        RETURN;
      END IF;
    END IF;

    v_current_date := v_current_date + INTERVAL '1 day';
  END LOOP;

  RETURN;
END;
$$ LANGUAGE plpgsql STABLE;
