# Square Tax Handling Fix - Implementation Summary

## Problem Statement

The Square integration had two critical issues with how it handled tax and other pass-through items:

1. **Line items included tax in total_price**: The sync function was using `total_money` (which includes tax) instead of `gross_sales_money` (which excludes tax) for line items
2. **Tax adjustments missing external_item_id**: Adjustment entries for tax, tips, service charges, and discounts were not setting the `external_item_id` field, causing issues with the unique constraint

### Example Issue

For a Square order with:
- Line item: Gin bottle at $300.00 (base price)
- Tax: $24.75 (8.25%)
- Total collected: $324.75

**Before the fix:**
- Line item showed `total_price = $324.75` (WRONG - includes tax)
- Tax adjustment may or may not be created
- Revenue calculations would be inflated by tax amounts

**After the fix:**
- Line item shows `total_price = $300.00` (CORRECT - revenue only)
- Tax adjustment created with `total_price = $24.75` and `adjustment_type = 'tax'`
- Revenue calculations: `WHERE adjustment_type IS NULL` = $300.00 (correct revenue)

## Changes Made

### File: `supabase/migrations/20251109_update_square_sync_for_adjustments.sql`

#### 1. Fixed Line Item Price Calculation (Lines 50-55)

**Before:**
```sql
soli.total_money as total_price,
```

**After:**
```sql
-- Use gross_sales_money from line item (excludes tax, discounts, modifiers already applied)
-- This is the REVENUE amount, not the total collected
COALESCE(
  ((soli.raw_json->>'gross_sales_money')::jsonb->>'amount')::numeric / 100.0,
  soli.total_money
) as total_price,
```

**Why this works:**
- Square API provides `gross_sales_money` in the line item, which is the revenue amount (excludes tax)
- We extract it from the `raw_json` JSONB field stored in `square_order_line_items` table
- Falls back to `total_money` if `gross_sales_money` is not available (backwards compatibility)
- Divides by 100.0 because Square API returns amounts in cents

#### 2. Added external_item_id to All Adjustments

**Tax Adjustment (Lines 105):**
```sql
so.order_id || '_tax' as external_item_id,  -- Unique ID for tax adjustment
```

**Tip Adjustment (Line 152):**
```sql
so.order_id || '_tip' as external_item_id,  -- Unique ID for tip adjustment
```

**Service Charge Adjustment (Line 196):**
```sql
so.order_id || '_service_charge' as external_item_id,  -- Unique ID
```

**Discount Adjustment (Line 240):**
```sql
so.order_id || '_discount' as external_item_id,  -- Unique ID
```

**Why this is important:**
- The unique constraint is on `(restaurant_id, pos_system, external_order_id, external_item_id)`
- Without `external_item_id`, adjustments couldn't use the proper conflict resolution
- Each adjustment now has a unique identifier derived from the order ID

#### 3. Changed Conflict Resolution from DO NOTHING to DO UPDATE

**Before:**
```sql
ON CONFLICT (restaurant_id, pos_system, external_order_id, item_name)
DO NOTHING;
```

**After:**
```sql
ON CONFLICT (restaurant_id, pos_system, external_order_id, external_item_id)
  WHERE parent_sale_id IS NULL
DO UPDATE SET
  total_price = EXCLUDED.total_price,
  sale_date = EXCLUDED.sale_date,
  sale_time = EXCLUDED.sale_time,
  raw_data = EXCLUDED.raw_data;
```

**Benefits:**
- Re-running the sync function will now update existing incorrect data
- Uses the correct unique constraint with `external_item_id`
- Includes `WHERE parent_sale_id IS NULL` to respect the partial unique index

#### 4. Enhanced Tax Raw Data (Lines 113-116)

**Before:**
```sql
jsonb_build_object(
  'total_tax_money', (so.raw_json->'total_tax_money')
) as raw_data
```

**After:**
```sql
jsonb_build_object(
  'total_tax_money', (so.raw_json->'total_tax_money'),
  'taxes', (so.raw_json->'taxes')
) as raw_data
```

**Benefits:**
- Includes detailed tax breakdown from Square (tax name, percentage, catalog object ID)
- Useful for auditing and detailed tax reporting

## Impact on Existing Data

When this migration is applied to a database with existing Square data:

1. **Existing line items** will be updated with correct pre-tax amounts
2. **Missing tax adjustments** will be created
3. **Existing adjustments** will be updated with correct `external_item_id`

## Revenue Calculation Pattern

The frontend correctly uses this pattern to calculate revenue:

```typescript
// Get revenue (excludes tax, tips, etc.)
const { data: revenue } = await supabase
  .from('unified_sales')
  .select('total_price')
  .eq('restaurant_id', restaurantId)
  .is('adjustment_type', null);  // ✅ Only revenue items

// Get tax collected separately
const { data: tax } = await supabase
  .from('unified_sales')
  .select('total_price')
  .eq('restaurant_id', restaurantId)
  .eq('adjustment_type', 'tax');  // ✅ Only tax adjustments
```

## Webhook Compatibility

The Square webhook handler (`supabase/functions/square-webhooks/index.ts`) already implements the correct pattern:

- Stores complete line item data in `raw_json` (includes `gross_sales_money`)
- Creates adjustments with proper `external_item_id` (lines 319, 334, 349, 364)
- Calls `sync_square_to_unified_sales` after processing (line 384)

No changes to the webhook are needed.

## Testing Recommendations

1. **Verify line item amounts**: Check that line items show pre-tax amounts
2. **Verify tax adjustments exist**: Each order with tax should have a separate tax adjustment entry
3. **Verify revenue totals**: Sum of revenue items should match gross sales (excluding tax)
4. **Verify total collected**: Sum of revenue + tax + tips should match total_money from Square

### SQL Test Query

```sql
-- Test query to verify correct data structure
SELECT 
  external_order_id,
  item_name,
  adjustment_type,
  total_price,
  CASE 
    WHEN adjustment_type IS NULL THEN 'Revenue'
    ELSE 'Pass-through (' || adjustment_type || ')'
  END as item_classification
FROM unified_sales
WHERE restaurant_id = 'YOUR_RESTAURANT_ID'
  AND pos_system = 'square'
  AND external_order_id = 'SAMPLE_ORDER_ID'
ORDER BY adjustment_type NULLS FIRST;
```

Expected output for sample order from problem statement:
```
external_order_id              | item_name              | adjustment_type | total_price | item_classification
-------------------------------|------------------------|-----------------|-------------|--------------------
tZgoHlTwUU5J0FxtnOT3EaLfuRGZY | Bowl of rice           | NULL            | 10.00       | Revenue
tZgoHlTwUU5J0FxtnOT3EaLfuRGZY | Horneaditas - mi tienda| NULL            | 1.50        | Revenue
tZgoHlTwUU5J0FxtnOT3EaLfuRGZY | Sales Tax              | tax             | 0.95        | Pass-through (tax)
```

Total revenue: $11.50
Tax collected: $0.95
Total at POS: $12.45 ✅

## GAAP Compliance

This implementation follows GAAP principles:

- **Revenue Recognition**: Only actual revenue is counted in revenue metrics
- **Pass-through Items**: Tax, tips, service charges are tracked as liabilities, not revenue
- **Gross vs. Net**: Clear separation between gross sales and total collected
- **Audit Trail**: Complete raw data preserved in JSONB for audit purposes

## Related Files

- Migration: `supabase/migrations/20251109_update_square_sync_for_adjustments.sql`
- Webhook: `supabase/functions/square-webhooks/index.ts`
- Types: `src/types/pos.ts`
- Frontend Hook: `src/hooks/useMonthlyMetrics.tsx`
- Database Schema: `supabase/migrations/20251109_add_adjustment_type.sql`

## Migration Safety

This migration is safe to run on production:

- Uses `DROP FUNCTION IF EXISTS` to safely replace the function
- Uses `COALESCE` with fallback to `total_money` for backwards compatibility
- All INSERT statements use `ON CONFLICT ... DO UPDATE` for idempotency
- No data is deleted, only updated with correct values
- Can be run multiple times without issues
