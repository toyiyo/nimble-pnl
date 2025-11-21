# Migration Files Fix Summary

## Issues Found

When attempting to apply the split categorization rules migrations, two errors occurred:

### 1. Function Return Type Error
```
ERROR: 42P13: cannot change return type of existing function
DETAIL: Row type defined by OUT parameters is different.
HINT: Use DROP FUNCTION find_matching_rules_for_bank_transaction(uuid,jsonb) first.
```

**Cause**: The migration tried to change the return type of existing functions without dropping them first.

**Fix**: Added explicit `DROP FUNCTION IF EXISTS` statements before recreating the functions with new signatures.

### 2. Check Constraint Violation
```
ERROR: 23514: check constraint "check_split_rule_has_categories" of relation "categorization_rules" is violated by some row
```

**Cause**: The check constraint was added before updating existing rows to have proper default values. Existing rows might have had NULL values for `is_split_rule` or improper combinations.

**Fix**: 
1. Added an UPDATE statement to set default values on existing rows BEFORE adding the constraint
2. Reordered operations to DROP NOT NULL constraint on `category_id` BEFORE adding the check constraint

## Fixed Migration Files

### File 1: `20251121143326_add_split_support_to_categorization_rules.sql`

**Changes Made**:
1. ✅ Added `UPDATE categorization_rules` to set defaults on existing rows
2. ✅ Moved `ALTER COLUMN category_id DROP NOT NULL` before the check constraint
3. ✅ Added comment explaining the order of operations

**Order of Operations** (Critical):
```sql
-- 1. Add new columns with defaults
ALTER TABLE categorization_rules 
ADD COLUMN IF NOT EXISTS is_split_rule BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN IF NOT EXISTS split_categories JSONB;

-- 2. Update existing rows to ensure proper values
UPDATE categorization_rules
SET 
  is_split_rule = false,
  split_categories = NULL
WHERE is_split_rule IS NULL;

-- 3. Drop NOT NULL constraint (before adding check constraint)
ALTER TABLE categorization_rules 
ALTER COLUMN category_id DROP NOT NULL;

-- 4. Add check constraint (after data is clean and NOT NULL is dropped)
ALTER TABLE categorization_rules
ADD CONSTRAINT check_split_rule_has_categories
CHECK (
  (is_split_rule = false AND split_categories IS NULL) OR
  (is_split_rule = true AND category_id IS NULL AND split_categories IS NOT NULL AND jsonb_array_length(split_categories) >= 2)
);
```

### File 2: `20251121143327_update_apply_rules_for_splits.sql`

**Changes Made**:
1. ✅ Added explicit `DROP FUNCTION` statements at the top
2. ✅ Reordered functions so `find_matching_rules_*` functions are created BEFORE `apply_rules_*` functions use them

**Order of Operations** (Critical):
```sql
-- 1. Drop existing functions first
DROP FUNCTION IF EXISTS find_matching_rules_for_bank_transaction(UUID, JSONB);
DROP FUNCTION IF EXISTS find_matching_rules_for_pos_sale(UUID, JSONB);

-- 2. Create find_matching_rules functions with new signatures
CREATE OR REPLACE FUNCTION find_matching_rules_for_bank_transaction(...) ...
CREATE OR REPLACE FUNCTION find_matching_rules_for_pos_sale(...) ...

-- 3. Create/update functions that use the find_matching_rules functions
CREATE OR REPLACE FUNCTION apply_rules_to_bank_transactions(...) ...
CREATE OR REPLACE FUNCTION apply_rules_to_pos_sales(...) ...
```

## How to Apply

These migrations should now apply cleanly:

```bash
# Option 1: Via Supabase CLI (local development)
supabase db reset

# Option 2: Via Supabase Dashboard
# Go to SQL Editor and run each migration file in order
```

## Verification

After applying, verify:

```sql
-- Check table structure
\d categorization_rules

-- Verify existing rules have proper defaults
SELECT 
  id,
  rule_name,
  is_split_rule,
  category_id IS NOT NULL as has_category,
  split_categories IS NOT NULL as has_split_cats
FROM categorization_rules
LIMIT 10;

-- Verify functions exist with correct signatures
\df find_matching_rules_for_bank_transaction
\df find_matching_rules_for_pos_sale
\df apply_rules_to_bank_transactions
\df apply_rules_to_pos_sales
```

## Key Lessons

1. **Always update existing data before adding constraints** - Constraints are checked against existing rows
2. **Drop functions explicitly when changing signatures** - PostgreSQL won't allow return type changes without dropping first
3. **Order matters for DDL operations** - Drop NOT NULL before adding check constraints that depend on NULL values
4. **Function dependencies** - Create functions before they're referenced by other functions

## Related Files

- `/supabase/migrations/20251121143326_add_split_support_to_categorization_rules.sql`
- `/supabase/migrations/20251121143327_update_apply_rules_for_splits.sql`
- `SPLIT_CATEGORIZATION_RULES.md` - Feature documentation
