-- Security fix: tenant check for deactivate_employee and reactivate_employee.
--
-- Both functions are SECURITY DEFINER, so RLS does not apply inside them.
-- Before this migration they did no auth check, and PUBLIC (so anon too) had
-- EXECUTE. Any caller with an employee UUID could deactivate or reactivate an
-- employee in any restaurant. Deactivate also sets termination_date and
-- cancels future shifts.
--
-- This migration keeps the signatures, the return type and the writes. It:
--   1. Reads the employee's restaurant_id, then requires manage:employees in
--      that restaurant. An unknown employee id gives the same error, so a
--      caller cannot probe for ids.
--   2. In reactivate_employee, requires view:pay_rates when a rate is given.
--      useReactivateEmployee already sends NULL without that flag.
--   3. Writes auth.uid() into deactivated_by / reactivated_by. The
--      p_deactivated_by / p_reactivated_by parameters stay for compatibility,
--      but the functions ignore them, so a caller cannot forge the audit trail.
--   4. Sets search_path and revokes EXECUTE from PUBLIC and anon.
--
-- Pattern: update_shift_series in 20260815110000_allow_update_locked_shift_series.sql.

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

  IF v_restaurant_id IS NULL
     OR NOT public.user_has_capability(v_restaurant_id, 'manage:employees') THEN
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
  RETURNING * INTO v_employee;

  IF p_remove_from_future_shifts THEN
    UPDATE public.shifts
    SET status = 'cancelled'
    WHERE employee_id = p_employee_id
      AND start_time > NOW()
      AND status = 'scheduled';
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
  v_employee public.employees;
BEGIN
  SELECT e.restaurant_id INTO v_restaurant_id
  FROM public.employees e
  WHERE e.id = p_employee_id;

  IF v_restaurant_id IS NULL
     OR NOT public.user_has_capability(v_restaurant_id, 'manage:employees') THEN
    RAISE EXCEPTION 'Access denied: you cannot manage employees for this restaurant'
      USING ERRCODE = '42501';
  END IF;

  IF p_new_hourly_rate IS NOT NULL
     AND NOT public.user_has_capability(v_restaurant_id, 'view:pay_rates') THEN
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
  RETURNING * INTO v_employee;

  RETURN v_employee;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.deactivate_employee(UUID, UUID, TEXT, BOOLEAN, DATE) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.reactivate_employee(UUID, UUID, INTEGER) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.deactivate_employee(UUID, UUID, TEXT, BOOLEAN, DATE) TO authenticated;
GRANT EXECUTE ON FUNCTION public.reactivate_employee(UUID, UUID, INTEGER) TO authenticated;
