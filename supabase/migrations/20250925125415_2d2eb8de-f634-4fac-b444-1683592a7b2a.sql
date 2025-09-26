-- First, let's check and fix the square_orders table structure
-- Make order_id unique in square_orders (assuming it should be unique per restaurant)
ALTER TABLE square_orders ADD CONSTRAINT square_orders_order_id_restaurant_unique UNIQUE (order_id, restaurant_id);

-- Now add the foreign key relationship
ALTER TABLE square_order_line_items 
ADD CONSTRAINT square_order_line_items_order_fkey 
FOREIGN KEY (order_id, restaurant_id) REFERENCES square_orders(order_id, restaurant_id);

-- Create a generic sales table for unified POS integration
CREATE TABLE IF NOT EXISTS public.unified_sales (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  restaurant_id UUID NOT NULL,
  pos_system TEXT NOT NULL, -- 'square', 'toast', 'clover', etc.
  external_order_id TEXT NOT NULL,
  external_item_id TEXT,
  item_name TEXT NOT NULL,
  quantity NUMERIC NOT NULL DEFAULT 1,
  unit_price NUMERIC,
  total_price NUMERIC,
  sale_date DATE NOT NULL,
  sale_time TIME,
  pos_category TEXT,
  raw_data JSONB,
  synced_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

-- Enable RLS on unified_sales
ALTER TABLE public.unified_sales ENABLE ROW LEVEL SECURITY;

-- Create RLS policies for unified_sales
CREATE POLICY "Users can view sales for their restaurants" 
ON public.unified_sales 
FOR SELECT 
USING (EXISTS (
  SELECT 1 FROM user_restaurants 
  WHERE restaurant_id = unified_sales.restaurant_id 
  AND user_id = auth.uid()
));

CREATE POLICY "Users can insert sales for their restaurants" 
ON public.unified_sales 
FOR INSERT 
WITH CHECK (EXISTS (
  SELECT 1 FROM user_restaurants 
  WHERE restaurant_id = unified_sales.restaurant_id 
  AND user_id = auth.uid() 
  AND role = ANY(ARRAY['owner', 'manager'])
));

-- Create indexes for performance
CREATE INDEX idx_unified_sales_restaurant_date ON public.unified_sales(restaurant_id, sale_date);
CREATE INDEX idx_unified_sales_pos_system ON public.unified_sales(pos_system);
CREATE INDEX idx_unified_sales_external_order ON public.unified_sales(external_order_id);