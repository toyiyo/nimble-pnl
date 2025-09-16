-- Create Square integration tables

-- Store Square OAuth connections per restaurant
CREATE TABLE public.square_connections (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  restaurant_id UUID NOT NULL REFERENCES public.restaurants(id) ON DELETE CASCADE,
  merchant_id TEXT NOT NULL,
  access_token TEXT NOT NULL, -- Will be encrypted
  refresh_token TEXT,
  scopes TEXT[] DEFAULT ARRAY[]::TEXT[],
  connected_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  expires_at TIMESTAMP WITH TIME ZONE,
  last_refreshed_at TIMESTAMP WITH TIME ZONE,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  UNIQUE(restaurant_id, merchant_id)
);

-- Store Square locations for each connection
CREATE TABLE public.square_locations (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  connection_id UUID NOT NULL REFERENCES public.square_connections(id) ON DELETE CASCADE,
  restaurant_id UUID NOT NULL REFERENCES public.restaurants(id) ON DELETE CASCADE,
  location_id TEXT NOT NULL,
  name TEXT,
  timezone TEXT,
  currency TEXT DEFAULT 'USD',
  address JSONB,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  UNIQUE(restaurant_id, location_id)
);

-- Store Square catalog objects (menu items, categories, modifiers)
CREATE TABLE public.square_catalog_objects (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  restaurant_id UUID NOT NULL REFERENCES public.restaurants(id) ON DELETE CASCADE,
  object_id TEXT NOT NULL,
  object_type TEXT NOT NULL,
  parent_id TEXT,
  name TEXT,
  category_id TEXT,
  sku TEXT,
  modifier_list_ids TEXT[],
  version BIGINT,
  raw_json JSONB,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  UNIQUE(restaurant_id, object_id)
);

-- Store Square orders
CREATE TABLE public.square_orders (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  restaurant_id UUID NOT NULL REFERENCES public.restaurants(id) ON DELETE CASCADE,
  order_id TEXT NOT NULL,
  location_id TEXT NOT NULL,
  state TEXT,
  source TEXT,
  created_at TIMESTAMP WITH TIME ZONE,
  closed_at TIMESTAMP WITH TIME ZONE,
  updated_at TIMESTAMP WITH TIME ZONE,
  service_date DATE,
  gross_sales_money DECIMAL(10,2) DEFAULT 0,
  net_amounts_money DECIMAL(10,2) DEFAULT 0,
  total_tax_money DECIMAL(10,2) DEFAULT 0,
  total_discount_money DECIMAL(10,2) DEFAULT 0,
  total_service_charge_money DECIMAL(10,2) DEFAULT 0,
  total_tip_money DECIMAL(10,2) DEFAULT 0,
  raw_json JSONB,
  synced_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  UNIQUE(restaurant_id, order_id)
);

-- Store Square order line items
CREATE TABLE public.square_order_line_items (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  restaurant_id UUID NOT NULL REFERENCES public.restaurants(id) ON DELETE CASCADE,
  order_id TEXT NOT NULL,
  uid TEXT NOT NULL,
  catalog_object_id TEXT,
  name TEXT,
  quantity DECIMAL(10,3),
  base_price_money DECIMAL(10,2),
  total_money DECIMAL(10,2),
  category_id TEXT,
  modifiers JSONB,
  raw_json JSONB,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  UNIQUE(restaurant_id, order_id, uid)
);

-- Store Square payments
CREATE TABLE public.square_payments (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  restaurant_id UUID NOT NULL REFERENCES public.restaurants(id) ON DELETE CASCADE,
  payment_id TEXT NOT NULL,
  order_id TEXT,
  location_id TEXT NOT NULL,
  status TEXT,
  amount_money DECIMAL(10,2),
  tip_money DECIMAL(10,2) DEFAULT 0,
  processing_fee_money DECIMAL(10,2) DEFAULT 0,
  created_at TIMESTAMP WITH TIME ZONE,
  raw_json JSONB,
  synced_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  UNIQUE(restaurant_id, payment_id)
);

-- Store Square refunds
CREATE TABLE public.square_refunds (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  restaurant_id UUID NOT NULL REFERENCES public.restaurants(id) ON DELETE CASCADE,
  refund_id TEXT NOT NULL,
  payment_id TEXT,
  order_id TEXT,
  amount_money DECIMAL(10,2),
  status TEXT,
  created_at TIMESTAMP WITH TIME ZONE,
  raw_json JSONB,
  synced_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  UNIQUE(restaurant_id, refund_id)
);

-- Store Square team members
CREATE TABLE public.square_team_members (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  restaurant_id UUID NOT NULL REFERENCES public.restaurants(id) ON DELETE CASCADE,
  team_member_id TEXT NOT NULL,
  name TEXT,
  status TEXT,
  wage_default_money DECIMAL(10,2),
  raw_json JSONB,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  UNIQUE(restaurant_id, team_member_id)
);

-- Store Square shifts (labor data)
CREATE TABLE public.square_shifts (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  restaurant_id UUID NOT NULL REFERENCES public.restaurants(id) ON DELETE CASCADE,
  shift_id TEXT NOT NULL,
  team_member_id TEXT,
  location_id TEXT NOT NULL,
  start_at TIMESTAMP WITH TIME ZONE,
  end_at TIMESTAMP WITH TIME ZONE,
  service_date DATE,
  hourly_rate_money DECIMAL(10,2),
  total_wage_money DECIMAL(10,2),
  overtime_seconds INTEGER DEFAULT 0,
  break_seconds INTEGER DEFAULT 0,
  raw_json JSONB,
  synced_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  UNIQUE(restaurant_id, shift_id)
);

-- Enable RLS on all Square tables
ALTER TABLE public.square_connections ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.square_locations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.square_catalog_objects ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.square_orders ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.square_order_line_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.square_payments ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.square_refunds ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.square_team_members ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.square_shifts ENABLE ROW LEVEL SECURITY;

-- RLS Policies for square_connections
CREATE POLICY "Restaurant owners can manage Square connections" ON public.square_connections
  FOR ALL USING (
    EXISTS (
      SELECT 1 FROM public.user_restaurants 
      WHERE restaurant_id = square_connections.restaurant_id 
        AND user_id = auth.uid() 
        AND role IN ('owner', 'manager')
    )
  );

-- RLS Policies for square_locations
CREATE POLICY "Restaurant users can view Square locations" ON public.square_locations
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM public.user_restaurants 
      WHERE restaurant_id = square_locations.restaurant_id 
        AND user_id = auth.uid()
    )
  );

-- RLS Policies for square_catalog_objects
CREATE POLICY "Restaurant users can view Square catalog" ON public.square_catalog_objects
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM public.user_restaurants 
      WHERE restaurant_id = square_catalog_objects.restaurant_id 
        AND user_id = auth.uid()
    )
  );

-- RLS Policies for square_orders
CREATE POLICY "Restaurant users can view Square orders" ON public.square_orders
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM public.user_restaurants 
      WHERE restaurant_id = square_orders.restaurant_id 
        AND user_id = auth.uid()
    )
  );

-- RLS Policies for square_order_line_items
CREATE POLICY "Restaurant users can view Square order line items" ON public.square_order_line_items
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM public.user_restaurants 
      WHERE restaurant_id = square_order_line_items.restaurant_id 
        AND user_id = auth.uid()
    )
  );

-- RLS Policies for square_payments
CREATE POLICY "Restaurant users can view Square payments" ON public.square_payments
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM public.user_restaurants 
      WHERE restaurant_id = square_payments.restaurant_id 
        AND user_id = auth.uid()
    )
  );

-- RLS Policies for square_refunds
CREATE POLICY "Restaurant users can view Square refunds" ON public.square_refunds
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM public.user_restaurants 
      WHERE restaurant_id = square_refunds.restaurant_id 
        AND user_id = auth.uid()
    )
  );

-- RLS Policies for square_team_members
CREATE POLICY "Restaurant users can view Square team members" ON public.square_team_members
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM public.user_restaurants 
      WHERE restaurant_id = square_team_members.restaurant_id 
        AND user_id = auth.uid()
    )
  );

-- RLS Policies for square_shifts
CREATE POLICY "Restaurant users can view Square shifts" ON public.square_shifts
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM public.user_restaurants 
      WHERE restaurant_id = square_shifts.restaurant_id 
        AND user_id = auth.uid()
    )
  );

-- Create indexes for performance
CREATE INDEX idx_square_connections_restaurant_id ON public.square_connections(restaurant_id);
CREATE INDEX idx_square_locations_restaurant_id ON public.square_locations(restaurant_id);
CREATE INDEX idx_square_locations_location_id ON public.square_locations(location_id);
CREATE INDEX idx_square_catalog_objects_restaurant_id ON public.square_catalog_objects(restaurant_id);
CREATE INDEX idx_square_catalog_objects_object_id ON public.square_catalog_objects(object_id);
CREATE INDEX idx_square_orders_restaurant_id ON public.square_orders(restaurant_id);
CREATE INDEX idx_square_orders_service_date ON public.square_orders(service_date);
CREATE INDEX idx_square_orders_location_id ON public.square_orders(location_id);
CREATE INDEX idx_square_order_line_items_restaurant_id ON public.square_order_line_items(restaurant_id);
CREATE INDEX idx_square_order_line_items_order_id ON public.square_order_line_items(order_id);
CREATE INDEX idx_square_payments_restaurant_id ON public.square_payments(restaurant_id);
CREATE INDEX idx_square_refunds_restaurant_id ON public.square_refunds(restaurant_id);
CREATE INDEX idx_square_team_members_restaurant_id ON public.square_team_members(restaurant_id);
CREATE INDEX idx_square_shifts_restaurant_id ON public.square_shifts(restaurant_id);
CREATE INDEX idx_square_shifts_service_date ON public.square_shifts(service_date);

-- Add triggers for updated_at
CREATE TRIGGER update_square_connections_updated_at
  BEFORE UPDATE ON public.square_connections
  FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at_column();

CREATE TRIGGER update_square_locations_updated_at
  BEFORE UPDATE ON public.square_locations
  FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at_column();

CREATE TRIGGER update_square_catalog_objects_updated_at
  BEFORE UPDATE ON public.square_catalog_objects
  FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at_column();

CREATE TRIGGER update_square_team_members_updated_at
  BEFORE UPDATE ON public.square_team_members
  FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at_column();

-- Function to aggregate Square data into daily P&L
CREATE OR REPLACE FUNCTION public.calculate_square_daily_pnl(p_restaurant_id uuid, p_service_date date)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_net_revenue DECIMAL(10,2) := 0;
  v_labor_cost DECIMAL(10,2) := 0;
  v_pnl_id UUID;
BEGIN
  -- Calculate net revenue from Square orders
  SELECT COALESCE(SUM(net_amounts_money), 0) INTO v_net_revenue
  FROM public.square_orders
  WHERE restaurant_id = p_restaurant_id 
    AND service_date = p_service_date
    AND state = 'COMPLETED';

  -- Calculate labor cost from Square shifts
  SELECT COALESCE(SUM(total_wage_money), 0) INTO v_labor_cost
  FROM public.square_shifts
  WHERE restaurant_id = p_restaurant_id 
    AND service_date = p_service_date;

  -- Update daily_sales table
  INSERT INTO public.daily_sales (restaurant_id, date, gross_revenue, discounts, comps, net_revenue)
  SELECT 
    p_restaurant_id,
    p_service_date,
    COALESCE(SUM(gross_sales_money), 0),
    COALESCE(SUM(total_discount_money), 0),
    0, -- comps from Square orders if needed
    COALESCE(SUM(net_amounts_money), 0)
  FROM public.square_orders
  WHERE restaurant_id = p_restaurant_id 
    AND service_date = p_service_date
    AND state = 'COMPLETED'
  ON CONFLICT (restaurant_id, date)
  DO UPDATE SET
    gross_revenue = EXCLUDED.gross_revenue,
    discounts = EXCLUDED.discounts,
    net_revenue = EXCLUDED.net_revenue,
    updated_at = now();

  -- Update daily_labor_costs table
  INSERT INTO public.daily_labor_costs (restaurant_id, date, hourly_wages, salary_wages, benefits, total_labor_cost)
  SELECT 
    p_restaurant_id,
    p_service_date,
    COALESCE(SUM(total_wage_money), 0),
    0, -- salary wages separate if available
    0, -- benefits separate if available  
    COALESCE(SUM(total_wage_money), 0)
  FROM public.square_shifts
  WHERE restaurant_id = p_restaurant_id 
    AND service_date = p_service_date
  ON CONFLICT (restaurant_id, date)
  DO UPDATE SET
    hourly_wages = EXCLUDED.hourly_wages,
    total_labor_cost = EXCLUDED.total_labor_cost,
    updated_at = now();

  -- Trigger overall P&L calculation
  SELECT public.calculate_daily_pnl(p_restaurant_id, p_service_date) INTO v_pnl_id;

  RETURN v_pnl_id;
END;
$$;