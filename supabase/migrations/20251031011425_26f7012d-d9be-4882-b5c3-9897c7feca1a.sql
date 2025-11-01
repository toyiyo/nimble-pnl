-- Fix chart_of_accounts RLS policy to include WITH CHECK clause for INSERT operations

-- Drop the existing policy
DROP POLICY IF EXISTS "Owners and managers can manage chart of accounts" ON chart_of_accounts;

-- Recreate with both USING and WITH CHECK clauses
CREATE POLICY "Owners and managers can manage chart of accounts"
  ON public.chart_of_accounts 
  FOR ALL
  USING (
    EXISTS (
      SELECT 1 FROM public.user_restaurants
      WHERE user_restaurants.restaurant_id = chart_of_accounts.restaurant_id
      AND user_restaurants.user_id = auth.uid()
      AND user_restaurants.role IN ('owner', 'manager')
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.user_restaurants
      WHERE user_restaurants.restaurant_id = chart_of_accounts.restaurant_id
      AND user_restaurants.user_id = auth.uid()
      AND user_restaurants.role IN ('owner', 'manager')
    )
  );