-- Add index on unified_sales.restaurant_id for better query performance
CREATE INDEX IF NOT EXISTS idx_unified_sales_restaurant_id 
ON public.unified_sales USING btree (restaurant_id);