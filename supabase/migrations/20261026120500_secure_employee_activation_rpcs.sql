-- Security fix: tenant check for deactivate_employee and reactivate_employee.
--
-- Both functions are SECURITY DEFINER, so RLS does not apply inside them.
-- Before this migration they did no auth check. PUBLIC, and so anon, had
-- EXECUTE. Any caller with an employee UUID could deactivate or reactivate an
-- employee in any restaurant. Deactivate also sets termination_date and
-- cancels future shifts.
--
-- This migration keeps the signatures and the return type. It:
--   1. Reads the employee's restaurant_id and requires manage:employees in
--      that restaurant. An unknown employee id gives the same error. Thus a
--      caller cannot probe for ids.
--   2. In reactivate_employee, requires view:pay_rates when a rate is given.
--   3. Writes auth.uid() into deactivated_by / reactivated_by. The
--      p_deactivated_by / p_reactivated_by parameters stay in the signature.
--      The functions ignore them. Thus a caller cannot forge the audit trail.
--   4. Scopes every UPDATE to the restaurant that the check used.
--   5. Masks the returned row with the rule of employees_secure
--      (20260806110000_employee_column_gating.sql). The row is the full
--      employees row, so without the mask it shows pay and PII columns that
--      the column grants hide from authenticated.
--   6. Sets search_path and revokes EXECUTE from PUBLIC and anon.
--
-- Pattern: update_shift_series in 20260815110000_allow_update_locked_shift_series.sql.
-- This migration adds an ERRCODE and a REVOKE to that pattern.

CREATE OR REPLACE FUNCTION public.deactivate_employee(
  p_employee_id UUID,
  p_deactivated_by UUID,
  p_reason TEXT DEFAULT NULL,
  p_remove_from_future_shifts BOOLEAN DEFAULT true,
  p_termination_date DATE DEFAULT CURRENT_DATE
)
RETURNS public.employees
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_restaurant_id UUID;
  v_employee public.employees;
BEGIN
  SELECT e.restaurant_id INTO v_restaurant_id
  FROM public.employees e
  WHERE e.id = p_employee_id;

  -- SECURITY DEFINER bypasses RLS, so the function checks tenancy itself.
  -- IS NOT TRUE also denies when the check returns NULL.
  IF v_restaurant_id IS NULL
     OR public.user_has_capability(v_restaurant_id, 'manage:employees') IS NOT TRUE THEN
    RAISE EXCEPTION 'Access denied: you cannot manage employees for this restaurant'
      USING ERRCODE = '42501';
  END IF;

  UPDATE public.employees
  SET
    is_active = false,
    status = 'inactive',
    deactivation_reason = p_reason,
    deactivated_at = NOW(),
    deactivated_by = auth.uid(),
    reactivated_at = NULL,
    reactivated_by = NULL,
    termination_date = p_termination_date  -- CRITICAL: payroll stops after this date
  WHERE id = p_employee_id
    AND restaurant_id = v_restaurant_id
  RETURNING * INTO v_employee;

  IF p_remove_from_future_shifts THEN
    UPDATE public.shifts
    SET status = 'cancelled'
    WHERE employee_id = p_employee_id
      AND restaurant_id = v_restaurant_id
      AND start_time > NOW()
      AND status = 'scheduled';
  END IF;

  -- Same mask as employees_secure.
  IF v_employee.user_id IS DISTINCT FROM auth.uid() THEN
    IF public.user_has_capability(v_restaurant_id, 'view:pay_rates') IS NOT TRUE THEN
      v_employee.hourly_rate := NULL;
      v_employee.salary_amount := NULL;
      v_employee.contractor_payment_amount := NULL;
      v_employee.daily_rate_amount := NULL;
      v_employee.daily_rate_reference_weekly := NULL;
    END IF;
    IF public.user_has_capability(v_restaurant_id, 'view:employee_pii') IS NOT TRUE THEN
      v_employee.email := NULL;
      v_employee.phone := NULL;
      v_employee.date_of_birth := NULL;
    END IF;
  END IF;

  RETURN v_employee;
END;
$$;

CREATE OR REPLACE FUNCTION public.reactivate_employee(
  p_employee_id UUID,
  p_reactivated_by UUID,
  p_new_hourly_rate INTEGER DEFAULT NULL
)
RETURNS public.employees
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_restaurant_id UUID;
  v_can_see_pay BOOLEAN;
  v_employee public.employees;
BEGIN
  SELECT e.restaurant_id INTO v_restaurant_id
  FROM public.employees e
  WHERE e.id = p_employee_id;

  -- SECURITY DEFINER bypasses RLS, so the function checks tenancy itself.
  -- IS NOT TRUE also denies when the check returns NULL.
  IF v_restaurant_id IS NULL
     OR public.user_has_capability(v_restaurant_id, 'manage:employees') IS NOT TRUE THEN
    RAISE EXCEPTION 'Access denied: you cannot manage employees for this restaurant'
      USING ERRCODE = '42501';
  END IF;

  v_can_see_pay := public.user_has_capability(v_restaurant_id, 'view:pay_rates') IS TRUE;

  IF p_new_hourly_rate IS NOT NULL AND NOT v_can_see_pay THEN
    RAISE EXCEPTION 'Access denied: you cannot set pay rates for this restaurant'
      USING ERRCODE = '42501';
  END IF;

  UPDATE public.employees
  SET
    is_active = true,
    status = 'active',
    deactivation_reason = NULL,
    deactivated_at = NULL,
    deactivated_by = NULL,
    reactivated_at = NOW(),
    reactivated_by = auth.uid(),
    hourly_rate = COALESCE(p_new_hourly_rate, hourly_rate)
  WHERE id = p_employee_id
    AND restaurant_id = v_restaurant_id
  RETURNING * INTO v_employee;

  -- Same mask as employees_secure.
  IF v_employee.user_id IS DISTINCT FROM auth.uid() THEN
    IF NOT v_can_see_pay THEN
      v_employee.hourly_rate := NULL;
      v_employee.salary_amount := NULL;
      v_employee.contractor_payment_amount := NULL;
      v_employee.daily_rate_amount := NULL;
      v_employee.daily_rate_reference_weekly := NULL;
    END IF;
    IF public.user_has_capability(v_restaurant_id, 'view:employee_pii') IS NOT TRUE THEN
      v_employee.email := NULL;
      v_employee.phone := NULL;
      v_employee.date_of_birth := NULL;
    END IF;
  END IF;

  RETURN v_employee;
END;
$$;

COMMENT ON FUNCTION public.deactivate_employee(UUID, UUID, TEXT, BOOLEAN, DATE) IS
'Deactivates an employee and sets the termination date. CRITICAL: payroll stops '
'salary and contractor allocations after termination_date. A future date is '
'valid for an employee who gives notice. Requires manage:employees in the '
'employee''s restaurant. The function ignores p_deactivated_by and writes '
'auth.uid(). The returned row masks pay and PII columns as employees_secure does.';

COMMENT ON FUNCTION public.reactivate_employee(UUID, UUID, INTEGER) IS
'Reactivates an employee. Requires manage:employees in the employee''s '
'restaurant, and view:pay_rates when p_new_hourly_rate is not NULL. The '
'function ignores p_reactivated_by and writes auth.uid(). The returned row '
'masks pay and PII columns as employees_secure does.';

REVOKE EXECUTE ON FUNCTION public.deactivate_employee(UUID, UUID, TEXT, BOOLEAN, DATE) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.reactivate_employee(UUID, UUID, INTEGER) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.deactivate_employee(UUID, UUID, TEXT, BOOLEAN, DATE) TO authenticated;
GRANT EXECUTE ON FUNCTION public.reactivate_employee(UUID, UUID, INTEGER) TO authenticated;
