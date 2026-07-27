# Plan: Receipt-import barcode sync

Design: docs/superpowers/specs/2026-07-24-receipt-import-barcode-sync-design.md

Small, dependency-ordered tasks. Each is TDD (RED → GREEN → REFACTOR → COMMIT) where a test seam exists.

## Task 1 — Pure helpers + unit tests (TDD)
**Files:** `src/utils/receiptImportUtils.ts`, `tests/unit/receiptImportUtils.test.ts` (or the existing test file for this util)
- RED: write failing tests for:
  - `resolveLineItemBarcode(parsedSku, product)`:
    - returns `null` when `parsedSku` is a non-empty string (don't overwrite user/existing value)
    - returns `product.gtin` when `parsedSku` is null/empty and gtin present
    - falls back to `product.sku` when gtin null/empty but sku present
    - returns `null` when both gtin and sku are null/empty
    - treats whitespace-only `parsedSku` as empty (fills)
  - `resolveBarcodeWriteBack(parsedSku)`:
    - returns trimmed value for a non-empty string
    - returns `null` for null, `''`, and whitespace-only
- GREEN: implement both pure helpers.
- COMMIT: `feat(receipt-import): add barcode resolve helpers`

## Task 2 — Auto-fill parsed_sku from matched product (Expectation A)
**File:** `src/hooks/useReceiptImport.tsx` (`enrichLineItemsWithProductData`)
- Add `gtin, sku` to the `products` SELECT (line ~475).
- After the existing `suggested_*` enrichment, set
  `enrichedItem.parsed_sku = resolveLineItemBarcode(item.parsed_sku, matchedProduct) ?? item.parsed_sku`.
- Verify no regression to existing size/package enrichment.
- COMMIT: `feat(receipt-import): auto-fill SKU/Barcode from matched product gtin`

## Task 3 — Write barcode back to matched product + hardening (Expectation B)
**File:** `src/hooks/useReceiptImport.tsx` (`bulkImportLineItems`, mapped branch ~654-737)
- Replace the two `id`-only SELECTs (`current_stock`, `receipt_item_names`) with one
  `restaurant_id`-scoped `.select('current_stock, receipt_item_names').maybeSingle()`; treat null/error as skip.
- Compute `const barcode = resolveBarcodeWriteBack(item.parsed_sku)`; when truthy, add `gtin: barcode` to the
  update object.
- Scope the UPDATE by `.eq('restaurant_id', restaurantId)` in addition to `id`; chain `.select('id').maybeSingle()`;
  treat null/error as a logged failure (`continue`) — no silent no-op.
- COMMIT: `fix(receipt-import): write edited barcode back to matched product gtin`

## Task 4 — Commit SKU field on blur, not per keystroke (Change 3)
**File:** `src/components/receipt/ReceiptItemRow.tsx` (SKU Input ~292-299)
- Change `onChange={(e) => onSkuChange(item.id, e.target.value)}` to
  `onBlur={(e) => onSkuChange(item.id, e.target.value)}`. Keep `defaultValue` (uncontrolled).
- No other input changes.
- COMMIT: `fix(receipt-import): commit SKU/Barcode field on blur to avoid write race`

## Notes / guards
- No DB migration (gtin/sku exist on products; verified against prod).
- Confirm `useProducts`/enrichment SELECT actually returns gtin (enrichment does its own query — controlled here).
- Deferred (documented in design): `handleSkuChange` gtin reverse-lookup, `SearchableProductSelector` gtin search key,
  collapsed-row Space-key a11y.

## Sequencing
Task 1 → (Task 2, Task 3 both depend on Task 1's helpers) → Task 4 independent (can go any time after Task 1).
