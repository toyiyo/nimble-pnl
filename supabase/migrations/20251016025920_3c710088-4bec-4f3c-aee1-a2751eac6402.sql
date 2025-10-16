-- Fix missing WITH CHECK clauses on Clover FOR ALL policies
-- This is a security fix: without WITH CHECK, INSERT/UPDATE operations
-- could bypass the restaurant membership and role restrictions

-- Drop and recreate clover_connections manage policy
DROP POLICY IF EXISTS "Restaurant owners and managers can manage Clover connections" ON public.clover_connections;

CREATE POLICY "Restaurant owners and managers can manage Clover connections"
  ON public.clover_connections FOR ALL
  USING (
    EXISTS (
      SELECT 1 FROM public.user_restaurants
      WHERE user_restaurants.restaurant_id = clover_connections.restaurant_id
        AND user_restaurants.user_id = auth.uid()
        AND user_restaurants.role IN ('owner', 'manager')
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.user_restaurants
      WHERE user_restaurants.restaurant_id = clover_connections.restaurant_id
        AND user_restaurants.user_id = auth.uid()
        AND user_restaurants.role IN ('owner', 'manager')
    )
  );

-- Drop and recreate clover_locations manage policy
DROP POLICY IF EXISTS "Restaurant owners and managers can manage Clover locations" ON public.clover_locations;

CREATE POLICY "Restaurant owners and managers can manage Clover locations"
  ON public.clover_locations FOR ALL
  USING (
    EXISTS (
      SELECT 1 FROM public.user_restaurants
      WHERE user_restaurants.restaurant_id = clover_locations.restaurant_id
        AND user_restaurants.user_id = auth.uid()
        AND user_restaurants.role IN ('owner', 'manager')
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.user_restaurants
      WHERE user_restaurants.restaurant_id = clover_locations.restaurant_id
        AND user_restaurants.user_id = auth.uid()
        AND user_restaurants.role IN ('owner', 'manager')
    )
  );

-- Drop and recreate clover_orders manage policy
DROP POLICY IF EXISTS "Restaurant owners and managers can manage Clover orders" ON public.clover_orders;

CREATE POLICY "Restaurant owners and managers can manage Clover orders"
  ON public.clover_orders FOR ALL
  USING (
    EXISTS (
      SELECT 1 FROM public.user_restaurants
      WHERE user_restaurants.restaurant_id = clover_orders.restaurant_id
        AND user_restaurants.user_id = auth.uid()
        AND user_restaurants.role IN ('owner', 'manager')
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.user_restaurants
      WHERE user_restaurants.restaurant_id = clover_orders.restaurant_id
        AND user_restaurants.user_id = auth.uid()
        AND user_restaurants.role IN ('owner', 'manager')
    )
  );

-- Drop and recreate clover_order_line_items manage policy
DROP POLICY IF EXISTS "Restaurant owners and managers can manage Clover line items" ON public.clover_order_line_items;

CREATE POLICY "Restaurant owners and managers can manage Clover line items"
  ON public.clover_order_line_items FOR ALL
  USING (
    EXISTS (
      SELECT 1 FROM public.user_restaurants
      WHERE user_restaurants.restaurant_id = clover_order_line_items.restaurant_id
        AND user_restaurants.user_id = auth.uid()
        AND user_restaurants.role IN ('owner', 'manager')
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.user_restaurants
      WHERE user_restaurants.restaurant_id = clover_order_line_items.restaurant_id
        AND user_restaurants.user_id = auth.uid()
        AND user_restaurants.role IN ('owner', 'manager')
    )
  );