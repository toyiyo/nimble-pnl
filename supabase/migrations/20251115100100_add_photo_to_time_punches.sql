-- Add photo field to time_punches for selfie verification
-- Photos are stored as base64 data URLs for simplicity
-- Could be migrated to Supabase Storage in the future for better performance

ALTER TABLE time_punches 
ADD COLUMN IF NOT EXISTS photo TEXT; -- Base64 data URL of the selfie

COMMENT ON COLUMN time_punches.photo IS 'Base64-encoded photo (selfie) taken during clock in/out for verification purposes';
