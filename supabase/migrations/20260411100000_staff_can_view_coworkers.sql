-- Staff employees need to see coworkers for shift marketplace, scheduling, and
-- team features. Current RLS only grants employee visibility to users with
-- 'view:employees' capability (owner/manager/accountant) plus a self-view policy.
-- This leaves staff unable to see who posted a shift trade, causing null joins
-- and crashes in the marketplace UI.
--
-- This policy allows any user associated with a restaurant (via user_restaurants)
-- to see employees in that same restaurant. Management features (INSERT/UPDATE/DELETE)
-- remain restricted to owner/manager via the existing "Owners and managers can
-- manage employees" policy.

CREATE POLICY "Team members can view coworkers in their restaurant"
  ON public.employees
  FOR SELECT
  USING (
    restaurant_id IN (
      SELECT ur.restaurant_id
      FROM public.user_restaurants ur
      WHERE ur.user_id = auth.uid()
    )
  );
