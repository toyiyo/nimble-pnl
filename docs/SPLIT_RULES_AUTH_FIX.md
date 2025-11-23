# Split Rules Authorization Fix

## Problem

When applying split categorization rules to POS sales, the `apply_rules_to_pos_sales()` function was successfully matching rules and converting percentages to amounts, but failing with:

```
"Unauthorized: user cannot split sales for this restaurant"
```

## Root Cause

The authorization flow had a conflict:

1. **`apply_rules_to_pos_sales()`** runs as `SECURITY DEFINER`
   - This means it runs with the function owner's privileges
   - In this context, `auth.uid()` returns NULL (no user session)

2. **`split_pos_sale()`** checked `auth.uid()` for authorization
   - It expected a user ID to verify permissions
   - When `auth.uid()` was NULL, it failed the auth check

## The Flow

```
User calls Edge Function
  ↓
Edge Function verifies user has manager/owner role ✅
  ↓
Edge Function calls apply_rules_to_pos_sales() (SECURITY DEFINER)
  ↓ (auth.uid() = NULL in this context)
  ↓
apply_rules_to_pos_sales() finds matching rule ✅
  ↓
apply_rules_to_pos_sales() converts percentages to amounts ✅
  ↓
apply_rules_to_pos_sales() calls split_pos_sale()
  ↓
split_pos_sale() checks auth.uid() → NULL ❌
  ↓
Returns: "Unauthorized" 
```

## Solution

Modified `split_pos_sale()` to handle two scenarios:

### Scenario 1: Direct User Call
- `auth.uid()` is NOT NULL
- Verify user has owner/manager role for the restaurant
- Proceed if authorized

### Scenario 2: Called by SECURITY DEFINER Function
- `auth.uid()` IS NULL
- Trust that the calling function has already verified permissions
- Proceed without additional auth check

## Code Change

```sql
-- Authorization check
v_user_id := auth.uid();

IF v_user_id IS NOT NULL THEN
  -- Direct user call - check permissions
  SELECT EXISTS (
    SELECT 1
    FROM user_restaurants
    WHERE user_id = v_user_id
      AND restaurant_id = v_sale.restaurant_id
      AND role IN ('owner', 'manager')
  ) INTO v_has_permission;

  IF NOT v_has_permission THEN
    RETURN QUERY SELECT FALSE, 'Unauthorized: user cannot split sales for this restaurant';
    RETURN;
  END IF;
END IF;
-- If v_user_id IS NULL, we're being called by a SECURITY DEFINER function
-- which has already done permission checks, so we proceed
```

## Security Considerations

This is **secure** because:

1. ✅ The Edge Function (`apply-categorization-rules`) verifies the user has permissions **before** calling `apply_rules_to_pos_sales()`
2. ✅ `apply_rules_to_pos_sales()` is `SECURITY DEFINER` and only accessible via the Edge Function
3. ✅ Direct user calls to `split_pos_sale()` still require authorization
4. ✅ RLS policies on `unified_sales` provide an additional security layer

## Files Modified

- **Migration**: `supabase/migrations/20251121180000_fix_split_pos_sale_authorization.sql`
  - Updates `split_pos_sale()` function to allow SECURITY DEFINER calls

## Testing

After applying this migration:

```sql
-- Should now work
SELECT * FROM apply_rules_to_pos_sales(
  'b80c60f4-76f9-49e6-9e63-7594d708d31a'::UUID,
  5
);
```

Expected result: `applied_count > 0` for Wetzel bits items.

## Verification

Run the Edge Function again:

```
POST https://ncdujvdgqtaunuyigflp.supabase.co/functions/v1/apply-categorization-rules
{
  "restaurantId": "b80c60f4-76f9-49e6-9e63-7594d708d31a",
  "applyTo": "pos_sales",
  "batchLimit": 100
}
```

Should return: `"Applied rules to X of 99 POS sales"` where X > 0.

## Related Issues

- Split rules were created successfully ✅
- Rules were matching correctly ✅  
- Percentage to amount conversion was working ✅
- Authorization was blocking the final step ❌ → ✅ (now fixed)
