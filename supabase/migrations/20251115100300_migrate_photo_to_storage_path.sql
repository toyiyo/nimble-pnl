-- Migration to change photo storage from base64 to Supabase Storage paths
-- Following the same pattern as receipt images

-- Step 1: Rename photo column to photo_path for clarity
ALTER TABLE time_punches 
RENAME COLUMN photo TO photo_path;

-- Step 2: Add comment explaining the new format
COMMENT ON COLUMN time_punches.photo_path IS 'Storage path in time-clock-photos bucket (e.g., restaurant_id/employee_id/punch-timestamp.jpg). Not a full URL.';

-- Step 3: Create storage bucket for time clock photos (if not exists)
-- Note: This needs to be run manually in Supabase dashboard or via storage API
-- INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
-- VALUES (
--   'time-clock-photos',
--   'time-clock-photos',
--   false,
--   5242880, -- 5MB limit
--   ARRAY['image/jpeg', 'image/png', 'image/jpg']
-- )
-- ON CONFLICT (id) DO NOTHING;

-- Step 4: RLS policies for time-clock-photos bucket
-- These will be created via the Supabase dashboard Storage > Policies

-- Policy 1: Employees can upload their own photos
-- CREATE POLICY "Employees can upload own photos"
-- ON storage.objects FOR INSERT
-- WITH CHECK (
--   bucket_id = 'time-clock-photos' AND
--   (storage.foldername(name))[1] IN (
--     SELECT restaurant_id::text FROM employees WHERE user_id = auth.uid()
--   ) AND
--   (storage.foldername(name))[2] IN (
--     SELECT id::text FROM employees WHERE user_id = auth.uid()
--   )
-- );

-- Policy 2: Managers and owners can view all photos for their restaurants
-- CREATE POLICY "Managers can view restaurant photos"
-- ON storage.objects FOR SELECT
-- USING (
--   bucket_id = 'time-clock-photos' AND
--   (storage.foldername(name))[1] IN (
--     SELECT restaurant_id::text FROM user_restaurants 
--     WHERE user_id = auth.uid() 
--     AND role IN ('owner', 'manager')
--   )
-- );

-- Policy 3: Employees can view their own photos
-- CREATE POLICY "Employees can view own photos"
-- ON storage.objects FOR SELECT
-- USING (
--   bucket_id = 'time-clock-photos' AND
--   (storage.foldername(name))[1] IN (
--     SELECT restaurant_id::text FROM employees WHERE user_id = auth.uid()
--   ) AND
--   (storage.foldername(name))[2] IN (
--     SELECT id::text FROM employees WHERE user_id = auth.uid()
--   )
-- );

-- Note: Existing base64 photos will remain in the database as-is for backwards compatibility
-- New photos will use the storage path format
-- The application code will handle both formats transparently
