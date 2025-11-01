-- Make account_subtype nullable for sub-accounts
ALTER TABLE chart_of_accounts 
ALTER COLUMN account_subtype DROP NOT NULL;