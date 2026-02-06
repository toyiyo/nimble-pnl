-- Allow all restaurant staff to view Gusto connection status
-- This enables the Payroll tab to show for employees in the Employee Portal
-- Staff can only VIEW, not modify the connection

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'All restaurant users can view Gusto connections' AND tablename = 'gusto_connections') THEN
    CREATE POLICY "All restaurant users can view Gusto connections"
    ON gusto_connections
    FOR SELECT
    TO authenticated
    USING (
      EXISTS (
        SELECT 1 FROM user_restaurants
        WHERE user_restaurants.restaurant_id = gusto_connections.restaurant_id
        AND user_restaurants.user_id = auth.uid()
      )
    );
  END IF;
END $$;
