-- Add lighthouse_location_ids column for storing Lighthouse location IDs
ALTER TABLE public.shift4_connections
  ADD COLUMN IF NOT EXISTS lighthouse_location_ids JSONB;

COMMENT ON COLUMN public.shift4_connections.lighthouse_location_ids IS 'JSON array of Lighthouse location IDs for sync';
