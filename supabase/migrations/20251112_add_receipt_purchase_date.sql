-- Add purchase_date to receipt_imports table to store the actual receipt date
-- This allows tracking when inventory was actually purchased vs when it was imported
ALTER TABLE public.receipt_imports
ADD COLUMN IF NOT EXISTS purchase_date DATE;

-- Add comment to explain the field
COMMENT ON COLUMN public.receipt_imports.purchase_date IS 'The actual date of purchase from the receipt. Can be extracted from OCR, filename, or set manually by user.';

-- Add transaction_date to inventory_transactions table for accurate historical tracking
-- This allows backdating inventory transactions to match actual purchase dates
ALTER TABLE public.inventory_transactions
ADD COLUMN IF NOT EXISTS transaction_date DATE;

-- Add comment to explain the field
COMMENT ON COLUMN public.inventory_transactions.transaction_date IS 'The actual date when the transaction occurred (e.g., purchase date from receipt). Defaults to created_at date if not specified.';

-- Set default for existing records to use created_at date
UPDATE public.inventory_transactions
SET transaction_date = created_at::date
WHERE transaction_date IS NULL;
