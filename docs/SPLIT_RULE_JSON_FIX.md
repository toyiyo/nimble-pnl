# Split Rule JSON Stringify Fix

## Issue

When creating a split categorization rule, the following error occurred:

```
new row for relation "categorization_rules" violates check constraint "check_split_config"
```

## Root Cause

The code was using `JSON.stringify()` on the `split_categories` field before inserting it into the database:

```typescript
// ❌ WRONG - Double-encoding the JSON
split_categories: params.isSplitRule && params.splitCategories 
  ? JSON.stringify(params.splitCategories) 
  : null
```

### Why This Failed

1. **Supabase automatically handles JSONB**: The Supabase JavaScript client automatically converts JavaScript objects to JSONB format
2. **Double encoding**: Using `JSON.stringify()` creates a string, which then gets stored as a JSON string instead of a JSONB object
3. **Check constraint failure**: The database constraint `check_split_rule_has_categories` checks for:
   - `jsonb_array_length(split_categories) >= 2`
   
   But when you stringify first, it becomes a JSON string, not a JSONB array, so `jsonb_array_length()` fails.

### Example of the Problem

```typescript
// What we were sending (WRONG):
split_categories: "[{\"category_id\":\"123\",\"percentage\":50}...]"
// Type: string (JSON string)

// What we should send (CORRECT):
split_categories: [{category_id: "123", percentage: 50}, ...]
// Type: JavaScript object array (Supabase converts to JSONB)
```

## Solution

Remove the `JSON.stringify()` calls and pass the JavaScript objects directly:

```typescript
// ✅ CORRECT - Let Supabase handle JSONB conversion
split_categories: params.isSplitRule && params.splitCategories 
  ? params.splitCategories 
  : null
```

## Changes Made

Fixed in `/src/hooks/useCategorizationRulesV2.tsx`:

1. **Line ~169** (useCreateRuleV2): Removed `JSON.stringify()` from insert
2. **Line ~207** (useUpdateRuleV2): Removed `JSON.stringify()` from update

### Before:
```typescript
split_categories: params.isSplitRule && params.splitCategories 
  ? JSON.stringify(params.splitCategories) 
  : null
```

### After:
```typescript
split_categories: params.isSplitRule && params.splitCategories 
  ? params.splitCategories 
  : null
```

## Database Constraint Reference

The check constraint in the database:

```sql
ALTER TABLE categorization_rules
ADD CONSTRAINT check_split_rule_has_categories
CHECK (
  (is_split_rule = false AND split_categories IS NULL) OR
  (is_split_rule = true AND category_id IS NULL AND split_categories IS NOT NULL AND jsonb_array_length(split_categories) >= 2)
);
```

This constraint validates:
- Regular rules: `split_categories` must be NULL
- Split rules: `split_categories` must be a JSONB array with at least 2 elements

## Testing

After this fix, creating a split rule should work:

1. Open Categorization Rules dialog
2. Toggle "Split rule" ON
3. Configure split categories (e.g., 50% to Food, 50% to Merchandise)
4. Click "Create Rule"
5. ✅ Rule should be created successfully

## Related Files

- `/src/hooks/useCategorizationRulesV2.tsx` - Main hook with the fix
- `/supabase/migrations/20251121143326_add_split_support_to_categorization_rules.sql` - Database constraint
- `/src/components/banking/EnhancedCategoryRulesDialog.tsx` - UI component

## Key Takeaway

**When working with Supabase JSONB columns:**
- ✅ Pass JavaScript objects/arrays directly
- ❌ Don't use `JSON.stringify()` - Supabase handles the conversion
- ✅ The client automatically serializes objects to JSONB
- ✅ The client automatically deserializes JSONB to objects on read
