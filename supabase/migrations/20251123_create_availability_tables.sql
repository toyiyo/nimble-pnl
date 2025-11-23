-- Create employee_availability table for recurring weekly preferences
CREATE TABLE IF NOT EXISTS employee_availability (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  restaurant_id UUID NOT NULL REFERENCES restaurants(id) ON DELETE CASCADE,
  employee_id UUID NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
  day_of_week INTEGER NOT NULL, -- 0 = Sunday, 6 = Saturday
  start_time TIME NOT NULL,
  end_time TIME NOT NULL,
  is_available BOOLEAN NOT NULL DEFAULT true,
  notes TEXT,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  CONSTRAINT valid_day_of_week CHECK (day_of_week >= 0 AND day_of_week <= 6),
  CONSTRAINT valid_time CHECK (end_time > start_time)
);

-- Create availability_exceptions table for one-time changes
CREATE TABLE IF NOT EXISTS availability_exceptions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  restaurant_id UUID NOT NULL REFERENCES restaurants(id) ON DELETE CASCADE,
  employee_id UUID NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
  date DATE NOT NULL,
  start_time TIME,
  end_time TIME,
  is_available BOOLEAN NOT NULL DEFAULT false, -- Default to unavailable for exceptions
  reason TEXT,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  CONSTRAINT valid_exception_time CHECK (
    (start_time IS NULL AND end_time IS NULL) OR 
    (start_time IS NOT NULL AND end_time IS NOT NULL AND end_time > start_time)
  )
);

-- Create indexes for better query performance
CREATE INDEX IF NOT EXISTS idx_employee_availability_restaurant_id ON employee_availability(restaurant_id);
CREATE INDEX IF NOT EXISTS idx_employee_availability_employee_id ON employee_availability(employee_id);
CREATE INDEX IF NOT EXISTS idx_employee_availability_day_of_week ON employee_availability(day_of_week);
CREATE INDEX IF NOT EXISTS idx_availability_exceptions_restaurant_id ON availability_exceptions(restaurant_id);
CREATE INDEX IF NOT EXISTS idx_availability_exceptions_employee_id ON availability_exceptions(employee_id);
CREATE INDEX IF NOT EXISTS idx_availability_exceptions_date ON availability_exceptions(date);

-- Enable Row Level Security
ALTER TABLE employee_availability ENABLE ROW LEVEL SECURITY;
ALTER TABLE availability_exceptions ENABLE ROW LEVEL SECURITY;

-- Helper to check whether the current user can access a restaurant
CREATE OR REPLACE FUNCTION user_has_restaurant_access(
  p_restaurant_id UUID,
  p_require_manager_role BOOLEAN DEFAULT false
)
RETURNS BOOLEAN AS $$
BEGIN
  RETURN EXISTS (
    SELECT 1 FROM user_restaurants
    WHERE user_restaurants.restaurant_id = p_restaurant_id
      AND user_restaurants.user_id = auth.uid()
      AND (
        NOT p_require_manager_role
        OR user_restaurants.role IN ('owner', 'manager')
      )
  );
END;
$$ LANGUAGE plpgsql STABLE SECURITY DEFINER;

-- RLS Policies for employee_availability table
CREATE POLICY "Users can view availability for their restaurants"
  ON employee_availability FOR SELECT
  USING (
    user_has_restaurant_access(employee_availability.restaurant_id)
  );

CREATE POLICY "Users can create availability for their restaurants"
  ON employee_availability FOR INSERT
  WITH CHECK (
    user_has_restaurant_access(employee_availability.restaurant_id, true)
  );

CREATE POLICY "Users can update availability for their restaurants"
  ON employee_availability FOR UPDATE
  USING (
    user_has_restaurant_access(employee_availability.restaurant_id, true)
  );

CREATE POLICY "Users can delete availability for their restaurants"
  ON employee_availability FOR DELETE
  USING (
    user_has_restaurant_access(employee_availability.restaurant_id, true)
  );

-- RLS Policies for availability_exceptions table
CREATE POLICY "Users can view availability exceptions for their restaurants"
  ON availability_exceptions FOR SELECT
  USING (
    user_has_restaurant_access(availability_exceptions.restaurant_id)
  );

CREATE POLICY "Users can create availability exceptions for their restaurants"
  ON availability_exceptions FOR INSERT
  WITH CHECK (
    user_has_restaurant_access(availability_exceptions.restaurant_id, true)
  );

CREATE POLICY "Users can update availability exceptions for their restaurants"
  ON availability_exceptions FOR UPDATE
  USING (
    user_has_restaurant_access(availability_exceptions.restaurant_id, true)
  );

CREATE POLICY "Users can delete availability exceptions for their restaurants"
  ON availability_exceptions FOR DELETE
  USING (
    user_has_restaurant_access(availability_exceptions.restaurant_id, true)
  );

-- Create triggers for updated_at
CREATE TRIGGER update_employee_availability_updated_at
  BEFORE UPDATE ON employee_availability
  FOR EACH ROW
  EXECUTE FUNCTION update_scheduling_updated_at();

CREATE TRIGGER update_availability_exceptions_updated_at
  BEFORE UPDATE ON availability_exceptions
  FOR EACH ROW
  EXECUTE FUNCTION update_scheduling_updated_at();

-- Create function to check for scheduling conflicts with time-off
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
) AS $$
BEGIN
  RETURN QUERY
  SELECT 
    true as has_conflict,
    tor.id as time_off_id,
    tor.start_date,
    tor.end_date,
    tor.status
  FROM time_off_requests tor
  WHERE tor.employee_id = p_employee_id
    AND tor.status IN ('approved', 'pending')
    AND (
      (DATE(p_start_time AT TIME ZONE 'UTC') BETWEEN tor.start_date AND tor.end_date)
      OR (DATE(p_end_time AT TIME ZONE 'UTC') BETWEEN tor.start_date AND tor.end_date)
      OR (tor.start_date BETWEEN DATE(p_start_time AT TIME ZONE 'UTC') AND DATE(p_end_time AT TIME ZONE 'UTC'))
    );
END;
$$ LANGUAGE plpgsql STABLE;

-- Create function to check availability conflicts
CREATE OR REPLACE FUNCTION check_availability_conflict(
  p_employee_id UUID,
  p_restaurant_id UUID,
  p_start_time TIMESTAMP WITH TIME ZONE,
  p_end_time TIMESTAMP WITH TIME ZONE
)
RETURNS TABLE (
  has_conflict BOOLEAN,
  conflict_type TEXT, -- 'recurring' or 'exception'
  message TEXT
) AS $$
DECLARE
  v_day_of_week INTEGER;
  v_date DATE;
  v_start_time TIME;
  v_end_time TIME;
  v_exception RECORD;
  v_availability RECORD;
BEGIN
  -- Extract date and time components
  v_date := DATE(p_start_time AT TIME ZONE 'UTC');
  v_day_of_week := EXTRACT(DOW FROM p_start_time);
  v_start_time := (p_start_time AT TIME ZONE 'UTC')::TIME;
  v_end_time := (p_end_time AT TIME ZONE 'UTC')::TIME;

  -- First check for exception on this specific date
  SELECT * INTO v_exception
  FROM availability_exceptions
  WHERE employee_id = p_employee_id
    AND restaurant_id = p_restaurant_id
    AND date = v_date
  LIMIT 1;

  IF FOUND THEN
    -- Exception exists for this date
    IF NOT v_exception.is_available THEN
      -- Employee marked as unavailable for entire day
      RETURN QUERY SELECT true, 'exception'::TEXT, 
        'Employee has marked themselves as unavailable on ' || v_date::TEXT;
      RETURN;
    ELSIF v_exception.start_time IS NOT NULL THEN
      -- Check if shift is fully contained within exception availability window
      IF v_start_time >= v_exception.start_time AND v_end_time <= v_exception.end_time THEN
        -- Shift is fully within available window, no conflict
        RETURN;
      ELSE
        RETURN QUERY SELECT true, 'exception'::TEXT,
          'Shift is outside employee availability window for ' || v_date::TEXT;
        RETURN;
      END IF;
    END IF;
  END IF;

  -- Check recurring availability for this day of week
  FOR v_availability IN
    SELECT * FROM employee_availability
    WHERE employee_id = p_employee_id
      AND restaurant_id = p_restaurant_id
      AND day_of_week = v_day_of_week
  LOOP
    IF NOT v_availability.is_available THEN
      -- Employee marked as unavailable for this day of week
      RETURN QUERY SELECT true, 'recurring'::TEXT,
        'Employee is typically unavailable on this day of the week';
      RETURN;
    ELSIF NOT (v_start_time >= v_availability.start_time AND v_end_time <= v_availability.end_time) THEN
      -- Shift is not fully contained within available window
      RETURN QUERY SELECT true, 'recurring'::TEXT,
        'Shift is outside employee typical availability (' || 
        v_availability.start_time::TEXT || ' - ' || v_availability.end_time::TEXT || ')';
      RETURN;
    END IF;
  END LOOP;

  -- No conflicts found
  RETURN;
END;
$$ LANGUAGE plpgsql STABLE;

-- Add comments for documentation
COMMENT ON TABLE employee_availability IS 'Stores recurring weekly availability preferences for employees';
COMMENT ON TABLE availability_exceptions IS 'Stores one-time availability changes or special dates for employees';
COMMENT ON FUNCTION check_timeoff_conflict IS 'Checks if a shift conflicts with approved or pending time-off requests';
COMMENT ON FUNCTION check_availability_conflict IS 'Checks if a shift conflicts with employee availability preferences';
