-- Drop existing foreign key constraint on supplier_id
ALTER TABLE public.product_suppliers
DROP CONSTRAINT IF EXISTS product_suppliers_supplier_id_fkey;

-- Add new foreign key constraint with ON DELETE RESTRICT to preserve historical data
ALTER TABLE public.product_suppliers
ADD CONSTRAINT product_suppliers_supplier_id_fkey
FOREIGN KEY (supplier_id) REFERENCES public.suppliers(id) ON DELETE RESTRICT;

-- Add comment explaining the constraint
COMMENT ON CONSTRAINT product_suppliers_supplier_id_fkey ON public.product_suppliers IS 
'Prevents deletion of suppliers with historical purchase records. Use ON DELETE RESTRICT to maintain data integrity and preserve purchase history (costs, dates, quantities, etc.).';