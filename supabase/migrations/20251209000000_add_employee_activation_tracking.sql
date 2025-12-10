-- Add employee activation/deactivation tracking
-- This migration adds fields to track employee activation status while preserving all historical data

-- Add activation tracking fields to employees table
ALTER TABLE employees
  ADD COLUMN IF NOT EXISTS is_active BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS deactivation_reason TEXT,
  ADD COLUMN IF NOT EXISTS deactivated_at TIMESTAMP WITH TIME ZONE,
  ADD COLUMN IF NOT EXISTS deactivated_by UUID REFERENCES auth.users(id),
  ADD COLUMN IF NOT EXISTS reactivated_at TIMESTAMP WITH TIME ZONE,
  ADD COLUMN IF NOT EXISTS reactivated_by UUID REFERENCES auth.users(id),
  ADD COLUMN IF NOT EXISTS last_active_date DATE; -- Derived from last shift or punch

-- Add index for filtering by activation status (performance optimization)
CREATE INDEX IF NOT EXISTS idx_employees_is_active ON employees(restaurant_id, is_active);

-- Add index for finding recently deactivated employees
CREATE INDEX IF NOT EXISTS idx_employees_deactivated_at ON employees(deactivated_at) WHERE deactivated_at IS NOT NULL;

-- Update existing employees to set is_active based on current status
-- This ensures data consistency before adding the constraint
UPDATE employees
SET is_active = CASE 
  WHEN status = 'active' THEN true
  ELSE false
END;

-- Add check constraint to ensure status and is_active are in sync
ALTER TABLE employees
  ADD CONSTRAINT employees_status_active_sync CHECK (
    (status = 'active' AND is_active = true) OR
    (status IN ('inactive', 'terminated') AND is_active = false)
  );

-- Create function to automatically update last_active_date
CREATE OR REPLACE FUNCTION update_employee_last_active_date()
RETURNS TRIGGER AS $$
BEGIN
  -- Update last_active_date when employee is deactivated
  IF NEW.is_active = false AND OLD.is_active = true THEN
    -- Get the most recent shift end_time or punch time
    SELECT COALESCE(
      (SELECT MAX(DATE(end_time)) FROM shifts WHERE employee_id = NEW.id),
      (SELECT MAX(DATE(punch_time)) FROM time_punches WHERE employee_id = NEW.id),
      CURRENT_DATE
    ) INTO NEW.last_active_date;
  END IF;
  
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Create trigger to maintain last_active_date
DROP TRIGGER IF EXISTS trigger_update_employee_last_active_date ON employees;
CREATE TRIGGER trigger_update_employee_last_active_date
  BEFORE UPDATE ON employees
  FOR EACH ROW
  EXECUTE FUNCTION update_employee_last_active_date();

-- Create view for active employees (convenience for queries)
CREATE OR REPLACE VIEW active_employees AS
SELECT *
FROM employees
WHERE is_active = true;

-- Create view for inactive employees with deactivation info
CREATE OR REPLACE VIEW inactive_employees AS
SELECT 
  e.*,
  u_deactivated.email as deactivated_by_email,
  u_reactivated.email as reactivated_by_email
FROM employees e
LEFT JOIN auth.users u_deactivated ON e.deactivated_by = u_deactivated.id
LEFT JOIN auth.users u_reactivated ON e.reactivated_by = u_reactivated.id
WHERE e.is_active = false;

-- Grant access to views (follows same RLS as employees table)
ALTER VIEW active_employees OWNER TO postgres;
ALTER VIEW inactive_employees OWNER TO postgres;

-- Add comment explaining the design
COMMENT ON COLUMN employees.is_active IS 'Indicates if employee can currently login, punch, and be scheduled. Deactivated employees preserve all historical data but are hidden from day-to-day workflows. Must be kept in sync with status field via check constraint.';

COMMENT ON COLUMN employees.deactivation_reason IS 'Optional reason for deactivation: seasonal, left_company, on_leave, other, etc. Helps managers track patterns and facilitates easier reactivation.';

COMMENT ON COLUMN employees.last_active_date IS 'Date of last shift or punch. Automatically set when employee is deactivated. Helps managers identify when to reactivate seasonal employees.';

-- Function to deactivate employee (for use in backend/edge functions)
CREATE OR REPLACE FUNCTION deactivate_employee(
  p_employee_id UUID,
  p_deactivated_by UUID,
  p_reason TEXT DEFAULT NULL,
  p_remove_from_future_shifts BOOLEAN DEFAULT true
)
RETURNS employees AS $$
DECLARE
  v_employee employees;
BEGIN
  -- Update employee status
  UPDATE employees
  SET 
    is_active = false,
    status = 'inactive',
    deactivation_reason = p_reason,
    deactivated_at = NOW(),
    deactivated_by = p_deactivated_by,
    reactivated_at = NULL,
    reactivated_by = NULL
  WHERE id = p_employee_id
  RETURNING * INTO v_employee;

  -- Optionally cancel future shifts
  IF p_remove_from_future_shifts THEN
    UPDATE shifts
    SET status = 'cancelled'
    WHERE employee_id = p_employee_id
      AND start_time > NOW()
      AND status = 'scheduled';
  END IF;

  RETURN v_employee;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Function to reactivate employee
CREATE OR REPLACE FUNCTION reactivate_employee(
  p_employee_id UUID,
  p_reactivated_by UUID,
  p_new_hourly_rate INTEGER DEFAULT NULL
)
RETURNS employees AS $$
DECLARE
  v_employee employees;
BEGIN
  -- Update employee status
  UPDATE employees
  SET 
    is_active = true,
    status = 'active',
    deactivation_reason = NULL,
    deactivated_at = NULL,
    deactivated_by = NULL,
    reactivated_at = NOW(),
    reactivated_by = p_reactivated_by,
    hourly_rate = COALESCE(p_new_hourly_rate, hourly_rate) -- Update rate if provided
  WHERE id = p_employee_id
  RETURNING * INTO v_employee;

  RETURN v_employee;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Grant execute permissions on functions
GRANT EXECUTE ON FUNCTION deactivate_employee TO authenticated;
GRANT EXECUTE ON FUNCTION reactivate_employee TO authenticated;

-- Update RLS policies to respect is_active for certain operations
-- (Note: Historical data queries should still work for inactive employees)

-- Ensure kiosk PIN lookups only work for active employees
-- (This assumes there's an employee_pins table - if not, this is a placeholder)
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'employee_pins') THEN
    -- Drop old policy if exists
    DROP POLICY IF EXISTS "Kiosk can verify PINs for active employees only" ON employee_pins;
    
    -- Create policy to restrict PIN validation to active employees
    CREATE POLICY "Kiosk can verify PINs for active employees only"
      ON employee_pins FOR SELECT
      USING (
        EXISTS (
          SELECT 1 FROM employees
          WHERE employees.id = employee_pins.employee_id
          AND employees.is_active = true
        )
      );
  END IF;
END $$;
