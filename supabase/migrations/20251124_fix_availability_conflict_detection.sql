-- Fix availability conflict detection to handle timezone properly and check each day

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
  -- Extract date range (no timezone conversion - use local time)
  v_current_date := DATE(p_start_time);
  v_end_date := DATE(p_end_time);
  
  -- Loop through each date in the shift range
  WHILE v_current_date <= v_end_date LOOP
    v_day_of_week := EXTRACT(DOW FROM v_current_date);
    
    -- Determine time range for this specific date
    IF v_current_date = DATE(p_start_time) AND v_current_date = DATE(p_end_time) THEN
      -- Shift starts and ends on the same day
      v_shift_start_time := (p_start_time)::TIME;
      v_shift_end_time := (p_end_time)::TIME;
    ELSIF v_current_date = DATE(p_start_time) THEN
      -- First day of multi-day shift
      v_shift_start_time := (p_start_time)::TIME;
      v_shift_end_time := '23:59:59'::TIME;
    ELSIF v_current_date = DATE(p_end_time) THEN
      -- Last day of multi-day shift
      v_shift_start_time := '00:00:00'::TIME;
      v_shift_end_time := (p_end_time)::TIME;
    ELSE
      -- Middle day of multi-day shift (entire day)
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
      -- Exception exists for this date
      IF NOT v_exception.is_available THEN
        -- Employee marked as unavailable for entire day
        RETURN QUERY SELECT true, 'exception'::TEXT, 
          'Employee is unavailable on ' || v_current_date::TEXT || 
          COALESCE(' (' || v_exception.reason || ')', '');
        RETURN;
      ELSIF v_exception.start_time IS NOT NULL THEN
        -- Check if shift is fully contained within exception availability window
        IF NOT (v_shift_start_time >= v_exception.start_time AND v_shift_end_time <= v_exception.end_time) THEN
          RETURN QUERY SELECT true, 'exception'::TEXT,
            'Shift on ' || v_current_date::TEXT || ' is outside employee availability window (' ||
            v_exception.start_time::TEXT || ' - ' || v_exception.end_time::TEXT || ')';
          RETURN;
        END IF;
      END IF;
      -- If exception is found and shift is within window, skip recurring check for this day
    ELSE
      -- No exception, check recurring availability for this day of week
      v_has_availability := false;
      
      FOR v_availability IN
        SELECT * FROM employee_availability
        WHERE employee_id = p_employee_id
          AND restaurant_id = p_restaurant_id
          AND day_of_week = v_day_of_week
      LOOP
        v_has_availability := true;
        
        IF NOT v_availability.is_available THEN
          -- Employee marked as unavailable for this day of week
          RETURN QUERY SELECT true, 'recurring'::TEXT,
            'Employee is not available on this day of the week';
          RETURN;
        ELSIF NOT (v_shift_start_time::TIME >= v_availability.start_time::TIME AND v_shift_end_time::TIME <= v_availability.end_time::TIME) THEN
          -- Shift is not fully contained within available window (inclusive, cast to TIME)
          RETURN QUERY SELECT true, 'recurring'::TEXT,
            'Shift on ' || v_current_date::TEXT || ' is outside employee availability (' || 
            v_availability.start_time::TEXT || ' - ' || v_availability.end_time::TEXT || ')';
          RETURN;
        END IF;
      END LOOP;
      
      -- If no availability is set for this day of week, don't flag as conflict
      -- (This allows scheduling when no availability preferences are set)
    END IF;
    
    -- Move to next date
    v_current_date := v_current_date + INTERVAL '1 day';
  END LOOP;

  -- No conflicts found
  RETURN;
END;
$$ LANGUAGE plpgsql STABLE;

COMMENT ON FUNCTION check_availability_conflict IS 'Checks if a shift conflicts with employee availability preferences or exceptions. Handles multi-day shifts by checking each date separately.';
