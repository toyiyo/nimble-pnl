-- Create suppliers table for vendor/provider management
CREATE TABLE public.suppliers (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  restaurant_id UUID NOT NULL,
  name TEXT NOT NULL,
  contact_email TEXT,
  contact_phone TEXT,
  address TEXT,
  website TEXT,
  notes TEXT,
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  UNIQUE(restaurant_id, name)
);

-- Enable RLS on suppliers table
ALTER TABLE public.suppliers ENABLE ROW LEVEL SECURITY;

-- Create RLS policies for suppliers
CREATE POLICY "Users can manage suppliers for their restaurants"
ON public.suppliers
FOR ALL
USING (
  EXISTS (
    SELECT 1 FROM user_restaurants
    WHERE user_restaurants.restaurant_id = suppliers.restaurant_id
    AND user_restaurants.user_id = auth.uid()
    AND user_restaurants.role = ANY(ARRAY['owner', 'manager', 'chef'])
  )
);

CREATE POLICY "Users can view suppliers for their restaurants"
ON public.suppliers
FOR SELECT
USING (
  EXISTS (
    SELECT 1 FROM user_restaurants
    WHERE user_restaurants.restaurant_id = suppliers.restaurant_id
    AND user_restaurants.user_id = auth.uid()
  )
);

-- Add supplier_id foreign key to products table
ALTER TABLE public.products 
ADD COLUMN supplier_id UUID REFERENCES public.suppliers(id);

-- Create index for better performance
CREATE INDEX idx_products_supplier_id ON public.products(supplier_id);
CREATE INDEX idx_suppliers_restaurant_name ON public.suppliers(restaurant_id, name);

-- Add updated_at trigger for suppliers
CREATE TRIGGER update_suppliers_updated_at
  BEFORE UPDATE ON public.suppliers
  FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at_column();

-- Add supplier_name to receipt_imports table for better tracking
ALTER TABLE public.receipt_imports 
ADD COLUMN supplier_id UUID REFERENCES public.suppliers(id);