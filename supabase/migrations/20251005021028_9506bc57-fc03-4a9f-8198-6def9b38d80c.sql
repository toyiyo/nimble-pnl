-- Add index on products.name for better query performance
CREATE INDEX IF NOT EXISTS idx_products_name 
ON public.products USING btree (name);