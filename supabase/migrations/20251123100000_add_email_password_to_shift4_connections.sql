-- Add email and password columns for Lighthouse authentication
ALTER TABLE public.shift4_connections
  ADD COLUMN IF NOT EXISTS email TEXT,
  ADD COLUMN IF NOT EXISTS password TEXT;

-- Optionally, add comments for clarity
COMMENT ON COLUMN public.shift4_connections.email IS 'Encrypted Lighthouse username/email';
COMMENT ON COLUMN public.shift4_connections.password IS 'Encrypted Lighthouse password';
