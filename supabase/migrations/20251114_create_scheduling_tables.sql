-- Create employees table for staff management
CREATE TABLE IF NOT EXISTS employees (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  restaurant_id UUID NOT NULL REFERENCES restaurants(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  email TEXT,
  phone TEXT,
  position TEXT NOT NULL, -- e.g., 'Server', 'Cook', 'Manager', 'Bartender'
  hourly_rate INTEGER NOT NULL DEFAULT 0, -- Stored in cents
  status TEXT NOT NULL DEFAULT 'active', -- 'active', 'inactive', 'terminated'
  hire_date DATE,
  notes TEXT,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Create shifts table for scheduling
CREATE TABLE IF NOT EXISTS shifts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  restaurant_id UUID NOT NULL REFERENCES restaurants(id) ON DELETE CASCADE,
  employee_id UUID NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
  start_time TIMESTAMP WITH TIME ZONE NOT NULL,
  end_time TIMESTAMP WITH TIME ZONE NOT NULL,
  break_duration INTEGER DEFAULT 0, -- Break duration in minutes
  position TEXT NOT NULL, -- Position for this specific shift
  notes TEXT,
  status TEXT NOT NULL DEFAULT 'scheduled', -- 'scheduled', 'confirmed', 'completed', 'cancelled'
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  CONSTRAINT valid_shift_time CHECK (end_time > start_time)
);

-- Create shift_templates table for recurring schedules
CREATE TABLE IF NOT EXISTS shift_templates (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  restaurant_id UUID NOT NULL REFERENCES restaurants(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  day_of_week INTEGER NOT NULL, -- 0 = Sunday, 6 = Saturday
  start_time TIME NOT NULL,
  end_time TIME NOT NULL,
  break_duration INTEGER NOT NULL DEFAULT 0,
  position TEXT NOT NULL,
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  CONSTRAINT valid_day_of_week CHECK (day_of_week >= 0 AND day_of_week <= 6)
);

-- Create time_off_requests table
CREATE TABLE IF NOT EXISTS time_off_requests (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  restaurant_id UUID NOT NULL REFERENCES restaurants(id) ON DELETE CASCADE,
  employee_id UUID NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
  start_date DATE NOT NULL,
  end_date DATE NOT NULL,
  reason TEXT,
  status TEXT NOT NULL DEFAULT 'pending', -- 'pending', 'approved', 'rejected'
  requested_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  reviewed_at TIMESTAMP WITH TIME ZONE,
  reviewed_by UUID REFERENCES auth.users(id),
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  CONSTRAINT valid_time_off_dates CHECK (end_date >= start_date)
);

-- Create indexes for better query performance
CREATE INDEX IF NOT EXISTS idx_employees_restaurant_id ON employees(restaurant_id);
CREATE INDEX IF NOT EXISTS idx_employees_status ON employees(status);
CREATE INDEX IF NOT EXISTS idx_shifts_restaurant_id ON shifts(restaurant_id);
CREATE INDEX IF NOT EXISTS idx_shifts_employee_id ON shifts(employee_id);
CREATE INDEX IF NOT EXISTS idx_shifts_start_time ON shifts(start_time);
CREATE INDEX IF NOT EXISTS idx_shifts_status ON shifts(status);
CREATE INDEX IF NOT EXISTS idx_shift_templates_restaurant_id ON shift_templates(restaurant_id);
CREATE INDEX IF NOT EXISTS idx_shift_templates_day_of_week ON shift_templates(day_of_week);
CREATE INDEX IF NOT EXISTS idx_time_off_requests_restaurant_id ON time_off_requests(restaurant_id);
CREATE INDEX IF NOT EXISTS idx_time_off_requests_employee_id ON time_off_requests(employee_id);
CREATE INDEX IF NOT EXISTS idx_time_off_requests_status ON time_off_requests(status);

-- Enable Row Level Security
ALTER TABLE employees ENABLE ROW LEVEL SECURITY;
ALTER TABLE shifts ENABLE ROW LEVEL SECURITY;
ALTER TABLE shift_templates ENABLE ROW LEVEL SECURITY;
ALTER TABLE time_off_requests ENABLE ROW LEVEL SECURITY;

-- RLS Policies for employees table
CREATE POLICY "Users can view employees for their restaurants"
  ON employees FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM user_restaurants
      WHERE user_restaurants.restaurant_id = employees.restaurant_id
      AND user_restaurants.user_id = auth.uid()
    )
  );

CREATE POLICY "Users can create employees for their restaurants"
  ON employees FOR INSERT
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM user_restaurants
      WHERE user_restaurants.restaurant_id = employees.restaurant_id
      AND user_restaurants.user_id = auth.uid()
      AND user_restaurants.role IN ('owner', 'manager')
    )
  );

CREATE POLICY "Users can update employees for their restaurants"
  ON employees FOR UPDATE
  USING (
    EXISTS (
      SELECT 1 FROM user_restaurants
      WHERE user_restaurants.restaurant_id = employees.restaurant_id
      AND user_restaurants.user_id = auth.uid()
      AND user_restaurants.role IN ('owner', 'manager')
    )
  );

CREATE POLICY "Users can delete employees for their restaurants"
  ON employees FOR DELETE
  USING (
    EXISTS (
      SELECT 1 FROM user_restaurants
      WHERE user_restaurants.restaurant_id = employees.restaurant_id
      AND user_restaurants.user_id = auth.uid()
      AND user_restaurants.role = 'owner'
    )
  );

-- RLS Policies for shifts table
CREATE POLICY "Users can view shifts for their restaurants"
  ON shifts FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM user_restaurants
      WHERE user_restaurants.restaurant_id = shifts.restaurant_id
      AND user_restaurants.user_id = auth.uid()
    )
  );

CREATE POLICY "Users can create shifts for their restaurants"
  ON shifts FOR INSERT
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM user_restaurants
      WHERE user_restaurants.restaurant_id = shifts.restaurant_id
      AND user_restaurants.user_id = auth.uid()
      AND user_restaurants.role IN ('owner', 'manager')
    )
  );

CREATE POLICY "Users can update shifts for their restaurants"
  ON shifts FOR UPDATE
  USING (
    EXISTS (
      SELECT 1 FROM user_restaurants
      WHERE user_restaurants.restaurant_id = shifts.restaurant_id
      AND user_restaurants.user_id = auth.uid()
      AND user_restaurants.role IN ('owner', 'manager')
    )
  );

CREATE POLICY "Users can delete shifts for their restaurants"
  ON shifts FOR DELETE
  USING (
    EXISTS (
      SELECT 1 FROM user_restaurants
      WHERE user_restaurants.restaurant_id = shifts.restaurant_id
      AND user_restaurants.user_id = auth.uid()
      AND user_restaurants.role IN ('owner', 'manager')
    )
  );

-- RLS Policies for shift_templates table
CREATE POLICY "Users can view shift templates for their restaurants"
  ON shift_templates FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM user_restaurants
      WHERE user_restaurants.restaurant_id = shift_templates.restaurant_id
      AND user_restaurants.user_id = auth.uid()
    )
  );

CREATE POLICY "Users can create shift templates for their restaurants"
  ON shift_templates FOR INSERT
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM user_restaurants
      WHERE user_restaurants.restaurant_id = shift_templates.restaurant_id
      AND user_restaurants.user_id = auth.uid()
      AND user_restaurants.role IN ('owner', 'manager')
    )
  );

CREATE POLICY "Users can update shift templates for their restaurants"
  ON shift_templates FOR UPDATE
  USING (
    EXISTS (
      SELECT 1 FROM user_restaurants
      WHERE user_restaurants.restaurant_id = shift_templates.restaurant_id
      AND user_restaurants.user_id = auth.uid()
      AND user_restaurants.role IN ('owner', 'manager')
    )
  );

CREATE POLICY "Users can delete shift templates for their restaurants"
  ON shift_templates FOR DELETE
  USING (
    EXISTS (
      SELECT 1 FROM user_restaurants
      WHERE user_restaurants.restaurant_id = shift_templates.restaurant_id
      AND user_restaurants.user_id = auth.uid()
      AND user_restaurants.role IN ('owner', 'manager')
    )
  );

-- RLS Policies for time_off_requests table
CREATE POLICY "Users can view time off requests for their restaurants"
  ON time_off_requests FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM user_restaurants
      WHERE user_restaurants.restaurant_id = time_off_requests.restaurant_id
      AND user_restaurants.user_id = auth.uid()
    )
  );

CREATE POLICY "Users can create time off requests for their restaurants"
  ON time_off_requests FOR INSERT
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM user_restaurants
      WHERE user_restaurants.restaurant_id = time_off_requests.restaurant_id
      AND user_restaurants.user_id = auth.uid()
      AND user_restaurants.role IN ('owner', 'manager')
    )
  );

CREATE POLICY "Users can update time off requests for their restaurants"
  ON time_off_requests FOR UPDATE
  USING (
    EXISTS (
      SELECT 1 FROM user_restaurants
      WHERE user_restaurants.restaurant_id = time_off_requests.restaurant_id
      AND user_restaurants.user_id = auth.uid()
      AND user_restaurants.role IN ('owner', 'manager')
    )
  );

CREATE POLICY "Users can delete time off requests for their restaurants"
  ON time_off_requests FOR DELETE
  USING (
    EXISTS (
      SELECT 1 FROM user_restaurants
      WHERE user_restaurants.restaurant_id = time_off_requests.restaurant_id
      AND user_restaurants.user_id = auth.uid()
      AND user_restaurants.role IN ('owner', 'manager')
    )
  );

-- Create function to update updated_at timestamp
CREATE OR REPLACE FUNCTION update_scheduling_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Create triggers for updated_at
CREATE TRIGGER update_employees_updated_at
  BEFORE UPDATE ON employees
  FOR EACH ROW
  EXECUTE FUNCTION update_scheduling_updated_at();

CREATE TRIGGER update_shifts_updated_at
  BEFORE UPDATE ON shifts
  FOR EACH ROW
  EXECUTE FUNCTION update_scheduling_updated_at();

CREATE TRIGGER update_shift_templates_updated_at
  BEFORE UPDATE ON shift_templates
  FOR EACH ROW
  EXECUTE FUNCTION update_scheduling_updated_at();

CREATE TRIGGER update_time_off_requests_updated_at
  BEFORE UPDATE ON time_off_requests
  FOR EACH ROW
  EXECUTE FUNCTION update_scheduling_updated_at();
