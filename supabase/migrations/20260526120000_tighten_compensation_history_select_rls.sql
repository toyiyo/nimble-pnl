-- Tighten SELECT policy on employee_compensation_history to owner/manager only.
--
-- Background: the original migration (20251216093000_add_employee_compensation_history.sql)
-- gated INSERT to owner/manager but left SELECT open to any user_restaurants member
-- (chef, staff, kiosk, collaborator_*). Compensation history rows contain wage/salary
-- rates that should not be visible to non-management roles. The ai-execute-tool labor
-- tools are dispatcher-gated to owner/manager, so this RLS tighten is defense-in-depth:
-- the gate at the edge function already exists, and now PostgREST enforces the same
-- posture for any other access path (direct REST client, server-rendered admin panels,
-- future RPCs that read this table without a role check).

DROP POLICY IF EXISTS "Users can view compensation history for their restaurants"
  ON public.employee_compensation_history;

CREATE POLICY "Owners and managers can view compensation history"
  ON public.employee_compensation_history FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM public.user_restaurants
      WHERE user_restaurants.restaurant_id = employee_compensation_history.restaurant_id
        AND user_restaurants.user_id = auth.uid()
        AND user_restaurants.role IN ('owner', 'manager')
    )
  );

COMMENT ON POLICY "Owners and managers can view compensation history"
  ON public.employee_compensation_history IS
  'Compensation history contains wage/salary rates. Read access is restricted to owner/manager '
  'to match the INSERT policy posture. Edge functions that need broader access must use the '
  'service-role key explicitly.';
