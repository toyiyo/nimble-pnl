# Split Rule Constraint Fix - Complete Solution

## Problem

When trying to save a split categorization rule, the following error occurred:

```
"message": "new row for relation \"categorization_rules\" violates check constraint \"check_split_config\""
```

### Payload Being Sent
```json
{
  "category_id": null,
  "is_split_rule": true,
  "split_categories": [
    {"category_id": "66546a08-...", "percentage": 90, "description": ""},
    {"category_id": "ac88dd08-...", "percentage": 10, "description": ""}
  ]
}
```

## Root Causes

### Issue 1: Wrong Constraint Name in Database
The error mentions `check_split_config` but our migration created `check_split_rule_has_categories`. This indicates:
- The database has an older/different constraint that wasn't captured in migrations
- Possibly created manually during development
- Need to drop it and recreate with correct name

### Issue 2: JSON.stringify() (Already Fixed)
- Was stringifying `split_categories` before sending to database
- Fixed by removing `JSON.stringify()` calls
- Now passes JavaScript objects directly (Supabase handles JSONB conversion)

### Issue 3: Constraint Logic Inconsistency
The original constraint had issues:
- Didn't require `category_id IS NOT NULL` for regular rules
- This could allow invalid regular rules without a category

## Complete Solution

### Step 1: Fix JSON Handling (✅ Already Done)
Removed `JSON.stringify()` from:
- `useCreateRuleV2` (line ~169)
- `useUpdateRuleV2` (line ~207)

### Step 2: New Migration to Fix Constraints
Created `/supabase/migrations/20251121150000_fix_split_constraint.sql`:

```sql
-- Drop any old/conflicting constraints
ALTER TABLE categorization_rules DROP CONSTRAINT IF EXISTS check_split_config;
ALTER TABLE categorization_rules DROP CONSTRAINT IF EXISTS check_split_rule_has_categories;
ALTER TABLE categorization_rules DROP CONSTRAINT IF EXISTS check_split_configuration;

-- Ensure category_id can be NULL
ALTER TABLE categorization_rules ALTER COLUMN category_id DROP NOT NULL;

-- Add correct constraint
ALTER TABLE categorization_rules
ADD CONSTRAINT check_split_rule_has_categories
CHECK (
  (is_split_rule IS FALSE AND split_categories IS NULL AND category_id IS NOT NULL) OR
  (is_split_rule IS TRUE AND split_categories IS NOT NULL AND jsonb_array_length(split_categories) >= 2)
);
```

### Step 3: Update Original Migration
Updated `/supabase/migrations/20251121143326_add_split_support_to_categorization_rules.sql`:
- Changed to use `IS FALSE` / `IS TRUE` (better SQL practice)
- Added `DROP CONSTRAINT IF EXISTS` before adding constraint
- Ensures regular rules have `category_id IS NOT NULL`

## Constraint Logic

### For Regular Rules (`is_split_rule = false`):
- ✅ Must have `category_id` (not null)
- ✅ Must NOT have `split_categories` (must be null)

### For Split Rules (`is_split_rule = true`):
- ✅ Must have `split_categories` array
- ✅ Array must have at least 2 categories
- ✅ `category_id` can be null (not used for split rules)

## How to Apply

### Option 1: Reset Database (Development)
```bash
supabase db reset
```

### Option 2: Apply New Migration Only (Production)
```bash
# The new migration will:
# 1. Drop old conflicting constraints
# 2. Add the correct constraint
supabase db push
```

### Option 3: Manual Fix (If migrations don't work)
Run this SQL directly in Supabase SQL Editor:

```sql
-- Drop old constraints
ALTER TABLE categorization_rules DROP CONSTRAINT IF EXISTS check_split_config;
ALTER TABLE categorization_rules DROP CONSTRAINT IF EXISTS check_split_rule_has_categories;

-- Ensure category_id nullable
ALTER TABLE categorization_rules ALTER COLUMN category_id DROP NOT NULL;

-- Add correct constraint
ALTER TABLE categorization_rules
ADD CONSTRAINT check_split_rule_has_categories
CHECK (
  (is_split_rule IS FALSE AND split_categories IS NULL AND category_id IS NOT NULL) OR
  (is_split_rule IS TRUE AND split_categories IS NOT NULL AND jsonb_array_length(split_categories) >= 2)
);
```

## Verification

After applying the fix, test by creating a split rule:

```json
{
  "rule_name": "Test Split Rule",
  "applies_to": "pos_sales",
  "item_name_pattern": "test",
  "is_split_rule": true,
  "category_id": null,
  "split_categories": [
    {"category_id": "uuid-1", "percentage": 60},
    {"category_id": "uuid-2", "percentage": 40}
  ]
}
```

Should succeed with no constraint violations.

## Files Changed

1. ✅ `/src/hooks/useCategorizationRulesV2.tsx` - Removed JSON.stringify()
2. ✅ `/supabase/migrations/20251121143326_add_split_support_to_categorization_rules.sql` - Updated constraint
3. ✅ `/supabase/migrations/20251121150000_fix_split_constraint.sql` - New migration to fix production DB

## Prevention

To prevent this issue in the future:
1. ✅ Always test migrations in development before deploying
2. ✅ Use `IF EXISTS` when dropping constraints
3. ✅ Never use `JSON.stringify()` for Supabase JSONB columns
4. ✅ Document constraints clearly in migrations
5. ✅ Capture all schema changes in migrations (avoid manual changes)
