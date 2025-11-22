# Bank Transaction Split Rules Fix

## Problem

Split categorization rules for bank transactions were not applying, returning:

```json
{
  "success": true,
  "message": "Applied rules to 0 of 100 bank transactions",
  "count": 0
}
```

**Rule details**:
- Rule name: "Tracer"
- Pattern: "Tracer" (contains)
- Type: Split rule with 10%/90% split
- Applies to: bank_transactions
- Transaction type: debit

**Expected to match**:
- "Draft 5096 Tracer 0091105387" (-$173.12)
- "Draft 5170 Tracer 0091105386" (-$346.92)
- "Draft 5129 Tracer 0091105385" (-$157.24)

## Root Cause

**Same issue as POS sales**: The `apply_rules_to_bank_transactions()` function was passing percentage-based splits directly to `split_bank_transaction()`, which expects amount-based splits.

### The Flow

```
User creates split rule with percentages:
{
  "percentage": 10,
  "category_id": "...",
  "description": ""
}
  ↓
apply_rules_to_bank_transactions() matches rule ✅
  ↓
Calls split_bank_transaction(transaction_id, split_categories) ❌
  (Passes percentages directly)
  ↓
split_bank_transaction() expects amounts:
FOR v_split IN SELECT * FROM jsonb_to_recordset(p_splits) 
  AS x(category_id uuid, amount numeric, description text)
  ↓
validation fails: total_split_amount doesn't match transaction amount
  ↓
Returns error or null result
```

### Code Evidence

**In migration `20251121143327_update_apply_rules_for_splits.sql` line 172**:
```sql
SELECT * INTO v_split_result
FROM split_bank_transaction(
  v_transaction.id,
  v_rule.split_categories  -- ❌ Contains percentages, not amounts
);
```

**In `split_bank_transaction()` line 33**:
```sql
FOR v_split IN SELECT * FROM jsonb_to_recordset(p_splits) 
  AS x(category_id uuid, amount numeric, description text)  -- Expects 'amount'
LOOP
  v_total_split_amount := v_total_split_amount + v_split.amount;
END LOOP;
```

**Validation at line 39**:
```sql
IF ABS(ABS(v_transaction.amount) - v_total_split_amount) > 0.01 THEN
  RAISE EXCEPTION 'Split amounts (%) do not match transaction amount (%)', 
    v_total_split_amount, ABS(v_transaction.amount);
END IF;
```

When passed percentages instead of amounts, `v_split.amount` is NULL, so `v_total_split_amount` = 0, which never matches the transaction amount.

## The Fix

Convert percentage splits to amount splits before calling `split_bank_transaction()`:

```sql
-- For each split in split_categories
FOR v_split IN SELECT * FROM jsonb_array_elements(v_rule.split_categories)
LOOP
  IF v_split->>'percentage' IS NOT NULL THEN
    -- Convert percentage to amount
    v_splits_array := v_splits_array || jsonb_build_object(
      'category_id', v_split->>'category_id',
      'amount', ROUND((ABS(v_transaction.amount) * (v_split->>'percentage')::NUMERIC / 100.0), 2),
      'description', COALESCE(v_split->>'description', '')
    );
  END IF;
END LOOP;

-- Convert array to JSONB and pass to split function
v_splits_with_amounts := to_jsonb(v_splits_array);
SELECT split_bank_transaction(v_transaction.id, v_splits_with_amounts) INTO v_split_result;
```

**Example conversion**:
```
Transaction: "Draft 5096 Tracer 0091105387" = -$173.12

Rule splits:
[
  {"percentage": 10, "category_id": "d44c79fe..."},
  {"percentage": 90, "category_id": "79a6634b..."}
]

Converted to:
[
  {"amount": 17.31, "category_id": "d44c79fe..."},  // 10% of $173.12
  {"amount": 155.81, "category_id": "79a6634b..."}  // 90% of $173.12
]

Total: $173.12 ✅ Matches transaction amount
```

## Additional Fixes

1. **Added exclusion filter**: Don't apply rules to transactions with `excluded_reason IS NOT NULL`
2. **Better error handling**: Check `split_result->>'success'` to determine if split succeeded
3. **NOTICE logging**: Log failures with transaction ID and error message

## Migration Applied

**File**: `supabase/migrations/20251121200000_fix_bank_split_rules_conversion.sql`

Updates `apply_rules_to_bank_transactions()` to:
- Convert percentage splits to amount splits
- Use `ABS(v_transaction.amount)` for calculation (handles negative amounts)
- Check split result success status
- Filter out excluded transactions

## Testing

**Debug function created**: `debug-bank-split-rules.sql`

Run this to see exactly what's happening:

```sql
SELECT * FROM apply_rules_to_bank_transactions_debug(
  'b80c60f4-76f9-49e6-9e63-7594d708d31a'::UUID,
  5
);
```

This shows:
- Which transactions are being checked
- Whether rules match
- Raw split_categories (percentages)
- Converted splits (amounts)
- Whether split succeeded
- Any error messages

**After applying migration**, call the Edge Function again:

```
POST /functions/v1/apply-categorization-rules
{
  "restaurantId": "b80c60f4-76f9-49e6-9e63-7594d708d31a",
  "applyTo": "bank_transactions",
  "batchLimit": 100
}
```

Expected: `"Applied rules to X of 100 bank transactions"` where X > 0 (should match the 3 Tracer transactions).

## Related Issues

- **Split POS sales**: Fixed in `20251121170000_fix_apply_split_rules_conversion.sql`
- **Split POS authorization**: Fixed in `20251121180000_fix_split_pos_sale_authorization.sql`
- **Bank transaction exclusion**: Fixed in `20251121190000_fix_exclude_bank_transaction.sql`

## Pattern for Future Integrations

**When creating split functionality**:

1. ✅ Store splits as percentages in rules (user-friendly)
2. ✅ Convert percentages to amounts before calling split functions
3. ✅ Use `ABS()` when calculating amounts from negative transactions
4. ✅ Validate converted amounts sum to transaction total
5. ✅ Handle both percentage and amount formats (future-proof)

**Formula**:
```sql
amount = ROUND((ABS(transaction_amount) * percentage / 100.0), 2)
```

## Verification Checklist

After applying migration:

- [ ] Apply rules via Edge Function
- [ ] Check `applied_count > 0`
- [ ] Verify splits created in `bank_transaction_splits` table
- [ ] Confirm original transaction marked `is_split = true`
- [ ] Check amounts sum to original transaction amount
- [ ] Verify journal entries created correctly
