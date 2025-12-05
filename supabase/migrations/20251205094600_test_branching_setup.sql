-- Test migration to validate Supabase branching setup
-- This adds a comment to a table and can be safely applied
-- Updated: Force re-sync after fixing directory path

-- Add a comment to verify the migration ran
COMMENT ON TABLE public.restaurants IS 'Core table for restaurant data. Migration test: branching setup validated on 2025-12-05.';

-- Log that the test migration was applied (will show in migration history)
DO $$
BEGIN
  RAISE NOTICE 'Supabase branching test migration applied successfully';
END $$;
