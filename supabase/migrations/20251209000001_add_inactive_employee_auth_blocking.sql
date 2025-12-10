-- Block inactive employees from authenticating
-- This migration adds auth blocking for inactive employees via database function

-- Create function to check if a user is an inactive employee
CREATE OR REPLACE FUNCTION check_employee_active_on_login()
RETURNS TRIGGER AS $$
DECLARE
  v_employee_record RECORD;
BEGIN
  -- Check if this user is associated with any employee records
  SELECT e.id, e.is_active, e.restaurant_id, e.name
  INTO v_employee_record
  FROM employees e
  WHERE e.user_id = NEW.id
  LIMIT 1;

  -- If user is an employee and is inactive, prevent login
  IF FOUND AND v_employee_record.is_active = false THEN
    -- Log the blocked login attempt for audit purposes (only if authenticated)
    IF auth.uid() IS NOT NULL THEN
      INSERT INTO auth_audit_log (
        user_id,
        event_type,
        employee_id,
        restaurant_id,
        metadata
      ) VALUES (
        NEW.id,
        'login_blocked_inactive_employee',
        v_employee_record.id,
        v_employee_record.restaurant_id,
        jsonb_build_object(
          'employee_name', v_employee_record.name,
          'attempted_at', NOW()
        )
      );
    END IF;

    -- Raise exception to prevent login
    RAISE EXCEPTION 'Account is inactive. Please contact your manager.'
      USING HINT = 'employee_inactive',
            ERRCODE = 'P0001';
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Create auth audit log table if it doesn't exist
CREATE TABLE IF NOT EXISTS auth_audit_log (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL,
  event_type TEXT NOT NULL,
  employee_id UUID REFERENCES employees(id),
  restaurant_id UUID REFERENCES restaurants(id),
  metadata JSONB,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Add index for audit queries
CREATE INDEX IF NOT EXISTS idx_auth_audit_log_user_id ON auth_audit_log(user_id);
CREATE INDEX IF NOT EXISTS idx_auth_audit_log_event_type ON auth_audit_log(event_type);
CREATE INDEX IF NOT EXISTS idx_auth_audit_log_created_at ON auth_audit_log(created_at);

-- Grant access to authenticated users (for their own logs only)
ALTER TABLE auth_audit_log ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view their own auth audit logs"
  ON auth_audit_log FOR SELECT
  USING (auth.uid() = user_id);

-- Note: We can't directly create triggers on auth.users (it's managed by Supabase)
-- Instead, we'll need to check employee status during the auth flow in the application
-- or use a custom auth hook if available in Supabase Edge Functions

-- However, we can create an RPC function that the frontend can call after successful auth
CREATE OR REPLACE FUNCTION verify_employee_can_login(p_user_id UUID DEFAULT NULL)
RETURNS TABLE(
  can_login BOOLEAN,
  reason TEXT,
  employee_id UUID,
  employee_name TEXT,
  is_active BOOLEAN
) AS $$
DECLARE
  v_user_id UUID;
  v_employee RECORD;
BEGIN
  -- Use provided user_id or current auth user
  v_user_id := COALESCE(p_user_id, auth.uid());

  -- Check if user is an employee
  SELECT e.id, e.name, e.is_active, e.restaurant_id
  INTO v_employee
  FROM employees e
  WHERE e.user_id = v_user_id
  LIMIT 1;

  -- If not an employee, allow login (they're a manager/owner)
  IF NOT FOUND THEN
    RETURN QUERY SELECT 
      true as can_login,
      'Not an employee account' as reason,
      NULL::UUID as employee_id,
      NULL::TEXT as employee_name,
      true as is_active;
    RETURN;
  END IF;

  -- If employee is inactive, block login
  IF v_employee.is_active = false THEN
    -- Log blocked attempt (only if authenticated)
    IF v_user_id IS NOT NULL THEN
      INSERT INTO auth_audit_log (
        user_id,
        event_type,
        employee_id,
        restaurant_id,
        metadata
      ) VALUES (
        v_user_id,
        'login_blocked_inactive_employee',
        v_employee.id,
        v_employee.restaurant_id,
        jsonb_build_object(
          'employee_name', v_employee.name,
          'attempted_at', NOW()
        )
      );
    END IF;

    RETURN QUERY SELECT 
      false as can_login,
      'Account is inactive. Please contact your manager.' as reason,
      v_employee.id as employee_id,
      v_employee.name as employee_name,
      v_employee.is_active;
    RETURN;
  END IF;

  -- Employee is active, allow login
  RETURN QUERY SELECT 
    true as can_login,
    'Active employee' as reason,
    v_employee.id as employee_id,
    v_employee.name as employee_name,
    v_employee.is_active;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Grant execute to authenticated users
GRANT EXECUTE ON FUNCTION verify_employee_can_login TO authenticated;
GRANT EXECUTE ON FUNCTION verify_employee_can_login TO anon;

-- Update the PIN verification to also check employee active status
CREATE OR REPLACE FUNCTION verify_employee_pin(
  p_restaurant_id UUID,
  p_pin TEXT
)
RETURNS TABLE(
  employee_id UUID,
  employee_name TEXT,
  is_valid BOOLEAN,
  reason TEXT
) AS $$
DECLARE
  v_employee RECORD;
  v_pin_hash TEXT;
BEGIN
  -- Hash the provided PIN to compare with stored hash
  v_pin_hash := encode(digest(p_pin, 'sha256'), 'hex');

  -- Find employee by PIN hash and restaurant
  SELECT e.id, e.name, e.is_active
  INTO v_employee
  FROM employees e
  INNER JOIN employee_pins ep ON ep.employee_id = e.id
  WHERE e.restaurant_id = p_restaurant_id
    AND ep.restaurant_id = p_restaurant_id
    AND ep.pin_hash = v_pin_hash
  LIMIT 1;

  -- No employee found with that PIN
  IF NOT FOUND THEN
    RETURN QUERY SELECT 
      NULL::UUID,
      NULL::TEXT,
      false,
      'Invalid PIN' as reason;
    RETURN;
  END IF;

  -- Employee found but inactive
  IF v_employee.is_active = false THEN
    -- Log blocked PIN attempt (only if authenticated user exists)
    IF auth.uid() IS NOT NULL THEN
      INSERT INTO auth_audit_log (
        user_id,
        event_type,
        employee_id,
        restaurant_id,
        metadata
      ) VALUES (
        auth.uid(),
        'pin_blocked_inactive_employee',
        v_employee.id,
        p_restaurant_id,
        jsonb_build_object(
          'employee_name', v_employee.name,
          'attempted_at', NOW()
        )
      );
    END IF;

    RETURN QUERY SELECT 
      v_employee.id,
      v_employee.name,
      false,
      'Account is inactive. Please contact your manager.' as reason;
    RETURN;
  END IF;

  -- Valid PIN and active employee
  RETURN QUERY SELECT 
    v_employee.id,
    v_employee.name,
    true,
    'Valid PIN' as reason;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Grant execute to authenticated and anon (kiosk mode)
GRANT EXECUTE ON FUNCTION verify_employee_pin TO authenticated;
GRANT EXECUTE ON FUNCTION verify_employee_pin TO anon;

-- Add comments
COMMENT ON FUNCTION verify_employee_can_login IS 'Checks if an employee user is active and can log in. Returns blocking reason if inactive.';
COMMENT ON FUNCTION verify_employee_pin IS 'Verifies employee PIN and checks if employee is active. Blocks PIN usage for inactive employees.';
COMMENT ON TABLE auth_audit_log IS 'Audit log for authentication events, including blocked login attempts by inactive employees.';
