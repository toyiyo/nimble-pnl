-- Create restaurant_operating_costs table for storing cost configurations
-- Supports fixed values, percentages, auto-calculated with manual override

CREATE TABLE public.restaurant_operating_costs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  restaurant_id UUID NOT NULL REFERENCES public.restaurants(id) ON DELETE CASCADE,
  
  -- Cost classification
  cost_type TEXT NOT NULL CHECK (cost_type IN ('fixed', 'semi_variable', 'variable', 'custom')),
  category TEXT NOT NULL, -- e.g., 'rent', 'insurance', 'utilities', 'franchise_fee', 'marketing'
  name TEXT NOT NULL, -- Display name: "Rent", "Franchise Royalties (5%)"
  
  -- Entry type: either 'value' (fixed $) or 'percentage' (% of sales)
  entry_type TEXT NOT NULL DEFAULT 'value' CHECK (entry_type IN ('value', 'percentage')),
  
  -- Monthly amount (in cents) - used when entry_type = 'value'
  monthly_value INTEGER DEFAULT 0,
  
  -- Percentage (as decimal, e.g., 0.05 = 5%) - used when entry_type = 'percentage'
  percentage_value NUMERIC(6,5) DEFAULT 0,
  
  -- Override settings
  is_auto_calculated BOOLEAN DEFAULT false, -- true if derived from historical data
  manual_override BOOLEAN DEFAULT false, -- true if user explicitly set this value
  
  -- For semi-variable costs (utilities): how many months to average
  averaging_months INTEGER DEFAULT 3,
  
  -- Ordering for display
  display_order INTEGER DEFAULT 0,
  
  -- Soft delete
  is_active BOOLEAN DEFAULT true,
  
  -- Metadata
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Indexes for performance
CREATE INDEX idx_operating_costs_restaurant ON public.restaurant_operating_costs(restaurant_id);
CREATE INDEX idx_operating_costs_type ON public.restaurant_operating_costs(cost_type);
CREATE INDEX idx_operating_costs_active ON public.restaurant_operating_costs(restaurant_id, is_active);

-- Enable RLS
ALTER TABLE public.restaurant_operating_costs ENABLE ROW LEVEL SECURITY;

-- RLS Policy: Users can view their restaurant operating costs
CREATE POLICY "Users can view their restaurant operating costs"
ON public.restaurant_operating_costs
FOR SELECT
USING (
  EXISTS (
    SELECT 1 FROM public.user_restaurants
    WHERE user_restaurants.restaurant_id = restaurant_operating_costs.restaurant_id
    AND user_restaurants.user_id = auth.uid()
  )
);

-- RLS Policy: Owners and managers can insert operating costs
CREATE POLICY "Owners and managers can insert operating costs"
ON public.restaurant_operating_costs
FOR INSERT
WITH CHECK (
  EXISTS (
    SELECT 1 FROM public.user_restaurants
    WHERE user_restaurants.restaurant_id = restaurant_operating_costs.restaurant_id
    AND user_restaurants.user_id = auth.uid()
    AND user_restaurants.role IN ('owner', 'manager')
  )
);

-- RLS Policy: Owners and managers can update operating costs
CREATE POLICY "Owners and managers can update operating costs"
ON public.restaurant_operating_costs
FOR UPDATE
USING (
  EXISTS (
    SELECT 1 FROM public.user_restaurants
    WHERE user_restaurants.restaurant_id = restaurant_operating_costs.restaurant_id
    AND user_restaurants.user_id = auth.uid()
    AND user_restaurants.role IN ('owner', 'manager')
  )
);

-- RLS Policy: Owners and managers can delete operating costs
CREATE POLICY "Owners and managers can delete operating costs"
ON public.restaurant_operating_costs
FOR DELETE
USING (
  EXISTS (
    SELECT 1 FROM public.user_restaurants
    WHERE user_restaurants.restaurant_id = restaurant_operating_costs.restaurant_id
    AND user_restaurants.user_id = auth.uid()
    AND user_restaurants.role IN ('owner', 'manager')
  )
);

-- Updated_at trigger
CREATE TRIGGER update_restaurant_operating_costs_updated_at
  BEFORE UPDATE ON public.restaurant_operating_costs
  FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at_column();