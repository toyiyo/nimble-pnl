-- Add user exclusion flag to bank_statement_lines
-- This allows users to mark transactions they want to skip/exclude from import

ALTER TABLE public.bank_statement_lines
  ADD COLUMN IF NOT EXISTS user_excluded BOOLEAN DEFAULT FALSE;

-- Add comment explaining the new column
COMMENT ON COLUMN public.bank_statement_lines.user_excluded IS 
  'Flag indicating if user has chosen to exclude/skip this transaction from import';
