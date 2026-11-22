-- Make stripe_connected_accounts read-only for app users.
-- Only the service role (edge functions) writes this table.
-- The SELECT policy and the service_role grants stay unchanged.

DROP POLICY IF EXISTS "Owners can manage connected accounts" ON public.stripe_connected_accounts;

REVOKE INSERT, UPDATE, DELETE ON public.stripe_connected_accounts FROM authenticated;
