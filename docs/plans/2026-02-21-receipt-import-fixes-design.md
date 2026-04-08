# Receipt Import Fixes: Editable Date & Accurate Import Totals

## Problem

Two customer-reported issues with the receipt/invoice import flow:

1. **Import date not editable after import** — The purchase date picker is hidden once a receipt has `status = 'imported'` (guarded by `!isImported` in `ReceiptMappingReview.tsx:510`). When the AI misreads a date, users cannot correct it after import.

2. **Import history total reflects full receipt, not imported items** — `receipt_imports.total_amount` is set once during AI processing from the full receipt total and never recalculated. When users skip items (e.g., a sponge that's an expense, not inventory), the history still shows the full receipt total instead of the sum of items actually imported.

## Design

### Database Changes

Add one column to `receipt_imports`:

```sql
ALTER TABLE receipt_imports
ADD COLUMN imported_total NUMERIC(10,2) DEFAULT NULL;
```

- Set at import time to the sum of `parsed_price` for items with `mapping_status IN ('mapped', 'new_item')`
- Remains NULL for receipts not yet imported
- `total_amount` (the AI-extracted receipt total) is preserved unchanged

### Import Logic Changes

**File: `src/hooks/useReceiptImport.tsx` — `bulkImportLineItems`**

After the import loop completes, sum `parsed_price` for all successfully imported items. Write both `status: 'imported'` and `imported_total` to `receipt_imports` in the existing update call (~line 806).

**File: `src/hooks/useReceiptImport.tsx` or `ReceiptMappingReview.tsx` — `handlePurchaseDateChange`**

When the date changes on an already-imported receipt:
1. Update `receipt_imports.purchase_date` (existing behavior)
2. Update all `inventory_transactions` where `reference_id LIKE 'receipt_{receiptId}_%'` to set `transaction_date` to the new date
3. Show a toast confirming transaction dates were updated

### UI Changes

**ReceiptMappingReview.tsx — Date editing on imported receipts**

- Remove the `!isImported` guard that hides the vendor/date section
- Keep vendor selector read-only when imported (vendor changes after import would be confusing)
- Keep date picker editable always (before and after import)
- On date change for imported receipts, cascade to inventory transactions and show confirmation toast

**ReceiptImport.tsx — History list total display**

When `imported_total` exists and differs from `total_amount`:
```
$85.40
Receipt total: $112.50
```

When they're equal or `imported_total` is null:
```
$112.50
```

**ReceiptStatusBar.tsx — No changes needed**

The status bar shows the receipt total during review, which is correct.

## Key Files

| File | Change |
|------|--------|
| `supabase/migrations/new` | Add `imported_total` column |
| `src/hooks/useReceiptImport.tsx` | Calculate `imported_total` on import; cascade date to transactions |
| `src/components/ReceiptMappingReview.tsx` | Remove `!isImported` guard on date; vendor read-only when imported |
| `src/pages/ReceiptImport.tsx` | Show `imported_total` in history list |

## Testing

- Unit test: `imported_total` calculation sums only mapped/new_item prices
- Unit test: date cascade updates inventory transactions matching reference_id pattern
- Manual test: import receipt, skip items, verify history shows correct total
- Manual test: edit date after import, verify inventory transactions updated
