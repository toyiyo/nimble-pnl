-- Add stripe_financial_account_id column to bank_account_balances for unique identification
ALTER TABLE public.bank_account_balances
ADD COLUMN IF NOT EXISTS stripe_financial_account_id TEXT;

-- Add unique constraint to prevent duplicate balance records per Stripe account
ALTER TABLE public.bank_account_balances
DROP CONSTRAINT IF EXISTS bank_account_balances_stripe_account_unique;

ALTER TABLE public.bank_account_balances
ADD CONSTRAINT bank_account_balances_stripe_account_unique 
UNIQUE (stripe_financial_account_id);

-- Add index for faster lookups
CREATE INDEX IF NOT EXISTS idx_bank_account_balances_stripe_account 
ON public.bank_account_balances(stripe_financial_account_id);

-- Add comment
COMMENT ON COLUMN public.bank_account_balances.stripe_financial_account_id 
IS 'Unique Stripe Financial Connections account identifier for precise balance updates';