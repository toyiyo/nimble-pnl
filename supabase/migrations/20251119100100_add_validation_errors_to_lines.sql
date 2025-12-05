-- Add validation error tracking to bank_statement_lines
-- This allows us to store ALL transactions (valid and invalid) and let users review/fix them

-- Add columns to track validation errors per line
ALTER TABLE public.bank_statement_lines
  ADD COLUMN IF NOT EXISTS has_validation_error BOOLEAN DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS validation_errors JSONB;

-- Add comment explaining the new columns
COMMENT ON COLUMN public.bank_statement_lines.has_validation_error IS 
  'Flag indicating if this transaction line has validation errors that need user attention';

COMMENT ON COLUMN public.bank_statement_lines.validation_errors IS 
  'JSON object containing validation error details, e.g., {"amount": "Missing or null", "date": "Invalid format"}';
