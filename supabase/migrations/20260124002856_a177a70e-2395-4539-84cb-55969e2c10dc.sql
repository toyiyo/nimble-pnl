-- Fix depreciation expense account subtype for existing restaurants
-- Account 6100 "Depreciation Expense" should have subtype 'depreciation', not 'other_expenses'
-- This ensures the dropdown in Asset depreciation settings shows the correct account

UPDATE chart_of_accounts
SET account_subtype = 'depreciation',
    updated_at = now()
WHERE account_code = '6100'
  AND account_subtype = 'other_expenses';

-- Also update any accounts with depreciation-related names that may have wrong subtype
UPDATE chart_of_accounts
SET account_subtype = 'depreciation',
    updated_at = now()
WHERE account_name ILIKE '%depreciation expense%'
  AND account_type = 'expense'
  AND (account_subtype IS NULL OR account_subtype != 'depreciation');