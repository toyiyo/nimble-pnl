-- Add user_id to employees table to link with auth.users
ALTER TABLE employees ADD COLUMN IF NOT EXISTS user_id UUID REFERENCES auth.users(id);
CREATE INDEX IF NOT EXISTS idx_employees_user_id ON employees(user_id);

-- Create time_punches table for clock in/out tracking
CREATE TABLE IF NOT EXISTS time_punches (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  restaurant_id UUID NOT NULL REFERENCES restaurants(id) ON DELETE CASCADE,
  employee_id UUID NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
  shift_id UUID REFERENCES shifts(id) ON DELETE SET NULL, -- optional link to scheduled shift
  punch_type TEXT NOT NULL CHECK (punch_type IN ('clock_in', 'clock_out', 'break_start', 'break_end')),
  punch_time TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
  location JSONB, -- GPS coordinates if needed: { "latitude": 0.0, "longitude": 0.0 }
  device_info TEXT, -- Device identifier or IP address
  notes TEXT,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  created_by UUID REFERENCES auth.users(id), -- Who created this punch (employee or manager)
  modified_by UUID REFERENCES auth.users(id) -- Who last modified (for manager corrections)
);

-- Create employee_tips table for tip tracking
CREATE TABLE IF NOT EXISTS employee_tips (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  restaurant_id UUID NOT NULL REFERENCES restaurants(id) ON DELETE CASCADE,
  employee_id UUID NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
  shift_id UUID REFERENCES shifts(id) ON DELETE SET NULL,
  tip_amount INTEGER NOT NULL DEFAULT 0, -- Stored in cents
  tip_source TEXT NOT NULL CHECK (tip_source IN ('cash', 'credit', 'pool', 'other')),
  recorded_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
  notes TEXT,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  created_by UUID REFERENCES auth.users(id)
);

-- Create indexes for better query performance
CREATE INDEX IF NOT EXISTS idx_time_punches_restaurant_id ON time_punches(restaurant_id);
CREATE INDEX IF NOT EXISTS idx_time_punches_employee_id ON time_punches(employee_id);
CREATE INDEX IF NOT EXISTS idx_time_punches_shift_id ON time_punches(shift_id);
CREATE INDEX IF NOT EXISTS idx_time_punches_punch_time ON time_punches(punch_time);
CREATE INDEX IF NOT EXISTS idx_time_punches_punch_type ON time_punches(punch_type);

CREATE INDEX IF NOT EXISTS idx_employee_tips_restaurant_id ON employee_tips(restaurant_id);
CREATE INDEX IF NOT EXISTS idx_employee_tips_employee_id ON employee_tips(employee_id);
CREATE INDEX IF NOT EXISTS idx_employee_tips_shift_id ON employee_tips(shift_id);
CREATE INDEX IF NOT EXISTS idx_employee_tips_recorded_at ON employee_tips(recorded_at);

-- Enable Row Level Security
ALTER TABLE time_punches ENABLE ROW LEVEL SECURITY;
ALTER TABLE employee_tips ENABLE ROW LEVEL SECURITY;

-- RLS Policies for time_punches table

-- Managers and owners can view all punches for their restaurants
CREATE POLICY "Managers can view all time punches for their restaurants"
  ON time_punches FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM user_restaurants
      WHERE user_restaurants.restaurant_id = time_punches.restaurant_id
      AND user_restaurants.user_id = auth.uid()
      AND user_restaurants.role IN ('owner', 'manager')
    )
  );

-- Employees can view their own punches
CREATE POLICY "Employees can view own time punches"
  ON time_punches FOR SELECT
  USING (
    employee_id IN (
      SELECT id FROM employees WHERE user_id = auth.uid()
    )
  );

-- Employees can create their own punches
CREATE POLICY "Employees can create own time punches"
  ON time_punches FOR INSERT
  WITH CHECK (
    employee_id IN (
      SELECT id FROM employees WHERE user_id = auth.uid()
    )
  );

-- Managers and owners can create punches for any employee
CREATE POLICY "Managers can create time punches for employees"
  ON time_punches FOR INSERT
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM user_restaurants
      WHERE user_restaurants.restaurant_id = time_punches.restaurant_id
      AND user_restaurants.user_id = auth.uid()
      AND user_restaurants.role IN ('owner', 'manager')
    )
  );

-- Employees can update their own recent punches (within 24 hours)
CREATE POLICY "Employees can update own recent punches"
  ON time_punches FOR UPDATE
  USING (
    employee_id IN (
      SELECT id FROM employees WHERE user_id = auth.uid()
    )
    AND punch_time > NOW() - INTERVAL '24 hours'
  );

-- Managers and owners can update any punch
CREATE POLICY "Managers can update time punches"
  ON time_punches FOR UPDATE
  USING (
    EXISTS (
      SELECT 1 FROM user_restaurants
      WHERE user_restaurants.restaurant_id = time_punches.restaurant_id
      AND user_restaurants.user_id = auth.uid()
      AND user_restaurants.role IN ('owner', 'manager')
    )
  );

-- Only managers and owners can delete punches
CREATE POLICY "Managers can delete time punches"
  ON time_punches FOR DELETE
  USING (
    EXISTS (
      SELECT 1 FROM user_restaurants
      WHERE user_restaurants.restaurant_id = time_punches.restaurant_id
      AND user_restaurants.user_id = auth.uid()
      AND user_restaurants.role IN ('owner', 'manager')
    )
  );

-- RLS Policies for employee_tips table

-- Managers and owners can view all tips for their restaurants
CREATE POLICY "Managers can view all employee tips for their restaurants"
  ON employee_tips FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM user_restaurants
      WHERE user_restaurants.restaurant_id = employee_tips.restaurant_id
      AND user_restaurants.user_id = auth.uid()
      AND user_restaurants.role IN ('owner', 'manager')
    )
  );

-- Employees can view their own tips
CREATE POLICY "Employees can view own tips"
  ON employee_tips FOR SELECT
  USING (
    employee_id IN (
      SELECT id FROM employees WHERE user_id = auth.uid()
    )
  );

-- Employees can create their own tip records
CREATE POLICY "Employees can create own tips"
  ON employee_tips FOR INSERT
  WITH CHECK (
    employee_id IN (
      SELECT id FROM employees WHERE user_id = auth.uid()
    )
  );

-- Managers and owners can create tips for any employee
CREATE POLICY "Managers can create employee tips"
  ON employee_tips FOR INSERT
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM user_restaurants
      WHERE user_restaurants.restaurant_id = employee_tips.restaurant_id
      AND user_restaurants.user_id = auth.uid()
      AND user_restaurants.role IN ('owner', 'manager')
    )
  );

-- Managers and owners can update any tip record
CREATE POLICY "Managers can update employee tips"
  ON employee_tips FOR UPDATE
  USING (
    EXISTS (
      SELECT 1 FROM user_restaurants
      WHERE user_restaurants.restaurant_id = employee_tips.restaurant_id
      AND user_restaurants.user_id = auth.uid()
      AND user_restaurants.role IN ('owner', 'manager')
    )
  );

-- Only managers and owners can delete tip records
CREATE POLICY "Managers can delete employee tips"
  ON employee_tips FOR DELETE
  USING (
    EXISTS (
      SELECT 1 FROM user_restaurants
      WHERE user_restaurants.restaurant_id = employee_tips.restaurant_id
      AND user_restaurants.user_id = auth.uid()
      AND user_restaurants.role IN ('owner', 'manager')
    )
  );

-- Create function to update updated_at timestamp
CREATE OR REPLACE FUNCTION update_time_tracking_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Create triggers for updated_at
CREATE TRIGGER update_time_punches_updated_at
  BEFORE UPDATE ON time_punches
  FOR EACH ROW
  EXECUTE FUNCTION update_time_tracking_updated_at();

CREATE TRIGGER update_employee_tips_updated_at
  BEFORE UPDATE ON employee_tips
  FOR EACH ROW
  EXECUTE FUNCTION update_time_tracking_updated_at();

-- Create helper function to get current punch status for an employee
CREATE OR REPLACE FUNCTION get_employee_punch_status(p_employee_id UUID)
RETURNS TABLE (
  is_clocked_in BOOLEAN,
  last_punch_time TIMESTAMP WITH TIME ZONE,
  last_punch_type TEXT,
  on_break BOOLEAN
) AS $$
BEGIN
  RETURN QUERY
  WITH latest_punch AS (
    SELECT 
      punch_type,
      punch_time,
      ROW_NUMBER() OVER (ORDER BY punch_time DESC) as rn
    FROM time_punches
    WHERE employee_id = p_employee_id
  )
  SELECT 
    CASE 
      WHEN lp.punch_type IN ('clock_in', 'break_end') THEN true
      ELSE false
    END as is_clocked_in,
    lp.punch_time as last_punch_time,
    lp.punch_type as last_punch_type,
    CASE 
      WHEN lp.punch_type = 'break_start' THEN true
      ELSE false
    END as on_break
  FROM latest_punch lp
  WHERE lp.rn = 1;
END;
$$ LANGUAGE plpgsql;

-- Create helper function to calculate worked hours for a date range
CREATE OR REPLACE FUNCTION calculate_worked_hours(
  p_employee_id UUID,
  p_start_date TIMESTAMP WITH TIME ZONE,
  p_end_date TIMESTAMP WITH TIME ZONE
)
RETURNS TABLE (
  total_hours NUMERIC,
  regular_hours NUMERIC,
  break_hours NUMERIC
) AS $$
BEGIN
  RETURN QUERY
  WITH punch_pairs AS (
    SELECT 
      punch_time as start_time,
      LEAD(punch_time) OVER (ORDER BY punch_time) as end_time,
      punch_type as start_type,
      LEAD(punch_type) OVER (ORDER BY punch_time) as end_type
    FROM time_punches
    WHERE employee_id = p_employee_id
      AND punch_time BETWEEN p_start_date AND p_end_date
  ),
  work_periods AS (
    SELECT 
      start_time,
      end_time,
      CASE 
        WHEN start_type = 'clock_in' AND end_type IN ('clock_out', 'break_start') 
          THEN EXTRACT(EPOCH FROM (end_time - start_time)) / 3600.0
        WHEN start_type = 'break_end' AND end_type IN ('clock_out', 'break_start')
          THEN EXTRACT(EPOCH FROM (end_time - start_time)) / 3600.0
        ELSE 0
      END as work_hours,
      CASE 
        WHEN start_type = 'break_start' AND end_type = 'break_end'
          THEN EXTRACT(EPOCH FROM (end_time - start_time)) / 3600.0
        ELSE 0
      END as break_hours
    FROM punch_pairs
    WHERE end_time IS NOT NULL
  )
  SELECT 
    COALESCE(SUM(work_hours), 0)::NUMERIC as total_hours,
    COALESCE(SUM(work_hours), 0)::NUMERIC as regular_hours,
    COALESCE(SUM(break_hours), 0)::NUMERIC as break_hours
  FROM work_periods;
END;
$$ LANGUAGE plpgsql;
