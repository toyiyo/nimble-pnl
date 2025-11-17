-- Create shift4_connections table
CREATE TABLE IF NOT EXISTS public.shift4_connections (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  restaurant_id UUID NOT NULL REFERENCES public.restaurants(id) ON DELETE CASCADE,
  access_token TEXT NOT NULL,
  refresh_token TEXT,
  merchant_id TEXT NOT NULL,
  connected_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  expires_at TIMESTAMPTZ,
  environment TEXT NOT NULL DEFAULT 'production',
  scopes TEXT[] NOT NULL DEFAULT '{}',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Enable RLS
ALTER TABLE public.shift4_connections ENABLE ROW LEVEL SECURITY;

-- Create RLS policies for shift4_connections
CREATE POLICY "Restaurant owners and managers can view Shift4 connections"
  ON public.shift4_connections
  FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM public.user_restaurants
      WHERE user_restaurants.restaurant_id = shift4_connections.restaurant_id
        AND user_restaurants.user_id = auth.uid()
        AND user_restaurants.role IN ('owner', 'manager')
    )
  );

CREATE POLICY "Restaurant owners and managers can manage Shift4 connections"
  ON public.shift4_connections
  FOR ALL
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

-- Create index for faster lookups
CREATE INDEX IF NOT EXISTS idx_shift4_connections_restaurant_id 
  ON public.shift4_connections(restaurant_id);

-- Create unique constraint on restaurant_id (one connection per restaurant)
CREATE UNIQUE INDEX IF NOT EXISTS idx_shift4_connections_restaurant_unique 
  ON public.shift4_connections(restaurant_id);

-- Add trigger for updated_at
CREATE TRIGGER update_shift4_connections_updated_at
  BEFORE UPDATE ON public.shift4_connections
  FOR EACH ROW
  EXECUTE FUNCTION public.update_accounting_updated_at();