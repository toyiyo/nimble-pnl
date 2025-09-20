-- Create products table for inventory management
CREATE TABLE public.products (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  restaurant_id UUID NOT NULL,
  gtin TEXT, -- Global Trade Item Number (UPC/EAN normalized to 14 digits)
  sku TEXT NOT NULL, -- Internal SKU
  name TEXT NOT NULL,
  description TEXT,
  brand TEXT,
  category TEXT,
  size_value NUMERIC,
  size_unit TEXT, -- e.g., 'mL', 'oz', 'lbs', 'pieces'
  package_qty INTEGER DEFAULT 1, -- How many units in the package
  uom_purchase TEXT, -- Unit of measure for purchasing
  uom_recipe TEXT, -- Unit of measure for recipes
  conversion_factor NUMERIC DEFAULT 1, -- Conversion between purchase and recipe UOM
  cost_per_unit NUMERIC,
  supplier_name TEXT,
  supplier_sku TEXT,
  par_level_min INTEGER DEFAULT 0,
  par_level_max INTEGER DEFAULT 0,
  current_stock INTEGER DEFAULT 0,
  reorder_point INTEGER DEFAULT 0,
  barcode_data JSONB, -- Store parsed barcode data (GS1 AIs, etc.)
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

-- Enable RLS
ALTER TABLE public.products ENABLE ROW LEVEL SECURITY;

-- Create policies for products
CREATE POLICY "Users can view products for their restaurants" 
ON public.products 
FOR SELECT 
USING (EXISTS (
  SELECT 1 FROM user_restaurants 
  WHERE user_restaurants.restaurant_id = products.restaurant_id 
  AND user_restaurants.user_id = auth.uid()
));

CREATE POLICY "Users can insert products for their restaurants" 
ON public.products 
FOR INSERT 
WITH CHECK (EXISTS (
  SELECT 1 FROM user_restaurants 
  WHERE user_restaurants.restaurant_id = products.restaurant_id 
  AND user_restaurants.user_id = auth.uid() 
  AND user_restaurants.role = ANY(ARRAY['owner', 'manager', 'chef'])
));

CREATE POLICY "Users can update products for their restaurants" 
ON public.products 
FOR UPDATE 
USING (EXISTS (
  SELECT 1 FROM user_restaurants 
  WHERE user_restaurants.restaurant_id = products.restaurant_id 
  AND user_restaurants.user_id = auth.uid() 
  AND user_restaurants.role = ANY(ARRAY['owner', 'manager', 'chef'])
));

CREATE POLICY "Users can delete products for their restaurants" 
ON public.products 
FOR DELETE 
USING (EXISTS (
  SELECT 1 FROM user_restaurants 
  WHERE user_restaurants.restaurant_id = products.restaurant_id 
  AND user_restaurants.user_id = auth.uid() 
  AND user_restaurants.role = ANY(ARRAY['owner', 'manager'])
));

-- Create indexes for better performance
CREATE INDEX idx_products_restaurant_id ON public.products(restaurant_id);
CREATE INDEX idx_products_gtin ON public.products(gtin) WHERE gtin IS NOT NULL;
CREATE INDEX idx_products_sku ON public.products(restaurant_id, sku);
CREATE INDEX idx_products_category ON public.products(restaurant_id, category);

-- Create trigger for updated_at
CREATE TRIGGER update_products_updated_at
  BEFORE UPDATE ON public.products
  FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at_column();

-- Create inventory_transactions table for tracking stock movements
CREATE TABLE public.inventory_transactions (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  restaurant_id UUID NOT NULL,
  product_id UUID NOT NULL REFERENCES public.products(id) ON DELETE CASCADE,
  transaction_type TEXT NOT NULL CHECK (transaction_type IN ('purchase', 'usage', 'adjustment', 'waste', 'transfer')),
  quantity NUMERIC NOT NULL,
  unit_cost NUMERIC,
  total_cost NUMERIC,
  reason TEXT,
  reference_id TEXT, -- Reference to purchase order, recipe, etc.
  lot_number TEXT,
  expiry_date DATE,
  location TEXT,
  performed_by UUID,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

-- Enable RLS for inventory transactions
ALTER TABLE public.inventory_transactions ENABLE ROW LEVEL SECURITY;

-- Create policies for inventory transactions
CREATE POLICY "Users can view inventory transactions for their restaurants" 
ON public.inventory_transactions 
FOR SELECT 
USING (EXISTS (
  SELECT 1 FROM user_restaurants 
  WHERE user_restaurants.restaurant_id = inventory_transactions.restaurant_id 
  AND user_restaurants.user_id = auth.uid()
));

CREATE POLICY "Users can insert inventory transactions for their restaurants" 
ON public.inventory_transactions 
FOR INSERT 
WITH CHECK (EXISTS (
  SELECT 1 FROM user_restaurants 
  WHERE user_restaurants.restaurant_id = inventory_transactions.restaurant_id 
  AND user_restaurants.user_id = auth.uid() 
  AND user_restaurants.role = ANY(ARRAY['owner', 'manager', 'chef', 'staff'])
));

-- Create indexes for inventory transactions
CREATE INDEX idx_inventory_transactions_restaurant_id ON public.inventory_transactions(restaurant_id);
CREATE INDEX idx_inventory_transactions_product_id ON public.inventory_transactions(product_id);
CREATE INDEX idx_inventory_transactions_created_at ON public.inventory_transactions(created_at);
CREATE INDEX idx_inventory_transactions_type ON public.inventory_transactions(restaurant_id, transaction_type);