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

-- Replace conflict detection function to handle overnight UTC windows.
-- When end_time < start_time, the window wraps around midnight:
--   shift is within window if shift_time >= start_time OR shift_time <= end_time.
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
        -- Check if shift is within exception availability window
        IF v_exception.end_time < v_exception.start_time THEN
          -- Overnight window: available from start_time to midnight AND midnight to end_time
          IF NOT (v_shift_start_time >= v_exception.start_time OR v_shift_start_time <= v_exception.end_time)
             OR NOT (v_shift_end_time >= v_exception.start_time OR v_shift_end_time <= v_exception.end_time) THEN
            RETURN QUERY SELECT true, 'exception'::TEXT,
              'Shift on ' || v_current_date::TEXT || ' is outside employee availability window (' ||
              v_exception.start_time::TEXT || ' - ' || v_exception.end_time::TEXT || ')';
            RETURN;
          END IF;
        ELSE
          -- Normal window: start_time <= shift <= end_time
          IF NOT (v_shift_start_time >= v_exception.start_time AND v_shift_end_time <= v_exception.end_time) THEN
            RETURN QUERY SELECT true, 'exception'::TEXT,
              'Shift on ' || v_current_date::TEXT || ' is outside employee availability window (' ||
              v_exception.start_time::TEXT || ' - ' || v_exception.end_time::TEXT || ')';
            RETURN;
          END IF;
        END IF;
      END IF;
    ELSE
      v_has_availability := false;
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

        -- Check if shift is within availability window
        IF v_availability.end_time < v_availability.start_time THEN
          -- Overnight window
          IF NOT (v_shift_start_time >= v_availability.start_time OR v_shift_start_time <= v_availability.end_time)
             OR NOT (v_shift_end_time >= v_availability.start_time OR v_shift_end_time <= v_availability.end_time) THEN
            RETURN QUERY SELECT true, 'recurring'::TEXT,
              'Shift on ' || v_current_date::TEXT || ' is outside employee availability (' ||
              v_availability.start_time::TEXT || ' - ' || v_availability.end_time::TEXT || ')';
            RETURN;
          END IF;
        ELSE
          -- Normal window
          IF NOT (v_shift_start_time >= v_availability.start_time AND v_shift_end_time <= v_availability.end_time) THEN
            RETURN QUERY SELECT true, 'recurring'::TEXT,
              'Shift on ' || v_current_date::TEXT || ' is outside employee availability (' ||
              v_availability.start_time::TEXT || ' - ' || v_availability.end_time::TEXT || ')';
            RETURN;
          END IF;
        END IF;
      END LOOP;

      IF NOT v_has_availability THEN
        NULL;
      END IF;
    END IF;

    v_current_date := v_current_date + INTERVAL '1 day';
  END LOOP;

  RETURN;
END;
$$ LANGUAGE plpgsql STABLE;
