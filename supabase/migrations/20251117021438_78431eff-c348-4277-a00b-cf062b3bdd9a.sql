-- Drop existing Shift4 tables if they exist
DROP TABLE IF EXISTS shift4_webhook_events CASCADE;
DROP TABLE IF EXISTS shift4_refunds CASCADE;
DROP TABLE IF EXISTS shift4_charges CASCADE;
DROP TABLE IF EXISTS shift4_connections CASCADE;

-- Create shift4_connections table with correct schema (API Key based)
CREATE TABLE shift4_connections (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  restaurant_id UUID NOT NULL REFERENCES restaurants(id) ON DELETE CASCADE,
  merchant_id TEXT NOT NULL,
  secret_key TEXT NOT NULL, -- Encrypted secret key
  environment TEXT NOT NULL DEFAULT 'production' CHECK (environment IN ('test', 'production')),
  connected_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_sync_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(restaurant_id, merchant_id)
);

-- Create shift4_charges table
CREATE TABLE shift4_charges (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  restaurant_id UUID NOT NULL REFERENCES restaurants(id) ON DELETE CASCADE,
  charge_id TEXT NOT NULL,
  merchant_id TEXT NOT NULL,
  amount INTEGER NOT NULL,
  currency TEXT NOT NULL DEFAULT 'USD',
  status TEXT NOT NULL,
  refunded BOOLEAN NOT NULL DEFAULT false,
  captured BOOLEAN NOT NULL DEFAULT false,
  created_at_ts BIGINT NOT NULL,
  created_time TIMESTAMPTZ NOT NULL,
  service_date DATE,
  service_time TIME,
  description TEXT,
  tip_amount INTEGER DEFAULT 0,
  raw_json JSONB,
  synced_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(restaurant_id, charge_id)
);

-- Create shift4_refunds table
CREATE TABLE shift4_refunds (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  restaurant_id UUID NOT NULL REFERENCES restaurants(id) ON DELETE CASCADE,
  refund_id TEXT NOT NULL,
  charge_id TEXT NOT NULL,
  merchant_id TEXT NOT NULL,
  amount INTEGER NOT NULL,
  currency TEXT NOT NULL DEFAULT 'USD',
  status TEXT NOT NULL,
  reason TEXT,
  created_at_ts BIGINT NOT NULL,
  created_time TIMESTAMPTZ NOT NULL,
  service_date DATE,
  raw_json JSONB,
  synced_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(restaurant_id, refund_id)
);

-- Create shift4_webhook_events table
CREATE TABLE shift4_webhook_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  restaurant_id UUID NOT NULL REFERENCES restaurants(id) ON DELETE CASCADE,
  event_id TEXT NOT NULL,
  event_type TEXT NOT NULL,
  object_id TEXT NOT NULL,
  raw_json JSONB NOT NULL,
  processed BOOLEAN NOT NULL DEFAULT false,
  processed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(event_id)
);

-- Enable RLS
ALTER TABLE shift4_connections ENABLE ROW LEVEL SECURITY;
ALTER TABLE shift4_charges ENABLE ROW LEVEL SECURITY;
ALTER TABLE shift4_refunds ENABLE ROW LEVEL SECURITY;
ALTER TABLE shift4_webhook_events ENABLE ROW LEVEL SECURITY;

-- RLS Policies for shift4_connections
CREATE POLICY "Restaurant owners and managers can manage Shift4 connections"
  ON shift4_connections
  FOR ALL
  USING (
    EXISTS (
      SELECT 1 FROM user_restaurants
      WHERE user_restaurants.restaurant_id = shift4_connections.restaurant_id
      AND user_restaurants.user_id = auth.uid()
      AND user_restaurants.role IN ('owner', 'manager')
    )
  );

CREATE POLICY "Restaurant owners and managers can view Shift4 connections"
  ON shift4_connections
  FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM user_restaurants
      WHERE user_restaurants.restaurant_id = shift4_connections.restaurant_id
      AND user_restaurants.user_id = auth.uid()
      AND user_restaurants.role IN ('owner', 'manager')
    )
  );

-- RLS Policies for shift4_charges
CREATE POLICY "Restaurant members can view Shift4 charges"
  ON shift4_charges
  FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM user_restaurants
      WHERE user_restaurants.restaurant_id = shift4_charges.restaurant_id
      AND user_restaurants.user_id = auth.uid()
    )
  );

CREATE POLICY "Restaurant owners and managers can manage Shift4 charges"
  ON shift4_charges
  FOR ALL
  USING (
    EXISTS (
      SELECT 1 FROM user_restaurants
      WHERE user_restaurants.restaurant_id = shift4_charges.restaurant_id
      AND user_restaurants.user_id = auth.uid()
      AND user_restaurants.role IN ('owner', 'manager')
    )
  );

-- RLS Policies for shift4_refunds
CREATE POLICY "Restaurant members can view Shift4 refunds"
  ON shift4_refunds
  FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM user_restaurants
      WHERE user_restaurants.restaurant_id = shift4_refunds.restaurant_id
      AND user_restaurants.user_id = auth.uid()
    )
  );

CREATE POLICY "Restaurant owners and managers can manage Shift4 refunds"
  ON shift4_refunds
  FOR ALL
  USING (
    EXISTS (
      SELECT 1 FROM user_restaurants
      WHERE user_restaurants.restaurant_id = shift4_refunds.restaurant_id
      AND user_restaurants.user_id = auth.uid()
      AND user_restaurants.role IN ('owner', 'manager')
    )
  );

-- RLS Policies for shift4_webhook_events
CREATE POLICY "Restaurant members can view Shift4 webhook events"
  ON shift4_webhook_events
  FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM user_restaurants
      WHERE user_restaurants.restaurant_id = shift4_webhook_events.restaurant_id
      AND user_restaurants.user_id = auth.uid()
    )
  );

-- Create indexes for better performance
CREATE INDEX idx_shift4_connections_restaurant ON shift4_connections(restaurant_id);
CREATE INDEX idx_shift4_charges_restaurant_date ON shift4_charges(restaurant_id, service_date);
CREATE INDEX idx_shift4_charges_charge_id ON shift4_charges(charge_id);
CREATE INDEX idx_shift4_refunds_restaurant_date ON shift4_refunds(restaurant_id, service_date);
CREATE INDEX idx_shift4_refunds_charge_id ON shift4_refunds(charge_id);
CREATE INDEX idx_shift4_webhook_events_restaurant ON shift4_webhook_events(restaurant_id);
CREATE INDEX idx_shift4_webhook_events_event_id ON shift4_webhook_events(event_id);