# Tip Pooling Bug Fixes - Summary

## Issues Fixed

### 1. POS Tips Not Showing in Tip Split Screen ✅

**Problem:**
- User had tip data in `unified_sales` (categorized as "tips" from Toast POS)
- Tip split screen showed "No POS tips found for today"
- Date was correct (Feb 10, 2026), but tips weren't being detected

**Root Cause:**
The SQL function `get_pos_tips_by_date` only queried `unified_sales_splits` (already categorized splits), but Toast POS syncs tips directly to `unified_sales` with `item_type='tip'` or `adjustment_type='tip'` BEFORE they are manually categorized into splits.

**Solution:**
Created migration `supabase/migrations/20260210234900_fix_get_pos_tips_by_date.sql` that:

1. Queries BOTH data sources:
   - **Categorized tips**: Items in `unified_sales_splits` where the account name or subtype contains "tip"
   - **Uncategorized tips**: Items in `unified_sales` where `item_type='tip'` OR `adjustment_type='tip'`

2. Prevents double-counting by excluding uncategorized items that already have splits

3. Combines both sources and aggregates by date and POS system

**Code Changes:**
- `supabase/migrations/20260210234900_fix_get_pos_tips_by_date.sql` - New migration

---

### 2. Tip Pool Settings Not Persisting ✅

**Problem:**
- User selects "POS Import" in tip pooling settings
- Closes the dialog
- Reopens the dialog → settings reverted to "Manual Entry"

**Root Cause:**
The auto-save hook `useAutoSaveTipSettings` had an early return if `settings` was null:

```typescript
if (!settings) return; // ❌ Blocked first-time saves!
```

This meant first-time users (or users without existing settings) could never save their settings because the auto-save hook would exit immediately.

**Solution:**
Modified `src/hooks/useAutoSaveTipSettings.ts` to:

1. Allow saving when `settings` is null (first-time setup)
2. Trigger save when user has selected employees (indicates user interaction)
3. Maintain existing behavior for updates to existing settings

**Code Changes:**
- `src/hooks/useAutoSaveTipSettings.ts` - Modified to support first-time setup

---

## Testing Instructions

### Test 1: POS Tips Display

**Prerequisites:**
- Restaurant with Toast POS connection
- Toast has synced orders with tips to `unified_sales`
- Tips have `item_type='tip'` or `adjustment_type='tip'`

**Steps:**
1. Navigate to Tips page
2. Click "Daily Entry" tab
3. Select a date that has Toast tips
4. Verify "Today's tips" card shows:
   - Correct tip amount from POS
   - Badge showing "TOAST" (or other POS source)
   - Transaction count
   - "Use this amount" and "Edit" buttons

**Expected Result:**
✅ POS tips appear correctly even if they haven't been manually categorized

### Test 2: Settings Persistence

**Prerequisites:**
- Restaurant without existing tip pool settings (or delete existing settings)

**Steps:**
1. Navigate to Tips page
2. Click Settings icon (gear)
3. Change "Tip Source" from "Manual Entry" to "POS Import"
4. Click "Done" to close dialog
5. Wait 2 seconds for auto-save
6. Verify toast notification appears: "Settings saved"
7. Click Settings icon again to reopen dialog

**Expected Result:**
✅ "POS Import" is still selected (settings persisted)

**Steps for Existing Settings:**
1. Open tip pool settings
2. Change any setting (e.g., Share Method from "By Hours" to "By Role")
3. Close dialog
4. Wait 2 seconds
5. Verify toast notification
6. Reopen dialog

**Expected Result:**
✅ Changes persisted correctly

---

## Database Migration

The SQL migration needs to be applied to fix the POS tips query:

```bash
# Apply the migration
npx supabase db push

# Or if using remote database
npx supabase db push --linked
```

---

## Implementation Details

### Migration: `20260210234900_fix_get_pos_tips_by_date.sql`

The migration replaces the `get_pos_tips_by_date` function with an enhanced version that uses CTEs (Common Table Expressions):

1. **categorized_tips CTE**: Queries `unified_sales_splits` joined with `chart_of_accounts` to find tips by account name/subtype
2. **uncategorized_tips CTE**: Queries `unified_sales` directly for items with tip-related types, excluding those already in splits
3. **combined_tips CTE**: Unions both sources
4. **Final aggregation**: Groups by date and POS system to prevent duplicates

### Code Change: `useAutoSaveTipSettings.ts`

Changed the change detection logic to:

```typescript
const hasChanges = settings
  ? // Compare with existing settings
    tipSource !== settings.tip_source || ...
  : // No settings exist - trigger save if user has configured
    selectedEmployees.size > 0;
```

This allows the auto-save to trigger even on first use, as long as the user has selected employees (indicating they've configured the settings).

---

## Potential Edge Cases

### Edge Case 1: Partially Categorized Tips
**Scenario**: Some tips are in splits, others are not
**Handling**: The migration excludes uncategorized items that have splits, preventing double-counting

### Edge Case 2: Multiple POS Systems
**Scenario**: Restaurant uses both Square and Toast
**Handling**: The query groups by `pos_source`, so each POS system's tips are aggregated separately

### Edge Case 3: Rapid Settings Changes
**Scenario**: User changes settings multiple times quickly
**Handling**: Auto-save has 1-second debounce, so only the final state is saved

---

## Rollback Plan

If issues arise, the migrations can be rolled back:

### Rollback SQL Function
```sql
-- Restore original function (queries only categorized tips)
CREATE OR REPLACE FUNCTION get_pos_tips_by_date(
  p_restaurant_id UUID,
  p_start_date DATE,
  p_end_date DATE
)
RETURNS TABLE (
  tip_date DATE,
  total_amount_cents INTEGER,
  transaction_count INTEGER,
  pos_source TEXT
)
LANGUAGE plpgsql
SECURITY INVOKER
AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM user_restaurants
    WHERE restaurant_id = p_restaurant_id
    AND user_id = auth.uid()
  ) THEN
    RAISE EXCEPTION 'Access denied: User does not have access to restaurant %', p_restaurant_id;
  END IF;

  RETURN QUERY
  SELECT
    us.sale_date AS tip_date,
    SUM(uss.amount * 100)::INTEGER AS total_amount_cents,
    COUNT(DISTINCT us.external_order_id)::INTEGER AS transaction_count,
    us.pos_system AS pos_source
  FROM unified_sales us
  INNER JOIN unified_sales_splits uss ON us.id = uss.sale_id
  INNER JOIN chart_of_accounts coa ON uss.category_id = coa.id
  WHERE us.restaurant_id = p_restaurant_id
    AND us.sale_date >= p_start_date
    AND us.sale_date <= p_end_date
    AND (
      LOWER(COALESCE(coa.account_name, '')) LIKE '%tip%'
      OR LOWER(COALESCE(coa.account_subtype::TEXT, '')) LIKE '%tip%'
    )
  GROUP BY us.sale_date, us.pos_system
  ORDER BY us.sale_date DESC;
END;
$$;
```

### Rollback Auto-Save Hook
```typescript
// In useAutoSaveTipSettings.ts, restore original logic:
useEffect(() => {
  if (!settings) return; // Original early return
  
  const hasChanges = ...
  
  if (!hasChanges) return;
  
  // ... rest of code
}, [...]);
```

---

## Related Files

### Modified:
- `src/hooks/useAutoSaveTipSettings.ts`

### Created:
- `supabase/migrations/20260210234900_fix_get_pos_tips_by_date.sql`

### Related (unchanged):
- `src/hooks/usePOSTips.tsx` - Hook that calls the SQL function
- `src/hooks/useTipPoolSettings.tsx` - Hook that manages settings persistence
- `src/pages/Tips.tsx` - Main tip pooling page
- `src/components/tips/TipPoolSettingsDialog.tsx` - Settings dialog component
- `src/components/tips/POSTipImporter.tsx` - POS tips display component

---

## Performance Considerations

### SQL Function Performance
The new query uses CTEs and filters to prevent double-counting. Performance impact:
- **Best case**: Tips are all categorized → single query path
- **Worst case**: All tips uncategorized → two CTEs execute and combine
- **Typical case**: Mix of both → both CTEs execute but exclude duplicates

**Indexes recommended** (may already exist):
```sql
CREATE INDEX IF NOT EXISTS idx_unified_sales_item_type 
  ON unified_sales(item_type, sale_date) 
  WHERE item_type = 'tip' OR adjustment_type = 'tip';
  
CREATE INDEX IF NOT EXISTS idx_unified_sales_splits_sale_id 
  ON unified_sales_splits(sale_id);
```

### Auto-Save Performance
- Debounced to 1 second (no change)
- Triggers on any setting change (now includes first-time setup)
- Uses React Query's mutation and invalidation (optimized)

---

## Success Metrics

✅ **Tip Display Fix Success:**
- POS tips appear immediately after Toast sync
- No "No POS tips found" message when tips exist
- Tips from all POS systems (Square, Toast, Clover, Shift4) detected

✅ **Settings Persistence Fix Success:**
- First-time users can save settings
- Settings persist across dialog open/close
- Toast notifications appear on save
- No silent failures

---

## Questions?

Contact: dev team or check these resources:
- Tip Pooling Documentation: `docs/TIP_POOLING.md` (if exists)
- Chart of Accounts: `docs/CHART_OF_ACCOUNTS.md` (if exists)
- POS Integration: `docs/POS_INTEGRATION.md` (if exists)
