-- Create SpotOn POS integration tables

-- Store SpotOn OAuth/API Key connections per restaurant
CREATE TABLE IF NOT EXISTS public.spoton_connections (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  restaurant_id UUID NOT NULL REFERENCES public.restaurants(id) ON DELETE CASCADE,
  location_id TEXT NOT NULL,
  access_token TEXT, -- OAuth access token (encrypted)
  refresh_token TEXT, -- OAuth refresh token (encrypted)
  api_key_encrypted TEXT, -- API key (encrypted) - alternative to OAuth
  connected_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  expires_at TIMESTAMP WITH TIME ZONE,
  last_sync_at TIMESTAMP WITH TIME ZONE,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  UNIQUE(restaurant_id, location_id)
);

-- Store SpotOn orders
CREATE TABLE IF NOT EXISTS public.spoton_orders (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  restaurant_id UUID NOT NULL REFERENCES public.restaurants(id) ON DELETE CASCADE,
  connection_id UUID NOT NULL REFERENCES public.spoton_connections(id) ON DELETE CASCADE,
  external_order_id TEXT NOT NULL,
  order_date TIMESTAMP WITH TIME ZONE,
  total_amount DECIMAL(10,2) DEFAULT 0,
  tax_amount DECIMAL(10,2) DEFAULT 0,
  discount_amount DECIMAL(10,2) DEFAULT 0,
  status TEXT,
  raw_data JSONB,
  synced_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  UNIQUE(restaurant_id, external_order_id)
);

-- Store SpotOn order items/line items
CREATE TABLE IF NOT EXISTS public.spoton_order_items (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  restaurant_id UUID NOT NULL REFERENCES public.restaurants(id) ON DELETE CASCADE,
  connection_id UUID NOT NULL REFERENCES public.spoton_connections(id) ON DELETE CASCADE,
  external_order_id TEXT NOT NULL,
  external_item_id TEXT NOT NULL,
  item_name TEXT,
  quantity DECIMAL(10,3) DEFAULT 1,
  unit_price DECIMAL(10,2),
  total_price DECIMAL(10,2),
  category TEXT,
  raw_data JSONB,
  synced_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  UNIQUE(restaurant_id, external_order_id, external_item_id)
);

-- Store SpotOn webhook subscriptions
CREATE TABLE IF NOT EXISTS public.spoton_webhook_subscriptions (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  connection_id UUID NOT NULL REFERENCES public.spoton_connections(id) ON DELETE CASCADE,
  restaurant_id UUID NOT NULL REFERENCES public.restaurants(id) ON DELETE CASCADE,
  webhook_id TEXT,
  webhook_url TEXT NOT NULL,
  events TEXT[] DEFAULT ARRAY[]::TEXT[],
  registered_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  UNIQUE(connection_id)
);

-- Store SpotOn webhook events for auditing and idempotency
CREATE TABLE IF NOT EXISTS public.spoton_webhook_events (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  external_event_id TEXT NOT NULL,
  event_type TEXT NOT NULL,
  payload JSONB NOT NULL,
  processed BOOLEAN DEFAULT false,
  received_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  processed_at TIMESTAMP WITH TIME ZONE,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  UNIQUE(external_event_id)
);

-- Create indexes for better query performance
CREATE INDEX IF NOT EXISTS idx_spoton_connections_restaurant_id ON public.spoton_connections(restaurant_id);
CREATE INDEX IF NOT EXISTS idx_spoton_orders_restaurant_id ON public.spoton_orders(restaurant_id);
CREATE INDEX IF NOT EXISTS idx_spoton_orders_order_date ON public.spoton_orders(order_date);
CREATE INDEX IF NOT EXISTS idx_spoton_order_items_restaurant_id ON public.spoton_order_items(restaurant_id);
CREATE INDEX IF NOT EXISTS idx_spoton_order_items_external_order_id ON public.spoton_order_items(external_order_id);
CREATE INDEX IF NOT EXISTS idx_spoton_webhook_events_event_type ON public.spoton_webhook_events(event_type);
CREATE INDEX IF NOT EXISTS idx_spoton_webhook_events_processed ON public.spoton_webhook_events(processed);

-- Enable Row Level Security
ALTER TABLE public.spoton_connections ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.spoton_orders ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.spoton_order_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.spoton_webhook_subscriptions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.spoton_webhook_events ENABLE ROW LEVEL SECURITY;

-- RLS Policies for spoton_connections
CREATE POLICY "Users can view their restaurant's SpotOn connections"
  ON public.spoton_connections FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM public.user_restaurants
      WHERE user_restaurants.restaurant_id = spoton_connections.restaurant_id
      AND user_restaurants.user_id = auth.uid()
    )
  );

CREATE POLICY "Owners and managers can manage SpotOn connections"
  ON public.spoton_connections FOR ALL
  USING (
    EXISTS (
      SELECT 1 FROM public.user_restaurants
      WHERE user_restaurants.restaurant_id = spoton_connections.restaurant_id
      AND user_restaurants.user_id = auth.uid()
      AND user_restaurants.role IN ('owner', 'manager')
    )
  );

-- RLS Policies for spoton_orders
CREATE POLICY "Users can view their restaurant's SpotOn orders"
  ON public.spoton_orders FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM public.user_restaurants
      WHERE user_restaurants.restaurant_id = spoton_orders.restaurant_id
      AND user_restaurants.user_id = auth.uid()
    )
  );

-- RLS Policies for spoton_order_items
CREATE POLICY "Users can view their restaurant's SpotOn order items"
  ON public.spoton_order_items FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM public.user_restaurants
      WHERE user_restaurants.restaurant_id = spoton_order_items.restaurant_id
      AND user_restaurants.user_id = auth.uid()
    )
  );

-- RLS Policies for spoton_webhook_subscriptions
CREATE POLICY "Users can view their restaurant's SpotOn webhook subscriptions"
  ON public.spoton_webhook_subscriptions FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM public.user_restaurants
      WHERE user_restaurants.restaurant_id = spoton_webhook_subscriptions.restaurant_id
      AND user_restaurants.user_id = auth.uid()
    )
  );

-- Create function to sync SpotOn data to unified_sales
CREATE OR REPLACE FUNCTION sync_spoton_to_unified_sales(p_restaurant_id UUID)
RETURNS INTEGER AS $$
DECLARE
  v_synced_count INTEGER := 0;
BEGIN
  -- Insert new sales from SpotOn order items into unified_sales
  WITH new_sales AS (
    INSERT INTO public.unified_sales (
      restaurant_id,
      pos_system,
      external_order_id,
      external_item_id,
      item_name,
      quantity,
      unit_price,
      total_price,
      sale_date,
      pos_category,
      raw_data,
      synced_at,
      created_at
    )
    SELECT 
      soi.restaurant_id,
      'spoton'::text,
      soi.external_order_id,
      soi.external_item_id,
      soi.item_name,
      soi.quantity,
      soi.unit_price,
      soi.total_price,
      so.order_date::date,
      soi.category,
      soi.raw_data,
      soi.synced_at,
      now()
    FROM public.spoton_order_items soi
    INNER JOIN public.spoton_orders so ON so.external_order_id = soi.external_order_id 
      AND so.restaurant_id = soi.restaurant_id
    WHERE soi.restaurant_id = p_restaurant_id
      AND NOT EXISTS (
        SELECT 1 FROM public.unified_sales us
        WHERE us.restaurant_id = soi.restaurant_id
          AND us.pos_system = 'spoton'
          AND us.external_order_id = soi.external_order_id
          AND us.external_item_id = soi.external_item_id
      )
    RETURNING 1
  )
  SELECT COUNT(*) INTO v_synced_count FROM new_sales;

  RETURN v_synced_count;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Grant execute permission on the function
GRANT EXECUTE ON FUNCTION sync_spoton_to_unified_sales(UUID) TO authenticated;

-- Add comment to document the function
COMMENT ON FUNCTION sync_spoton_to_unified_sales IS 'Syncs SpotOn order items to the unified_sales table for a given restaurant';
