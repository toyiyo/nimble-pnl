-- Split chart_of_accounts RLS policy into separate policies for each operation
-- This follows best practices and makes debugging easier

-- Drop the existing ALL policy
DROP POLICY IF EXISTS "Owners and managers can manage chart of accounts" ON chart_of_accounts;
DROP POLICY IF EXISTS "Users can view chart of accounts for their restaurants" ON chart_of_accounts;

-- Create separate policies for each operation
CREATE POLICY "Users can view chart of accounts for their restaurants"
  ON public.chart_of_accounts 
  FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM public.user_restaurants
      WHERE user_restaurants.restaurant_id = chart_of_accounts.restaurant_id
      AND user_restaurants.user_id = auth.uid()
    )
  );

CREATE POLICY "Owners and managers can insert accounts"
  ON public.chart_of_accounts 
  FOR INSERT
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.user_restaurants
      WHERE user_restaurants.restaurant_id = chart_of_accounts.restaurant_id
      AND user_restaurants.user_id = auth.uid()
      AND user_restaurants.role IN ('owner', 'manager')
    )
  );

CREATE POLICY "Owners and managers can update accounts"
  ON public.chart_of_accounts 
  FOR UPDATE
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

CREATE POLICY "Owners and managers can delete accounts"
  ON public.chart_of_accounts 
  FOR DELETE
  USING (
    EXISTS (
      SELECT 1 FROM public.user_restaurants
      WHERE user_restaurants.restaurant_id = chart_of_accounts.restaurant_id
      AND user_restaurants.user_id = auth.uid()
      AND user_restaurants.role IN ('owner', 'manager')
    )
  );