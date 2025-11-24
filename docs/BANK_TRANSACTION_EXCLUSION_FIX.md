# Bank Transaction Exclusion Fix

## Problem

When trying to exclude a bank transaction using the "Exclude" button, the system returned an error:

```json
{
  "code": "22P02",
  "details": null,
  "hint": null,
  "message": "invalid input value for enum transaction_status_enum: \"excluded\""
}
```

**Endpoint**: `/rest/v1/rpc/exclude_bank_transaction`  
**Payload**: `{"p_transaction_id":"...","p_reason":"Excluded by user"}`

## Root Cause

The `exclude_bank_transaction()` function was trying to set:

```sql
UPDATE bank_transactions
SET
  status = 'excluded',  -- ❌ INVALID!
  excluded_reason = p_reason,
  ...
```

However, the `transaction_status_enum` only has these values:
- `'pending'`
- `'posted'`
- `'reconciled'`
- `'void'`

**It does NOT have `'excluded'` as a valid value.**

## Design Confusion

The system has two overlapping concepts:

### 1. Database Enum Status (`status` column)
- Type: `transaction_status_enum`
- Values: `pending`, `posted`, `reconciled`, `void`
- Purpose: Tracks the **posting status** of the transaction in the banking system

### 2. Logical UI Status (derived)
- Type: `TransactionStatus` (TypeScript)
- Values: `'for_review'` | `'categorized'` | `'excluded'` | `'reconciled'`
- Purpose: Tracks the **accounting workflow status** in the UI
- Implementation: **Derived from multiple columns**, not stored in `status` enum

## How Exclusion Actually Works

The "excluded" status is tracked by the `excluded_reason` column:

```typescript
// In useBankTransactions.tsx
if (status === 'excluded') {
  // Filter where excluded_reason IS NOT NULL
  query = query.not('excluded_reason', 'is', null);
}
```

**Translation Table**:
| UI Status | Database Logic |
|-----------|----------------|
| `for_review` | `is_categorized = false AND excluded_reason IS NULL` |
| `categorized` | `is_categorized = true AND excluded_reason IS NULL` |
| `excluded` | `excluded_reason IS NOT NULL` |
| `reconciled` | `is_reconciled = true` |

## The Fix

Remove the line that tries to set `status = 'excluded'`:

```sql
-- ❌ OLD (broken)
UPDATE bank_transactions
SET
  status = 'excluded',        -- Invalid enum value!
  excluded_reason = p_reason,
  updated_at = now()
WHERE id = p_transaction_id;

-- ✅ NEW (fixed)
UPDATE bank_transactions
SET
  excluded_reason = p_reason, -- This is enough to mark as excluded
  updated_at = now()
WHERE id = p_transaction_id;
```

## Why This Design?

The `transaction_status_enum` reflects **bank posting status** (from Stripe API):
- `pending` - Not yet posted by bank
- `posted` - Confirmed by bank
- `reconciled` - Matched to internal records
- `void` - Transaction voided/cancelled

The **accounting workflow status** is orthogonal and tracked separately:
- `excluded_reason` - User wants to ignore this transaction
- `is_categorized` - Has been assigned to chart of accounts
- `is_split` - Split across multiple categories
- `is_transfer` - Inter-account transfer

## Migration Applied

**File**: `supabase/migrations/20251121190000_fix_exclude_bank_transaction.sql`

Updates `exclude_bank_transaction()` function to only set `excluded_reason`, not `status`.

## Testing

After applying migration, try excluding a transaction:

```json
POST /rest/v1/rpc/exclude_bank_transaction
{
  "p_transaction_id": "c1cc204a-edc1-4a7b-bd9b-9b77b9724d21",
  "p_reason": "Excluded by user"
}
```

Should return:
```json
{
  "success": true,
  "transaction_id": "c1cc204a-edc1-4a7b-bd9b-9b77b9724d21",
  "excluded_reason": "Excluded by user"
}
```

## Related Files

- Migration: `supabase/migrations/20251019180355_d2bfe819-d400-46cb-b127-b13330c9798e.sql` (original broken function)
- Fix Migration: `supabase/migrations/20251121190000_fix_exclude_bank_transaction.sql`
- Hook: `src/hooks/useBankTransactions.tsx` (handles UI status logic)
- Types: `src/integrations/supabase/types.ts` (enum definition)

## Future Considerations

Consider renaming the column to avoid confusion:
- `status` → `posting_status` (clarifies it's about bank posting, not workflow)
- Or add a separate `workflow_status` enum that includes `excluded`

But for now, the current design works - exclusion is tracked by `excluded_reason IS NOT NULL`.
