-- Add fields to track transaction validation and partial success
-- This migration supports the new validation logic to handle invalid transactions gracefully

-- Add columns to bank_statement_uploads for tracking validation results
ALTER TABLE public.bank_statement_uploads
  ADD COLUMN IF NOT EXISTS successful_transaction_count INTEGER DEFAULT 0,
  ADD COLUMN IF NOT EXISTS failed_transaction_count INTEGER DEFAULT 0,
  ADD COLUMN IF NOT EXISTS invalid_transactions JSONB;

-- Update status check constraint to include 'partial_success'
ALTER TABLE public.bank_statement_uploads
  DROP CONSTRAINT IF EXISTS bank_statement_uploads_status_check;

ALTER TABLE public.bank_statement_uploads
  ADD CONSTRAINT bank_statement_uploads_status_check 
  CHECK (status IN ('uploaded', 'processed', 'imported', 'error', 'partial_success'));

-- Add comment explaining the new columns
COMMENT ON COLUMN public.bank_statement_uploads.successful_transaction_count IS 
  'Number of transactions successfully inserted after validation';

COMMENT ON COLUMN public.bank_statement_uploads.failed_transaction_count IS 
  'Number of transactions that failed validation (e.g., missing amount, invalid date)';

COMMENT ON COLUMN public.bank_statement_uploads.invalid_transactions IS 
  'JSON array of transactions that failed validation, stored for manual review';
