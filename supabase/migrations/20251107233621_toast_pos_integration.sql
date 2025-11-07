-- =====================================================
-- TOAST POS INTEGRATION DATABASE SCHEMA
-- Following the Square and Clover pattern for consistency
-- =====================================================

-- Table: toast_connections
-- Stores OAuth connection details for each restaurant's Toast account
CREATE TABLE IF NOT EXISTS public.toast_connections (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  restaurant_id UUID NOT NULL REFERENCES public.restaurants(id) ON DELETE CASCADE,
  restaurant_guid TEXT NOT NULL, -- Toast restaurant GUID
  management_group_guid TEXT, -- Toast management group GUID
  access_token TEXT NOT NULL, -- Encrypted access token
  refresh_token TEXT, -- Encrypted refresh token (if applicable)
  scopes TEXT[] NOT NULL DEFAULT '{}',
  environment TEXT NOT NULL DEFAULT 'production' CHECK (environment IN ('sandbox', 'production')),
  expires_at TIMESTAMP WITH TIME ZONE,
  connected_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  UNIQUE(restaurant_id, restaurant_guid)
);

-- Table: toast_locations
-- Stores Toast restaurant locations
CREATE TABLE IF NOT EXISTS public.toast_locations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  connection_id UUID NOT NULL REFERENCES public.toast_connections(id) ON DELETE CASCADE,
  restaurant_id UUID NOT NULL REFERENCES public.restaurants(id) ON DELETE CASCADE,
  location_guid TEXT NOT NULL,
  name TEXT NOT NULL,
  timezone TEXT,
  currency TEXT DEFAULT 'USD',
  address JSONB,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  UNIQUE(restaurant_id, location_guid)
);

-- Table: toast_orders
-- Stores Toast orders synced from the API
CREATE TABLE IF NOT EXISTS public.toast_orders (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  restaurant_id UUID NOT NULL REFERENCES public.restaurants(id) ON DELETE CASCADE,
  order_guid TEXT NOT NULL, -- Toast order GUID
  restaurant_guid TEXT NOT NULL,
  check_guid TEXT, -- Toast check GUID
  business_date DATE, -- Toast business date
  closed_date TIMESTAMP WITH TIME ZONE,
  modified_date TIMESTAMP WITH TIME ZONE,
  created_date TIMESTAMP WITH TIME ZONE,
  service_date DATE, -- Calculated service date for PNL
  dining_option TEXT, -- DINE_IN, TAKE_OUT, DELIVERY, etc.
  source TEXT, -- POS, ONLINE_ORDERING, MOBILE_ORDERING, etc.
  void_business_date DATE,
  deleted BOOLEAN DEFAULT false,
  voided BOOLEAN DEFAULT false,
  number TEXT, -- Order number displayed to guest
  total_amount NUMERIC, -- Total amount in dollars
  tax_amount NUMERIC,
  tip_amount NUMERIC,
  discount_amount NUMERIC,
  service_charge_amount NUMERIC,
  amount_due NUMERIC,
  raw_json JSONB,
  synced_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  UNIQUE(restaurant_id, order_guid)
);

-- Table: toast_order_selections
-- Stores individual item selections (line items) from Toast orders
CREATE TABLE IF NOT EXISTS public.toast_order_selections (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  restaurant_id UUID NOT NULL REFERENCES public.restaurants(id) ON DELETE CASCADE,
  order_guid TEXT NOT NULL,
  selection_guid TEXT NOT NULL, -- Toast selection GUID
  item_guid TEXT, -- Toast menu item GUID
  item_group_guid TEXT, -- Toast menu item group GUID
  name TEXT NOT NULL,
  display_name TEXT,
  quantity NUMERIC NOT NULL DEFAULT 1,
  unit_price NUMERIC, -- Price per unit
  pre_discount_price NUMERIC,
  price NUMERIC, -- Total price after discounts
  tax NUMERIC,
  voided BOOLEAN DEFAULT false,
  deferred BOOLEAN DEFAULT false, -- For split checks
  pre_modifier BOOLEAN DEFAULT false, -- Modifiers applied before cooking
  raw_json JSONB,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  UNIQUE(restaurant_id, order_guid, selection_guid)
);

-- Indexes for performance
CREATE INDEX IF NOT EXISTS idx_toast_connections_restaurant 
  ON public.toast_connections(restaurant_id);
  
CREATE INDEX IF NOT EXISTS idx_toast_connections_restaurant_guid 
  ON public.toast_connections(restaurant_guid);

CREATE INDEX IF NOT EXISTS idx_toast_locations_restaurant 
  ON public.toast_locations(restaurant_id);
  
CREATE INDEX IF NOT EXISTS idx_toast_locations_connection 
  ON public.toast_locations(connection_id);

CREATE INDEX IF NOT EXISTS idx_toast_orders_restaurant_date 
  ON public.toast_orders(restaurant_id, service_date DESC);
  
CREATE INDEX IF NOT EXISTS idx_toast_orders_order_guid 
  ON public.toast_orders(order_guid);
  
CREATE INDEX IF NOT EXISTS idx_toast_orders_business_date 
  ON public.toast_orders(business_date DESC);

CREATE INDEX IF NOT EXISTS idx_toast_orders_restaurant_guid 
  ON public.toast_orders(restaurant_guid);

CREATE INDEX IF NOT EXISTS idx_toast_selections_restaurant 
  ON public.toast_order_selections(restaurant_id);
  
CREATE INDEX IF NOT EXISTS idx_toast_selections_order 
  ON public.toast_order_selections(order_guid);
  
CREATE INDEX IF NOT EXISTS idx_toast_selections_item 
  ON public.toast_order_selections(item_guid) WHERE item_guid IS NOT NULL;

-- Enable Row Level Security
ALTER TABLE public.toast_connections ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.toast_locations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.toast_orders ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.toast_order_selections ENABLE ROW LEVEL SECURITY;

-- RLS Policies for toast_connections
CREATE POLICY "Restaurant owners and managers can view Toast connections"
  ON public.toast_connections FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM public.user_restaurants
      WHERE user_restaurants.restaurant_id = toast_connections.restaurant_id
        AND user_restaurants.user_id = auth.uid()
        AND user_restaurants.role IN ('owner', 'manager')
    )
  );

CREATE POLICY "Restaurant owners and managers can manage Toast connections"
  ON public.toast_connections FOR ALL
  USING (
    EXISTS (
      SELECT 1 FROM public.user_restaurants
      WHERE user_restaurants.restaurant_id = toast_connections.restaurant_id
        AND user_restaurants.user_id = auth.uid()
        AND user_restaurants.role IN ('owner', 'manager')
    )
  );

-- RLS Policies for toast_locations
CREATE POLICY "Restaurant members can view Toast locations"
  ON public.toast_locations FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM public.user_restaurants
      WHERE user_restaurants.restaurant_id = toast_locations.restaurant_id
        AND user_restaurants.user_id = auth.uid()
    )
  );

CREATE POLICY "Restaurant owners and managers can manage Toast locations"
  ON public.toast_locations FOR ALL
  USING (
    EXISTS (
      SELECT 1 FROM public.user_restaurants
      WHERE user_restaurants.restaurant_id = toast_locations.restaurant_id
        AND user_restaurants.user_id = auth.uid()
        AND user_restaurants.role IN ('owner', 'manager')
    )
  );

-- RLS Policies for toast_orders
CREATE POLICY "Restaurant members can view Toast orders"
  ON public.toast_orders FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM public.user_restaurants
      WHERE user_restaurants.restaurant_id = toast_orders.restaurant_id
        AND user_restaurants.user_id = auth.uid()
    )
  );

CREATE POLICY "Restaurant owners and managers can manage Toast orders"
  ON public.toast_orders FOR ALL
  USING (
    EXISTS (
      SELECT 1 FROM public.user_restaurants
      WHERE user_restaurants.restaurant_id = toast_orders.restaurant_id
        AND user_restaurants.user_id = auth.uid()
        AND user_restaurants.role IN ('owner', 'manager')
    )
  );

-- RLS Policies for toast_order_selections
CREATE POLICY "Restaurant members can view Toast selections"
  ON public.toast_order_selections FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM public.user_restaurants
      WHERE user_restaurants.restaurant_id = toast_order_selections.restaurant_id
        AND user_restaurants.user_id = auth.uid()
    )
  );

CREATE POLICY "Restaurant owners and managers can manage Toast selections"
  ON public.toast_order_selections FOR ALL
  USING (
    EXISTS (
      SELECT 1 FROM public.user_restaurants
      WHERE user_restaurants.restaurant_id = toast_order_selections.restaurant_id
        AND user_restaurants.user_id = auth.uid()
        AND user_restaurants.role IN ('owner', 'manager')
    )
  );

-- Database function: sync_toast_to_unified_sales
-- Syncs Toast order selections to unified_sales table
CREATE OR REPLACE FUNCTION public.sync_toast_to_unified_sales(p_restaurant_id UUID)
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
    t_orders.restaurant_id,
    'toast' as pos_system,
    t_orders.order_guid as external_order_id,
    t_selections.selection_guid as external_item_id,
    COALESCE(t_selections.display_name, t_selections.name, 'Unknown Item') as item_name,
    COALESCE(t_selections.quantity, 1) as quantity,
    t_selections.unit_price as unit_price,
    t_selections.price as total_price,
    t_orders.service_date as sale_date,
    (t_orders.closed_date AT TIME ZONE v_restaurant_timezone)::time as sale_time,
    t_selections.item_group_guid as pos_category,
    jsonb_build_object(
      'toast_order', t_orders.raw_json,
      'toast_selection', t_selections.raw_json
    ) as raw_data
  FROM toast_orders t_orders
  JOIN toast_order_selections t_selections 
    ON t_orders.order_guid = t_selections.order_guid 
    AND t_orders.restaurant_id = t_selections.restaurant_id
  WHERE t_orders.restaurant_id = p_restaurant_id
    AND t_orders.service_date IS NOT NULL
    AND t_orders.closed_date IS NOT NULL
    AND t_orders.voided = false
    AND t_orders.deleted = false
    AND t_selections.voided = false
    AND t_selections.deferred = false
  ON CONFLICT (restaurant_id, pos_system, external_order_id, external_item_id) 
  DO UPDATE SET
    item_name = EXCLUDED.item_name,
    quantity = EXCLUDED.quantity,
    unit_price = EXCLUDED.unit_price,
    total_price = EXCLUDED.total_price,
    sale_date = EXCLUDED.sale_date,
    sale_time = EXCLUDED.sale_time,
    pos_category = EXCLUDED.pos_category,
    raw_data = EXCLUDED.raw_data,
    updated_at = now();
  
  GET DIAGNOSTICS synced_count = ROW_COUNT;
  RETURN synced_count;
END;
$$;
