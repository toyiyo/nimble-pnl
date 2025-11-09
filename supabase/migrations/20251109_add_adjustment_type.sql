-- Add adjustment_type column to unified_sales
-- This allows us to track tax, tips, service charges, discounts, and fees separately
-- from revenue items without creating fake line items

ALTER TABLE public.unified_sales 
ADD COLUMN IF NOT EXISTS adjustment_type TEXT 
CHECK (adjustment_type IN ('tax', 'tip', 'service_charge', 'discount', 'fee', NULL));

-- Add index for filtering on adjustment_type (optimization for queries)
CREATE INDEX IF NOT EXISTS idx_unified_sales_adjustment_type 
ON public.unified_sales(restaurant_id, adjustment_type, sale_date DESC);

-- Add comment for documentation
COMMENT ON COLUMN public.unified_sales.adjustment_type IS 
'Classifies pass-through items (tax, tip, service_charge, discount, fee). 
NULL = regular revenue line item. Used to exclude pass-throughs from revenue/analytics queries.';
