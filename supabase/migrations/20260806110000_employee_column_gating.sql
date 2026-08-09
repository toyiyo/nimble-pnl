-- Gate the eight sensitive columns of public.employees behind view:pay_rates
-- and view:employee_pii.
--
-- RLS filters rows. It cannot mask a column. A column GRANT is a role-level
-- privilege, so it cannot depend on user_has_capability. The mechanism is
-- therefore a column REVOKE plus a view that applies the capability check per
-- row.
--
-- The REVOKE is the control. The view is the accessor. A caller who goes
-- around the view hits the column ACL and gets "permission denied for column
-- hourly_rate". PostgREST cannot bypass the ACL.
--
-- Prerequisite: 20260806100000 seeds the two flags onto the five builtin roles
-- that hold view:employees. Without that seed this migration masks pay and
-- contact data for every user, the owner included.

-- ============================================================================
-- Step 1: the masking view
-- ============================================================================
--
-- security_invoker stays OFF, unlike its siblings active_employees and
-- inactive_employees. Do not "fix" this view to match them. The caller no
-- longer holds SELECT on the eight columns, so an invoker-rights view would
-- fail for everyone, flag or no flag.
--
-- An owner-rights view bypasses the base table's RLS, so the view carries its
-- own row predicate. That predicate is the union of the SELECT-capable
-- policies on public.employees:
--   "Team members can view coworkers in their restaurant" (membership)
--   "Users can view employees for their restaurants"      (view:employees)
--   "Owners and managers can manage employees"            (user_has_role)
--   "Employees can view their own record"                 (self)
-- The first is the widest: user_has_capability and user_has_role both read
-- user_restaurants, so both are subsets of the membership test. No user gains
-- or loses a row.
--
-- security_barrier protects the ROW filter from a cheap user-supplied
-- function that leaks values before the predicate runs. It does not protect
-- the column mask: a CASE in a target list is not a qual, and Postgres does
-- not reorder target-list evaluation.
--
-- The CROSS JOIN LATERAL computes the two booleans once per row. Eight
-- separate user_has_capability calls would be eight distinct expression
-- nodes, each evaluated per row — 1,600 calls for a 200-employee roster to
-- answer two questions. STABLE does not memoize across rows.
--
-- is_minor goes to every member. isMinor(date_of_birth) returns false for a
-- null date, so a masked date would silently delete the "Minor" badge from the
-- roster. That badge is a labor-compliance cue. The raw date stays gated.
--
-- Self-row exception: a caller always reads their own pay and their own
-- contact data, flag or no flag. Your own wage and your own contact details
-- are your own data, and /employee/pay exists to show them. caps.self is
-- (e.user_id = auth.uid()). e.user_id is nullable, so an employee row with no
-- linked account must stay masked: NULL = auth.uid() evaluates to NULL, which
-- OR treats as FALSE, so the row does not unmask.
CREATE VIEW public.employees_secure
WITH (security_barrier = true) AS
SELECT
  e.id,
  e.restaurant_id,
  e.name,
  e.position,
  e.area,
  e.status,
  e.hire_date,
  e.termination_date,
  e.notes,
  e.created_at,
  e.updated_at,
  e.user_id,
  e.compensation_type,
  e.pay_period_type,
  e.contractor_payment_interval,
  e.allocate_daily,
  e.tip_eligible,
  e.requires_time_punch,
  e.is_active,
  e.deactivation_reason,
  e.deactivated_at,
  e.deactivated_by,
  e.reactivated_at,
  e.reactivated_by,
  e.last_active_date,
  e.daily_rate_reference_days,
  e.is_exempt,
  e.exempt_changed_at,
  e.exempt_changed_by,
  e.employment_type,
  CASE WHEN caps.pay OR caps.self THEN e.hourly_rate END                 AS hourly_rate,
  CASE WHEN caps.pay OR caps.self THEN e.salary_amount END               AS salary_amount,
  CASE WHEN caps.pay OR caps.self THEN e.contractor_payment_amount END   AS contractor_payment_amount,
  CASE WHEN caps.pay OR caps.self THEN e.daily_rate_amount END           AS daily_rate_amount,
  CASE WHEN caps.pay OR caps.self THEN e.daily_rate_reference_weekly END AS daily_rate_reference_weekly,
  CASE WHEN caps.pii OR caps.self THEN e.email END                       AS email,
  CASE WHEN caps.pii OR caps.self THEN e.phone END                       AS phone,
  CASE WHEN caps.pii OR caps.self THEN e.date_of_birth END               AS date_of_birth,
  (e.date_of_birth IS NOT NULL
   AND e.date_of_birth > (CURRENT_DATE - INTERVAL '18 years')) AS is_minor
FROM public.employees e
CROSS JOIN LATERAL (
  SELECT public.user_has_capability(e.restaurant_id, 'view:pay_rates')    AS pay,
         public.user_has_capability(e.restaurant_id, 'view:employee_pii') AS pii,
         (e.user_id = auth.uid())                                        AS self
) caps
WHERE e.restaurant_id IN (
        SELECT ur.restaurant_id
        FROM public.user_restaurants ur
        WHERE ur.user_id = auth.uid())
   OR e.user_id = auth.uid();

COMMENT ON VIEW public.employees_secure IS
  'Read path for public.employees. Returns NULL for a pay or contact column '
  'the caller has no flag for, unless the row is the caller''s own record '
  '(e.user_id = auth.uid()) — a person always reads their own pay and their '
  'own contact data. Owner rights on purpose: authenticated holds no SELECT '
  'on those columns, so an invoker-rights view would fail for all.';

-- ============================================================================
-- Step 2: the grant posture
-- ============================================================================
--
-- Revoke from every role the stock ALTER DEFAULT PRIVILEGES entry grants to.
-- REVOKE ... FROM PUBLIC cannot undo a direct grant to anon or to
-- service_role, so name each one.
REVOKE SELECT ON public.employees FROM PUBLIC, anon, authenticated, service_role;

GRANT SELECT (
  id, restaurant_id, name, position, area, status, hire_date,
  termination_date, notes, created_at, updated_at, user_id,
  compensation_type, pay_period_type, contractor_payment_interval,
  allocate_daily, tip_eligible, requires_time_punch, is_active,
  deactivation_reason, deactivated_at, deactivated_by, reactivated_at,
  reactivated_by, last_active_date, daily_rate_reference_days,
  is_exempt, exempt_changed_at, exempt_changed_by, employment_type
) ON public.employees TO authenticated;

-- service_role keeps the whole table. The payroll edge functions need pay, and
-- rolbypassrls makes the table ACL the only control behind that role. State
-- the grant. Do not inherit it.
GRANT SELECT ON public.employees TO service_role;

GRANT  SELECT ON public.employees_secure TO authenticated;
REVOKE SELECT ON public.employees_secure FROM PUBLIC, anon;

-- ============================================================================
-- Step 3: employee_compensation_history
-- ============================================================================
--
-- The whole table is pay data, so a row policy states the rule exactly. No
-- view and no column grant are needed. PostgREST drops the embedded rows
-- under RLS with no error for the client to handle.
DROP POLICY IF EXISTS "Users can view compensation history for their restaurants"
  ON public.employee_compensation_history;

CREATE POLICY "Users can view compensation history for their restaurants"
  ON public.employee_compensation_history
  FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM public.user_restaurants ur
      WHERE ur.restaurant_id = employee_compensation_history.restaurant_id
        AND ur.user_id = auth.uid()
    )
    AND public.user_has_capability(
      employee_compensation_history.restaurant_id, 'view:pay_rates')
  );
