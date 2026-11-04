-- Scope two user-lookup RPCs to the caller's tenants.
-- Design: docs/superpowers/specs/2026-10-26-scope-user-lookup-rpcs-design.md
--
-- Why: both functions are SECURITY DEFINER and anon has EXECUTE on both.
--   * get_users_by_ids (20260104000001_add_get_users_by_ids_function.sql)
--     returns email and full_name from auth.users for any id, with no check.
--   * verify_employee_can_login (20251209000001_add_inactive_employee_auth_blocking.sql)
--     returns the employee name and active state for any p_user_id. For an
--     inactive employee it also writes an auth_audit_log row for that id.
--
-- Callers (checked in src/ and supabase/functions/):
--   * get_users_by_ids: src/hooks/useTipSplitAuditLog.ts:45 only. It runs
--     after sign-in and asks for the actors of one restaurant's audit log.
--   * verify_employee_can_login: no caller. No path runs before sign-in or
--     with the service role, so the function now uses auth.uid() only.
--
-- CREATE OR REPLACE keeps the old ACL, so each function gets an explicit
-- REVOKE. anon is revoked by name as well as through PUBLIC: some Supabase
-- images give a direct anon grant through ALTER DEFAULT PRIVILEGES, and a
-- REVOKE ... FROM PUBLIC does not touch that grant.

-- ---------------------------------------------------------------------------
-- get_users_by_ids: same return shape. A row comes back only when the id
-- shares at least one restaurant with auth.uid(). Other ids give no row, not
-- an error. auth.uid() is NULL for a caller with no JWT, so that caller gets
-- no rows.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.get_users_by_ids(user_ids UUID[])
RETURNS TABLE (
  id UUID,
  email TEXT,
  full_name TEXT
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT
    u.id,
    u.email::TEXT,
    (u.raw_user_meta_data->>'full_name')::TEXT AS full_name
  FROM auth.users u
  WHERE u.id = ANY(user_ids)
    AND EXISTS (
      SELECT 1
      FROM public.user_restaurants mine
      JOIN public.user_restaurants theirs
        ON theirs.restaurant_id = mine.restaurant_id
      WHERE mine.user_id = auth.uid()
        AND theirs.user_id = u.id
    );
$$;

REVOKE ALL ON FUNCTION public.get_users_by_ids(UUID[]) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_users_by_ids(UUID[]) TO authenticated;

COMMENT ON FUNCTION public.get_users_by_ids(UUID[]) IS
  'Fetches email and full_name from auth.users for audit trail display. Returns only users who share a restaurant with auth.uid().';

-- ---------------------------------------------------------------------------
-- verify_employee_can_login: the caller can check only their own account.
-- The p_user_id parameter stays so that the signature and the generated
-- types do not change. A NULL p_user_id or a p_user_id equal to auth.uid()
-- works. Any other value raises 42501 before the function reads data or
-- writes an audit row. A caller with no JWT also gets 42501.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.verify_employee_can_login(p_user_id UUID DEFAULT NULL)
RETURNS TABLE(
  can_login BOOLEAN,
  reason TEXT,
  employee_id UUID,
  employee_name TEXT,
  is_active BOOLEAN
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_user_id UUID;
  v_employee RECORD;
BEGIN
  v_user_id := auth.uid();

  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'Not authenticated' USING ERRCODE = '42501';
  END IF;

  IF p_user_id IS NOT NULL AND p_user_id <> v_user_id THEN
    RAISE EXCEPTION 'Cannot check another user' USING ERRCODE = '42501';
  END IF;

  -- Check if user is an employee
  SELECT e.id, e.name, e.is_active, e.restaurant_id
  INTO v_employee
  FROM public.employees e
  WHERE e.user_id = v_user_id
  LIMIT 1;

  -- If not an employee, allow login (they're a manager/owner)
  IF NOT FOUND THEN
    RETURN QUERY SELECT
      true AS can_login,
      'Not an employee account' AS reason,
      NULL::UUID AS employee_id,
      NULL::TEXT AS employee_name,
      true AS is_active;
    RETURN;
  END IF;

  -- If employee is inactive, log the attempt and block login
  IF v_employee.is_active = false THEN
    INSERT INTO public.auth_audit_log (
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

    RETURN QUERY SELECT
      false AS can_login,
      'Account is inactive. Please contact your manager.' AS reason,
      v_employee.id AS employee_id,
      v_employee.name::TEXT AS employee_name,
      v_employee.is_active;
    RETURN;
  END IF;

  -- Employee is active, allow login
  RETURN QUERY SELECT
    true AS can_login,
    'Active employee' AS reason,
    v_employee.id AS employee_id,
    v_employee.name::TEXT AS employee_name,
    v_employee.is_active;
END;
$$;

REVOKE ALL ON FUNCTION public.verify_employee_can_login(UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.verify_employee_can_login(UUID) TO authenticated;

COMMENT ON FUNCTION public.verify_employee_can_login(UUID) IS
  'Checks if the signed-in employee is active and can log in. Uses auth.uid(); p_user_id must be NULL or equal to auth.uid().';
