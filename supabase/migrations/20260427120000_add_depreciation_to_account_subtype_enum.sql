-- Migration: Add 'depreciation' to account_subtype_enum
-- Description: Adds the missing 'depreciation' value to the account_subtype_enum for chart_of_accounts

BEGIN;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_type t
    JOIN pg_enum e ON t.oid = e.enumtypid
    WHERE t.typname = 'account_subtype_enum' AND e.enumlabel = 'depreciation'
  ) THEN
    ALTER TYPE account_subtype_enum ADD VALUE 'depreciation';
  END IF;
END$$;

COMMIT;
