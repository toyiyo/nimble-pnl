-- Create daily_sales table for POS data
CREATE TABLE public.daily_sales (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  restaurant_id UUID NOT NULL REFERENCES public.restaurants(id) ON DELETE CASCADE,
  date DATE NOT NULL,
  gross_revenue DECIMAL(10,2) NOT NULL DEFAULT 0,
  discounts DECIMAL(10,2) NOT NULL DEFAULT 0,
  comps DECIMAL(10,2) NOT NULL DEFAULT 0,
  net_revenue DECIMAL(10,2) GENERATED ALWAYS AS (gross_revenue - discounts - comps) STORED,
  transaction_count INTEGER DEFAULT 0,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  UNIQUE(restaurant_id, date)
);

-- Create daily_food_costs table for COGS tracking
CREATE TABLE public.daily_food_costs (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  restaurant_id UUID NOT NULL REFERENCES public.restaurants(id) ON DELETE CASCADE,
  date DATE NOT NULL,
  purchases DECIMAL(10,2) NOT NULL DEFAULT 0,
  inventory_adjustments DECIMAL(10,2) NOT NULL DEFAULT 0,
  total_food_cost DECIMAL(10,2) GENERATED ALWAYS AS (purchases + inventory_adjustments) STORED,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  UNIQUE(restaurant_id, date)
);

-- Create daily_labor_costs table
CREATE TABLE public.daily_labor_costs (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  restaurant_id UUID NOT NULL REFERENCES public.restaurants(id) ON DELETE CASCADE,
  date DATE NOT NULL,
  hourly_wages DECIMAL(10,2) NOT NULL DEFAULT 0,
  salary_wages DECIMAL(10,2) NOT NULL DEFAULT 0,
  benefits DECIMAL(10,2) NOT NULL DEFAULT 0,
  total_labor_cost DECIMAL(10,2) GENERATED ALWAYS AS (hourly_wages + salary_wages + benefits) STORED,
  total_hours DECIMAL(8,2) DEFAULT 0,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  UNIQUE(restaurant_id, date)
);

-- Create daily_pnl table for calculated P&L metrics
CREATE TABLE public.daily_pnl (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  restaurant_id UUID NOT NULL REFERENCES public.restaurants(id) ON DELETE CASCADE,
  date DATE NOT NULL,
  net_revenue DECIMAL(10,2) NOT NULL DEFAULT 0,
  food_cost DECIMAL(10,2) NOT NULL DEFAULT 0,
  labor_cost DECIMAL(10,2) NOT NULL DEFAULT 0,
  prime_cost DECIMAL(10,2) GENERATED ALWAYS AS (food_cost + labor_cost) STORED,
  gross_profit DECIMAL(10,2) GENERATED ALWAYS AS (net_revenue - food_cost - labor_cost) STORED,
  food_cost_percentage DECIMAL(5,2) GENERATED ALWAYS AS (
    CASE WHEN net_revenue > 0 THEN (food_cost / net_revenue * 100) ELSE 0 END
  ) STORED,
  labor_cost_percentage DECIMAL(5,2) GENERATED ALWAYS AS (
    CASE WHEN net_revenue > 0 THEN (labor_cost / net_revenue * 100) ELSE 0 END
  ) STORED,
  prime_cost_percentage DECIMAL(5,2) GENERATED ALWAYS AS (
    CASE WHEN net_revenue > 0 THEN (prime_cost / net_revenue * 100) ELSE 0 END
  ) STORED,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  UNIQUE(restaurant_id, date)
);

-- Enable Row Level Security
ALTER TABLE public.daily_sales ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.daily_food_costs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.daily_labor_costs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.daily_pnl ENABLE ROW LEVEL SECURITY;

-- Create RLS policies for daily_sales
CREATE POLICY "Users can view sales for their restaurants" 
ON public.daily_sales FOR SELECT 
USING (
  EXISTS (
    SELECT 1 FROM public.user_restaurants 
    WHERE restaurant_id = daily_sales.restaurant_id 
    AND user_id = auth.uid()
  )
);

CREATE POLICY "Users can insert sales for their restaurants" 
ON public.daily_sales FOR INSERT 
WITH CHECK (
  EXISTS (
    SELECT 1 FROM public.user_restaurants 
    WHERE restaurant_id = daily_sales.restaurant_id 
    AND user_id = auth.uid() 
    AND role IN ('owner', 'manager')
  )
);

CREATE POLICY "Users can update sales for their restaurants" 
ON public.daily_sales FOR UPDATE 
USING (
  EXISTS (
    SELECT 1 FROM public.user_restaurants 
    WHERE restaurant_id = daily_sales.restaurant_id 
    AND user_id = auth.uid() 
    AND role IN ('owner', 'manager')
  )
);

-- Create similar RLS policies for daily_food_costs
CREATE POLICY "Users can view food costs for their restaurants" 
ON public.daily_food_costs FOR SELECT 
USING (
  EXISTS (
    SELECT 1 FROM public.user_restaurants 
    WHERE restaurant_id = daily_food_costs.restaurant_id 
    AND user_id = auth.uid()
  )
);

CREATE POLICY "Users can insert food costs for their restaurants" 
ON public.daily_food_costs FOR INSERT 
WITH CHECK (
  EXISTS (
    SELECT 1 FROM public.user_restaurants 
    WHERE restaurant_id = daily_food_costs.restaurant_id 
    AND user_id = auth.uid() 
    AND role IN ('owner', 'manager', 'chef')
  )
);

CREATE POLICY "Users can update food costs for their restaurants" 
ON public.daily_food_costs FOR UPDATE 
USING (
  EXISTS (
    SELECT 1 FROM public.user_restaurants 
    WHERE restaurant_id = daily_food_costs.restaurant_id 
    AND user_id = auth.uid() 
    AND role IN ('owner', 'manager', 'chef')
  )
);

-- Create similar RLS policies for daily_labor_costs
CREATE POLICY "Users can view labor costs for their restaurants" 
ON public.daily_labor_costs FOR SELECT 
USING (
  EXISTS (
    SELECT 1 FROM public.user_restaurants 
    WHERE restaurant_id = daily_labor_costs.restaurant_id 
    AND user_id = auth.uid()
  )
);

CREATE POLICY "Users can insert labor costs for their restaurants" 
ON public.daily_labor_costs FOR INSERT 
WITH CHECK (
  EXISTS (
    SELECT 1 FROM public.user_restaurants 
    WHERE restaurant_id = daily_labor_costs.restaurant_id 
    AND user_id = auth.uid() 
    AND role IN ('owner', 'manager')
  )
);

CREATE POLICY "Users can update labor costs for their restaurants" 
ON public.daily_labor_costs FOR UPDATE 
USING (
  EXISTS (
    SELECT 1 FROM public.user_restaurants 
    WHERE restaurant_id = daily_labor_costs.restaurant_id 
    AND user_id = auth.uid() 
    AND role IN ('owner', 'manager')
  )
);

-- Create RLS policies for daily_pnl
CREATE POLICY "Users can view P&L for their restaurants" 
ON public.daily_pnl FOR SELECT 
USING (
  EXISTS (
    SELECT 1 FROM public.user_restaurants 
    WHERE restaurant_id = daily_pnl.restaurant_id 
    AND user_id = auth.uid()
  )
);

CREATE POLICY "Users can insert P&L for their restaurants" 
ON public.daily_pnl FOR INSERT 
WITH CHECK (
  EXISTS (
    SELECT 1 FROM public.user_restaurants 
    WHERE restaurant_id = daily_pnl.restaurant_id 
    AND user_id = auth.uid() 
    AND role IN ('owner', 'manager')
  )
);

CREATE POLICY "Users can update P&L for their restaurants" 
ON public.daily_pnl FOR UPDATE 
USING (
  EXISTS (
    SELECT 1 FROM public.user_restaurants 
    WHERE restaurant_id = daily_pnl.restaurant_id 
    AND user_id = auth.uid() 
    AND role IN ('owner', 'manager')
  )
);

-- Add triggers for updated_at columns
CREATE TRIGGER update_daily_sales_updated_at
BEFORE UPDATE ON public.daily_sales
FOR EACH ROW
EXECUTE FUNCTION public.update_updated_at_column();

CREATE TRIGGER update_daily_food_costs_updated_at
BEFORE UPDATE ON public.daily_food_costs
FOR EACH ROW
EXECUTE FUNCTION public.update_updated_at_column();

CREATE TRIGGER update_daily_labor_costs_updated_at
BEFORE UPDATE ON public.daily_labor_costs
FOR EACH ROW
EXECUTE FUNCTION public.update_updated_at_column();

CREATE TRIGGER update_daily_pnl_updated_at
BEFORE UPDATE ON public.daily_pnl
FOR EACH ROW
EXECUTE FUNCTION public.update_updated_at_column();

-- Create function to calculate and update daily P&L
CREATE OR REPLACE FUNCTION public.calculate_daily_pnl(
  p_restaurant_id UUID,
  p_date DATE
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_net_revenue DECIMAL(10,2) := 0;
  v_food_cost DECIMAL(10,2) := 0;
  v_labor_cost DECIMAL(10,2) := 0;
  v_pnl_id UUID;
BEGIN
  -- Get net revenue for the date
  SELECT COALESCE(net_revenue, 0) INTO v_net_revenue
  FROM public.daily_sales
  WHERE restaurant_id = p_restaurant_id AND date = p_date;

  -- Get food cost for the date
  SELECT COALESCE(total_food_cost, 0) INTO v_food_cost
  FROM public.daily_food_costs
  WHERE restaurant_id = p_restaurant_id AND date = p_date;

  -- Get labor cost for the date
  SELECT COALESCE(total_labor_cost, 0) INTO v_labor_cost
  FROM public.daily_labor_costs
  WHERE restaurant_id = p_restaurant_id AND date = p_date;

  -- Insert or update daily P&L
  INSERT INTO public.daily_pnl (restaurant_id, date, net_revenue, food_cost, labor_cost)
  VALUES (p_restaurant_id, p_date, v_net_revenue, v_food_cost, v_labor_cost)
  ON CONFLICT (restaurant_id, date)
  DO UPDATE SET
    net_revenue = EXCLUDED.net_revenue,
    food_cost = EXCLUDED.food_cost,
    labor_cost = EXCLUDED.labor_cost,
    updated_at = now()
  RETURNING id INTO v_pnl_id;

  RETURN v_pnl_id;
END;
$$;

-- Create triggers to automatically update P&L when data changes
CREATE OR REPLACE FUNCTION public.trigger_calculate_pnl()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  -- Calculate P&L for the affected date
  PERFORM public.calculate_daily_pnl(NEW.restaurant_id, NEW.date);
  RETURN NEW;
END;
$$;

-- Add triggers to recalculate P&L when sales, food costs, or labor costs change
CREATE TRIGGER recalculate_pnl_on_sales_change
AFTER INSERT OR UPDATE ON public.daily_sales
FOR EACH ROW
EXECUTE FUNCTION public.trigger_calculate_pnl();

CREATE TRIGGER recalculate_pnl_on_food_costs_change
AFTER INSERT OR UPDATE ON public.daily_food_costs
FOR EACH ROW
EXECUTE FUNCTION public.trigger_calculate_pnl();

CREATE TRIGGER recalculate_pnl_on_labor_costs_change
AFTER INSERT OR UPDATE ON public.daily_labor_costs
FOR EACH ROW
EXECUTE FUNCTION public.trigger_calculate_pnl();