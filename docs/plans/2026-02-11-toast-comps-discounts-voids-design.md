# Toast Comps/Discounts/Voids — Design

**Date**: 2026-02-11
**Status**: Approved

## Problem

Our POS Sales page shows higher totals than Toast's "Net Amount" report. For Feb 10, 2026:
- Ours (excluding tax+tips): $1,254.52
- Toast Net Amount: $1,093.87
- Gap: $160.65

Root causes:
1. **Fully comped items** (`selection.price = 0`) are excluded by `total_price != 0` filter — they disappear entirely
2. **Item-level discounts** are not tracked — we store `selection.price` (net) but never create offset entries
3. **`toast_orders.discount_amount`** is always NULL in production (Toast API doesn't populate it), so the existing order-level discount section never creates entries
4. **Voided items** are imported as regular sales with no distinction

## Approach: Gross + Offset Entries

Store every item at its **gross menu price** (`preDiscountPrice`) for inventory tracking. Create separate negative entries to offset revenue for financial calculations.

### Math Verification

| Scenario | Revenue Entry | Offset Entry | Net |
|----------|--------------|-------------|-----|
| Normal ($27.95) | +$27.95 | — | $27.95 |
| 10% discount ($28.95→$26.05) | +$28.95 | -$2.90 (discount) | $26.05 |
| Fully comped ($27.95→$0) | +$27.95 | -$27.95 (discount) | $0.00 |
| Voided ($27.95) | — (filtered) | -$27.95 (void) | -$27.95 |

## Changes

### 1. Schema: Add columns to `toast_order_items`

```sql
ALTER TABLE toast_order_items ADD COLUMN is_voided BOOLEAN DEFAULT false;
ALTER TABLE toast_order_items ADD COLUMN discount_amount NUMERIC DEFAULT 0;
```

Backfill from existing `raw_json`:
```sql
UPDATE toast_order_items SET
  is_voided = COALESCE((raw_json->>'voided')::BOOLEAN, false),
  discount_amount = GREATEST(COALESCE(unit_price, 0) - COALESCE(total_price, 0), 0);
```

### 2. TypeScript: Update `toastOrderProcessor.ts`

In `upsertOrderItem`, add two new fields:
```typescript
is_voided: selection.voided ?? false,
discount_amount: Math.max((selection.preDiscountPrice ?? 0) - (selection.price ?? 0), 0),
```

### 3. SQL: Rewrite `sync_toast_to_unified_sales`

Both single-arg and date-range overloads get the same changes:

**Revenue entries** (modified):
- Use `toi.unit_price` as both `unit_price` and `total_price` (gross menu price)
- Change filter: `toi.unit_price IS NOT NULL AND toi.unit_price != 0 AND toi.is_voided = false`
- This ensures comped items ($0 net but non-zero gross) are included

**Item discount/comp entries** (new):
- `WHERE toi.discount_amount > 0 AND toi.is_voided = false`
- `total_price = -toi.discount_amount`
- `item_type = 'discount'`, `adjustment_type = 'discount'`
- `external_item_id = toi.toast_item_guid || '_discount'`

**Void entries** (new):
- `WHERE toi.is_voided = true AND toi.unit_price IS NOT NULL AND toi.unit_price != 0`
- `total_price = -toi.unit_price`
- `item_type = 'discount'`, `adjustment_type = 'void'`
- `external_item_id = toi.toast_item_guid || '_void'`

**Order-level discount section** (removed):
- The existing section using `toast_orders.discount_amount` is removed since this field is always NULL in production

## Key Files

- `supabase/migrations/20260211300000_toast_comps_discounts_voids.sql`
- `supabase/functions/_shared/toastOrderProcessor.ts`
- `supabase/tests/toast_comps_discounts_voids.sql`
