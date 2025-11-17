-- SHIFT4 POS INTEGRATION DATABASE SCHEMA
-- This migration sets up the complete database structure for Shift4 integration

-- Drop the incomplete shift4_connections table if it exists
DROP TABLE IF EXISTS public.shift4_connections CASCADE;

-- Table: shift4_connections
-- Stores API key and merchant information for Shift4 accounts
-- Unlike OAuth integrations, Shift4 uses API Key authentication
CREATE TABLE IF NOT EXISTS public.shift4_connections (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  restaurant_id UUID NOT NULL REFERENCES public.restaurants(id) ON DELETE CASCADE,
  merchant_id TEXT NOT NULL, -- Shift4 merchant identifier
  secret_key TEXT NOT NULL, -- Encrypted Shift4 Secret API Key
  environment TEXT NOT NULL DEFAULT 'production',
  connected_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_sync_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Table: shift4_charges
-- Stores charge (payment/sale) data synced from Shift4 API
CREATE TABLE IF NOT EXISTS public.shift4_charges (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  restaurant_id UUID NOT NULL REFERENCES public.restaurants(id) ON DELETE CASCADE,
  charge_id TEXT NOT NULL, -- Shift4 charge ID (e.g., "char_...")
  amount BIGINT NOT NULL, -- Amount in cents
  currency TEXT NOT NULL DEFAULT 'USD',
  status TEXT NOT NULL, -- successful, failed, etc.
  description TEXT,
  customer_email TEXT,
  created_at_ts BIGINT NOT NULL, -- Unix timestamp from Shift4 API
  service_date DATE NOT NULL,
  synced_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  raw_json JSONB, -- Full charge object from Shift4 API
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(restaurant_id, charge_id)
);

-- Table: shift4_refunds
-- Stores refund data from Shift4 API
CREATE TABLE IF NOT EXISTS public.shift4_refunds (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  restaurant_id UUID NOT NULL REFERENCES public.restaurants(id) ON DELETE CASCADE,
  refund_id TEXT NOT NULL, -- Shift4 refund ID
  charge_id TEXT NOT NULL, -- Associated charge ID
  amount BIGINT NOT NULL, -- Refund amount in cents
  currency TEXT NOT NULL DEFAULT 'USD',
  status TEXT NOT NULL,
  reason TEXT,
  created_at_ts BIGINT NOT NULL, -- Unix timestamp from Shift4 API
  service_date DATE NOT NULL,
  synced_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(restaurant_id, refund_id)
);

-- Table: shift4_webhook_events
-- Tracks processed webhook events to ensure idempotency
CREATE TABLE IF NOT EXISTS public.shift4_webhook_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  restaurant_id UUID NOT NULL REFERENCES public.restaurants(id) ON DELETE CASCADE,
  event_id TEXT NOT NULL, -- Shift4 event ID
  event_type TEXT NOT NULL,
  processed_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(event_id)
);

-- Indexes for performance
CREATE INDEX IF NOT EXISTS idx_shift4_connections_restaurant 
  ON public.shift4_connections(restaurant_id);

CREATE INDEX IF NOT EXISTS idx_shift4_connections_merchant 
  ON public.shift4_connections(merchant_id);

CREATE INDEX IF NOT EXISTS idx_shift4_charges_restaurant_date 
  ON public.shift4_charges(restaurant_id, service_date DESC);

CREATE INDEX IF NOT EXISTS idx_shift4_charges_charge_id 
  ON public.shift4_charges(charge_id);

CREATE INDEX IF NOT EXISTS idx_shift4_charges_created_ts 
  ON public.shift4_charges(created_at_ts DESC);

CREATE INDEX IF NOT EXISTS idx_shift4_refunds_restaurant 
  ON public.shift4_refunds(restaurant_id);

CREATE INDEX IF NOT EXISTS idx_shift4_refunds_charge_id 
  ON public.shift4_refunds(charge_id);

CREATE INDEX IF NOT EXISTS idx_shift4_webhook_events_restaurant 
  ON public.shift4_webhook_events(restaurant_id);

CREATE INDEX IF NOT EXISTS idx_shift4_webhook_events_event_id 
  ON public.shift4_webhook_events(event_id);

-- Enable RLS on all tables
ALTER TABLE public.shift4_connections ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.shift4_charges ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.shift4_refunds ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.shift4_webhook_events ENABLE ROW LEVEL SECURITY;

-- RLS Policies for shift4_connections
DROP POLICY IF EXISTS "Users can view shift4_connections for their restaurants" ON public.shift4_connections;
CREATE POLICY "Users can view shift4_connections for their restaurants"
  ON public.shift4_connections
  FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM public.user_restaurants
      WHERE user_restaurants.restaurant_id = shift4_connections.restaurant_id
        AND user_restaurants.user_id = auth.uid()
    )
  );

DROP POLICY IF EXISTS "Users can insert shift4_connections for their restaurants" ON public.shift4_connections;
CREATE POLICY "Users can insert shift4_connections for their restaurants"
  ON public.shift4_connections
  FOR INSERT
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.user_restaurants
      WHERE user_restaurants.restaurant_id = shift4_connections.restaurant_id
        AND user_restaurants.user_id = auth.uid()
        AND user_restaurants.role IN ('owner', 'manager')
    )
  );

DROP POLICY IF EXISTS "Users can update shift4_connections for their restaurants" ON public.shift4_connections;
CREATE POLICY "Users can update shift4_connections for their restaurants"
  ON public.shift4_connections
  FOR UPDATE
  USING (
    EXISTS (
      SELECT 1 FROM public.user_restaurants
      WHERE user_restaurants.restaurant_id = shift4_connections.restaurant_id
        AND user_restaurants.user_id = auth.uid()
        AND user_restaurants.role IN ('owner', 'manager')
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.user_restaurants
      WHERE user_restaurants.restaurant_id = shift4_connections.restaurant_id
        AND user_restaurants.user_id = auth.uid()
        AND user_restaurants.role IN ('owner', 'manager')
    )
  );

DROP POLICY IF EXISTS "Users can delete shift4_connections for their restaurants" ON public.shift4_connections;
CREATE POLICY "Users can delete shift4_connections for their restaurants"
  ON public.shift4_connections
  FOR DELETE
  USING (
    EXISTS (
      SELECT 1 FROM public.user_restaurants
      WHERE user_restaurants.restaurant_id = shift4_connections.restaurant_id
        AND user_restaurants.user_id = auth.uid()
        AND user_restaurants.role IN ('owner', 'manager')
    )
  );

-- RLS Policies for shift4_charges
DROP POLICY IF EXISTS "Users can view shift4_charges for their restaurants" ON public.shift4_charges;
CREATE POLICY "Users can view shift4_charges for their restaurants"
  ON public.shift4_charges
  FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM public.user_restaurants
      WHERE user_restaurants.restaurant_id = shift4_charges.restaurant_id
        AND user_restaurants.user_id = auth.uid()
    )
  );

DROP POLICY IF EXISTS "Users can insert shift4_charges for their restaurants" ON public.shift4_charges;
CREATE POLICY "Users can insert shift4_charges for their restaurants"
  ON public.shift4_charges
  FOR INSERT
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.user_restaurants
      WHERE user_restaurants.restaurant_id = shift4_charges.restaurant_id
        AND user_restaurants.user_id = auth.uid()
    )
  );

-- RLS Policies for shift4_refunds  
DROP POLICY IF EXISTS "Users can view shift4_refunds for their restaurants" ON public.shift4_refunds;
CREATE POLICY "Users can view shift4_refunds for their restaurants"
  ON public.shift4_refunds
  FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM public.user_restaurants
      WHERE user_restaurants.restaurant_id = shift4_refunds.restaurant_id
        AND user_restaurants.user_id = auth.uid()
    )
  );

DROP POLICY IF EXISTS "Users can insert shift4_refunds for their restaurants" ON public.shift4_refunds;
CREATE POLICY "Users can insert shift4_refunds for their restaurants"
  ON public.shift4_refunds
  FOR INSERT
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.user_restaurants
      WHERE user_restaurants.restaurant_id = shift4_refunds.restaurant_id
        AND user_restaurants.user_id = auth.uid()
    )
  );

-- RLS Policies for shift4_webhook_events
DROP POLICY IF EXISTS "Users can view shift4_webhook_events for their restaurants" ON public.shift4_webhook_events;
CREATE POLICY "Users can view shift4_webhook_events for their restaurants"
  ON public.shift4_webhook_events
  FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM public.user_restaurants
      WHERE user_restaurants.restaurant_id = shift4_webhook_events.restaurant_id
        AND user_restaurants.user_id = auth.uid()
    )
  );

-- Add triggers for updated_at
CREATE TRIGGER update_shift4_connections_updated_at
  BEFORE UPDATE ON public.shift4_connections
  FOR EACH ROW
  EXECUTE FUNCTION public.update_accounting_updated_at();

CREATE TRIGGER update_shift4_charges_updated_at
  BEFORE UPDATE ON public.shift4_charges
  FOR EACH ROW
  EXECUTE FUNCTION public.update_accounting_updated_at();

CREATE TRIGGER update_shift4_refunds_updated_at
  BEFORE UPDATE ON public.shift4_refunds
  FOR EACH ROW
  EXECUTE FUNCTION public.update_accounting_updated_at();