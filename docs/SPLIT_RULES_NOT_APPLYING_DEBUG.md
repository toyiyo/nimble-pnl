

# Split Rules Not Applying - Debug Guide

## Problem

Split categorization rule created successfully, but when applying rules to existing records:
- Found 99 POS sales
- Applied rules to 0 of them
- Rule appears correctly configured with matching pattern

## Rule Configuration
```json
{
  "rule_name": "Wetzel bits",
  "item_name_pattern": "Wetzel bits",
  "item_name_match_type": "contains",
  "is_split_rule": true,
  "split_categories": [
    {"category_id": "...", "percentage": 90},
    {"category_id": "...", "percentage": 10}
  ]
}
```

## POS Sale to Match
- Item: "Wetzel bits"
- Price: $7.99
- Should match with "contains" logic

## Possible Causes

### 1. Column Name Mismatch
The rule data shows BOTH:
- `"split_config": null` ❌ (wrong column name)
- `"split_categories": [...]` ✅ (correct)

This suggests the database might have both columns, causing confusion.

### 2. The Rule Matching Function Might Be Using Wrong Column
The `find_matching_rules_for_pos_sale` function needs to return `split_categories`, not `split_config`.

## Solutions

### Step 1: Apply Debug Migration
Apply the migration `/supabase/migrations/20251121160000_debug_split_rules_application.sql`:

```bash
supabase db push
```

This will:
- Drop any `split_config` column if it exists
- Ensure `split_categories` column exists
- Add debug logging to `apply_rules_to_pos_sales` function

### Step 2: Run Debug Queries
Run the queries in `debug-split-rules-matching.sql` in Supabase SQL Editor:

```sql
-- This will show you:
-- 1. The actual rule configuration
-- 2. POS sales that should match
-- 3. Test if matching logic works
-- 4. Check column names
-- 5. Test the matching function directly
```

### Step 3: Check Supabase Logs
After applying the debug migration, run "Apply Rules" again and check Supabase logs:

1. Go to Supabase Dashboard
2. Navigate to: Logs → Postgres Logs
3. Look for NOTICE messages like:
   ```
   Found X active POS rules for restaurant...
   Checking sale: item_name=Wetzel bits...
   Found matching rule...
   ```

### Step 4: Verify Column Names
Run this query to see actual columns:

```sql
SELECT column_name, data_type
FROM information_schema.columns
WHERE table_name = 'categorization_rules'
  AND column_name LIKE '%split%'
ORDER BY column_name;
```

Expected output:
- `split_categories` | `jsonb` ✅
- ~~`split_config`~~ should NOT exist ❌

## Quick Manual Test

Run this in SQL Editor to test if the rule SHOULD match:

```sql
-- Test with your restaurant_id
SELECT * FROM find_matching_rules_for_pos_sale(
  'b80c60f4-76f9-49e6-9e63-7594d708d31a'::UUID,
  jsonb_build_object(
    'item_name', 'Wetzel bits',
    'total_price', 7.99,
    'pos_category', NULL
  )
);
```

**Expected**: Should return your rule
**If empty**: The matching logic has an issue

## Common Issues & Fixes

### Issue: Rule returns but has NULL split_categories
**Cause**: The function is selecting the wrong column name

**Fix**: Update `find_matching_rules_for_pos_sale` to ensure it's returning the correct column.

### Issue: Case sensitivity
**Cause**: Item name might have different casing

**Fix**: The function uses `LOWER()` so this shouldn't be an issue, but verify:
```sql
SELECT item_name, LOWER(item_name)
FROM unified_sales
WHERE item_name ILIKE '%wetzel%'
LIMIT 5;
```

### Issue: Extra whitespace
**Cause**: Item name might have leading/trailing spaces

**Fix**: Check for whitespace:
```sql
SELECT 
  item_name,
  LENGTH(item_name) as len,
  LENGTH(TRIM(item_name)) as trimmed_len
FROM unified_sales
WHERE item_name ILIKE '%wetzel%'
LIMIT 5;
```

## Expected Debug Output

After applying the debug migration and running "Apply Rules", you should see in logs:

```
NOTICE: Found 1 active POS rules for restaurant b80c60f4-...
NOTICE: Checking sale ...: item_name=Wetzel bits, total_price=7.99, pos_category=<NULL>
NOTICE: Found matching rule Wetzel bits for sale ...
NOTICE: Applying split rule Wetzel bits to sale ...
NOTICE: Successfully applied split rule to sale ...
NOTICE: Completed: applied 1 rules to 99 of 100 sales
```

If you see:
```
NOTICE: No matching rule found for sale ...
```

Then the matching logic is failing. Check:
1. Is `is_active = true`?
2. Is `applies_to` correct ('pos_sales' or 'both')?
3. Is the item name pattern matching correctly?

## Next Steps

1. ✅ Apply debug migration
2. ✅ Run debug queries
3. ✅ Check Supabase logs
4. ✅ Share log output if still not working

The debug logging will tell us exactly where the process is failing.
