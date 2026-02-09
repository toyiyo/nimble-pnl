# Categorization Rule Application: Edge Function to Database Migration

## Overview

This document describes the migration of categorization rule application logic from Supabase Edge Functions to direct database RPC calls, eliminating execution time limits and improving performance.

## Problem

Previously, when applying categorization rules to existing POS/bank transactions, the system used a Supabase Edge Function (`apply-categorization-rules`) which had the following limitations:

1. **CPU limits**: ~10 seconds maximum execution time
2. **Memory constraints**: Limited memory allocation
3. **Timeout issues**: Large batches would timeout
4. **HTTP overhead**: Additional latency from function invocation
5. **Complexity**: Extra layer between frontend and database

Users had to manually click "Apply Rules" multiple times to process all transactions due to these limitations.

## Solution

Move the rule application logic to direct database RPC calls:
- Database functions (`apply_rules_to_pos_sales`, `apply_rules_to_bank_transactions`) already existed
- These functions use `SECURITY DEFINER` but lacked permission checks
- Frontend hooks now call database RPCs directly instead of Edge Function

## Changes Made

### 1. Database Migration: `20260209000000_add_auth_to_apply_rule_functions.sql`

Added permission checks to both functions:

```sql
-- CRITICAL SECURITY CHECK: Verify user has permission to apply rules for this restaurant
IF NOT EXISTS (
  SELECT 1 FROM user_restaurants
  WHERE restaurant_id = p_restaurant_id
  AND user_id = auth.uid()
  AND role IN ('owner', 'manager')
) THEN
  RAISE EXCEPTION 'Permission denied: user does not have access to apply rules for this restaurant';
END IF;
```

**Permissions:**
- ✅ Owner role: Can apply rules
- ✅ Manager role: Can apply rules
- ❌ Chef/Staff/Kiosk roles: Cannot apply rules

### 2. Frontend Hook Update: `useApplyRulesV2()` in `useCategorizationRulesV2.tsx`

**Before:**
```typescript
const { data, error } = await supabase.functions.invoke(
  'apply-categorization-rules',
  { body: { restaurantId, applyTo, batchLimit } }
);
```

**After:**
```typescript
// Call database RPC directly
const { data: bankData, error: bankError } = await supabase
  .rpc('apply_rules_to_bank_transactions', {
    p_restaurant_id: restaurantId,
    p_batch_limit: batchLimit
  });

const { data: posData, error: posError } = await supabase
  .rpc('apply_rules_to_pos_sales', {
    p_restaurant_id: restaurantId,
    p_batch_limit: batchLimit
  });
```

### 3. Legacy Hook Update: `useApplyRules()` in `useCategorizationRules.tsx`

Updated for backwards compatibility with old `supplier_categorization_rules` table.

### 4. Tests: `19_apply_rules_permissions.sql`

Added comprehensive permission tests:
- ✅ Owner can apply rules to POS sales
- ✅ Manager can apply rules to POS sales
- ❌ Staff cannot apply rules to POS sales
- ✅ Owner can apply rules to bank transactions
- ✅ Manager can apply rules to bank transactions
- ❌ Chef cannot apply rules to bank transactions

## Benefits

### Performance
- **No execution time limits**: Database functions can run as long as needed
- **Better performance**: Eliminates HTTP overhead from Edge Function calls
- **Larger batches**: Can process more records per batch without timeout

### Architecture
- **Simpler**: Fewer moving parts (no Edge Function intermediary)
- **More secure**: Permission checks at database level
- **Better scalability**: Database handles concurrency better than Edge Functions

### User Experience
- **Fewer clicks**: Larger batches mean fewer manual "Apply Rules" clicks
- **Faster processing**: Direct database calls are faster than HTTP round-trips
- **More reliable**: No timeout errors for large datasets

## Edge Function Status

The Edge Function `apply-categorization-rules` is **still present** for backwards compatibility but is no longer used by the main application. It can be deprecated and removed in a future release once we're confident all code paths have been updated.

## Migration Impact

### Database
- ✅ Functions updated with permission checks
- ✅ No schema changes required
- ✅ Backwards compatible (existing function signatures unchanged)

### Frontend
- ✅ Main hooks updated to use RPC directly
- ✅ No API changes (same function signatures)
- ✅ Backwards compatible

### Security
- ✅ Permission checks added at database level
- ✅ RLS policies still enforced for categorization_rules table
- ✅ auth.uid() used for user identification

## Testing

### Database Tests
Run pgTAP tests to verify permission checks:
```bash
cd supabase/tests && ./run_tests.sh 19_apply_rules_permissions.sql
```

### Manual Testing
1. Create categorization rules in UI
2. Click "Apply to existing" button
3. Verify rules are applied to uncategorized transactions
4. Check that staff/chef users cannot apply rules (should see error)

## Rollback Plan

If issues are discovered, rollback is simple:

1. Revert frontend hooks to use Edge Function:
   ```typescript
   // In useApplyRulesV2()
   const { data, error } = await supabase.functions.invoke(
     'apply-categorization-rules',
     { body: { restaurantId, applyTo, batchLimit } }
   );
   ```

2. Deploy migration to remove permission checks (optional):
   ```sql
   -- Remove the IF NOT EXISTS check from both functions
   ```

## Future Improvements

1. **Background Jobs**: For very large datasets (10k+ transactions), consider using pg_cron or background workers
2. **Progress Tracking**: Add progress reporting for long-running operations
3. **Batch Optimization**: Dynamically adjust batch size based on transaction count
4. **Parallel Processing**: Split work across multiple parallel RPC calls for faster processing

## Related Files

- Migration: `supabase/migrations/20260209000000_add_auth_to_apply_rule_functions.sql`
- Tests: `supabase/tests/19_apply_rules_permissions.sql`
- Frontend: `src/hooks/useCategorizationRulesV2.tsx`
- Legacy: `src/hooks/useCategorizationRules.tsx`
- Edge Function (deprecated): `supabase/functions/apply-categorization-rules/index.ts`
