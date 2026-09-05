# Plan: Per-unit supplier price comparison (pack size)

Design: docs/superpowers/specs/2026-08-30-supplier-pack-size-design.md

Each task follows RED → GREEN → REFACTOR → COMMIT.

## Task 1: Migration + pgTAP tests

Depends on: none.

1. Write `supabase/tests/` pgTAP test per the design "Tests" section:
   columns exist, NULL pair inserts, `0` and negative qty fail, unpaired
   fields fail, purchase-style UPDATE keeps pack columns, cross-tenant
   UPDATE fails under RLS.
2. Write the migration: add `pack_size_qty NUMERIC`, `pack_size_unit TEXT`,
   `CHECK (pack_size_qty IS NULL OR pack_size_qty > 0)`,
   `CHECK ((pack_size_qty IS NULL) = (pack_size_unit IS NULL))`.
3. Run `npm run db:reset` then `npm run test:db`. Warning: the local
   Supabase stack is shared across worktrees — do not run `db:reset` while
   a sibling worktree runs database work.
4. Commit.

## Task 2: Generated types

Depends on: Task 1.

1. Regenerate types against the local database.
2. Merge the `product_suppliers` block (Row, Insert, Update) into
   src/integrations/supabase/types.ts (block starts at line 4908).
3. Diff the regenerated block against the merge; check nullability marks.
4. Run `npm run typecheck`. Commit.

## Task 3: Utility `src/utils/supplierUnitPrice.ts`

Depends on: none.

1. Write `tests/unit/supplierUnitPrice.test.ts` per the design "Tests"
   section (RED).
2. Write `computeUnitPrice` and `compareSupplierUnitPrices` per design
   section 2. Return type: `Map<string, SupplierUnitPrice>` keyed by row id.
3. Run `npm run test`. Commit.

## Task 4: Hook interface

Depends on: Task 2.

1. Add `pack_size_qty?: number | null` and `pack_size_unit?: string | null`
   to `ProductSupplier` (src/hooks/useProductSuppliers.tsx:5-22).
2. Run `npm run typecheck`. Commit with Task 5 if trivial.

## Task 5: Add-supplier form pack fields

Depends on: Tasks 2, 4.

1. Add the "Pack size" quantity input and the unit `Select` to the
   add-supplier form in src/components/ProductUpdateDialog.tsx.
   Follow the design section 3 label, styling, and empty-input rules.
2. Include `pack_size_qty` and `pack_size_unit` in the insert at
   src/components/ProductUpdateDialog.tsx:975-984. Send `null` when empty.
3. Capture the pack fields on the new-product pending path
   (src/components/ProductUpdateDialog.tsx:950-971).
4. Run `npm run typecheck && npm run lint`. Commit.

## Task 6: Price edit dialog pack fields

Depends on: Tasks 2, 4.

1. Add the same two fields to the price edit dialog, pre-filled from the
   row.
2. After the RPC call, write the pack columns with a direct
   `supabase.from('product_suppliers').update(...)` scoped by
   `.eq('id', ...).eq('restaurant_id', ...)`.
3. Run `npm run typecheck && npm run lint`. Commit.

## Task 7: Per-unit table column

Depends on: Tasks 3, 4.

1. Compute unit prices with `compareSupplierUnitPrices` in a `useMemo`.
2. Add the "Per Unit" column after "Last Price". Show `$3.06/lb` format,
   `-` for rows without data.
3. Show the "Best price" `Badge` (`variant="secondary"`) on the
   `isCheapest` row, inside the `TableCell`, never inside a `<p>`.
4. Run `npm run typecheck && npm run lint`. Commit.

## Task 8: E2E spec

Depends on: Tasks 5, 7.

1. Extend or add a Playwright spec under `tests/e2e/`: open a product on
   /inventory, add a supplier with a pack size, check the "Per Unit" value.
2. Use `page.getByRole()` / `page.getByLabel()` selectors and helpers from
   `'../helpers/e2e-supabase'`.
3. Run the spec. Commit.
