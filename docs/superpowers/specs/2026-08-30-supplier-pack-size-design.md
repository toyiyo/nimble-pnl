# Design: Per-unit supplier price comparison (pack size)

Date: 2026-08-30
Source: PostHog feedback, session 01a0300a-4704-74b4-93db-a30eb44b1b98 (2026-08-23).
Customer request: the supplier price comparison on /inventory ignores pack size.
Example: a 30 lb case at $91.81 shows next to a 10 lb case at $39.03.
The 30 lb case costs $3.06/lb. The 10 lb case costs $3.90/lb.
The current table makes the cheaper case look more expensive.

## Current behavior (premises, cited)

- The supplier table in the product dialog shows `last_unit_cost` and
  `average_unit_cost` as raw dollar amounts
  (src/components/ProductUpdateDialog.tsx:1086, src/components/ProductUpdateDialog.tsx:1089).
- The table has no pack size column and no per-unit column
  (src/components/ProductUpdateDialog.tsx:1066-1074).
- The `product_suppliers` table has no pack size columns. Its row type lists
  cost, date, quantity, SKU, and preference fields only
  (src/integrations/supabase/types.ts:4833-4851).
- The add-supplier form inserts `last_unit_cost`, `supplier_sku`, and
  `is_preferred` only (src/components/ProductUpdateDialog.tsx:975-984).
- The price edit dialog opens with the supplier row and a price string
  (src/components/ProductUpdateDialog.tsx:1135-1139).
- The purchase upsert RPC `upsert_product_supplier` updates cost, date,
  quantity, average, and count. It does not touch other columns
  (supabase/migrations/20251012015040_159dadb5-3d15-45b1-86fa-84ad8e62894b.sql:34-44).
- The receipt import inserts `product_suppliers` rows without pack data
  (src/hooks/useReceiptImport.tsx:870-882).
- Products store a product-level size as `size_value`, `size_unit`,
  `package_qty`, `uom_purchase` (src/hooks/useProducts.tsx:41-44). One
  product-level size cannot describe two suppliers with different cases.
- `convertUnits(value, fromUnit, toUnit, productName?)` converts between
  compatible units on the client (src/lib/enhancedUnitConversion.ts:152-157).
- The analytics report compares suppliers with raw `last_unit_cost`
  (src/hooks/useSupplierPriceAnalytics.tsx:158-175).

## Approaches

### A. Per-supplier pack size columns (chosen)

Add `pack_size_qty` and `pack_size_unit` to `product_suppliers`. Compute the
per-unit price on the client. Show it in the supplier table.

- Pro: each supplier keeps its own case size. This matches the request.
- Pro: nullable columns. Existing rows and write paths stay valid.
- Con: users must enter the pack size once per supplier.

### B. Derive from product-level size

Use `products.size_value` for every supplier.

- Con: one value cannot describe two different case sizes. Rejected.

### C. Store the computed per-unit price

- Con: a stored computed value drifts when the price changes. Rejected.

## Design (approach A)

### 1. Migration

Add two nullable columns to `product_suppliers`:

- `pack_size_qty NUMERIC` with `CHECK (pack_size_qty > 0)`
- `pack_size_unit TEXT`

No backfill. No RLS change: existing policies cover the whole row.
The RPC `upsert_product_supplier` stays unchanged. A purchase update
does not clear the pack columns because its UPDATE lists explicit columns
(supabase/migrations/20251012015040_159dadb5-3d15-45b1-86fa-84ad8e62894b.sql:34-44).

Add the two columns to the `product_suppliers` block in
src/integrations/supabase/types.ts (Row, Insert, Update).

### 2. Utility: `src/utils/supplierUnitPrice.ts`

Pure functions, no React:

- `computeUnitPrice(price, qty)` → `price / qty`, or `null` when either
  input is not a positive finite number.
- `compareSupplierUnitPrices(rows, productName?)` → per-row result:
  - `unitPrice` and `unit` in the supplier's own pack unit.
  - `normalizedUnitPrice` in a base unit. The base unit is the pack unit of
    the first row with pack data. Convert with `convertUnits`
    (src/lib/enhancedUnitConversion.ts:152). A row that cannot convert gets
    `normalizedUnitPrice: null`.
  - `isCheapest: true` on the row with the lowest `normalizedUnitPrice`,
    only when two or more rows have a `normalizedUnitPrice`.

Price input per row: `last_unit_cost`, with fallback to `average_unit_cost`.

### 3. UI: `ProductUpdateDialog` supplier section

- Add-supplier form: add a "Pack size" quantity input and a unit `Select`.
  The unit list is `WEIGHT_UNITS + VOLUME_UNITS + COUNT_UNITS`
  (src/lib/enhancedUnitConversion.ts:5-7). Both fields are optional.
  Include both values in the insert.
- Price edit dialog: add the same two fields. This gives existing supplier
  rows a path to a pack size. Save writes `pack_size_qty`, `pack_size_unit`,
  and the price.
- Supplier table: add a "Per Unit" column after "Last Price". Show
  `$3.06/lb` format. Show `-` when the row has no pack size or no price.
  Show a "Best price" badge on the `isCheapest` row.
- The new-product pending-supplier path
  (src/components/ProductUpdateDialog.tsx:950-971) also captures the pack
  fields so they apply on create.

### 4. Hook: `useProductSuppliers`

Add `pack_size_qty` and `pack_size_unit` to the `ProductSupplier` interface
(src/hooks/useProductSuppliers.tsx:5-22). The fetch uses `select('*')`
(src/hooks/useProductSuppliers.tsx:42) so the new columns arrive without a
query change.

## Tests

- `tests/unit/supplierUnitPrice.test.ts`: the 30 lb / 10 lb example, zero and
  null guards, unit fallback, cross-unit normalization (lb vs oz), the
  single-row case (no `isCheapest`), non-convertible unit exclusion.
- pgTAP `supabase/tests/`: columns exist, `CHECK` rejects `0` and negative
  values, a purchase-style UPDATE keeps the pack columns.
- Playwright `tests/e2e/`: open a product on /inventory, add a supplier with
  a pack size, check the "Per Unit" value shows in the table.

## Decided trade-offs

- The analytics report comparison
  (src/hooks/useSupplierPriceAnalytics.tsx:158-175) keeps raw prices in this
  change. The report needs its own design for mixed pack sizes across the
  whole catalog. Deferred as a follow-up task.
- Receipt import does not capture pack size. OCR line items do not carry a
  reliable pack size today. The edit dialog covers this gap manually.
