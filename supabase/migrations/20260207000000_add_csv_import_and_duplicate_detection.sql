-- Add source_type to bank_statement_uploads (pdf vs csv vs excel)
ALTER TABLE public.bank_statement_uploads
  ADD COLUMN IF NOT EXISTS source_type TEXT DEFAULT 'pdf'
  CHECK (source_type IN ('pdf', 'csv', 'excel'));

-- Add connected_bank_id to bank_statement_uploads (CSV user selects bank)
ALTER TABLE public.bank_statement_uploads
  ADD COLUMN IF NOT EXISTS connected_bank_id UUID
  REFERENCES public.connected_banks(id) ON DELETE SET NULL;

-- Add duplicate detection fields to bank_statement_lines
ALTER TABLE public.bank_statement_lines
  ADD COLUMN IF NOT EXISTS is_potential_duplicate BOOLEAN DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS duplicate_transaction_id UUID
    REFERENCES public.bank_transactions(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS duplicate_confidence NUMERIC(3,2);

-- Add 'csv_import' to bank_transactions source CHECK
ALTER TABLE public.bank_transactions
  DROP CONSTRAINT IF EXISTS bank_transactions_source_check;
ALTER TABLE public.bank_transactions
  ADD CONSTRAINT bank_transactions_source_check
  CHECK (source IN ('bank_integration', 'manual_upload', 'import', 'csv_import'));

-- Index for duplicate detection queries
CREATE INDEX IF NOT EXISTS idx_bank_transactions_date_amount
  ON public.bank_transactions(restaurant_id, transaction_date, amount);
