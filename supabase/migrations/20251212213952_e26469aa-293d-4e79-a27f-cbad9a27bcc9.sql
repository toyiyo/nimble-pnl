-- Fix inactive_employees view to use profiles table instead of auth.users
-- This removes the security vulnerability of exposing auth.users data

DROP VIEW IF EXISTS inactive_employees;

CREATE VIEW inactive_employees AS
SELECT 
    e.id,
    e.restaurant_id,
    e.name,
    e.email,
    e.phone,
    e.position,
    e.hourly_rate,
    e.status,
    e.hire_date,
    e.notes,
    e.created_at,
    e.updated_at,
    e.user_id,
    e.compensation_type,
    e.salary_amount,
    e.pay_period_type,
    e.contractor_payment_amount,
    e.contractor_payment_interval,
    e.allocate_daily,
    e.tip_eligible,
    e.requires_time_punch,
    e.termination_date,
    e.is_active,
    e.deactivation_reason,
    e.deactivated_at,
    e.deactivated_by,
    e.reactivated_at,
    e.reactivated_by,
    e.last_active_date,
    p_deactivated.email AS deactivated_by_email,
    p_reactivated.email AS reactivated_by_email
FROM employees e
LEFT JOIN profiles p_deactivated ON e.deactivated_by = p_deactivated.user_id
LEFT JOIN profiles p_reactivated ON e.reactivated_by = p_reactivated.user_id
WHERE e.is_active = false;

-- Add comment explaining the security fix
COMMENT ON VIEW inactive_employees IS 'View of inactive employees with deactivated/reactivated by emails from profiles table (RLS-protected) instead of auth.users';