-- Hardening for link_employee_to_user ahead of routing real UI traffic to it
-- from EmployeeDialog's "link to existing account" flow.
--
-- 1. operations_manager holds manage:employees (see ROLE_CAPABILITIES) and can
--    invite staff, but was absent from this allowlist — clicking "link" would
--    fail and leave an employees row with user_id = NULL beside an existing
--    membership, i.e. the double-provisioning this feature exists to prevent.
--    Precedent for widening a gate to this role: 20260702170000.
-- 2. The employee and auth.users lookups ran BEFORE the caller was authorized,
--    with distinct "Employee not found" / "User not found" messages, letting
--    any authenticated user distinguish "does not exist" from "not yours".
-- 3. The old comment claimed the PUBLIC grant had been removed. No REVOKE was
--    ever issued; Postgres grants EXECUTE to PUBLIC by default and Supabase
--    grants it to anon/authenticated. That is what makes the client rpc() call
--    work — but the in-function check is the ONLY boundary. Comment corrected
--    so nobody reads a protection layer that is not there.

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
  -- One message for "no such employee" and "exists but not yours", so the
  -- function cannot be used to probe for employee ids.
  c_denied CONSTANT TEXT := 'Employee not found, or you are not authorized to manage it';
BEGIN
  v_caller_id := auth.uid();

  IF v_caller_id IS NULL THEN
    RETURN QUERY SELECT FALSE, 'Unauthorized: Authentication required'::TEXT, NULL::TEXT, NULL::TEXT;
    RETURN;
  END IF;

  SELECT * INTO v_employee FROM public.employees WHERE id = p_employee_id;

  IF NOT FOUND THEN
    RETURN QUERY SELECT FALSE, c_denied, NULL::TEXT, NULL::TEXT;
    RETURN;
  END IF;

  -- Authorize BEFORE revealing anything further, including whether p_user_id exists.
  SELECT EXISTS (
    SELECT 1 FROM public.user_restaurants
    WHERE user_id = v_caller_id
      AND restaurant_id = v_employee.restaurant_id
      AND role IN ('owner', 'manager', 'operations_manager')
  ) INTO v_is_authorized;

  IF NOT v_is_authorized THEN
    RETURN QUERY SELECT FALSE, c_denied, NULL::TEXT, NULL::TEXT;
    RETURN;
  END IF;

  SELECT email INTO v_user FROM auth.users WHERE id = p_user_id;

  IF NOT FOUND THEN
    RETURN QUERY SELECT FALSE, 'User not found'::TEXT, NULL::TEXT, NULL::TEXT;
    RETURN;
  END IF;

  IF v_employee.user_id IS NOT NULL THEN
    RETURN QUERY SELECT FALSE,
      format('Employee already linked to user %s', v_employee.user_id)::TEXT,
      v_employee.name::TEXT,
      v_employee.email::TEXT;
    RETURN;
  END IF;

  UPDATE public.employees
  SET user_id = p_user_id, updated_at = NOW()
  WHERE id = p_employee_id
    AND user_id IS NULL; -- guard against a concurrent link

  GET DIAGNOSTICS v_rows_updated = ROW_COUNT;

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

COMMENT ON FUNCTION link_employee_to_user IS
  'Links an employee record to an existing user account. Callable by owner, '
  'manager, and operations_manager of the employee''s restaurant. EXECUTE is '
  'granted to authenticated by Supabase default; the in-function authorization '
  'check is the only access boundary.';
