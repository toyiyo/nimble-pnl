-- Create inventory reconciliations table
CREATE TABLE public.inventory_reconciliations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  restaurant_id UUID NOT NULL REFERENCES public.restaurants(id) ON DELETE CASCADE,
  reconciliation_date DATE NOT NULL DEFAULT CURRENT_DATE,
  started_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  submitted_at TIMESTAMP WITH TIME ZONE,
  status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'in_progress', 'submitted')),
  performed_by UUID NOT NULL,
  total_items_counted INTEGER DEFAULT 0,
  items_with_variance INTEGER DEFAULT 0,
  total_shrinkage_value NUMERIC DEFAULT 0,
  notes TEXT,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

-- Create reconciliation items table
CREATE TABLE public.reconciliation_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  reconciliation_id UUID NOT NULL REFERENCES public.inventory_reconciliations(id) ON DELETE CASCADE,
  product_id UUID NOT NULL REFERENCES public.products(id) ON DELETE CASCADE,
  expected_quantity NUMERIC NOT NULL,
  actual_quantity NUMERIC,
  variance NUMERIC GENERATED ALWAYS AS (actual_quantity - expected_quantity) STORED,
  unit_cost NUMERIC NOT NULL,
  variance_value NUMERIC GENERATED ALWAYS AS ((actual_quantity - expected_quantity) * unit_cost) STORED,
  notes TEXT,
  counted_at TIMESTAMP WITH TIME ZONE,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

-- Enable RLS
ALTER TABLE public.inventory_reconciliations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.reconciliation_items ENABLE ROW LEVEL SECURITY;

-- RLS Policies for inventory_reconciliations
CREATE POLICY "Users can view reconciliations for their restaurants"
  ON public.inventory_reconciliations
  FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM public.user_restaurants
      WHERE user_restaurants.restaurant_id = inventory_reconciliations.restaurant_id
        AND user_restaurants.user_id = auth.uid()
    )
  );

CREATE POLICY "Users can insert reconciliations for their restaurants"
  ON public.inventory_reconciliations
  FOR INSERT
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.user_restaurants
      WHERE user_restaurants.restaurant_id = inventory_reconciliations.restaurant_id
        AND user_restaurants.user_id = auth.uid()
        AND user_restaurants.role IN ('owner', 'manager', 'chef')
    )
  );

CREATE POLICY "Users can update draft reconciliations for their restaurants"
  ON public.inventory_reconciliations
  FOR UPDATE
  USING (
    EXISTS (
      SELECT 1 FROM public.user_restaurants
      WHERE user_restaurants.restaurant_id = inventory_reconciliations.restaurant_id
        AND user_restaurants.user_id = auth.uid()
        AND user_restaurants.role IN ('owner', 'manager', 'chef')
    )
  );

CREATE POLICY "Users can delete draft reconciliations"
  ON public.inventory_reconciliations
  FOR DELETE
  USING (
    status = 'draft' AND
    EXISTS (
      SELECT 1 FROM public.user_restaurants
      WHERE user_restaurants.restaurant_id = inventory_reconciliations.restaurant_id
        AND user_restaurants.user_id = auth.uid()
        AND user_restaurants.role IN ('owner', 'manager', 'chef')
    )
  );

-- RLS Policies for reconciliation_items
CREATE POLICY "Users can view reconciliation items for their restaurants"
  ON public.reconciliation_items
  FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM public.inventory_reconciliations ir
      JOIN public.user_restaurants ur ON ir.restaurant_id = ur.restaurant_id
      WHERE ir.id = reconciliation_items.reconciliation_id
        AND ur.user_id = auth.uid()
    )
  );

CREATE POLICY "Users can manage reconciliation items for their restaurants"
  ON public.reconciliation_items
  FOR ALL
  USING (
    EXISTS (
      SELECT 1 FROM public.inventory_reconciliations ir
      JOIN public.user_restaurants ur ON ir.restaurant_id = ur.restaurant_id
      WHERE ir.id = reconciliation_items.reconciliation_id
        AND ur.user_id = auth.uid()
        AND ur.role IN ('owner', 'manager', 'chef')
    )
  );

-- Create indexes for performance
CREATE INDEX idx_inventory_reconciliations_restaurant_id ON public.inventory_reconciliations(restaurant_id);
CREATE INDEX idx_inventory_reconciliations_status ON public.inventory_reconciliations(status);
CREATE INDEX idx_reconciliation_items_reconciliation_id ON public.reconciliation_items(reconciliation_id);
CREATE INDEX idx_reconciliation_items_product_id ON public.reconciliation_items(product_id);