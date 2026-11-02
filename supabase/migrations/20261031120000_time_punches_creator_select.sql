-- Let a member read a punch that the member created in the last 5 minutes.
--
-- useCreateTimePunch sends INSERT ... RETURNING (src/hooks/useTimePunches.tsx).
-- Postgres applies the SELECT policies to the returned row.
-- A kiosk service account (role 'kiosk') passes the INSERT policy.
-- Since 20260805130000_self_scope_employee_reads.sql, no SELECT policy admits it.
-- It has no view:scheduling or view:payroll capability. It has no employees row.
-- Every kiosk punch then fails with
-- "new row violates row-level security policy for table "time_punches"".
--
-- The 5-minute window prevents access to the punch history from a shared
-- kiosk tablet. The membership check prevents access by a removed member to
-- rows that they created.
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
