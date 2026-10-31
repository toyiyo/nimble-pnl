-- Let a kiosk service account record a tip after a clock-out.
--
-- The kiosk opens the tip dialog after each clock-out (src/pages/KioskMode.tsx).
-- useEmployeeTips sends INSERT ... RETURNING on employee_tips.
-- No INSERT policy on employee_tips admits the role 'kiosk'.
-- No SELECT policy admits the returned row for the kiosk either.
-- Every kiosk tip then fails with
-- "new row violates row-level security policy for table "employee_tips"".
--
-- 1. caller_is_kiosk_service_account(): true only for the user in
--    kiosk_service_accounts for that restaurant. Any member can change their
--    own role to 'kiosk', so the role string alone is not enough. Only an
--    owner or manager can write kiosk_service_accounts.
-- 2. INSERT: the kiosk service account can create a cash or credit tip for an
--    employee of the same restaurant. These are the only values that the
--    kiosk dialog sends. recorded_at sets tip_date, so it must be within
--    1 day of the database clock. The kiosk cannot backdate a tip.
-- 3. SELECT: the same bounded creator policy as time_punches
--    (20261031120000_time_punches_creator_select.sql).
--
-- Design: docs/superpowers/specs/2026-10-31-kiosk-punch-returning-rls-design.md
-- Rollback:
--   DROP POLICY "Kiosk can create employee tips" ON public.employee_tips;
--   DROP POLICY "Creators can view tips they just created" ON public.employee_tips;
--   DROP FUNCTION public.caller_is_kiosk_service_account(uuid);

SET LOCAL lock_timeout = '3s';

CREATE OR REPLACE FUNCTION public.caller_is_kiosk_service_account(p_restaurant_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT auth.uid() IS NOT NULL
     AND EXISTS (
       SELECT 1
       FROM public.kiosk_service_accounts k
       JOIN public.user_restaurants ur
         ON ur.user_id = k.user_id
        AND ur.restaurant_id = k.restaurant_id
       WHERE k.user_id = auth.uid()
         AND k.restaurant_id = p_restaurant_id
         AND ur.role = 'kiosk'
     );
$$;

COMMENT ON FUNCTION public.caller_is_kiosk_service_account IS
'Whether the caller (auth.uid()) is the kiosk service account of p_restaurant_id, with a kiosk membership there. Tells the caller only about their own identity. Used by employee_tips RLS.';

REVOKE ALL ON FUNCTION public.caller_is_kiosk_service_account(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.caller_is_kiosk_service_account(uuid) TO authenticated, service_role;

DROP POLICY IF EXISTS "Kiosk can create employee tips" ON public.employee_tips;
CREATE POLICY "Kiosk can create employee tips"
  ON public.employee_tips
  FOR INSERT
  TO authenticated
  WITH CHECK (
    created_by = (select auth.uid())
    AND tip_source IN ('cash', 'credit')
    AND shift_id IS NULL
    AND recorded_at BETWEEN now() - interval '1 day' AND now() + interval '1 day'
    AND public.caller_is_kiosk_service_account(restaurant_id)
    AND EXISTS (
      SELECT 1 FROM public.employees e
      WHERE e.id = employee_tips.employee_id
        AND e.restaurant_id = employee_tips.restaurant_id
    )
  );

DROP POLICY IF EXISTS "Creators can view tips they just created" ON public.employee_tips;
CREATE POLICY "Creators can view tips they just created"
  ON public.employee_tips
  FOR SELECT
  TO authenticated
  USING (
    created_by = (select auth.uid())
    AND created_at >= now() - interval '5 minutes'
    AND EXISTS (
      SELECT 1 FROM public.user_restaurants ur
      WHERE ur.user_id = (select auth.uid())
        AND ur.restaurant_id = employee_tips.restaurant_id
    )
  );
