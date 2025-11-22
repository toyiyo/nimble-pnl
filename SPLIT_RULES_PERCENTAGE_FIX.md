# Split Rules Application Fix - Percentage to Amount Conversion

## Root Cause Found! ✅

The manual debug query confirmed the rule IS being matched correctly. The problem is in how the split data is being passed to the `split_pos_sale` function.

### The Issue

**Rule stores splits as percentages:**
```json
{
  "split_categories": [
    {"category_id": "...", "percentage": 90, "description": ""},
    {"category_id": "...", "percentage": 10, "description": ""}
  ]
}
```

**But `split_pos_sale` function expects amounts:**
```json
{
  "splits": [
    {"category_id": "...", "amount": 7.19, "description": ""},
    {"category_id": "...", "amount": 0.80, "description": ""}
  ]
}
```

### Why It Failed Silently

When `apply_rules_to_pos_sales` called `split_pos_sale` with percentage data:
1. `split_pos_sale` tried to sum the amounts: `SUM((v_split->>'amount')::NUMERIC)`
2. But the field is `percentage`, not `amount`, so it gets NULL
3. The validation fails: "Split amounts must equal the original sale amount"
4. The function returns `success: false` with an error message
5. The `apply_rules` function catches this and continues, but doesn't count it as applied

## The Fix

Created migration `/supabase/migrations/20251121170000_fix_apply_split_rules_conversion.sql` that:

1. **Converts percentages to amounts** before calling `split_pos_sale`:
   ```sql
   -- For a $7.99 sale with 90%/10% split:
   amount_1 = ROUND(7.99 * 90 / 100, 2) = 7.19
   amount_2 = ROUND(7.99 * 10 / 100, 2) = 0.80
   ```

2. **Handles both formats**:
   - If split has `percentage` → calculate amount
   - If split has `amount` → use it directly

3. **Logs failures** for debugging:
   ```sql
   RAISE NOTICE 'Failed to split sale %: %', sale_id, error_message;
   ```

## How to Apply

### Option 1: Apply Migration
```bash
supabase db push
```

### Option 2: Manual SQL (if migration doesn't work)
Copy the entire content of `20251121170000_fix_apply_split_rules_conversion.sql` and run it in Supabase SQL Editor.

## Test After Applying

1. Run "Apply Rules to Existing Records" again
2. Should now see: `"Applied rules to X of 99 POS sales"` (where X > 0)
3. Check a "Wetzel bits" sale - it should be split into:
   - $7.19 → Sales - Food (90%)
   - $0.80 → Merchandise Sales (10%)

## Verification Query

Run this to see if splits were created:

```sql
-- Check if the sale was split
SELECT 
  id,
  item_name,
  total_price,
  is_split,
  parent_sale_id,
  category_id,
  is_categorized
FROM unified_sales
WHERE item_name ILIKE '%Wetzel bits%'
ORDER BY sale_date DESC, created_at ASC
LIMIT 10;
```

**Expected Result**:
- 1 row with `is_split = true` (the original)
- 2 rows with `parent_sale_id = <original_id>` (the splits)

## Why This Happened

The split categorization rules feature is new and was designed to store splits as percentages (more flexible), but the existing `split_pos_sale` function was built earlier and expects amounts.

We needed a conversion layer in the `apply_rules` function.

## Related Files

- ✅ `/supabase/migrations/20251121170000_fix_apply_split_rules_conversion.sql` - The fix
- `/supabase/migrations/20251031030424_cfb74b18-8784-4e75-a32b-b2a2ed0dd10a.sql` - Original `split_pos_sale` function
- `/supabase/migrations/20251121143327_update_apply_rules_for_splits.sql` - Original (broken) apply rules function

## Prevention

Going forward:
1. ✅ Test the complete flow (create rule → apply to existing records)
2. ✅ Add better error logging to catch silent failures
3. ✅ Document data format requirements between functions
4. ✅ Consider updating `split_pos_sale` to accept both formats
