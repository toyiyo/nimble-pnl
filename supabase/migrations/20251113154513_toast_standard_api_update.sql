-- Update Toast connections table for Standard API access
-- This migration adds support for direct credential entry instead of OAuth

-- Add new columns for Standard API credentials
ALTER TABLE public.toast_connections 
ADD COLUMN IF NOT EXISTS client_id TEXT,
ADD COLUMN IF NOT EXISTS client_secret TEXT,
ADD COLUMN IF NOT EXISTS api_url TEXT;

-- Update existing comment to reflect new usage
COMMENT ON TABLE public.toast_connections IS 'Stores Toast Standard API credentials for each restaurant. Uses client credentials grant instead of OAuth authorization code flow.';
COMMENT ON COLUMN public.toast_connections.client_id IS 'Encrypted Toast API client ID from restaurant''s Toast Web portal';
COMMENT ON COLUMN public.toast_connections.client_secret IS 'Encrypted Toast API client secret from restaurant''s Toast Web portal';
COMMENT ON COLUMN public.toast_connections.api_url IS 'Toast API base URL (e.g., https://ws-api.toasttab.com)';
COMMENT ON COLUMN public.toast_connections.access_token IS 'Encrypted access token obtained via client credentials grant';
COMMENT ON COLUMN public.toast_connections.refresh_token IS 'Not used for Standard API (client credentials grant)';
