-- Create receipt-images storage bucket if it doesn't exist
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'receipt-images', 
  'receipt-images', 
  false, 
  52428800, -- 50MB limit
  ARRAY['image/jpeg', 'image/jpg', 'image/png', 'image/webp']
)
ON CONFLICT (id) DO UPDATE SET
  file_size_limit = 52428800,
  allowed_mime_types = ARRAY['image/jpeg', 'image/jpg', 'image/png', 'image/webp'];

-- Drop existing policies to recreate them
DROP POLICY IF EXISTS "Users can upload receipt images for their restaurants" ON storage.objects;
DROP POLICY IF EXISTS "Users can view receipt images for their restaurants" ON storage.objects;
DROP POLICY IF EXISTS "Users can update receipt images for their restaurants" ON storage.objects;
DROP POLICY IF EXISTS "Users can delete receipt images for their restaurants" ON storage.objects;

-- Allow users to upload receipt images to their restaurant folders
CREATE POLICY "Users can upload receipt images for their restaurants" 
ON storage.objects 
FOR INSERT 
WITH CHECK (
  bucket_id = 'receipt-images' 
  AND EXISTS (
    SELECT 1 
    FROM user_restaurants ur
    WHERE ur.restaurant_id::text = (storage.foldername(name))[1]
    AND ur.user_id = auth.uid()
    AND ur.role = ANY(ARRAY['owner'::text, 'manager'::text, 'chef'::text])
  )
);

-- Allow users to view receipt images for their restaurants
CREATE POLICY "Users can view receipt images for their restaurants" 
ON storage.objects 
FOR SELECT 
USING (
  bucket_id = 'receipt-images' 
  AND EXISTS (
    SELECT 1 
    FROM user_restaurants ur
    WHERE ur.restaurant_id::text = (storage.foldername(name))[1]
    AND ur.user_id = auth.uid()
  )
);

-- Allow users to update receipt images for their restaurants
CREATE POLICY "Users can update receipt images for their restaurants" 
ON storage.objects 
FOR UPDATE 
USING (
  bucket_id = 'receipt-images' 
  AND EXISTS (
    SELECT 1 
    FROM user_restaurants ur
    WHERE ur.restaurant_id::text = (storage.foldername(name))[1]
    AND ur.user_id = auth.uid()
    AND ur.role = ANY(ARRAY['owner'::text, 'manager'::text, 'chef'::text])
  )
);

-- Allow users to delete receipt images for their restaurants  
CREATE POLICY "Users can delete receipt images for their restaurants" 
ON storage.objects 
FOR DELETE 
USING (
  bucket_id = 'receipt-images' 
  AND EXISTS (
    SELECT 1 
    FROM user_restaurants ur
    WHERE ur.restaurant_id::text = (storage.foldername(name))[1]
    AND ur.user_id = auth.uid()
    AND ur.role = ANY(ARRAY['owner'::text, 'manager'::text])
  )
);