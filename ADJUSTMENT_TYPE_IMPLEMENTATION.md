# Adjustment Type Implementation - Tax, Tips, and Non-Revenue Items

## Overview

This implementation adds support for properly tracking tax, tips, service charges, discounts, and fees separately from revenue items. This ensures GAAP compliance and keeps analytics clean by preventing pass-through items from inflating revenue metrics.

## Key Changes

### 1. Database Schema

**Migration**: `supabase/migrations/20251109_add_adjustment_type.sql`

- Added `adjustment_type` column to `unified_sales` table
- Supports values: `'tax'`, `'tip'`, `'service_charge'`, `'discount'`, `'fee'`, or `NULL`
- `NULL` indicates regular revenue line items
- Added index for performance: `idx_unified_sales_adjustment_type`

### 2. POS Integration Changes

#### Clover Sync (`supabase/functions/clover-sync-data/index.ts`)

**Expand Parameter Update** (Line 296):
```typescript
// Before:
ordersUrl.searchParams.set('expand', 'lineItems');

// After:
ordersUrl.searchParams.set('expand', 'lineItems,lineItems.appliedTaxes,taxRates,totals,payments');
```

**Adjustment Extraction** (After line 453):
- Extracts `taxAmount`, `tipAmount`, `serviceCharge`, and `discount` from Clover orders
- Creates separate `unified_sales` records with appropriate `adjustment_type`
- Upserts using conflict on `(restaurant_id, pos_system, external_order_id, item_name)`

#### Square Webhooks (`supabase/functions/square-webhooks/index.ts`)

**Adjustment Extraction** (After line 308):
- Extracts `total_tax_money`, `total_tip_money`, `total_service_charge_money`, and `total_discount_money`
- Creates separate `unified_sales` records with appropriate `adjustment_type`
- Square already provides this data in the order response (no API change needed)

### 3. Frontend Changes

#### Type Definitions

**Database Types** (`src/integrations/supabase/types.ts`):
```typescript
adjustment_type: string | null  // Added to Row, Insert, Update
```

**POS Types** (`src/types/pos.ts`):
```typescript
adjustment_type?: 'tax' | 'tip' | 'service_charge' | 'discount' | 'fee' | null;
```

#### Manual Sales Hook (`src/hooks/useUnifiedSales.tsx`)

**Updated Functions**:
- `createManualSale()` - Added `adjustmentType` parameter
- `updateManualSale()` - Added `adjustmentType` parameter
- Sale transformation - Maps `adjustment_type` from database to TypeScript interface

### 4. Reporting & Aggregation

**Aggregate Function** (`supabase/migrations/20251012160337_9e390523-e575-42f4-ad28-715e2ba5bd67.sql`):
```sql
-- Revenue calculation now excludes adjustments
WHERE us.adjustment_type IS NULL
```

## Data Flow

### Clover Flow
1. Order created in Clover POS
2. Webhook/sync fetches order with expanded data (tax, tip, etc.)
3. Line items stored in `clover_order_line_items` (regular items only)
4. Adjustments stored directly in `unified_sales` with `adjustment_type` set
5. Sync function (`sync_clover_to_unified_sales`) syncs line items only
6. Revenue calculations filter `WHERE adjustment_type IS NULL`

### Square Flow
1. Order created in Square POS
2. Webhook receives order data (already includes totals)
3. Line items stored in `square_order_line_items` (regular items only)
4. Adjustments stored directly in `unified_sales` with `adjustment_type` set
5. Sync function (`sync_square_to_unified_sales`) syncs line items only
6. Revenue calculations filter `WHERE adjustment_type IS NULL`

## Testing Checklist

### Manual Testing

- [ ] Create Clover test order with tax and tip
  - Verify line item has `adjustment_type = NULL`
  - Verify tax has `adjustment_type = 'tax'`
  - Verify tip has `adjustment_type = 'tip'`

- [ ] Create Square test order with tax, tip, and service charge
  - Verify line item has `adjustment_type = NULL`
  - Verify tax has `adjustment_type = 'tax'`
  - Verify tip has `adjustment_type = 'tip'`
  - Verify service charge has `adjustment_type = 'service_charge'`

- [ ] Verify revenue dashboard excludes adjustments
  - Check P&L report shows correct revenue (excluding tax/tip)
  - Check item analytics doesn't show tax/tip as items
  - Check transaction counts are accurate

### SQL Verification

```sql
-- Count revenue lines vs adjustments
SELECT 
  adjustment_type,
  COUNT(*) as count,
  SUM(total_price) as total
FROM unified_sales 
WHERE restaurant_id = 'YOUR_RESTAURANT_ID' 
  AND sale_date >= '2025-11-01'
GROUP BY adjustment_type
ORDER BY adjustment_type NULLS FIRST;

-- Verify revenue calculation
SELECT 
  SUM(CASE WHEN adjustment_type IS NULL THEN total_price ELSE 0 END) as revenue,
  SUM(CASE WHEN adjustment_type = 'tax' THEN total_price ELSE 0 END) as tax,
  SUM(CASE WHEN adjustment_type = 'tip' THEN total_price ELSE 0 END) as tips,
  SUM(total_price) as grand_total
FROM unified_sales 
WHERE restaurant_id = 'YOUR_RESTAURANT_ID' 
  AND sale_date >= '2025-11-01';
```

## Backward Compatibility

- ✅ `adjustment_type` is nullable - existing data unaffected
- ✅ Existing queries work - `NULL` means revenue item
- ✅ No breaking changes to API or UI
- ✅ Revenue calculations explicitly filter - backward compatible

## GAAP Compliance

This implementation ensures:
- ✅ Revenue doesn't include liabilities (tax owed to government)
- ✅ Revenue doesn't include pass-throughs (tips to employees)
- ✅ Clean COGS% calculations (not diluted by tax/tip)
- ✅ Accurate item-level analytics
- ✅ Auditability via `raw_data` JSONB field

## Future Enhancements

Possible future additions:
- UI for viewing/analyzing adjustments separately
- Adjustment-specific reporting (tax liability, tip distribution)
- Manual adjustment entry in POS sales dialog
- Per-item tax tracking (if needed for tax compliance)

## Migration Rollback

If needed, to rollback:
```sql
-- Remove index
DROP INDEX IF EXISTS idx_unified_sales_adjustment_type;

-- Remove column
ALTER TABLE unified_sales DROP COLUMN IF EXISTS adjustment_type;
```

Note: This will not affect existing data, but revenue calculations will include all items again.
