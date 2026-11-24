-- Make stripe_connected_accounts read-only for app users.
-- Only the service role (edge functions) writes this table.
-- The SELECT policy and the service_role grants stay unchanged.

DROP POLICY IF EXISTS "Owners can manage connected accounts" ON public.stripe_connected_accounts;

REVOKE INSERT, UPDATE, DELETE ON public.stripe_connected_accounts FROM authenticated;

-- Rollback SQL (run by hand; do not run in this migration).
-- These statements restore the state from 20251221000001_create_invoicing_tables.sql.
--
-- CREATE POLICY "Owners can manage connected accounts"
--   ON public.stripe_connected_accounts FOR ALL
--   USING (
--     restaurant_id IN (
--       SELECT restaurant_id FROM public.user_restaurants
--       WHERE user_id = auth.uid()
--       AND role = 'owner'
--     )
--   )
--   WITH CHECK (
--     restaurant_id IN (
--       SELECT restaurant_id FROM public.user_restaurants
--       WHERE user_id = auth.uid()
--       AND role = 'owner'
--     )
--   );
--
-- GRANT INSERT, UPDATE, DELETE ON public.stripe_connected_accounts TO authenticated;
