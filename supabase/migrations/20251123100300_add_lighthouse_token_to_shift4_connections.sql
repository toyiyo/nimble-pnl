-- Add Lighthouse token columns for authentication and expiry
ALTER TABLE public.shift4_connections
  ADD COLUMN IF NOT EXISTS lighthouse_token TEXT,
  ADD COLUMN IF NOT EXISTS lighthouse_token_expires_at TIMESTAMP;

COMMENT ON COLUMN public.shift4_connections.lighthouse_token IS 'Encrypted Lighthouse API token';
COMMENT ON COLUMN public.shift4_connections.lighthouse_token_expires_at IS 'Expiry timestamp for Lighthouse token';
