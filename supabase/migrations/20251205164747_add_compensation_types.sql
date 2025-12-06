-- Migration: Add compensation types to employees table
-- Supports hourly, salary, and contractor payment structures

-- Add compensation type and related fields to employees table
ALTER TABLE employees
  ADD COLUMN IF NOT EXISTS compensation_type TEXT NOT NULL DEFAULT 'hourly'
    CHECK (compensation_type IN ('hourly', 'salary', 'contractor')),
  ADD COLUMN IF NOT EXISTS salary_amount INTEGER DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS pay_period_type TEXT DEFAULT NULL
    CHECK (pay_period_type IS NULL OR pay_period_type IN ('weekly', 'bi-weekly', 'semi-monthly', 'monthly')),
  ADD COLUMN IF NOT EXISTS contractor_payment_amount INTEGER DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS contractor_payment_interval TEXT DEFAULT NULL
    CHECK (contractor_payment_interval IS NULL OR contractor_payment_interval IN ('weekly', 'bi-weekly', 'monthly', 'per-job')),
  ADD COLUMN IF NOT EXISTS allocate_daily BOOLEAN DEFAULT TRUE,
  ADD COLUMN IF NOT EXISTS tip_eligible BOOLEAN DEFAULT TRUE,
  ADD COLUMN IF NOT EXISTS requires_time_punch BOOLEAN DEFAULT TRUE;

-- Add comments for documentation
COMMENT ON COLUMN employees.compensation_type IS 
  'hourly: wages from time punches, salary: fixed periodic amount, contractor: fixed payment';
COMMENT ON COLUMN employees.salary_amount IS 
  'For salary employees: amount per pay period in cents';
COMMENT ON COLUMN employees.pay_period_type IS 
  'For salary employees: weekly, bi-weekly, semi-monthly, or monthly';
COMMENT ON COLUMN employees.contractor_payment_amount IS 
  'For contractors: payment amount per interval in cents';
COMMENT ON COLUMN employees.contractor_payment_interval IS 
  'For contractors: weekly, bi-weekly, monthly, or per-job';
COMMENT ON COLUMN employees.allocate_daily IS 
  'If true, salary/contractor costs are distributed daily for P&L calculations';
COMMENT ON COLUMN employees.tip_eligible IS 
  'Whether employee can receive tips';
COMMENT ON COLUMN employees.requires_time_punch IS 
  'Whether employee must clock in/out (typically false for salary/contractor)';

-- Create daily_labor_allocations table for salary/contractor daily cost distribution
CREATE TABLE IF NOT EXISTS daily_labor_allocations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  restaurant_id UUID NOT NULL REFERENCES restaurants(id) ON DELETE CASCADE,
  employee_id UUID NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
  date DATE NOT NULL,
  allocated_cost INTEGER NOT NULL DEFAULT 0, -- In cents
  compensation_type TEXT NOT NULL CHECK (compensation_type IN ('salary', 'contractor')),
  source TEXT DEFAULT 'auto' CHECK (source IN ('auto', 'manual', 'per-job')),
  notes TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  
  CONSTRAINT unique_employee_allocation_date UNIQUE (employee_id, date)
);

-- Create indexes for efficient queries
CREATE INDEX IF NOT EXISTS idx_daily_labor_allocations_restaurant_date 
  ON daily_labor_allocations(restaurant_id, date);
CREATE INDEX IF NOT EXISTS idx_daily_labor_allocations_employee 
  ON daily_labor_allocations(employee_id);
CREATE INDEX IF NOT EXISTS idx_daily_labor_allocations_date 
  ON daily_labor_allocations(date);

-- Enable Row Level Security
ALTER TABLE daily_labor_allocations ENABLE ROW LEVEL SECURITY;

-- RLS Policies for daily_labor_allocations
CREATE POLICY "Users can view allocations for their restaurants"
  ON daily_labor_allocations FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM user_restaurants
      WHERE user_restaurants.restaurant_id = daily_labor_allocations.restaurant_id
      AND user_restaurants.user_id = auth.uid()
    )
  );

CREATE POLICY "Users can insert allocations for their restaurants"
  ON daily_labor_allocations FOR INSERT
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM user_restaurants
      WHERE user_restaurants.restaurant_id = daily_labor_allocations.restaurant_id
      AND user_restaurants.user_id = auth.uid()
      AND user_restaurants.role IN ('owner', 'manager')
    )
  );

CREATE POLICY "Users can update allocations for their restaurants"
  ON daily_labor_allocations FOR UPDATE
  USING (
    EXISTS (
      SELECT 1 FROM user_restaurants
      WHERE user_restaurants.restaurant_id = daily_labor_allocations.restaurant_id
      AND user_restaurants.user_id = auth.uid()
      AND user_restaurants.role IN ('owner', 'manager')
    )
  );

CREATE POLICY "Users can delete allocations for their restaurants"
  ON daily_labor_allocations FOR DELETE
  USING (
    EXISTS (
      SELECT 1 FROM user_restaurants
      WHERE user_restaurants.restaurant_id = daily_labor_allocations.restaurant_id
      AND user_restaurants.user_id = auth.uid()
      AND user_restaurants.role IN ('owner', 'manager')
    )
  );

-- Function to generate daily labor allocations for salary/contractor employees
CREATE OR REPLACE FUNCTION generate_daily_labor_allocations(
  p_restaurant_id UUID,
  p_start_date DATE,
  p_end_date DATE
) RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_employee RECORD;
  v_date DATE;
  v_daily_amount INTEGER;
  v_days_in_period INTEGER;
  v_count INTEGER := 0;
BEGIN
  -- Process each active salary/contractor employee
  FOR v_employee IN 
    SELECT * FROM employees 
    WHERE restaurant_id = p_restaurant_id 
    AND status = 'active'
    AND compensation_type IN ('salary', 'contractor')
    AND allocate_daily = true
  LOOP
    -- Calculate days in pay period
    v_days_in_period := CASE 
      WHEN v_employee.compensation_type = 'salary' THEN
        CASE v_employee.pay_period_type
          WHEN 'weekly' THEN 7
          WHEN 'bi-weekly' THEN 14
          WHEN 'semi-monthly' THEN 15
          WHEN 'monthly' THEN 30
          ELSE 30
        END
      ELSE -- contractor
        CASE v_employee.contractor_payment_interval
          WHEN 'weekly' THEN 7
          WHEN 'bi-weekly' THEN 14
          WHEN 'monthly' THEN 30
          ELSE 30
        END
    END;
    
    -- Calculate daily amount
    IF v_employee.compensation_type = 'salary' THEN
      v_daily_amount := COALESCE(v_employee.salary_amount, 0) / v_days_in_period;
    ELSE
      -- Skip per-job contractors (they need manual allocation)
      IF v_employee.contractor_payment_interval = 'per-job' THEN
        CONTINUE;
      END IF;
      v_daily_amount := COALESCE(v_employee.contractor_payment_amount, 0) / v_days_in_period;
    END IF;
    
    -- Skip if no amount to allocate
    IF v_daily_amount <= 0 THEN
      CONTINUE;
    END IF;
    
    -- Generate allocation for each day in the range
    v_date := p_start_date;
    WHILE v_date <= p_end_date LOOP
      INSERT INTO daily_labor_allocations (
        restaurant_id, 
        employee_id, 
        date, 
        allocated_cost, 
        compensation_type, 
        source
      ) VALUES (
        p_restaurant_id, 
        v_employee.id, 
        v_date, 
        v_daily_amount, 
        v_employee.compensation_type, 
        'auto'
      )
      ON CONFLICT (employee_id, date) DO UPDATE SET
        allocated_cost = EXCLUDED.allocated_cost,
        compensation_type = EXCLUDED.compensation_type,
        updated_at = NOW();
      
      v_count := v_count + 1;
      v_date := v_date + 1;
    END LOOP;
  END LOOP;
  
  RETURN v_count;
END;
$$;

-- Function to get aggregated daily labor costs including allocations
CREATE OR REPLACE FUNCTION get_daily_labor_summary(
  p_restaurant_id UUID,
  p_date DATE
) RETURNS TABLE (
  hourly_labor INTEGER,
  salary_labor INTEGER,
  contractor_labor INTEGER,
  total_labor INTEGER,
  total_hours NUMERIC
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  RETURN QUERY
  SELECT
    -- Hourly labor from daily_labor_costs
    COALESCE((
      SELECT (dlc.hourly_wages * 100)::INTEGER
      FROM daily_labor_costs dlc
      WHERE dlc.restaurant_id = p_restaurant_id
      AND dlc.date = p_date
    ), 0) AS hourly_labor,
    
    -- Salary allocations
    COALESCE((
      SELECT SUM(dla.allocated_cost)::INTEGER
      FROM daily_labor_allocations dla
      WHERE dla.restaurant_id = p_restaurant_id
      AND dla.date = p_date
      AND dla.compensation_type = 'salary'
    ), 0) AS salary_labor,
    
    -- Contractor allocations
    COALESCE((
      SELECT SUM(dla.allocated_cost)::INTEGER
      FROM daily_labor_allocations dla
      WHERE dla.restaurant_id = p_restaurant_id
      AND dla.date = p_date
      AND dla.compensation_type = 'contractor'
    ), 0) AS contractor_labor,
    
    -- Total
    (
      COALESCE((
        SELECT (dlc.hourly_wages * 100)::INTEGER
        FROM daily_labor_costs dlc
        WHERE dlc.restaurant_id = p_restaurant_id
        AND dlc.date = p_date
      ), 0) +
      COALESCE((
        SELECT SUM(dla.allocated_cost)::INTEGER
        FROM daily_labor_allocations dla
        WHERE dla.restaurant_id = p_restaurant_id
        AND dla.date = p_date
      ), 0)
    ) AS total_labor,
    
    -- Hours from daily_labor_costs
    COALESCE((
      SELECT dlc.total_hours
      FROM daily_labor_costs dlc
      WHERE dlc.restaurant_id = p_restaurant_id
      AND dlc.date = p_date
    ), 0) AS total_hours;
END;
$$;

-- Grant execute permissions
GRANT EXECUTE ON FUNCTION generate_daily_labor_allocations(UUID, DATE, DATE) TO authenticated;
GRANT EXECUTE ON FUNCTION get_daily_labor_summary(UUID, DATE) TO authenticated;
