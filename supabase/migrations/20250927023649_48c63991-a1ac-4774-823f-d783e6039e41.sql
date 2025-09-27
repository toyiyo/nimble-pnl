-- Fix Extension in Public Schema Security Issue
-- Create a dedicated schema for extensions
CREATE SCHEMA IF NOT EXISTS extensions;

-- Move pg_net extension from public to extensions schema
-- Note: Some extensions may not support schema changes, so we'll recreate it
DROP EXTENSION IF EXISTS pg_net;
CREATE EXTENSION pg_net SCHEMA extensions;

-- Grant necessary permissions to use pg_net from the extensions schema
GRANT USAGE ON SCHEMA extensions TO authenticated, anon, service_role;

-- Update any existing functions that might reference pg_net
-- Most Supabase Edge Functions should continue to work as they use qualified names