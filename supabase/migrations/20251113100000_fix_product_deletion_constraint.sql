-- Fix foreign key constraint on receipt_line_items.matched_product_id
-- to allow product deletion by setting the reference to NULL instead of blocking deletion

-- Drop the existing foreign key constraint
ALTER TABLE public.receipt_line_items
DROP CONSTRAINT IF EXISTS receipt_line_items_matched_product_id_fkey;

-- Add the constraint back with ON DELETE SET NULL
-- This allows products to be deleted even if they're referenced in receipt line items
-- The matched_product_id will be set to NULL, preserving the receipt data while removing the reference
ALTER TABLE public.receipt_line_items
ADD CONSTRAINT receipt_line_items_matched_product_id_fkey
FOREIGN KEY (matched_product_id)
REFERENCES public.products(id)
ON DELETE SET NULL;
