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
- The `product_suppliers` table has no pack size columns. Its Row type lists
  `average_unit_cost`, `last_unit_cost`, `last_purchase_date`,
  `last_purchase_quantity`, `purchase_count`, `is_preferred`, `supplier_sku`,
  `notes`, `lead_time_days`, `minimum_order_quantity`,
  `supplier_product_name`, and the key columns
  (src/integrations/supabase/types.ts:4908-4927).
- The add-supplier form inserts `last_unit_cost`, `supplier_sku`, and
  `is_preferred` only (src/components/ProductUpdateDialog.tsx:975-984).
- The price edit dialog opens with the supplier row and a price string
  (src/components/ProductUpdateDialog.tsx:1135-1139). Its save handler
  writes the price through the RPC `upsert_product_supplier` only
  (src/components/ProductUpdateDialog.tsx:1346-1352). The RPC takes
  `p_restaurant_id, p_product_id, p_supplier_id, p_unit_cost, p_quantity`
  (supabase/migrations/20251012015040_159dadb5-3d15-45b1-86fa-84ad8e62894b.sql:2-8).
- RLS on `product_suppliers` has a `FOR ALL` policy for owner/manager/chef,
  scoped by `restaurant_id` through `user_restaurants`
  (supabase/migrations/20251009161619_a1938f58-f26c-4509-8794-65ccaf65ce05.sql:51-60).
  A direct client UPDATE is a permitted write path.
- The purchase upsert RPC `upsert_product_supplier` updates cost, date,
  quantity, average, and count with an explicit column list. It cannot clear
  other columns
  (supabase/migrations/20251012015040_159dadb5-3d15-45b1-86fa-84ad8e62894b.sql:34-44).
- The receipt import inserts `product_suppliers` rows without pack data
  (src/hooks/useReceiptImport.tsx:870-882).
- Products store a product-level size as `size_value`, `size_unit`,
  `package_qty`, `uom_purchase` (src/hooks/useProducts.tsx:41-44). One
  product-level size cannot describe two suppliers with different cases.
- `convertUnits(value, fromUnit, toUnit, productName?)` converts between
  compatible units on the client (src/lib/enhancedUnitConversion.ts:152-157).
- The analytics report compares suppliers with
  `ps.last_unit_cost || ps.average_unit_cost || 0`
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

- `pack_size_qty NUMERIC`
- `pack_size_unit TEXT`

Constraints:

- `CHECK (pack_size_qty IS NULL OR pack_size_qty > 0)`
- `CHECK ((pack_size_qty IS NULL) = (pack_size_unit IS NULL))` — the two
  fields travel together. A per-unit price needs both.

No backfill. No RLS change: the existing policies apply at the row level.
The RPC `upsert_product_supplier` stays unchanged.

Type sync: run the migration on the local database. Regenerate types against
the local database. Update the `product_suppliers` block (Row, Insert,
Update) in src/integrations/supabase/types.ts (block starts at line 4908).
Diff the regenerated block against the hand-edit to check nullability marks.

### 2. Utility: `src/utils/supplierUnitPrice.ts`

Pure functions, no React:

- `computeUnitPrice(price, qty)` → `price / qty`, or `null` when either
  input is not a positive finite number.
- `compareSupplierUnitPrices(rows, productName?)` where each input row is
  `{ id, price, packSizeQty, packSizeUnit }`. Returns
  `Map<string, SupplierUnitPrice>` keyed by row `id`. The map gives the
  table a stable join key back to each `ProductSupplier` row. Each value:
  - `unitPrice` and `unit` in the supplier's own pack unit, or `null`.
  - `normalizedUnitPrice` in the base unit. The base unit is the pack unit
    of the first input row with pack data. The caller passes rows in the
    hook's fetch order; the rule is deterministic for a given fetch.
    Convert with `convertUnits` (src/lib/enhancedUnitConversion.ts:152).
    A row that cannot convert gets `normalizedUnitPrice: null`.
  - `isCheapest: true` on the row with the lowest `normalizedUnitPrice`,
    only when two or more rows have a `normalizedUnitPrice`. Tie-break:
    the earliest input row wins.

Price input per row: `last_unit_cost`, with fallback to `average_unit_cost`.

### 3. UI: `ProductUpdateDialog` supplier section

- Add-supplier form: add a "Pack size" quantity input and a unit `Select`.
  The unit list is `WEIGHT_UNITS + VOLUME_UNITS + COUNT_UNITS`
  (src/lib/enhancedUnitConversion.ts:5-7). Both fields are optional.
  Include both values in the insert.
- Empty-input rule: send `null` for both columns when the user leaves the
  pack fields empty. Never send `0` or an empty string — the CHECK
  constraints reject them.
- Label rule: give every new input an `id` and its `Label` an `htmlFor`.
  Give the unit `Select` trigger an `aria-label` or a paired `Label`.
  Do not copy the unassociated `<Label>Supplier</Label>` pattern at
  src/components/ProductUpdateDialog.tsx:852.
- Styling: use the CLAUDE.md form scale — `text-[12px] font-medium
  text-muted-foreground uppercase tracking-wider` labels, `h-10 text-[14px]
  bg-muted/30 border-border/40 rounded-lg` inputs.
- Price edit dialog: add the same two fields, pre-filled from the row.
  Save calls the RPC for the price, then a direct
  `supabase.from('product_suppliers').update({ pack_size_qty, pack_size_unit })`
  scoped by `.eq('id', ps.id).eq('restaurant_id', restaurantId)`. The
  `FOR ALL` RLS policy permits this write. This path gives existing rows a
  pack size.
- Supplier table: add a "Per Unit" column after "Last Price". Show
  `$3.06/lb` format. Show `-` when the row has no pack size or no price.
  Show a "Best price" `Badge` with `variant="secondary"` on the
  `isCheapest` row. Place the `Badge` directly in the `TableCell` or a
  `div` — never inside a `<p>` (shadcn `Badge` renders a `div`).
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
  null guards, price fallback to `average_unit_cost`, cross-unit
  normalization (lb vs oz), the single-row case (no `isCheapest`),
  non-convertible unit exclusion, tie-break, and map keys match input ids.
- pgTAP `supabase/tests/`:
  - The two columns exist.
  - A row with both pack columns `NULL` inserts without error.
  - `pack_size_qty = 0` and negative values violate the CHECK.
  - A qty without a unit, and a unit without a qty, violate the paired CHECK.
  - A purchase-style UPDATE keeps the pack columns.
  - A cross-tenant UPDATE that sets the pack columns fails under RLS.
- Playwright `tests/e2e/`: open a product on /inventory, add a supplier with
  a pack size, check the "Per Unit" value shows in the table.

## Decided trade-offs

- The analytics report comparison
  (src/hooks/useSupplierPriceAnalytics.tsx:158-175) keeps raw prices in this
  change. The report needs its own design for mixed pack sizes across the
  whole catalog. Deferred as a follow-up task.
- Receipt import does not capture pack size. OCR line items do not carry a
  reliable pack size today. The edit dialog covers this gap manually.
- `pack_size_unit` has no database check against the UI unit list. A write
  path outside the UI can store a unit `convertUnits` cannot parse; the row
  then shows `normalizedUnitPrice: null` and drops out of the ranking. This
  gap is accepted: the unit list lives in TypeScript and a SQL copy would
  drift.
