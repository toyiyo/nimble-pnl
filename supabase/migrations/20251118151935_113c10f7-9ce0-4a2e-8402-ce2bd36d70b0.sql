-- Create index on bank_transactions amount column for better query performance
CREATE INDEX IF NOT EXISTS idx_bank_transactions_amount ON public.bank_transactions USING btree (amount);