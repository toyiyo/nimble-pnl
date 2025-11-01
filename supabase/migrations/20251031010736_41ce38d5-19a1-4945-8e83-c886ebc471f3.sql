-- Add RLS policies for unified_sales table to allow file uploads

-- Enable RLS on unified_sales if not already enabled
ALTER TABLE unified_sales ENABLE ROW LEVEL SECURITY;

-- Drop existing policies if they exist to recreate them
DROP POLICY IF EXISTS "Users can view sales for their restaurants" ON unified_sales;
DROP POLICY IF EXISTS "Users can insert sales for their restaurants" ON unified_sales;
DROP POLICY IF EXISTS "Users can update sales for their restaurants" ON unified_sales;
DROP POLICY IF EXISTS "Users can delete manual sales for their restaurants" ON unified_sales;

-- Allow users to view sales for their restaurants
CREATE POLICY "Users can view sales for their restaurants"
ON unified_sales
FOR SELECT
USING (
  EXISTS (
    SELECT 1
    FROM user_restaurants
    WHERE user_restaurants.restaurant_id = unified_sales.restaurant_id
    AND user_restaurants.user_id = auth.uid()
  )
);

-- Allow owners, managers, and staff to insert sales for their restaurants
CREATE POLICY "Users can insert sales for their restaurants"
ON unified_sales
FOR INSERT
WITH CHECK (
  EXISTS (
    SELECT 1
    FROM user_restaurants
    WHERE user_restaurants.restaurant_id = unified_sales.restaurant_id
    AND user_restaurants.user_id = auth.uid()
    AND user_restaurants.role IN ('owner', 'manager', 'staff', 'chef')
  )
);

-- Allow owners and managers to update sales for their restaurants
CREATE POLICY "Users can update sales for their restaurants"
ON unified_sales
FOR UPDATE
USING (
  EXISTS (
    SELECT 1
    FROM user_restaurants
    WHERE user_restaurants.restaurant_id = unified_sales.restaurant_id
    AND user_restaurants.user_id = auth.uid()
    AND user_restaurants.role IN ('owner', 'manager')
  )
);

-- Allow owners and managers to delete manual sales (not from POS systems)
CREATE POLICY "Users can delete manual sales for their restaurants"
ON unified_sales
FOR DELETE
USING (
  EXISTS (
    SELECT 1
    FROM user_restaurants
    WHERE user_restaurants.restaurant_id = unified_sales.restaurant_id
    AND user_restaurants.user_id = auth.uid()
    AND user_restaurants.role IN ('owner', 'manager')
  )
  AND pos_system IN ('manual', 'manual_upload')
);