# POS Tips Integration - Architecture Summary

## Problem Statement

**Issue:** Tip pooling is not working with tips from POS imports.

**Root Cause:** The tip pooling system (`usePOSTips` hook) only queried `employee_tips` table, which contains employee-declared tips. There was no mechanism to surface categorized POS tips from `unified_sales_splits` table.

## Solution Architecture

### Data Flow Diagram

```
┌─────────────────────────────────────────────────────────────────┐
│                     POS SYSTEMS                                 │
│  (Square, Toast, Clover, Shift4)                               │
└────────────────┬────────────────────────────────────────────────┘
                 │
                 │ Import via edge functions
                 ↓
┌─────────────────────────────────────────────────────────────────┐
│                 unified_sales                                   │
│  - id, restaurant_id, pos_system                                │
│  - item_name, total_price, sale_date                           │
│  - external_order_id, raw_data                                 │
└────────────────┬────────────────────────────────────────────────┘
                 │
                 │ User categorizes via UI
                 ↓
┌─────────────────────────────────────────────────────────────────┐
│            unified_sales_splits                                 │
│  - sale_id → unified_sales.id                                   │
│  - category_id → chart_of_accounts.id                          │
│  - amount (portion of sale allocated to category)              │
└────────────────┬────────────────────────────────────────────────┘
                 │
                 │ NEW: Aggregation via SQL function
                 ↓
┌─────────────────────────────────────────────────────────────────┐
│         get_pos_tips_by_date() RPC Function                    │
│  - Joins: unified_sales + splits + chart_of_accounts           │
│  - Filters: WHERE account_name LIKE '%tip%'                    │
│  - Groups: BY sale_date, pos_system                            │
│  - Returns: tip_date, total_cents, count, source               │
└────────────────┬────────────────────────────────────────────────┘
                 │
                 │ Called by updated hook
                 ↓
┌─────────────────────────────────────────────────────────────────┐
│              usePOSTips Hook (UPDATED)                          │
│  ┌─────────────────────────────────────────────────────────┐   │
│  │ Fetch 1: employee_tips (employee-declared)              │   │
│  │   - Direct table query                                  │   │
│  │   - WHERE restaurant_id = X AND date IN range           │   │
│  └─────────────────────────────────────────────────────────┘   │
│                            +                                    │
│  ┌─────────────────────────────────────────────────────────┐   │
│  │ Fetch 2: categorized POS tips (NEW)                     │   │
│  │   - RPC call to get_pos_tips_by_date()                  │   │
│  │   - Aggregates from unified_sales_splits                │   │
│  └─────────────────────────────────────────────────────────┘   │
│                            ↓                                    │
│  ┌─────────────────────────────────────────────────────────┐   │
│  │ Merge Logic (by date)                                   │   │
│  │   - Map<date, {total, count, source}>                   │   │
│  │   - Combines amounts and counts for same date           │   │
│  │   - Preserves source info (square, toast, etc.)         │   │
│  └─────────────────────────────────────────────────────────┘   │
└────────────────┬────────────────────────────────────────────────┘
                 │
                 │ Returns POSTipData[]
                 ↓
┌─────────────────────────────────────────────────────────────────┐
│                Tips Page UI (/tips)                             │
│  ┌─────────────────────────────────────────────────────────┐   │
│  │ IF tipSource === 'pos' AND hasPOSTips:                  │   │
│  │   <POSTipImporter>                                       │   │
│  │     - Shows total from POS (employee + categorized)      │   │
│  │     - Displays POS source badge                          │   │
│  │     - "Use this amount" button                           │   │
│  │   </POSTipImporter>                                      │   │
│  │                                                           │   │
│  │ ELSE:                                                    │   │
│  │   <Manual entry form>                                    │   │
│  └─────────────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────────┘
```

## Components Changed

### 1. Database Layer

**File:** `supabase/migrations/20260209192825_add_aggregate_pos_tips_function.sql`

```sql
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
```

**Purpose:** Aggregates categorized POS tips by date.

**Key Logic:**
- Joins `unified_sales` → `unified_sales_splits` → `chart_of_accounts`
- Filters for categories with "tip" in name or subtype
- Groups by date and POS system
- Returns daily totals in cents

### 2. Data Access Layer

**File:** `src/hooks/usePOSTips.tsx`

**Changes:**
- Added RPC call to `get_pos_tips_by_date`
- Implemented merge logic for dual data sources
- Enhanced error handling (logs but doesn't fail)
- Updated POSTipData interface to support 'pos' source

**Before:**
```typescript
// Only queried employee_tips
const { data } = await supabase
  .from('employee_tips')
  .select(...)
```

**After:**
```typescript
// Queries BOTH sources
const { data: employeeTips } = await supabase
  .from('employee_tips')
  .select(...)

const { data: posTips } = await supabase
  .rpc('get_pos_tips_by_date', ...)

// Merge by date
for (const tip of employeeTips) { /* add to map */ }
for (const tip of posTips) { /* add to map */ }
```

### 3. Presentation Layer

**File:** `src/pages/Tips.tsx` (NO CHANGES NEEDED)

The existing code already supports our changes:
```typescript
const { tipData: posTipData, hasTips: hasPOSTips } = usePOSTipsForDate(restaurantId, today);

{tipSource === 'pos' && hasPOSTips && posTipData ? (
  <POSTipImporter tipData={posTipData} ... />
) : (
  <Manual entry form />
)}
```

**File:** `src/components/tips/POSTipImporter.tsx` (NO CHANGES NEEDED)

Already displays:
- `tipData.totalTipsCents` (now includes categorized POS)
- `tipData.source` (now can be 'square', 'toast', etc.)
- `tipData.transactionCount` (now includes POS counts)

## Database Schema

### Existing Tables Used

```sql
-- Source: POS sales
unified_sales (
  id UUID PRIMARY KEY,
  restaurant_id UUID,
  pos_system TEXT, -- 'square', 'toast', etc.
  sale_date DATE,
  total_price NUMERIC,
  ...
)

-- Link: Categorized sales
unified_sales_splits (
  id UUID PRIMARY KEY,
  sale_id UUID → unified_sales.id,
  category_id UUID → chart_of_accounts.id,
  amount NUMERIC
)

-- Categories: Identifies tips
chart_of_accounts (
  id UUID PRIMARY KEY,
  restaurant_id UUID,
  account_name TEXT,
  account_subtype account_subtype_enum
)

-- Alternative source: Employee tips
employee_tips (
  id UUID PRIMARY KEY,
  restaurant_id UUID,
  employee_id UUID,
  tip_amount INTEGER, -- in cents
  tip_source TEXT,
  recorded_at TIMESTAMP,
  tip_date DATE
)
```

## Query Performance

### Indexes Used
- `unified_sales.restaurant_id` (existing)
- `unified_sales.sale_date` (existing)
- `unified_sales_splits.sale_id` (FK, existing)
- `unified_sales_splits.category_id` (FK, existing)
- `employee_tips.restaurant_id` (existing)
- `employee_tips.tip_date` (existing)

### Expected Performance
- Date range queries: < 100ms for 30 days
- RPC call overhead: ~10ms
- Total hook execution: < 200ms
- UI render: < 50ms

## Security

### RLS Enforcement
- `get_pos_tips_by_date` uses `SECURITY DEFINER`
- Still respects RLS policies on underlying tables
- User must have access to restaurant via `user_restaurants`

### Data Privacy
- Function only returns aggregated data (no individual sales)
- No PII exposed (employee IDs remain internal)
- Category names visible but appropriate

## Error Handling

### Graceful Degradation
```typescript
if (employeeError) {
  console.error('Error fetching employee tips:', employeeError);
  // Continue - still try POS tips
}

if (posError) {
  console.error('Error fetching POS tips:', posError);
  // Continue - still try employee tips
}

// Return empty array only if both fail
```

### User Experience
- If employee tips fail: Still shows POS tips
- If POS tips fail: Still shows employee tips
- If both fail: Shows "No tips found" (not an error)

## Testing

### Unit Tests
**File:** `tests/unit/posTipsAggregation.test.ts`

Coverage:
- ✅ SQL function behavior (grouping, filtering)
- ✅ Merge logic (combining sources)
- ✅ Edge cases (null, zero, multiple POS)
- ✅ Date handling
- ✅ Type conversions

### Manual Test Scenarios
**File:** `docs/POS_TIPS_TESTING.md`

Scenarios:
1. Basic POS tip display
2. Mixed tips (employee + POS)
3. No POS tips
4. Multiple POS systems
5. Error handling

## Rollback Plan

If issues occur in production:

1. **Quick fix:** Remove RPC call from hook
   ```typescript
   // Comment out POS tips fetch
   // const { data: posTips } = await supabase.rpc(...)
   ```

2. **Full rollback:** Revert migration
   ```sql
   DROP FUNCTION IF EXISTS get_pos_tips_by_date;
   ```

3. **Fallback:** Manual tip entry still works

## Future Enhancements

Not implemented but documented:

1. **Nightly Sync:** Cron job to sync POS tips → employee_tips
2. **Category Config:** UI to configure tip categories (not name-based)
3. **Employee Attribution:** Match tips to specific employees from POS
4. **Historical Import:** Bulk import of past POS tips

## Success Metrics

The fix is successful if:
- ✅ Categorized POS tips appear in tip pooling
- ✅ Amounts are accurate (match categorized sales)
- ✅ No performance degradation (< 200ms)
- ✅ No errors in production logs
- ✅ User can complete tip pooling workflow

## Documentation

Complete docs created:
1. `docs/POS_TIPS_INTEGRATION.md` - User guide
2. `docs/POS_TIPS_TESTING.md` - Test scenarios
3. `docs/POS_TIPS_ARCHITECTURE.md` - This file
4. Inline code comments in SQL and TypeScript

## Conclusion

This minimal change bridges the gap between POS categorization and tip pooling:
- **1 SQL migration** (new aggregation function)
- **1 hook update** (dual data source)
- **0 UI changes** (existing components work)
- **1 test file** (comprehensive coverage)
- **3 doc files** (complete guide)

Total implementation: ~400 lines of code + docs.
