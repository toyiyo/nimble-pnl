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
-- 4. The target account was never checked for membership of the employee's
--    restaurant, so an authorized owner/manager could link an employee row to
--    ANY account in the system — a cross-tenant access grant. Linking now
--    requires the target to already be a member of the same restaurant.
-- 5. Idempotency contract: re-linking to the SAME account returns success=TRUE
--    (the desired end state already holds) so the client can trust `success`
--    alone; linking to a DIFFERENT account is a conflict (success=FALSE).

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
  v_linked_user_id UUID;
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

  -- The target account must ALREADY be a member of the employee's restaurant.
  -- Linking connects an employee row to a teammate who is already on the team;
  -- it must never mint access for an arbitrary account (cross-tenant grant).
  -- Joining through user_restaurants also collapses "no such user" and "user
  -- exists but isn't on this team" into one indistinguishable denial.
  SELECT u.email INTO v_user
  FROM public.user_restaurants ur
  JOIN auth.users u ON u.id = ur.user_id
  WHERE ur.user_id = p_user_id
    AND ur.restaurant_id = v_employee.restaurant_id;

  IF NOT FOUND THEN
    RETURN QUERY SELECT FALSE,
      'That account is not a member of this restaurant'::TEXT,
      NULL::TEXT, NULL::TEXT;
    RETURN;
  END IF;

  -- Idempotency: re-linking to the SAME account is the caller's desired end
  -- state, so report success and let the client trust `success` alone. Linking
  -- to a DIFFERENT account is a genuine conflict.
  IF v_employee.user_id IS NOT NULL THEN
    IF v_employee.user_id = p_user_id THEN
      RETURN QUERY SELECT TRUE,
        'Employee is already linked to this account'::TEXT,
        v_employee.name::TEXT,
        v_employee.email::TEXT;
    ELSE
      RETURN QUERY SELECT FALSE,
        'Employee is already linked to a different account'::TEXT,
        v_employee.name::TEXT,
        v_employee.email::TEXT;
    END IF;
    RETURN;
  END IF;

  UPDATE public.employees
  SET user_id = p_user_id, updated_at = NOW()
  WHERE id = p_employee_id
    AND user_id IS NULL; -- guard against a concurrent link

  GET DIAGNOSTICS v_rows_updated = ROW_COUNT;

  IF v_rows_updated = 0 THEN
    -- A concurrent transaction won the race. Re-read and mirror the idempotency
    -- contract: same account → success, different → conflict.
    SELECT user_id INTO v_linked_user_id FROM public.employees WHERE id = p_employee_id;
    IF v_linked_user_id = p_user_id THEN
      RETURN QUERY SELECT TRUE,
        'Employee is already linked to this account'::TEXT,
        v_employee.name::TEXT,
        v_employee.email::TEXT;
    ELSE
      RETURN QUERY SELECT FALSE,
        'Employee is already linked to a different account'::TEXT,
        v_employee.name::TEXT,
        v_employee.email::TEXT;
    END IF;
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
  'manager, and operations_manager of the employee''s restaurant, and only for '
  'a target account that is already a member of that same restaurant. '
  'Re-linking to the same account is idempotent (success=TRUE); a different '
  'account is a conflict. EXECUTE is granted to authenticated by Supabase '
  'default; the in-function authorization check is the only access boundary.';
