-- Let a kiosk service account record a tip after a clock-out.
--
-- The kiosk opens the tip dialog after each clock-out (src/pages/KioskMode.tsx).
-- useEmployeeTips sends INSERT ... RETURNING on employee_tips.
-- No INSERT policy on employee_tips admits the role 'kiosk'.
-- No SELECT policy admits the returned row for the kiosk either.
-- Every kiosk tip then fails with
-- "new row violates row-level security policy for table "employee_tips"".
--
-- 1. INSERT: a kiosk member can create a tip for an employee of the same
--    restaurant, with created_by set to the kiosk user. The kiosk can already
--    insert punches for these employees, so the trust level is the same.
-- 2. SELECT: the same bounded creator policy as time_punches
--    (20261031120000_time_punches_creator_select.sql).
--
-- Design: docs/superpowers/specs/2026-10-31-kiosk-punch-returning-rls-design.md
-- Rollback:
--   DROP POLICY "Kiosk can create employee tips" ON public.employee_tips;
--   DROP POLICY "Creators can view tips they just created" ON public.employee_tips;

SET LOCAL lock_timeout = '3s';

DROP POLICY IF EXISTS "Kiosk can create employee tips" ON public.employee_tips;
CREATE POLICY "Kiosk can create employee tips"
  ON public.employee_tips
  FOR INSERT
  TO authenticated
  WITH CHECK (
    created_by = (select auth.uid())
    AND EXISTS (
      SELECT 1 FROM public.user_restaurants ur
      WHERE ur.user_id = (select auth.uid())
        AND ur.restaurant_id = employee_tips.restaurant_id
        AND ur.role = 'kiosk'
    )
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
