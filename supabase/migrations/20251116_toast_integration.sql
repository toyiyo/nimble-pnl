-- =====================================================
-- TOAST POS INTEGRATION DATABASE SCHEMA
-- Following the established integration patterns
-- =====================================================

-- Table: toast_connections
-- Stores OAuth credentials and restaurant information for Toast accounts
-- Toast uses OAuth 2.0 for authentication
CREATE TABLE IF NOT EXISTS public.toast_connections (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  restaurant_id UUID NOT NULL REFERENCES public.restaurants(id) ON DELETE CASCADE,
  toast_restaurant_guid TEXT NOT NULL, -- Toast restaurant GUID
  access_token TEXT NOT NULL, -- Encrypted OAuth access token
  refresh_token TEXT, -- Encrypted OAuth refresh token (if provided)
  token_expires_at TIMESTAMP WITH TIME ZONE, -- Token expiration timestamp
  scopes TEXT[], -- Granted OAuth scopes
  connected_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  last_sync_at TIMESTAMP WITH TIME ZONE,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  UNIQUE(restaurant_id, toast_restaurant_guid)
);

-- Table: toast_orders
-- Stores order data synced from Toast API
CREATE TABLE IF NOT EXISTS public.toast_orders (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  restaurant_id UUID NOT NULL REFERENCES public.restaurants(id) ON DELETE CASCADE,
  toast_order_guid TEXT NOT NULL, -- Toast order GUID
  toast_restaurant_guid TEXT NOT NULL,
  order_number TEXT,
  order_date DATE NOT NULL,
  order_time TIME,
  total_amount NUMERIC(10, 2),
  subtotal_amount NUMERIC(10, 2),
  tax_amount NUMERIC(10, 2),
  tip_amount NUMERIC(10, 2),
  discount_amount NUMERIC(10, 2),
  service_charge_amount NUMERIC(10, 2),
  payment_status TEXT, -- 'PAID', 'UNPAID', 'VOID', etc.
  dining_option TEXT, -- 'DINE_IN', 'TAKEOUT', 'DELIVERY', etc.
  raw_json JSONB, -- Full order object from Toast API
  synced_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  UNIQUE(restaurant_id, toast_order_guid)
);

-- Table: toast_order_items
-- Stores individual line items from Toast orders
CREATE TABLE IF NOT EXISTS public.toast_order_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  restaurant_id UUID NOT NULL REFERENCES public.restaurants(id) ON DELETE CASCADE,
  toast_order_id UUID NOT NULL REFERENCES public.toast_orders(id) ON DELETE CASCADE,
  toast_order_guid TEXT NOT NULL,
  toast_item_guid TEXT NOT NULL, -- Toast menu item GUID
  item_name TEXT NOT NULL,
  quantity NUMERIC(10, 2) NOT NULL DEFAULT 1,
  unit_price NUMERIC(10, 2),
  total_price NUMERIC(10, 2),
  menu_category TEXT,
  modifiers JSONB, -- Item modifiers/customizations
  raw_json JSONB,
  synced_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  UNIQUE(restaurant_id, toast_order_guid, toast_item_guid)
);

-- Table: toast_payments
-- Stores payment data from Toast orders
CREATE TABLE IF NOT EXISTS public.toast_payments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  restaurant_id UUID NOT NULL REFERENCES public.restaurants(id) ON DELETE CASCADE,
  toast_payment_guid TEXT NOT NULL,
  toast_order_guid TEXT NOT NULL,
  payment_type TEXT, -- 'CREDIT', 'CASH', 'GIFT_CARD', etc.
  amount NUMERIC(10, 2) NOT NULL,
  tip_amount NUMERIC(10, 2) DEFAULT 0,
  payment_date DATE,
  payment_status TEXT,
  raw_json JSONB,
  synced_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  UNIQUE(restaurant_id, toast_payment_guid)
);

-- Table: toast_menu_items
-- Stores menu item catalog from Toast
CREATE TABLE IF NOT EXISTS public.toast_menu_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  restaurant_id UUID NOT NULL REFERENCES public.restaurants(id) ON DELETE CASCADE,
  toast_item_guid TEXT NOT NULL,
  toast_restaurant_guid TEXT NOT NULL,
  item_name TEXT NOT NULL,
  description TEXT,
  price NUMERIC(10, 2),
  category TEXT,
  is_active BOOLEAN DEFAULT true,
  raw_json JSONB,
  synced_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  UNIQUE(restaurant_id, toast_item_guid)
);

-- Table: toast_webhook_events
-- Tracks processed webhook events for idempotency
CREATE TABLE IF NOT EXISTS public.toast_webhook_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  restaurant_id UUID NOT NULL REFERENCES public.restaurants(id) ON DELETE CASCADE,
  event_id TEXT NOT NULL,
  event_type TEXT NOT NULL, -- e.g., 'ORDER_CREATED', 'ORDER_UPDATED', 'PAYMENT_CREATED'
  processed_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  raw_json JSONB,
  UNIQUE(restaurant_id, event_id)
);

-- Indexes for performance
CREATE INDEX IF NOT EXISTS idx_toast_connections_restaurant 
  ON public.toast_connections(restaurant_id);

CREATE INDEX IF NOT EXISTS idx_toast_connections_toast_guid 
  ON public.toast_connections(toast_restaurant_guid);

CREATE INDEX IF NOT EXISTS idx_toast_orders_restaurant_date 
  ON public.toast_orders(restaurant_id, order_date DESC);

CREATE INDEX IF NOT EXISTS idx_toast_orders_guid 
  ON public.toast_orders(toast_order_guid);

CREATE INDEX IF NOT EXISTS idx_toast_order_items_order 
  ON public.toast_order_items(toast_order_id);

CREATE INDEX IF NOT EXISTS idx_toast_order_items_restaurant 
  ON public.toast_order_items(restaurant_id);

CREATE INDEX IF NOT EXISTS idx_toast_payments_restaurant 
  ON public.toast_payments(restaurant_id);

CREATE INDEX IF NOT EXISTS idx_toast_payments_order 
  ON public.toast_payments(toast_order_guid);

CREATE INDEX IF NOT EXISTS idx_toast_menu_items_restaurant 
  ON public.toast_menu_items(restaurant_id);

CREATE INDEX IF NOT EXISTS idx_toast_webhook_events_restaurant 
  ON public.toast_webhook_events(restaurant_id);

-- Row Level Security (RLS)
ALTER TABLE public.toast_connections ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.toast_orders ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.toast_order_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.toast_payments ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.toast_menu_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.toast_webhook_events ENABLE ROW LEVEL SECURITY;

-- RLS Policies for toast_connections
CREATE POLICY "Users can view their restaurant Toast connections" 
  ON public.toast_connections FOR SELECT 
  USING (
    restaurant_id IN (
      SELECT restaurant_id FROM public.user_restaurants 
      WHERE user_id = auth.uid()
    )
  );

CREATE POLICY "Owners/managers can insert Toast connections" 
  ON public.toast_connections FOR INSERT 
  WITH CHECK (
    restaurant_id IN (
      SELECT restaurant_id FROM public.user_restaurants 
      WHERE user_id = auth.uid() 
        AND role IN ('owner', 'manager')
    )
  );

CREATE POLICY "Owners/managers can delete Toast connections" 
  ON public.toast_connections FOR DELETE 
  USING (
    restaurant_id IN (
      SELECT restaurant_id FROM public.user_restaurants 
      WHERE user_id = auth.uid() 
        AND role IN ('owner', 'manager')
    )
  );

-- RLS Policies for toast_orders
CREATE POLICY "Users can view their restaurant Toast orders" 
  ON public.toast_orders FOR SELECT 
  USING (
    restaurant_id IN (
      SELECT restaurant_id FROM public.user_restaurants 
      WHERE user_id = auth.uid()
    )
  );

-- RLS Policies for toast_order_items
CREATE POLICY "Users can view their restaurant Toast order items" 
  ON public.toast_order_items FOR SELECT 
  USING (
    restaurant_id IN (
      SELECT restaurant_id FROM public.user_restaurants 
      WHERE user_id = auth.uid()
    )
  );

-- RLS Policies for toast_payments
CREATE POLICY "Users can view their restaurant Toast payments" 
  ON public.toast_payments FOR SELECT 
  USING (
    restaurant_id IN (
      SELECT restaurant_id FROM public.user_restaurants 
      WHERE user_id = auth.uid()
    )
  );

-- RLS Policies for toast_menu_items
CREATE POLICY "Users can view their restaurant Toast menu items" 
  ON public.toast_menu_items FOR SELECT 
  USING (
    restaurant_id IN (
      SELECT restaurant_id FROM public.user_restaurants 
      WHERE user_id = auth.uid()
    )
  );

-- RLS Policies for toast_webhook_events
CREATE POLICY "Users can view their restaurant Toast webhook events" 
  ON public.toast_webhook_events FOR SELECT 
  USING (
    restaurant_id IN (
      SELECT restaurant_id FROM public.user_restaurants 
      WHERE user_id = auth.uid()
    )
  );

-- Function to sync Toast orders to unified_sales
CREATE OR REPLACE FUNCTION sync_toast_to_unified_sales(p_restaurant_id UUID)
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_synced_count INTEGER := 0;
BEGIN
  -- Insert Toast order items into unified_sales
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
    raw_data,
    synced_at,
    source
  )
  SELECT
    toi.restaurant_id,
    'toast'::TEXT,
    toi.toast_order_guid,
    toi.toast_item_guid,
    toi.item_name,
    toi.quantity,
    toi.unit_price,
    toi.total_price,
    too.order_date,
    too.order_time,
    toi.menu_category,
    toi.raw_json,
    NOW(),
    'toast_api'
  FROM public.toast_order_items toi
  INNER JOIN public.toast_orders too ON toi.toast_order_id = too.id
  WHERE toi.restaurant_id = p_restaurant_id
    AND NOT EXISTS (
      SELECT 1 FROM public.unified_sales us
      WHERE us.restaurant_id = toi.restaurant_id
        AND us.pos_system = 'toast'
        AND us.external_order_id = toi.toast_order_guid
        AND us.external_item_id = toi.toast_item_guid
    )
  ON CONFLICT (restaurant_id, pos_system, external_order_id, external_item_id) 
  DO NOTHING;

  GET DIAGNOSTICS v_synced_count = ROW_COUNT;
  
  RETURN v_synced_count;
END;
$$;
