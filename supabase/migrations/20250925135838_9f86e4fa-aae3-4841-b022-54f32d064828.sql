-- Create storage bucket for product images
INSERT INTO storage.buckets (id, name, public) 
VALUES ('product-images', 'product-images', true);

-- Add image_url field to products table
ALTER TABLE public.products 
ADD COLUMN image_url text;

-- Change inventory quantity fields to support decimals
ALTER TABLE public.products 
ALTER COLUMN current_stock TYPE numeric USING current_stock::numeric,
ALTER COLUMN par_level_min TYPE numeric USING par_level_min::numeric,
ALTER COLUMN par_level_max TYPE numeric USING par_level_max::numeric,
ALTER COLUMN reorder_point TYPE numeric USING reorder_point::numeric;

-- Create RLS policies for product images bucket
CREATE POLICY "Product images are publicly accessible" 
ON storage.objects 
FOR SELECT 
USING (bucket_id = 'product-images');

CREATE POLICY "Users can upload product images for their restaurants" 
ON storage.objects 
FOR INSERT 
WITH CHECK (
  bucket_id = 'product-images' 
  AND EXISTS (
    SELECT 1 FROM user_restaurants 
    WHERE user_id = auth.uid() 
    AND role IN ('owner', 'manager', 'chef')
  )
);

CREATE POLICY "Users can update product images for their restaurants" 
ON storage.objects 
FOR UPDATE 
USING (
  bucket_id = 'product-images' 
  AND EXISTS (
    SELECT 1 FROM user_restaurants 
    WHERE user_id = auth.uid() 
    AND role IN ('owner', 'manager', 'chef')
  )
);

CREATE POLICY "Users can delete product images for their restaurants" 
ON storage.objects 
FOR DELETE 
USING (
  bucket_id = 'product-images' 
  AND EXISTS (
    SELECT 1 FROM user_restaurants 
    WHERE user_id = auth.uid() 
    AND role IN ('owner', 'manager', 'chef')
  )
);