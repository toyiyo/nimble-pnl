-- Add imported_total column to track sum of actually imported items
-- Separate from total_amount which stores the AI-extracted receipt total
ALTER TABLE public.receipt_imports
ADD COLUMN imported_total NUMERIC(10,2) DEFAULT NULL;

COMMENT ON COLUMN public.receipt_imports.imported_total IS 'Sum of parsed_price for imported items (mapped/new_item). NULL until import is finalized. Distinct from total_amount which is the AI-extracted receipt total.';
