-- Make purchase order supplier_id optional to support multi-supplier orders
-- This allows users to add items from multiple suppliers to a single purchase order

ALTER TABLE public.purchase_orders 
  ALTER COLUMN supplier_id DROP NOT NULL;

-- Add comment to explain the change
COMMENT ON COLUMN public.purchase_orders.supplier_id IS 
  'Optional supplier filter. When NULL, the PO can contain items from multiple suppliers. Each line item tracks its own supplier.';
