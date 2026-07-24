# Design: Connect the receipt-import "SKU / Barcode" field to matched products

**Date:** 2026-07-24
**Branch:** `fix/receipt-import-barcode-sync`
**Area:** Receipt/Invoice import → Review & Map step

## Problem

In the receipt-import mapping step ([ReceiptMappingReview.tsx](../../../src/components/ReceiptMappingReview.tsx) /
[ReceiptItemRow.tsx](../../../src/components/receipt/ReceiptItemRow.tsx)), each parsed line has a field labeled
**"SKU / Barcode"**, backed by a single column `parsed_sku` on `receipt_line_items`. Two user expectations are unmet:

- **(A) Fill on match.** When a line item is auto-matched to an existing product that already has a barcode, the
  SKU/Barcode field stays empty. Root cause: `enrichLineItemsWithProductData`
  ([useReceiptImport.tsx:461](../../../src/hooks/useReceiptImport.tsx)) is the only path that copies data from a
  matched product into the row, and it selects only `id, size_value, size_unit, uom_purchase` — it never reads the
  product's `gtin`/`sku` and never populates `parsed_sku`.

- **(B) Write-back on edit.** Editing the field and importing does not update the matched product's barcode. The edit
  persists to `receipt_line_items.parsed_sku` fine, but `bulkImportLineItems`' **mapped** branch
  ([useReceiptImport.tsx:654–737](../../../src/hooks/useReceiptImport.tsx)) updates only
  `current_stock / cost_per_unit / receipt_item_names / supplier_id / updated_at` and drops `parsed_sku`. `parsed_sku`
  only reaches a product in the **new_item** branch (as `sku`).

Both failures share one cause: the barcode field is wired only for *creating* products, disconnected from *matched
existing* products in both directions.

## Decisions (from the user)

- **Barcode column = `gtin`, with `sku` as fallback.**
  - **Read/fill (A):** fill from `product.gtin || product.sku`.
  - **Write (B):** write the edited value to `product.gtin`. We do **not** overwrite `product.sku` — `sku` is a
    distinct stock-keeping identifier and clobbering it risks breaking sku-based lookups. "Fallback to sku" applies to
    the *read* direction. (Decided trade-off, see below.)
- **Fill behavior = auto-fill** (not an "Apply" suggestion chip).

## Approach

### Change 1 — Auto-fill `parsed_sku` from the matched product (Expectation A)

In `enrichLineItemsWithProductData`:
1. Add `gtin, sku` to the `products` SELECT.
2. When `item.parsed_sku` is empty and the product has `gtin || sku`, set `enrichedItem.parsed_sku` to that value.

This is **in-memory enrichment only** (not persisted to `receipt_line_items`), mirroring how `suggested_*` values
already work. Since `loadData` sets `lineItems` once *after* enrichment completes, and rows mount only after that,
the existing **uncontrolled** `defaultValue={item.parsed_sku || ''}` in `ReceiptItemRow` will display the filled value
on first render.

**The SKU input stays uncontrolled.** Making it controlled would force every keystroke through an awaited DB write in
`handleItemUpdate` before the displayed value updates — a typing-lag / cursor-jump regression. No `ReceiptItemRow`
change is needed.

### Change 2 — Write the edited barcode back to the matched product (Expectation B)

In `bulkImportLineItems`' mapped branch, fold `gtin` into the existing single `products` UPDATE when
`item.parsed_sku` is a non-empty trimmed string:

```ts
const productUpdate = {
  current_stock: newStock,
  cost_per_unit: unitPrice,
  receipt_item_names: updatedMappings,
  supplier_id: supplierId,
  updated_at: new Date().toISOString(),
  ...(resolveBarcodeWriteBack(item.parsed_sku) ? { gtin: resolveBarcodeWriteBack(item.parsed_sku) } : {}),
};
await supabase.from('products').update(productUpdate)
  .eq('id', item.matched_product_id)
  .eq('restaurant_id', selectedRestaurant.restaurant_id);   // L717: scope products UPDATE by restaurant_id
```

Per lessons.md L717 (an unscoped `products` UPDATE was a real bug on PR #545), the write-back UPDATE is scoped by
`restaurant_id` in addition to `id`.

### Testable seam — pure helpers in `receiptImportUtils.ts`

The affected logic lives inside a Supabase-calling hook, which is awkward to unit-test. Extract two pure helpers into
[src/utils/receiptImportUtils.ts](../../../src/utils/receiptImportUtils.ts) (which already holds pure helpers like
`calculateUnitPrice`) and have the hook call them:

- `resolveLineItemBarcode(parsedSku: string | null, product: { gtin?: string | null; sku?: string | null }): string | null`
  — returns the value to auto-fill: `null` when `parsedSku` is already non-empty; otherwise `gtin || sku || null`.
- `resolveBarcodeWriteBack(parsedSku: string | null): string | null` — returns the trimmed non-empty `parsedSku`,
  else `null`.

Unit tests cover these directly (TDD RED first).

## Scope boundaries (explicitly out)

- **`handleSkuChange` reverse lookup** ([ReceiptMappingReview.tsx:365](../../../src/components/ReceiptMappingReview.tsx))
  matches typed input against `p.sku` only. Extending it to also match `gtin` would make a written barcode
  re-findable, but it's a separate "type-a-barcode-to-map" feature, not one of the two stated expectations. **Deferred**
  (noted here so it isn't silently forgotten).
- **`SearchableProductSelector` Fuse keys** (`['name','sku','brand']`) — not adding `gtin` to search. Out of scope.
- **No DB migration** — `gtin` and `sku` already exist on `products`.

## Decided trade-offs

- **Write to `gtin` only, not `sku`.** Reading falls back to `sku`, but writing never overwrites an existing `sku`.
  Rationale: `sku` is a distinct identifier used by other lookups; the barcode's canonical home is `gtin` (the column
  the scanner's `findProductByGtin` queries). A product whose barcode currently lives in `sku` (from an older import)
  will, after an edit, have the new value in `gtin` and the stale value in `sku`; fill prefers `gtin`, so the UI stays
  correct.
- **Auto-fill is display-only (not persisted).** Untouched auto-filled rows write nothing back on import (the product
  keeps its own barcode — a no-op). Only user edits persist and write back.

## Verification

- Unit tests for `resolveLineItemBarcode` / `resolveBarcodeWriteBack`.
- Manual/preview: import a receipt where a line matches a product with a `gtin` → field shows it; edit the field →
  after import the product's `gtin` reflects the edit; matched product's `restaurant_id` scoping enforced.
