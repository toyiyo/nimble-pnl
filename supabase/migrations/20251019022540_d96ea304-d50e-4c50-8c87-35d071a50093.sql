-- Clean up Opening Balance Equity functionality
-- This removes the temporary opening balance setup that is no longer needed

-- Step 1: Delete all journal entry lines associated with opening balance journal entries
DELETE FROM journal_entry_lines
WHERE journal_entry_id IN (
  SELECT id FROM journal_entries 
  WHERE reference_type = 'opening_balance'
);

-- Step 2: Delete all opening balance journal entries
DELETE FROM journal_entries
WHERE reference_type = 'opening_balance';

-- Step 3: Delete the Opening Balance Equity account (code 3900)
DELETE FROM chart_of_accounts
WHERE account_code = '3900'
  AND account_name = 'Opening Balance Equity'
  AND account_type = 'equity';

-- Step 4: Rebuild all account balances from journal entries for all restaurants
-- This ensures all balances are accurate after cleanup
DO $$
DECLARE
  r_id uuid;
BEGIN
  FOR r_id IN SELECT DISTINCT restaurant_id FROM chart_of_accounts
  LOOP
    PERFORM rebuild_account_balances(r_id);
  END LOOP;
END $$;