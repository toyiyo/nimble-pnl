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
  CASE WHEN caps.pay THEN e.hourly_rate END                 AS hourly_rate,
  CASE WHEN caps.pay THEN e.salary_amount END               AS salary_amount,
  CASE WHEN caps.pay THEN e.contractor_payment_amount END   AS contractor_payment_amount,
  CASE WHEN caps.pay THEN e.daily_rate_amount END           AS daily_rate_amount,
  CASE WHEN caps.pay THEN e.daily_rate_reference_weekly END AS daily_rate_reference_weekly,
  CASE WHEN caps.pii THEN e.email END                       AS email,
  CASE WHEN caps.pii THEN e.phone END                       AS phone,
  CASE WHEN caps.pii THEN e.date_of_birth END               AS date_of_birth,
  (e.date_of_birth IS NOT NULL
   AND e.date_of_birth > (CURRENT_DATE - INTERVAL '18 years')) AS is_minor
FROM public.employees e
CROSS JOIN LATERAL (
  SELECT public.user_has_capability(e.restaurant_id, 'view:pay_rates')    AS pay,
         public.user_has_capability(e.restaurant_id, 'view:employee_pii') AS pii
) caps
WHERE e.restaurant_id IN (
        SELECT ur.restaurant_id
        FROM public.user_restaurants ur
        WHERE ur.user_id = auth.uid())
   OR e.user_id = auth.uid();

COMMENT ON VIEW public.employees_secure IS
  'Read path for public.employees. Returns NULL for a pay or contact column '
  'the caller has no flag for. Owner rights on purpose: authenticated holds '
  'no SELECT on those columns, so an invoker-rights view would fail for all.';
