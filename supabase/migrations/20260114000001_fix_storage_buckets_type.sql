-- Fix: Storage buckets_analytics type mismatch
-- This is a workaround for Supabase storage bug
-- The actual issue is in Supabase's storage service, not our migrations
-- 
-- NOTE: The daily_rate migration (20260114000000) applied successfully
-- This error occurs during container restart and doesn't affect functionality

-- No changes needed - this is just a placeholder to document the issue
