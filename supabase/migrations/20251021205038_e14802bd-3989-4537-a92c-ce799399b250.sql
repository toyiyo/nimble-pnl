-- Add unique constraint on chart_of_accounts (restaurant_id, account_code)
-- This allows idempotent seeding with upsert operations

CREATE UNIQUE INDEX IF NOT EXISTS uq_accounts_rest_code
  ON chart_of_accounts(restaurant_id, account_code);