-- Helper function to manually link an employee to a user account
-- This can be used by managers to fix cases where automatic linking didn't work
-- SECURITY: Requires caller to be owner/manager of the employee's restaurant

CREATE OR REPLACE FUNCTION link_employee_to_user(
  p_employee_id UUID,
  p_user_id UUID
)
RETURNS TABLE (
  success BOOLEAN,
  message TEXT,
  employee_name TEXT,
  employee_email TEXT
) AS $$
DECLARE
  v_employee RECORD;
  v_user RECORD;
  v_caller_id UUID;
  v_is_authorized BOOLEAN;
  v_rows_updated INTEGER;
BEGIN
  -- (1) Get caller identity and verify they are authenticated
  v_caller_id := auth.uid();
  
  IF v_caller_id IS NULL THEN
    RETURN QUERY SELECT FALSE, 'Unauthorized: Authentication required'::TEXT, NULL::TEXT, NULL::TEXT;
    RETURN;
  END IF;

  -- Get employee details with fully qualified schema
  SELECT * INTO v_employee FROM public.employees WHERE id = p_employee_id;
  
  IF NOT FOUND THEN
    RETURN QUERY SELECT FALSE, 'Employee not found'::TEXT, NULL::TEXT, NULL::TEXT;
    RETURN;
  END IF;

  -- Get user details
  SELECT email INTO v_user FROM auth.users WHERE id = p_user_id;
  
  IF NOT FOUND THEN
    RETURN QUERY SELECT FALSE, 'User not found'::TEXT, NULL::TEXT, NULL::TEXT;
    RETURN;
  END IF;

  -- (2) Enforce authorization: verify caller is owner/manager of the employee's restaurant
  SELECT EXISTS (
    SELECT 1 FROM public.user_restaurants
    WHERE user_id = v_caller_id
      AND restaurant_id = v_employee.restaurant_id
      AND role IN ('owner', 'manager')
  ) INTO v_is_authorized;

  IF NOT v_is_authorized THEN
    RETURN QUERY SELECT FALSE, 
      'Unauthorized: Only owners and managers can link employees'::TEXT,
      NULL::TEXT,
      NULL::TEXT;
    RETURN;
  END IF;

  -- Check if employee already linked
  IF v_employee.user_id IS NOT NULL THEN
    RETURN QUERY SELECT FALSE, 
      format('Employee already linked to user %s', v_employee.user_id)::TEXT,
      v_employee.name::TEXT,
      v_employee.email::TEXT;
    RETURN;
  END IF;

  -- (3) Harden UPDATE with fully qualified schema and race condition protection
  UPDATE public.employees 
  SET user_id = p_user_id, updated_at = NOW()
  WHERE id = p_employee_id
    AND user_id IS NULL; -- Prevent race condition where another process already linked

  GET DIAGNOSTICS v_rows_updated = ROW_COUNT;

  -- Check if update was successful
  IF v_rows_updated = 0 THEN
    RETURN QUERY SELECT FALSE,
      'Failed to link employee: Already linked by another process'::TEXT,
      v_employee.name::TEXT,
      v_employee.email::TEXT;
    RETURN;
  END IF;

  RETURN QUERY SELECT TRUE,
    format('Successfully linked %s to user %s', v_employee.name, v_user.email)::TEXT,
    v_employee.name::TEXT,
    v_employee.email::TEXT;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, pg_temp;

-- (4) Remove public grant - this function should only be called by authenticated users
-- with proper authorization checks inside the function itself.
-- The authorization is enforced within the function, so no explicit GRANT is needed.
-- If you want to restrict this further, you can grant to a specific privileged role only:
-- GRANT EXECUTE ON FUNCTION link_employee_to_user(UUID, UUID) TO privileged_role;

-- Example usage:
-- SELECT * FROM link_employee_to_user(
--   'employee-id-here'::UUID,
--   'user-id-here'::UUID
-- );

COMMENT ON FUNCTION link_employee_to_user IS 'Helper function to manually link an employee record to a user account. Used when automatic linking fails during invitation acceptance. Requires caller to be owner/manager of the employee''s restaurant.';
