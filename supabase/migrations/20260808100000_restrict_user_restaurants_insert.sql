-- Block self-grant of restaurant membership through the browser client.
--
-- This policy denies an INSERT into user_restaurants unless the caller
-- already owns the target restaurant. Before this migration, a signed-in
-- stranger could insert a row for any restaurant_id, at any role, and grant
-- themselves membership. The permissive "Users can insert their own
-- restaurant associations" policy only checked user_id = auth.uid(), never
-- who owned the restaurant.
--
-- Every real writer of a new membership row bypasses RLS, so this guard
-- does not block a real product flow:
--   1. create_restaurant_with_owner: SECURITY DEFINER, owner postgres.
--      supabase/migrations/20260129000000_add_subscription_system.sql:367-420
--   2. accept-invitation edge function: service-role client.
--      supabase/functions/accept-invitation/index.ts:118-133
--   3. scim-v2 edge function: service-role client.
--      supabase/functions/scim-v2/index.ts:473-475
--   4. create-kiosk-service-account edge function: service-role client,
--      .upsert(). supabase/functions/create-kiosk-service-account/index.ts:38, 129-136
--
-- The new policy is RESTRICTIVE, not permissive. A permissive policy can
-- only widen access; it can never deny. memory/lessons.md:848 records PR
-- #568 making this exact mistake on this exact table: a permissive
-- deny-guard ORed with the pre-existing FOR ALL policy, so the escalation
-- still worked. Only a RESTRICTIVE policy narrows the effective check.

DROP POLICY IF EXISTS "Users can insert their own restaurant associations"
  ON public.user_restaurants;

-- Drop the new policy by its own name first, so a re-run of this file is a
-- refresh and not a "policy already exists" failure. Same pattern as
-- 20260730180000_close_role_id_self_escalation.sql:45-47.
DROP POLICY IF EXISTS "Only owners can insert restaurant associations"
  ON public.user_restaurants;

CREATE POLICY "Only owners can insert restaurant associations"
  ON public.user_restaurants
  AS RESTRICTIVE
  FOR INSERT
  TO public
  WITH CHECK (is_restaurant_owner(restaurant_id, auth.uid()));
