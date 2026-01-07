-- Migration: Convert Toast integration to Standard API Access
-- This replaces the OAuth-based approach with client credential authentication

-- Drop the old OAuth-based toast_connections table and recreate for Standard API
DROP TABLE IF EXISTS public.toast_connections CASCADE;

-- Create new toast_connections table for Standard API Access
CREATE TABLE IF NOT EXISTS public.toast_connections (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  restaurant_id UUID NOT NULL REFERENCES public.restaurants(id) ON DELETE CASCADE,
  
  -- Standard API credentials (encrypted)
  client_id TEXT NOT NULL,
  client_secret_encrypted TEXT NOT NULL,
  
  -- Restaurant GUID from Toast (user-provided or fetched via API)
  toast_restaurant_guid TEXT NOT NULL,
  
  -- Bearer token cache (tokens last 24 hours)
  access_token_encrypted TEXT,
  token_expires_at TIMESTAMP WITH TIME ZONE,
  token_fetched_at TIMESTAMP WITH TIME ZONE,
  
  -- Webhook configuration (manually set up in Toast Web)
  webhook_secret_encrypted TEXT,
  webhook_subscription_guid TEXT,
  webhook_active BOOLEAN DEFAULT false,
  
  -- Sync tracking
  last_sync_time TIMESTAMP WITH TIME ZONE,
  initial_sync_done BOOLEAN DEFAULT false,
  
  -- Status tracking
  is_active BOOLEAN DEFAULT true,
  connection_status TEXT DEFAULT 'pending', -- 'pending', 'connected', 'error', 'disconnected'
  last_error TEXT,
  last_error_at TIMESTAMP WITH TIME ZONE,
  
  -- Metadata
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  
  -- Unique constraint: one connection per restaurant
  UNIQUE(restaurant_id)
);

-- Enable RLS on toast_connections
ALTER TABLE public.toast_connections ENABLE ROW LEVEL SECURITY;

-- RLS Policies for toast_connections
-- Allow users to view connections for their restaurants
CREATE POLICY "Users can view their restaurant's Toast connection"
ON public.toast_connections
FOR SELECT
USING (
  restaurant_id IN (
    SELECT restaurant_id 
    FROM public.user_restaurants 
    WHERE user_id = auth.uid()
  )
);

-- Allow owners/managers to insert/update connections
CREATE POLICY "Owners and managers can manage Toast connections"
ON public.toast_connections
FOR ALL
USING (
  restaurant_id IN (
    SELECT restaurant_id 
    FROM public.user_restaurants 
    WHERE user_id = auth.uid() 
    AND role IN ('owner', 'manager')
  )
);

-- Update trigger for updated_at
CREATE OR REPLACE FUNCTION update_toast_connections_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER update_toast_connections_updated_at
BEFORE UPDATE ON public.toast_connections
FOR EACH ROW
EXECUTE FUNCTION update_toast_connections_updated_at();

-- Add index for faster lookups
CREATE INDEX IF NOT EXISTS idx_toast_connections_restaurant_id 
ON public.toast_connections(restaurant_id);

CREATE INDEX IF NOT EXISTS idx_toast_connections_toast_restaurant_guid 
ON public.toast_connections(toast_restaurant_guid);

CREATE INDEX IF NOT EXISTS idx_toast_connections_active 
ON public.toast_connections(is_active) 
WHERE is_active = true;

-- Note: toast_orders, toast_order_items, toast_payments, toast_menu_items, 
-- and toast_webhook_events tables remain unchanged as they are API-agnostic
