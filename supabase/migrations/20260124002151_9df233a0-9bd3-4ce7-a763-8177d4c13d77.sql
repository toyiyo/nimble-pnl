-- Fix RLS policies for asset-images bucket
-- The upload path format is: {restaurantId}/assets/{assetId}/{filename}
-- So we need to check split_part(name, '/', 1) for restaurantId

-- Drop existing policies
DROP POLICY IF EXISTS "Users can view asset images for their restaurants" ON storage.objects;
DROP POLICY IF EXISTS "Owners managers and accountants can upload asset images" ON storage.objects;
DROP POLICY IF EXISTS "Owners managers and accountants can update asset images" ON storage.objects;
DROP POLICY IF EXISTS "Owners managers and accountants can delete asset images" ON storage.objects;

-- Recreate with corrected path matching
CREATE POLICY "Users can view asset images for their restaurants"
  ON storage.objects FOR SELECT
  USING (
    bucket_id = 'asset-images'
    AND EXISTS (
      SELECT 1 FROM public.user_restaurants
      WHERE user_restaurants.user_id = auth.uid()
      AND user_restaurants.role IN ('owner', 'manager', 'collaborator_accountant')
      AND split_part(name, '/', 1) = user_restaurants.restaurant_id::text
    )
  );

CREATE POLICY "Owners managers and accountants can upload asset images"
  ON storage.objects FOR INSERT
  WITH CHECK (
    bucket_id = 'asset-images'
    AND EXISTS (
      SELECT 1 FROM public.user_restaurants
      WHERE user_restaurants.user_id = auth.uid()
      AND user_restaurants.role IN ('owner', 'manager', 'collaborator_accountant')
      AND split_part(name, '/', 1) = user_restaurants.restaurant_id::text
    )
  );

CREATE POLICY "Owners managers and accountants can update asset images"
  ON storage.objects FOR UPDATE
  USING (
    bucket_id = 'asset-images'
    AND EXISTS (
      SELECT 1 FROM public.user_restaurants
      WHERE user_restaurants.user_id = auth.uid()
      AND user_restaurants.role IN ('owner', 'manager', 'collaborator_accountant')
      AND split_part(name, '/', 1) = user_restaurants.restaurant_id::text
    )
  );

CREATE POLICY "Owners managers and accountants can delete asset images"
  ON storage.objects FOR DELETE
  USING (
    bucket_id = 'asset-images'
    AND EXISTS (
      SELECT 1 FROM public.user_restaurants
      WHERE user_restaurants.user_id = auth.uid()
      AND user_restaurants.role IN ('owner', 'manager', 'collaborator_accountant')
      AND split_part(name, '/', 1) = user_restaurants.restaurant_id::text
    )
  );