-- Create purchase_orders table
CREATE TABLE public.purchase_orders (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  restaurant_id UUID NOT NULL REFERENCES public.restaurants(id) ON DELETE CASCADE,
  po_number TEXT, -- Auto-generated or custom PO number
  supplier_id UUID NOT NULL REFERENCES public.suppliers(id) ON DELETE RESTRICT,
  location_id UUID REFERENCES public.restaurants(id), -- For multi-location support
  status TEXT NOT NULL DEFAULT 'DRAFT' CHECK (status IN ('DRAFT', 'READY_TO_SEND', 'SENT', 'PARTIALLY_RECEIVED', 'RECEIVED', 'CLOSED')),
  budget NUMERIC(10, 2), -- Optional budget target
  total NUMERIC(10, 2) NOT NULL DEFAULT 0, -- Order total (sum of line items)
  notes TEXT,
  created_by UUID REFERENCES auth.users(id),
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  sent_at TIMESTAMP WITH TIME ZONE,
  closed_at TIMESTAMP WITH TIME ZONE
);

-- Create purchase_order_lines table
CREATE TABLE public.purchase_order_lines (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  purchase_order_id UUID NOT NULL REFERENCES public.purchase_orders(id) ON DELETE CASCADE,
  product_id UUID NOT NULL REFERENCES public.products(id) ON DELETE RESTRICT,
  supplier_id UUID NOT NULL REFERENCES public.suppliers(id) ON DELETE RESTRICT,
  item_name TEXT NOT NULL, -- Snapshot of product name at time of order
  sku TEXT, -- Snapshot of SKU
  unit_label TEXT, -- e.g., "Case (24x12oz)"
  unit_cost NUMERIC(10, 2) NOT NULL DEFAULT 0,
  quantity NUMERIC(10, 3) NOT NULL DEFAULT 1, -- Allow decimals for weight-based items
  line_total NUMERIC(10, 2) NOT NULL DEFAULT 0, -- Calculated: quantity * unit_cost
  received_quantity NUMERIC(10, 3) DEFAULT 0,
  notes TEXT,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

-- Enable RLS
ALTER TABLE public.purchase_orders ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.purchase_order_lines ENABLE ROW LEVEL SECURITY;

-- Create RLS policies for purchase_orders
CREATE POLICY "Users can view purchase orders for their restaurants"
ON public.purchase_orders
FOR SELECT
USING (
  EXISTS (
    SELECT 1 FROM user_restaurants
    WHERE user_restaurants.restaurant_id = purchase_orders.restaurant_id
    AND user_restaurants.user_id = auth.uid()
  )
);

CREATE POLICY "Users can create purchase orders for their restaurants"
ON public.purchase_orders
FOR INSERT
WITH CHECK (
  EXISTS (
    SELECT 1 FROM user_restaurants
    WHERE user_restaurants.restaurant_id = purchase_orders.restaurant_id
    AND user_restaurants.user_id = auth.uid()
    AND user_restaurants.role IN ('owner', 'manager', 'chef')
  )
);

CREATE POLICY "Users can update purchase orders for their restaurants"
ON public.purchase_orders
FOR UPDATE
USING (
  EXISTS (
    SELECT 1 FROM user_restaurants
    WHERE user_restaurants.restaurant_id = purchase_orders.restaurant_id
    AND user_restaurants.user_id = auth.uid()
    AND user_restaurants.role IN ('owner', 'manager', 'chef')
  )
);

CREATE POLICY "Users can delete purchase orders for their restaurants"
ON public.purchase_orders
FOR DELETE
USING (
  EXISTS (
    SELECT 1 FROM user_restaurants
    WHERE user_restaurants.restaurant_id = purchase_orders.restaurant_id
    AND user_restaurants.user_id = auth.uid()
    AND user_restaurants.role IN ('owner', 'manager')
  )
);

-- Create RLS policies for purchase_order_lines
CREATE POLICY "Users can view purchase order lines for their restaurants"
ON public.purchase_order_lines
FOR SELECT
USING (
  EXISTS (
    SELECT 1 FROM purchase_orders po
    JOIN user_restaurants ur ON ur.restaurant_id = po.restaurant_id
    WHERE po.id = purchase_order_lines.purchase_order_id
    AND ur.user_id = auth.uid()
  )
);

CREATE POLICY "Users can create purchase order lines for their restaurants"
ON public.purchase_order_lines
FOR INSERT
WITH CHECK (
  EXISTS (
    SELECT 1 FROM purchase_orders po
    JOIN user_restaurants ur ON ur.restaurant_id = po.restaurant_id
    WHERE po.id = purchase_order_lines.purchase_order_id
    AND ur.user_id = auth.uid()
    AND ur.role IN ('owner', 'manager', 'chef')
  )
);

CREATE POLICY "Users can update purchase order lines for their restaurants"
ON public.purchase_order_lines
FOR UPDATE
USING (
  EXISTS (
    SELECT 1 FROM purchase_orders po
    JOIN user_restaurants ur ON ur.restaurant_id = po.restaurant_id
    WHERE po.id = purchase_order_lines.purchase_order_id
    AND ur.user_id = auth.uid()
    AND ur.role IN ('owner', 'manager', 'chef')
  )
);

CREATE POLICY "Users can delete purchase order lines for their restaurants"
ON public.purchase_order_lines
FOR DELETE
USING (
  EXISTS (
    SELECT 1 FROM purchase_orders po
    JOIN user_restaurants ur ON ur.restaurant_id = po.restaurant_id
    WHERE po.id = purchase_order_lines.purchase_order_id
    AND ur.user_id = auth.uid()
    AND ur.role IN ('owner', 'manager', 'chef')
  )
);

-- Create indexes for better performance
CREATE INDEX idx_purchase_orders_restaurant_id ON public.purchase_orders(restaurant_id);
CREATE INDEX idx_purchase_orders_supplier_id ON public.purchase_orders(supplier_id);
CREATE INDEX idx_purchase_orders_status ON public.purchase_orders(restaurant_id, status);
CREATE INDEX idx_purchase_orders_created_at ON public.purchase_orders(restaurant_id, created_at DESC);

CREATE INDEX idx_purchase_order_lines_po_id ON public.purchase_order_lines(purchase_order_id);
CREATE INDEX idx_purchase_order_lines_product_id ON public.purchase_order_lines(product_id);

-- Create trigger for updated_at
CREATE TRIGGER update_purchase_orders_updated_at
  BEFORE UPDATE ON public.purchase_orders
  FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at_column();

CREATE TRIGGER update_purchase_order_lines_updated_at
  BEFORE UPDATE ON public.purchase_order_lines
  FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at_column();

-- Function to generate PO number
CREATE OR REPLACE FUNCTION generate_po_number(p_restaurant_id UUID)
RETURNS TEXT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_year TEXT;
  v_count INTEGER;
  v_po_number TEXT;
BEGIN
  v_year := TO_CHAR(NOW(), 'YYYY');
  
  -- Get count of POs for this restaurant this year
  SELECT COUNT(*) INTO v_count
  FROM purchase_orders
  WHERE restaurant_id = p_restaurant_id
    AND EXTRACT(YEAR FROM created_at) = EXTRACT(YEAR FROM NOW());
  
  v_count := v_count + 1;
  
  -- Format: PO-YYYY-NNNNNN
  v_po_number := 'PO-' || v_year || '-' || LPAD(v_count::TEXT, 6, '0');
  
  RETURN v_po_number;
END;
$$;

-- Function to update PO total when lines change
CREATE OR REPLACE FUNCTION update_purchase_order_total()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_total NUMERIC(10, 2);
BEGIN
  -- Calculate total from all lines
  SELECT COALESCE(SUM(line_total), 0)
  INTO v_total
  FROM purchase_order_lines
  WHERE purchase_order_id = COALESCE(NEW.purchase_order_id, OLD.purchase_order_id);
  
  -- Update the purchase order total
  UPDATE purchase_orders
  SET total = v_total,
      updated_at = NOW()
  WHERE id = COALESCE(NEW.purchase_order_id, OLD.purchase_order_id);
  
  RETURN COALESCE(NEW, OLD);
END;
$$;

-- Trigger to recalculate PO total when lines change
CREATE TRIGGER update_po_total_on_line_insert
  AFTER INSERT ON public.purchase_order_lines
  FOR EACH ROW
  EXECUTE FUNCTION update_purchase_order_total();

CREATE TRIGGER update_po_total_on_line_update
  AFTER UPDATE ON public.purchase_order_lines
  FOR EACH ROW
  EXECUTE FUNCTION update_purchase_order_total();

CREATE TRIGGER update_po_total_on_line_delete
  AFTER DELETE ON public.purchase_order_lines
  FOR EACH ROW
  EXECUTE FUNCTION update_purchase_order_total();

-- Function to auto-generate PO number on insert if not provided
CREATE OR REPLACE FUNCTION set_po_number()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.po_number IS NULL THEN
    NEW.po_number := generate_po_number(NEW.restaurant_id);
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER set_po_number_on_insert
  BEFORE INSERT ON public.purchase_orders
  FOR EACH ROW
  EXECUTE FUNCTION set_po_number();
