-- Make supplier_id nullable in purchase_order_lines to support items without suppliers
ALTER TABLE public.purchase_order_lines 
ALTER COLUMN supplier_id DROP NOT NULL;