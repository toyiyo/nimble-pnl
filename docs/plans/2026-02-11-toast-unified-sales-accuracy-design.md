# Toast unified_sales Accuracy Fixes

## Problem

EasyShiftHQ daily totals do not match Toast Sales Summary. Investigation on Feb 10, 2026 data revealed two bugs in the `sync_toast_to_unified_sales` RPC function.

## Confirmed Bugs

### Bug 1: Quantity x Price Double-Multiplication

Toast's `price` and `preDiscountPrice` fields are **line totals** (already multiplied by quantity). Our order processor stores these as `unit_price` and `total_price` in `toast_order_items`. The RPC then multiplies by quantity again when writing to `unified_sales`.

**Example** (Stemmari Red Blend GL, Feb 10):
- Toast: qty=2, price=20 (10 each)
- `toast_order_items`: unit_price=20, total_price=20
- `unified_sales`: total_price = 20 * 2 = **40** (should be 20)

Affects Steps 1 (revenue), 2 (discount offsets), and 3 (void offsets) of the RPC.

**Feb 10 impact**: +$36 in gross sales.

### Bug 2: Denied Payment Tips Included

Step 5 (tips) of the RPC includes all payments regardless of status. Denied payment attempts with tips inflate tip totals.

**Example** (Order c6b2c9e1, Feb 10):
- 1 CAPTURED payment: $2.50 tip
- 1 DENIED payment: $2.50 tip
- Both appear in unified_sales

**Feb 10 impact**: +$2.50 in tips (207.94 vs 205.44 target).

## Fix Design

All changes are in one SQL migration that replaces the `sync_toast_to_unified_sales` function.

### Fix 1: Stop double-multiplying (Steps 1, 2, 3)

For each step, change the pattern from:

```sql
-- Before (wrong)
toi.unit_price, toi.unit_price * toi.quantity

-- After (correct)
toi.unit_price / NULLIF(toi.quantity, 0), toi.unit_price
```

`unit_price` in `unified_sales` becomes a true per-unit price (divided by quantity).
`total_price` in `unified_sales` uses the raw value as-is (already a line total).

Same pattern for discount and void offsets.

### Fix 2: Filter denied payment tips (Step 5)

```sql
-- Add to WHERE clause
AND tp.payment_status NOT IN ('DENIED', 'VOIDED')
```

### What We Are NOT Changing

- `toast_order_items` storage (no backfill of raw data needed)
- `item_type` for voids (stays as 'discount' with adjustment_type='void')
- Tax entries (pulled from toast_orders, already correct)
- Business date handling (already uses Toast businessDate, verified correct)

## Backfill Strategy

The RPC uses `ON CONFLICT ... DO UPDATE`, so re-running it overwrites existing rows. After deploying the migration, call `sync_toast_to_unified_sales(restaurant_id)` for each Toast-connected restaurant.

## Verification (Feb 10 targets)

| Metric | Before Fix | Target |
|--------|-----------|--------|
| Gross sales | 1,296.45 | 1,260.45 |
| Discounts | -166.58 | -166.58 |
| Net sales | ~1,129.87 | 1,093.87 |
| Tax | 88.05 | 88.05 |
| Tips | 207.94 | 205.44 |

## Files Touched

- 1 new SQL migration (replaces RPC function)
- Test updates if needed for `28_toast_comps_discounts_voids.sql` and `17_toast_sync_authorization.sql`
