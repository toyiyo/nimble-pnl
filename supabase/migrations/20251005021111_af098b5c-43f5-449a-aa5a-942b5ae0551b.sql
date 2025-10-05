-- Add indexes for better query performance
CREATE INDEX IF NOT EXISTS idx_unified_sales_item_name 
ON public.unified_sales USING btree (item_name);

CREATE INDEX IF NOT EXISTS idx_products_name 
ON public.products USING btree (name);