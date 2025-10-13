-- =====================================================
-- CLOVER POS INTEGRATION DATABASE SCHEMA
-- Following the Square pattern for consistency
-- =====================================================

-- Table: clover_connections
-- Stores OAuth connection details for each restaurant's Clover account
CREATE TABLE IF NOT EXISTS public.clover_connections (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  restaurant_id UUID NOT NULL REFERENCES public.restaurants(id) ON DELETE CASCADE,
  merchant_id TEXT NOT NULL,
  access_token TEXT NOT NULL, -- Encrypted access token
  refresh_token TEXT, -- Encrypted refresh token (if applicable)
  scopes TEXT[] NOT NULL DEFAULT '{}',
  region TEXT NOT NULL DEFAULT 'na', -- na, eu, latam, apac
  expires_at TIMESTAMP WITH TIME ZONE,
  connected_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  UNIQUE(restaurant_id, merchant_id)
);

-- Table: clover_locations
-- Stores Clover merchant locations
CREATE TABLE IF NOT EXISTS public.clover_locations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  connection_id UUID NOT NULL REFERENCES public.clover_connections(id) ON DELETE CASCADE,
  restaurant_id UUID NOT NULL REFERENCES public.restaurants(id) ON DELETE CASCADE,
  location_id TEXT NOT NULL,
  name TEXT NOT NULL,
  timezone TEXT,
  currency TEXT DEFAULT 'USD',
  address JSONB,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  UNIQUE(restaurant_id, location_id)
);

-- Table: clover_orders
-- Stores Clover orders synced from the API
CREATE TABLE IF NOT EXISTS public.clover_orders (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  restaurant_id UUID NOT NULL REFERENCES public.restaurants(id) ON DELETE CASCADE,
  order_id TEXT NOT NULL,
  merchant_id TEXT NOT NULL,
  employee_id TEXT,
  state TEXT,
  total NUMERIC,
  tax_amount NUMERIC,
  service_charge_amount NUMERIC,
  discount_amount NUMERIC,
  tip_amount NUMERIC,
  created_time TIMESTAMP WITH TIME ZONE,
  modified_time TIMESTAMP WITH TIME ZONE,
  closed_time TIMESTAMP WITH TIME ZONE,
  service_date DATE,
  raw_json JSONB,
  synced_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  UNIQUE(restaurant_id, order_id)
);

-- Table: clover_order_line_items
-- Stores individual line items from Clover orders
CREATE TABLE IF NOT EXISTS public.clover_order_line_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  restaurant_id UUID NOT NULL REFERENCES public.restaurants(id) ON DELETE CASCADE,
  order_id TEXT NOT NULL,
  line_item_id TEXT NOT NULL,
  item_id TEXT,
  name TEXT NOT NULL,
  alternate_name TEXT,
  price NUMERIC,
  unit_quantity NUMERIC,
  is_revenue BOOLEAN DEFAULT true,
  note TEXT,
  printed BOOLEAN DEFAULT false,
  category_id TEXT,
  raw_json JSONB,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  UNIQUE(restaurant_id, order_id, line_item_id)
);

-- Indexes for performance
CREATE INDEX IF NOT EXISTS idx_clover_connections_restaurant 
  ON public.clover_connections(restaurant_id);
  
CREATE INDEX IF NOT EXISTS idx_clover_connections_merchant 
  ON public.clover_connections(merchant_id);

CREATE INDEX IF NOT EXISTS idx_clover_locations_restaurant 
  ON public.clover_locations(restaurant_id);
  
CREATE INDEX IF NOT EXISTS idx_clover_locations_connection 
  ON public.clover_locations(connection_id);

CREATE INDEX IF NOT EXISTS idx_clover_orders_restaurant_date 
  ON public.clover_orders(restaurant_id, service_date DESC);
  
CREATE INDEX IF NOT EXISTS idx_clover_orders_order_id 
  ON public.clover_orders(order_id);
  
CREATE INDEX IF NOT EXISTS idx_clover_orders_state 
  ON public.clover_orders(state) WHERE state = 'OPEN' OR state = 'LOCKED';

CREATE INDEX IF NOT EXISTS idx_clover_line_items_restaurant 
  ON public.clover_order_line_items(restaurant_id);
  
CREATE INDEX IF NOT EXISTS idx_clover_line_items_order 
  ON public.clover_order_line_items(order_id);
  
CREATE INDEX IF NOT EXISTS idx_clover_line_items_item 
  ON public.clover_order_line_items(item_id) WHERE item_id IS NOT NULL;

-- Enable Row Level Security
ALTER TABLE public.clover_connections ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.clover_locations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.clover_orders ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.clover_order_line_items ENABLE ROW LEVEL SECURITY;

-- RLS Policies for clover_connections
CREATE POLICY "Restaurant owners and managers can view Clover connections"
  ON public.clover_connections FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM public.user_restaurants
      WHERE user_restaurants.restaurant_id = clover_connections.restaurant_id
        AND user_restaurants.user_id = auth.uid()
        AND user_restaurants.role IN ('owner', 'manager')
    )
  );

CREATE POLICY "Restaurant owners and managers can manage Clover connections"
  ON public.clover_connections FOR ALL
  USING (
    EXISTS (
      SELECT 1 FROM public.user_restaurants
      WHERE user_restaurants.restaurant_id = clover_connections.restaurant_id
        AND user_restaurants.user_id = auth.uid()
        AND user_restaurants.role IN ('owner', 'manager')
    )
  );

-- RLS Policies for clover_locations
CREATE POLICY "Restaurant members can view Clover locations"
  ON public.clover_locations FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM public.user_restaurants
      WHERE user_restaurants.restaurant_id = clover_locations.restaurant_id
        AND user_restaurants.user_id = auth.uid()
    )
  );

CREATE POLICY "Restaurant owners and managers can manage Clover locations"
  ON public.clover_locations FOR ALL
  USING (
    EXISTS (
      SELECT 1 FROM public.user_restaurants
      WHERE user_restaurants.restaurant_id = clover_locations.restaurant_id
        AND user_restaurants.user_id = auth.uid()
        AND user_restaurants.role IN ('owner', 'manager')
    )
  );

-- RLS Policies for clover_orders
CREATE POLICY "Restaurant members can view Clover orders"
  ON public.clover_orders FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM public.user_restaurants
      WHERE user_restaurants.restaurant_id = clover_orders.restaurant_id
        AND user_restaurants.user_id = auth.uid()
    )
  );

CREATE POLICY "Restaurant owners and managers can manage Clover orders"
  ON public.clover_orders FOR ALL
  USING (
    EXISTS (
      SELECT 1 FROM public.user_restaurants
      WHERE user_restaurants.restaurant_id = clover_orders.restaurant_id
        AND user_restaurants.user_id = auth.uid()
        AND user_restaurants.role IN ('owner', 'manager')
    )
  );

-- RLS Policies for clover_order_line_items
CREATE POLICY "Restaurant members can view Clover line items"
  ON public.clover_order_line_items FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM public.user_restaurants
      WHERE user_restaurants.restaurant_id = clover_order_line_items.restaurant_id
        AND user_restaurants.user_id = auth.uid()
    )
  );

CREATE POLICY "Restaurant owners and managers can manage Clover line items"
  ON public.clover_order_line_items FOR ALL
  USING (
    EXISTS (
      SELECT 1 FROM public.user_restaurants
      WHERE user_restaurants.restaurant_id = clover_order_line_items.restaurant_id
        AND user_restaurants.user_id = auth.uid()
        AND user_restaurants.role IN ('owner', 'manager')
    )
  );

-- Database function: sync_clover_to_unified_sales
-- Syncs Clover order line items to unified_sales table
CREATE OR REPLACE FUNCTION public.sync_clover_to_unified_sales(p_restaurant_id UUID)
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  synced_count INTEGER := 0;
  v_restaurant_timezone TEXT;
BEGIN
  SELECT timezone INTO v_restaurant_timezone
  FROM restaurants
  WHERE id = p_restaurant_id;
  
  v_restaurant_timezone := COALESCE(v_restaurant_timezone, 'America/Chicago');

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
    sale_time,
    pos_category,
    raw_data
  )
  SELECT 
    co.restaurant_id,
    'clover' as pos_system,
    co.order_id as external_order_id,
    coli.line_item_id as external_item_id,
    COALESCE(coli.name, 'Unknown Item') as item_name,
    COALESCE(coli.unit_quantity, 1) as quantity,
    coli.price as unit_price,
    (coli.price * COALESCE(coli.unit_quantity, 1)) as total_price,
    co.service_date as sale_date,
    (co.closed_time AT TIME ZONE v_restaurant_timezone)::time as sale_time,
    coli.category_id as pos_category,
    jsonb_build_object(
      'clover_order', co.raw_json,
      'clover_line_item', coli.raw_json
    ) as raw_data
  FROM clover_orders co
  JOIN clover_order_line_items coli 
    ON co.order_id = coli.order_id 
    AND co.restaurant_id = coli.restaurant_id
  WHERE co.restaurant_id = p_restaurant_id
    AND co.state IN ('LOCKED', 'OPEN')
    AND co.service_date IS NOT NULL
    AND co.closed_time IS NOT NULL
    AND coli.is_revenue = true
  ON CONFLICT (restaurant_id, pos_system, external_order_id, external_item_id) 
  DO NOTHING;
  
  GET DIAGNOSTICS synced_count = ROW_COUNT;
  RETURN synced_count;
END;
$$;