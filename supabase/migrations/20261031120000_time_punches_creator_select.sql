-- Let a member read a punch that the member created in the last 5 minutes.
--
-- useCreateTimePunch sends INSERT ... RETURNING (src/hooks/useTimePunches.tsx).
-- Postgres applies the SELECT policies to the returned row. A kiosk service
-- account (role 'kiosk') passes the INSERT policy, but since
-- 20260805130000_self_scope_employee_reads.sql no SELECT policy admits it:
-- it has no view:scheduling / view:payroll capability and no employees row.
-- The kiosk then fails every punch with
-- "new row violates row-level security policy for table "time_punches"".
--
-- The 5-minute window keeps a shared kiosk tablet from reading the punch
-- history of the restaurant. The membership check keeps a removed member from
-- reading rows that they created before removal.
--
-- Design: docs/superpowers/specs/2026-10-31-kiosk-punch-returning-rls-design.md
-- Rollback: DROP POLICY "Creators can view punches they just created" ON public.time_punches;

SET LOCAL lock_timeout = '3s';

DROP POLICY IF EXISTS "Creators can view punches they just created" ON public.time_punches;
CREATE POLICY "Creators can view punches they just created"
  ON public.time_punches
  FOR SELECT
  TO authenticated
  USING (
    created_by = (select auth.uid())
    AND created_at >= now() - interval '5 minutes'
    AND EXISTS (
      SELECT 1 FROM public.user_restaurants ur
      WHERE ur.user_id = (select auth.uid())
        AND ur.restaurant_id = time_punches.restaurant_id
    )
  );
