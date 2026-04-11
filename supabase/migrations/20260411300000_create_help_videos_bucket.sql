-- Create public storage bucket for employee help videos
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'help-videos',
  'help-videos',
  true,
  5242880, -- 5MB max per file
  ARRAY['video/mp4']::text[]
)
ON CONFLICT (id) DO NOTHING;

-- Allow public read access (videos are non-sensitive)
CREATE POLICY "Public read access for help videos"
ON storage.objects FOR SELECT
USING (bucket_id = 'help-videos');

-- Allow authenticated users to upload (restricted in practice by app logic)
CREATE POLICY "Authenticated users can upload help videos"
ON storage.objects FOR INSERT
WITH CHECK (
  bucket_id = 'help-videos'
  AND auth.role() = 'authenticated'
);
