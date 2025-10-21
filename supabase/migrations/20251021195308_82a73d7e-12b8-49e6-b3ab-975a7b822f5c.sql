-- Change transaction date columns to TIMESTAMPTZ to store full UTC timestamps

-- Change transaction_date from DATE to TIMESTAMPTZ
ALTER TABLE bank_transactions 
  ALTER COLUMN transaction_date TYPE TIMESTAMPTZ 
  USING transaction_date::TIMESTAMPTZ;

-- Change posted_date from DATE to TIMESTAMPTZ  
ALTER TABLE bank_transactions 
  ALTER COLUMN posted_date TYPE TIMESTAMPTZ 
  USING posted_date::TIMESTAMPTZ;

-- Add comments to document the change
COMMENT ON COLUMN bank_transactions.transaction_date IS 'Full UTC timestamp of when transaction occurred (converted from Stripe transacted_at)';
COMMENT ON COLUMN bank_transactions.posted_date IS 'Full UTC timestamp of when transaction posted (converted from Stripe posted_at)';