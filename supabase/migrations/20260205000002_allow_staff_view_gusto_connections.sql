-- Restrict Gusto connection visibility to owners and managers only.
-- The gusto_connections table contains encrypted OAuth tokens that must not
-- be exposed to staff or kiosk roles. The original SELECT policy from
-- 20260205000000 already limits access to owner/manager -- this migration
-- drops the overly-broad policy that was added in error and ensures only
-- the correct owner/manager policy exists.

-- Drop the overly-broad policy if it was already applied
DROP POLICY IF EXISTS "All restaurant users can view Gusto connections" ON public.gusto_connections;

-- Ensure the correct owner/manager SELECT policy exists (idempotent)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE policyname = 'Owners and managers can view Gusto connections'
      AND tablename = 'gusto_connections'
  ) THEN
    -- Also drop the old-named policy if it exists, to avoid duplicates
    DROP POLICY IF EXISTS "Restaurant owners and managers can view Gusto connections" ON public.gusto_connections;

    CREATE POLICY "Owners and managers can view Gusto connections"
    ON public.gusto_connections
    FOR SELECT
    TO authenticated
    USING (
      EXISTS (
        SELECT 1 FROM public.user_restaurants
        WHERE user_restaurants.restaurant_id = gusto_connections.restaurant_id
        AND user_restaurants.user_id = auth.uid()
        AND user_restaurants.role IN ('owner', 'manager')
      )
    );
  END IF;
END $$;
