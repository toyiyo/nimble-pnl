-- Fix employee views to use SECURITY INVOKER so they respect underlying RLS policies
-- This ensures queries through these views use the querying user's permissions

-- Fix active_employees view
DROP VIEW IF EXISTS active_employees;
CREATE VIEW active_employees 
WITH (security_invoker = true) AS
SELECT * FROM employees WHERE is_active = true;

COMMENT ON VIEW active_employees IS 'View of active employees with security_invoker enabled to respect RLS policies';

-- Fix inactive_employees view (preserve the profile joins from previous fix)
DROP VIEW IF EXISTS inactive_employees;
CREATE VIEW inactive_employees 
WITH (security_invoker = true) AS
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

COMMENT ON VIEW inactive_employees IS 'View of inactive employees with security_invoker enabled to respect RLS policies';