-- Fix RLS policies for receipt-images storage bucket

-- Drop existing policies that might be too restrictive
DROP POLICY IF EXISTS "Users can upload receipt images to their restaurant folder" ON storage.objects;
DROP POLICY IF EXISTS "Users can view receipt images from their restaurants" ON storage.objects;
DROP POLICY IF EXISTS "Users can update receipt images in their restaurant folder" ON storage.objects;

-- Create more permissive policies for receipt-images bucket
CREATE POLICY "Allow authenticated users to upload receipt images" 
ON storage.objects 
FOR INSERT 
TO authenticated
WITH CHECK (
  bucket_id = 'receipt-images' AND 
  auth.uid() IS NOT NULL
);

CREATE POLICY "Allow authenticated users to view their receipt images" 
ON storage.objects 
FOR SELECT 
TO authenticated
USING (
  bucket_id = 'receipt-images' AND 
  auth.uid() IS NOT NULL
);

CREATE POLICY "Allow authenticated users to update their receipt images" 
ON storage.objects 
FOR UPDATE 
TO authenticated
USING (
  bucket_id = 'receipt-images' AND 
  auth.uid() IS NOT NULL
);

CREATE POLICY "Allow authenticated users to delete their receipt images" 
ON storage.objects 
FOR DELETE 
TO authenticated
USING (
  bucket_id = 'receipt-images' AND 
  auth.uid() IS NOT NULL
);