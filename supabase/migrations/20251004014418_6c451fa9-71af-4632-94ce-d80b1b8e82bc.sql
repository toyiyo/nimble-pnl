-- Update the UPDATE policy to allow manual_upload as well
DROP POLICY IF EXISTS "Users can update manual sales for their restaurants" ON public.unified_sales;

CREATE POLICY "Users can update manual sales for their restaurants"
ON public.unified_sales
FOR UPDATE
USING (
  EXISTS (
    SELECT 1 FROM user_restaurants
    WHERE user_restaurants.restaurant_id = unified_sales.restaurant_id
    AND user_restaurants.user_id = auth.uid()
    AND user_restaurants.role IN ('owner', 'manager')
  )
  AND pos_system IN ('manual', 'manual_upload')
)
WITH CHECK (
  EXISTS (
    SELECT 1 FROM user_restaurants
    WHERE user_restaurants.restaurant_id = unified_sales.restaurant_id
    AND user_restaurants.user_id = auth.uid()
    AND user_restaurants.role IN ('owner', 'manager')
  )
  AND pos_system IN ('manual', 'manual_upload')
);

-- Update the DELETE policy to allow manual_upload as well
DROP POLICY IF EXISTS "Users can delete manual sales for their restaurants" ON public.unified_sales;

CREATE POLICY "Users can delete manual sales for their restaurants"
ON public.unified_sales
FOR DELETE
USING (
  EXISTS (
    SELECT 1 FROM user_restaurants
    WHERE user_restaurants.restaurant_id = unified_sales.restaurant_id
    AND user_restaurants.user_id = auth.uid()
    AND user_restaurants.role IN ('owner', 'manager')
  )
  AND pos_system IN ('manual', 'manual_upload')
);