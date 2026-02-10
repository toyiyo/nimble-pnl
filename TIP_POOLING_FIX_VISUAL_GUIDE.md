# Tip Pooling Fixes - Visual Guide

## Issue #1: POS Tips Not Showing

### BEFORE (Broken)
```
┌──────────────────────────────────────────────────┐
│ Tip Entry                                        │
│ Entering for today                               │
│ Tuesday, February 10, 2026                       │
├──────────────────────────────────────────────────┤
│                                                  │
│ ❌ No POS tips found for today.                  │
│    You can enter them manually or wait for      │
│    POS sync.                                     │
│                                                  │
└──────────────────────────────────────────────────┘

Meanwhile, unified_sales HAS tips:
- Tip - CREDIT: $13.78 ✓
- Tip - CREDIT: $14.57 ✓
- Tip - CREDIT: $4.00 ✓
- Tip - CREDIT: $30.00 ✓
(Total: $87.16 in tips FROM TOAST POS)
```

**Why it failed:**
The SQL function only looked for tips that were ALREADY CATEGORIZED into chart of accounts. Toast POS syncs tips with `item_type='tip'` BEFORE they're categorized.

### AFTER (Fixed) ✅
```
┌──────────────────────────────────────────────────┐
│ Today's tips                            [TOAST]  │
│ Imported from POS • 9 transactions               │
├──────────────────────────────────────────────────┤
│                                                  │
│                  $87.16                          │
│          Total tips from Toast                   │
│                                                  │
│  [Use this amount]          [Edit]               │
│                                                  │
└──────────────────────────────────────────────────┘
```

---

## Issue #2: Settings Not Persisting

### BEFORE (Broken)
```
Step 1: User opens settings (first time)
┌────────────────────────────────────────┐
│ Tip Pool Settings                      │
├────────────────────────────────────────┤
│ Tip Source:                            │
│  ○ Manual Entry  ● POS Import  ← User selects
│                                        │
│ [Done]                                 │
└────────────────────────────────────────┘

Step 2: User clicks "Done"
(Auto-save hook runs)
❌ useAutoSaveTipSettings: 
   if (!settings) return;  // EXIT! No save!

Step 3: User reopens settings
┌────────────────────────────────────────┐
│ Tip Pool Settings                      │
├────────────────────────────────────────┤
│ Tip Source:                            │
│  ● Manual Entry  ○ POS Import  ← Reverted!
│                                        │
│ [Done]                                 │
└────────────────────────────────────────┘
❌ Setting lost! User frustrated!
```

### AFTER (Fixed) ✅
```
Step 1: User opens settings (first time)
┌────────────────────────────────────────┐
│ Tip Pool Settings                      │
├────────────────────────────────────────┤
│ Tip Source:                            │
│  ○ Manual Entry  ● POS Import  ← User selects
│                                        │
│ Participating Employees:               │
│  ☑ John (Server)                       │
│  ☑ Jane (Bartender)                    │
│                                        │
│ [Done]                                 │
└────────────────────────────────────────┘

Step 2: User clicks "Done"
(Auto-save hook runs)
✅ useAutoSaveTipSettings: 
   Has changes (employees selected): TRUE
   Saves settings to database!

(Toast notification appears)
┌────────────────────────────────────────┐
│ ✓ Settings saved                       │
│   Tip pooling preferences updated      │
└────────────────────────────────────────┘

Step 3: User reopens settings
┌────────────────────────────────────────┐
│ Tip Pool Settings                      │
├────────────────────────────────────────┤
│ Tip Source:                            │
│  ○ Manual Entry  ● POS Import  ← Persisted!
│                                        │
│ Participating Employees:               │
│  ☑ John (Server)                       │
│  ☑ Jane (Bartender)                    │
│                                        │
│ [Done]                                 │
└────────────────────────────────────────┘
✅ Setting persisted! User happy!
```

---

## Technical Changes Summary

### Fix #1: SQL Function Enhancement

**File:** `supabase/migrations/20260210234900_fix_get_pos_tips_by_date.sql`

**Old Query (Simplified):**
```sql
SELECT tips FROM unified_sales_splits
WHERE account_name LIKE '%tip%'
-- Only finds CATEGORIZED tips
```

**New Query (Simplified):**
```sql
WITH categorized_tips AS (
  SELECT tips FROM unified_sales_splits
  WHERE account_name LIKE '%tip%'
),
uncategorized_tips AS (
  SELECT tips FROM unified_sales
  WHERE item_type = 'tip' 
    AND NOT EXISTS (SELECT 1 FROM splits WHERE sale_id = id)
)
SELECT * FROM categorized_tips
UNION ALL
SELECT * FROM uncategorized_tips
-- Finds BOTH categorized AND uncategorized tips
-- Prevents double-counting
```

### Fix #2: Auto-Save Hook Logic

**File:** `src/hooks/useAutoSaveTipSettings.ts`

**Old Logic:**
```typescript
useEffect(() => {
  if (!settings) return; // ❌ Blocks first-time save
  
  const hasChanges = tipSource !== settings.tip_source || ...;
  
  if (!hasChanges) return;
  
  setTimeout(() => onSave(), 1000);
}, [settings, tipSource, ...]);
```

**New Logic:**
```typescript
useEffect(() => {
  const hasChanges = settings
    ? // Existing settings: compare changes
      tipSource !== settings.tip_source || ...
    : // No settings: save if user configured (employees selected)
      selectedEmployees.size > 0; // ✅ Allows first-time save
  
  if (!hasChanges) return;
  
  setTimeout(() => onSave(), 1000);
}, [settings, tipSource, selectedEmployees, ...]);
```

---

## Data Flow Diagrams

### POS Tips Data Flow (BEFORE)

```
Toast POS
   ↓
   ↓ sync_toast_to_unified_sales()
   ↓
unified_sales
   id: 123
   item_type: 'tip'           ← Tip exists here
   total_price: 13.78
   sale_date: 2026-02-10
   
   ↓ (User manually categorizes later)
   
unified_sales_splits
   sale_id: 123
   category_id: <tips account>  ← Eventually categorized
   amount: 13.78
   
   ↓
   ↓ get_pos_tips_by_date() queries ONLY splits
   ↓
   
❌ No tips found! (before categorization)
```

### POS Tips Data Flow (AFTER) ✅

```
Toast POS
   ↓
   ↓ sync_toast_to_unified_sales()
   ↓
unified_sales
   id: 123
   item_type: 'tip'           ← Tip exists here
   total_price: 13.78
   sale_date: 2026-02-10
   
   ↓ 
   ↓ get_pos_tips_by_date() queries BOTH
   ↓ unified_sales AND unified_sales_splits
   ↓
   
✅ Tips found immediately! (even before categorization)

(Later, when user categorizes...)

unified_sales_splits
   sale_id: 123
   category_id: <tips account>
   amount: 13.78
   
   ↓
   ↓ get_pos_tips_by_date() still finds it
   ↓ (excludes from uncategorized to prevent double-count)
   ↓
   
✅ Still shows tips correctly! (after categorization)
```

---

## Testing Scenarios

### Scenario 1: Fresh Toast Data
**Setup:**
- New restaurant
- Toast synced orders today
- Tip data in unified_sales with item_type='tip'
- No manual categorization yet

**Expected Result:** ✅
- Tip split screen shows POS tips
- Amount matches Toast data
- Can proceed with tip split

### Scenario 2: Partially Categorized
**Setup:**
- Some tips categorized (in splits)
- Some tips uncategorized (only in unified_sales)

**Expected Result:** ✅
- Both categorized and uncategorized tips appear
- No double-counting
- Total is sum of all tips

### Scenario 3: First-Time Settings
**Setup:**
- New restaurant
- Never configured tip pool settings
- User opens settings dialog

**Expected Result:** ✅
- User can select POS import
- User can select employees
- Settings save on close (toast notification)
- Settings persist when reopened

### Scenario 4: Update Existing Settings
**Setup:**
- Restaurant has existing settings
- User changes from "Manual" to "POS Import"

**Expected Result:** ✅
- Change detected
- Auto-save triggers after 1 second
- Toast notification appears
- Settings persist

---

## Database Migration

```bash
# Step 1: Navigate to project
cd /path/to/nimble-pnl

# Step 2: Apply migration
npx supabase db push

# Expected output:
# Applying migration 20260210234900_fix_get_pos_tips_by_date.sql...
# ✓ Migration applied successfully

# Step 3: Verify function exists
npx supabase db execute "
  SELECT routine_name 
  FROM information_schema.routines 
  WHERE routine_name = 'get_pos_tips_by_date'
"

# Expected output:
#  routine_name
# ─────────────────────
#  get_pos_tips_by_date
```

---

## Success Criteria

✅ **POS Tips Fix:**
- [ ] Toast tips appear in tip split screen immediately after sync
- [ ] Square tips appear (if applicable)
- [ ] Clover tips appear (if applicable)
- [ ] Shift4 tips appear (if applicable)
- [ ] No "No POS tips found" error when tips exist
- [ ] Amount matches POS data
- [ ] Transaction count is correct

✅ **Settings Persistence Fix:**
- [ ] First-time users can save settings
- [ ] "Settings saved" toast appears
- [ ] Settings persist after closing dialog
- [ ] Settings persist after page refresh
- [ ] Changes to existing settings work
- [ ] All setting fields persist (source, method, cadence, employees, weights)

---

## Rollback Instructions

If you need to revert these changes:

```bash
# Revert code changes
git revert 3e7537d  # Revert documentation
git revert 07f1654  # Revert auto-save fix
git revert 14a0d97  # Revert SQL migration

# Or restore SQL function manually
npx supabase db execute "$(cat rollback_script.sql)"
```

Where `rollback_script.sql` contains the original function (see TIP_POOLING_FIX_SUMMARY.md).

---

## Support

If issues persist:
1. Check console for errors
2. Check Network tab for failed requests
3. Verify migration applied: `SELECT * FROM supabase_migrations.schema_migrations ORDER BY version DESC LIMIT 5;`
4. Check RLS policies allow tip data access
5. Verify user has correct permissions on restaurant

---

## Related Documentation

- Full technical details: `TIP_POOLING_FIX_SUMMARY.md`
- POS integration: Check Toast/Square/Clover sync documentation
- Tip pooling features: User guide (if exists)
