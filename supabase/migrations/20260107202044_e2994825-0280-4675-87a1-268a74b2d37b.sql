-- Add SKU field to receipt_line_items for barcode scanning during import
ALTER TABLE public.receipt_line_items 
ADD COLUMN parsed_sku TEXT;