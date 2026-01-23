-- Test: account_subtype_enum includes depreciation
-- Description: Verifies that the 'depreciation' enum value was added to account_subtype_enum

BEGIN;

SELECT plan(1);

SELECT ok(
  EXISTS (
    SELECT 1 FROM pg_type t
    JOIN pg_enum e ON t.oid = e.enumtypid
    WHERE t.typname = 'account_subtype_enum' AND e.enumlabel = 'depreciation'
  ),
  'account_subtype_enum includes depreciation'
);

SELECT * FROM finish();

ROLLBACK;