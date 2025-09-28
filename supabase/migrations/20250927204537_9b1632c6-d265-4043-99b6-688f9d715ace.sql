-- Create storage bucket for receipt files
INSERT INTO storage.buckets (id, name, public) 
VALUES ('receipt-images', 'receipt-images', false)
ON CONFLICT (id) DO NOTHING;

-- Storage policies for receipt images
CREATE POLICY "Users can view receipt images for their restaurants" 
ON storage.objects 
FOR SELECT 
USING (
  bucket_id = 'receipt-images' 
  AND auth.uid()::text = (storage.foldername(name))[1]
);

CREATE POLICY "Users can upload receipt images for their restaurants" 
ON storage.objects 
FOR INSERT 
WITH CHECK (
  bucket_id = 'receipt-images' 
  AND auth.uid()::text = (storage.foldername(name))[1]
);

CREATE POLICY "Users can update receipt images for their restaurants" 
ON storage.objects 
FOR UPDATE 
USING (
  bucket_id = 'receipt-images' 
  AND auth.uid()::text = (storage.foldername(name))[1]
);