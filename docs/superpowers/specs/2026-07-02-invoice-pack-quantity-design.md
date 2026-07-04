# Design: Invoice importer reads the "pack" column as the quantity

**Date:** 2026-07-02
**Branch:** `feature/invoice-pack-quantity`
**Author:** Jose Delgado (via `/dev`)

## Problem

When we import supplier invoices (PFG, Sygma, and similar distributors), each
line has a **pack** value — the number of individual units inside one
purchasing container (case/box). We stock and consume those inner units, not
the shipping box. Today the AI importer ignores the pack column: it records the
number of *cases ordered* as the quantity and captures only the per-inner-unit
*size*, so the pack multiplier is lost.

### Concrete example (PFG line, item 87750)

```
Item#   Ordered  Pack   Size      Description                          Ext
87750   1        500    .32 OZ    GULDENS %MUSTARD PACKET SPICY BRWN    29.96
```

- **Today:** quantity=1, size=0.32 oz, package="box" → *"1 box containing 0.32 oz"*,
  cost = $29.96 per box. The `500` is dropped. We sell by the packet, but the
  system thinks we received one 0.32 oz box.
- **Wanted:** quantity=**500 packets**, each 0.32 oz, cost = $29.96 / 500 =
  $0.0599 per packet.

### Root cause

`supabase/functions/process-receipt/index.ts` — the `RECEIPT_ANALYSIS_PROMPT`
uses a three-field model (`parsedQuantity`, `packageType`, `sizeValue`+`sizeUnit`)
and **explicitly instructs the model to discard the pack count**:

> Example 3: `"1 case 12x355ML BEER"` → `parsedQuantity=1, packageType="case",
> sizeValue=355, sizeUnit="ml"` *(extract the per-can size)*

There is no field or instruction for the "12". The mapping in
`src/hooks/useReceiptImport.tsx` (`bulkImportLineItems`) then increments
`current_stock` by `parsed_quantity` (cases), never applying the pack multiplier.

## Key insight — this is an extraction fix, not an inventory-model change

The existing product model already represents everything we need:

- `current_stock` is counted in the **stocking unit**.
- `size_value` / `size_unit` describe **the contents of ONE single stocking
  unit** (per the inventory UI help: *"750 for a 750ml bottle"*).
- Recipe deduction (`supabase/functions/_shared/inventoryConversion.ts` + the
  authoritative `process_unified_inventory_deduction` SQL) converts recipe
  units → fractional stocking units via `size_value`/`size_unit`.

The realization from the domain owner: **the inner "pack" unit IS the stocking
unit.** The box/case is only how the product ships and is irrelevant to
inventory. So the fix is to make the importer:

1. Set the **stocking unit** = the inner unit (packet, can, bag, bottle) — not
   the box/case.
2. Set **quantity** = `Ordered × Pack` (total inner units received).
3. Keep **`size_value`/`size_unit`** = the per-single-inner-unit size — unchanged
   meaning.

Because `size_value` keeps its exact current meaning, **the recipe-deduction
engine is not touched and no existing recipe or product changes behavior.**

### Field mapping (all confirmed with domain owner)

| Line (PFG) | Ordered | Pack | Size | Quantity | Package type | Amount/pkg | Unit | Cost/unit |
|---|---|---|---|---|---|---|---|---|
| Gulden's mustard | 1 | 500 | .32 OZ | 500 | packet | .32 | oz | 29.96/500 = $0.060 |
| Baking soda | 1 | 12 | 2 LB | 12 | can | 2 | lb | 33.30/12 = $2.775 |
| Butter clarified | 2 | 4 | 5 LB | 8 | can | 5 | lb | 152.40/8 = $19.05 |
| Rice | 1 | 15 | 1 LB | 15 | bag | 1 | lb | — |
| Vodka | 1 | 1 | 750 ML | 1 | bottle | 750 | ml | — (unchanged) |

**Consumption is decided by the recipe, not the import.** A recipe consuming
`2 fl oz` of vodka, `0.5 lb` of rice, or `1 packet` of mustard all deduct
correctly through the existing `size_value`/`size_unit` conversion.

## Distributor layouts the AI must read

### PFG (Performance Food Service)
Explicit columns: `Item Number | Ordered | Shipped | Pack | Size | Unit |
Description | Price | Extension`.
- `Ordered` (or `Shipped`) = number of cases.
- `Pack` = inner units per case.
- `Size` = size of one inner unit (`.32 OZ`, `2 LB`, `750 ML`).

### Sygma
Order qty is `N CS` in the leftmost column; the pack/size is a **combined
token** in one column: `pack/size`.
- `1/20 LB` → pack 1, size 20 lb
- `8/32 OZ` → pack 8, size 32 oz
- `2/2.5GAL` → pack 2, size 2.5 gal

So `casesOrdered × pack` = total inner units, and `size`/`unit` = per-inner-unit
size — the same model as PFG.

## Approach

### 1. AI extraction (`process-receipt/index.ts`)
Extend `ParsedLineItem` and the prompt with two explicit, auditable fields:

- `casesOrdered` — number of purchasing containers on the line (PFG "Ordered",
  Sygma "N CS"). Default 1 when a receipt has no case concept.
- `unitsPerPack` — the pack count (PFG "Pack" column, Sygma numerator). Default 1.

The model then computes:
- `parsedQuantity = casesOrdered × unitsPerPack` (total inner units).
- `packageType` = the **inner** unit (packet, can, bottle, bag, jar, …),
  inferred from the description ("MUSTARD PACKET" → packet) or category.
- `sizeValue`/`sizeUnit` = per-single-inner-unit size.
- `unitPrice = lineTotal / parsedQuantity`; `lineTotal` = the line Extension.

Prompt work:
- Add a **distributor pack/size section** teaching the PFG column layout and the
  Sygma `pack/size` combined token.
- **Rewrite Example 3** (the beer case) so it no longer discards the pack:
  `"1 case 12x355ML"` → `casesOrdered=1, unitsPerPack=12, parsedQuantity=12,
  packageType="can", sizeValue=355, sizeUnit="ml"`.
- Add PFG/Sygma worked examples (mustard, baking soda, butter).
- Keep existing behavior for retail receipts with no pack concept
  (`unitsPerPack=1`, `casesOrdered=parsedQuantity` — net result unchanged).

### 2. Pure helper + unit tests (`src/utils/receiptImportUtils.ts`)
Add small, deterministic, fully-tested helpers (the AI output is non-testable,
so pull the math out of it):

- `computeImportedQuantity({ casesOrdered, unitsPerPack })` →
  `max(1, casesOrdered) × max(1, unitsPerPack)`.
- `parsePackSizeToken("8/32 OZ")` → `{ unitsPerPack: 8, sizeValue: 32,
  sizeUnit: "oz" }` (tolerates `1/20 LB`, `2/2.5GAL`, missing slash → pack 1).
  **Use `parseFloat` (not `parseInt`) for the size** so `2/2.5GAL` yields
  `sizeValue: 2.5`, not `2`.
- Extend `calculateUnitPrice` usage so per-unit price divides by the total
  inner-unit quantity (already divides by `parsed_quantity`; behavior is correct
  once `parsed_quantity` is the total).

### 3. Persist the pack (`receipt_line_items`)
New migration adding a nullable column (no default, no backfill, no table
rewrite):
```sql
ALTER TABLE receipt_line_items ADD COLUMN IF NOT EXISTS pack_quantity INTEGER;
COMMENT ON COLUMN receipt_line_items.pack_quantity IS
  'Distributor pack: inner units per purchasing case (audit/display only). '
  'NOT the products.package_qty costing field — this is receipt trail metadata.';
```
`process-receipt` insert maps `pack_quantity: item.unitsPerPack ?? null`.
`ReceiptLineItem` (TS interface) gains `pack_quantity: number | null`.

### 4. Import → product (`useReceiptImport.tsx`)
In `bulkImportLineItems`:
- Existing product: `newStock = current_stock + parsed_quantity` (now total
  inner units — no code change, correct once quantity is right).
- New product: `uom_purchase = packageType` (inner unit), `size_value`/`size_unit`
  as today, `current_stock = parsed_quantity`,
  `cost_per_unit = calculateUnitPrice(item)` (→ per inner unit).
- **Do NOT write `products.package_qty`** (see "What explicitly does NOT
  change"). The stocking model is fully described by quantity + `size_value` +
  `uom_purchase` + `cost_per_unit`; leaving `package_qty` at its default `1`
  keeps `calculate_recipe_cost` correct.

### 5. Receipt review UI (`ReceiptItemRow.tsx`)
- Add a **read-only summary line**, shown only when `pack_quantity > 1`:
  *"2 cases × 4 = 8 cans"*, so the user can verify the multiplication.
  - Typography: `text-[13px] text-muted-foreground` (secondary scale), placed in
    the left column adjacent to the `Qty` field it annotates.
  - Accessibility: wrap in `aria-live="polite"` so screen readers announce the
    computed total when the row expands; use the real `×` glyph (`×`), not
    the letter `x`.
- Update the "Package Definition" box copy to read from the inner unit:
  - `pack_quantity > 1` → *"8 cans, each containing 5 lb"*.
  - `pack_quantity` null/1 → keep today's *"1 {packageType} containing {size}"*
    wording (avoids the awkward "1 can, each containing…").
  - Copy renders at `text-[14px] font-medium` (body scale).
- **Migrate the box to semantic tokens** while we're editing it (it currently
  uses raw `green-50/green-800/green-200` classes, a CLAUDE.md violation). Use
  `bg-muted/30 border-border/40` for the container with `text-foreground` /
  `text-muted-foreground` inside; add `aria-hidden="true"` to the `✓` span. Do
  not add any new raw color classes.
- The compact auto-approved row (`ReceiptItemRow.tsx:170`) shows
  `{parsed_quantity} × {price}`; when `pack_quantity > 1` this now shows the full
  inner-unit total (e.g. `500 × $0.06`), which is correct. No extra badge needed;
  expanding the row reveals the pack breakdown.
- The `Qty` field continues to show/edit the total inner-unit quantity.

## What explicitly does NOT change

- `process_unified_inventory_deduction` (SQL) and `inventoryConversion.ts` — the
  deduction engine reads only `size_value`/`size_unit` (verified: it never
  references `package_qty`). Their semantics are unchanged, so deduction for
  every existing product is byte-for-byte identical.
- **`products.package_qty` is never written by this feature.** This is load-
  bearing, not incidental: `calculate_recipe_cost`
  (`supabase/migrations/20251006230142_*.sql:39-40`) computes
  `package_total_size = size_value × COALESCE(package_qty, 1)` and
  `unit_price = cost_per_unit / package_total_size`. Because we now store
  `size_value` = per-single-inner-unit size **and** `cost_per_unit` = per-inner-
  unit cost, leaving `package_qty` at its default `1` yields the correct per-size
  cost (butter: `19.05 / (5 × 1) = $3.81/lb`). Writing a non-1 `package_qty`
  here would divide costs by the pack and silently corrupt P&L — so we don't.
  The pack lives on `receipt_line_items.pack_quantity` (audit/UI) only.

## Edge cases

- **No pack concept** (retail receipts, produce by weight): `unitsPerPack=1`,
  `casesOrdered=parsedQuantity` → identical to today.
- **Sold by weight** (e.g. `6.86 lb CHEEK MEAT`): `parsedUnit="lb"`, no pack —
  unchanged.
- **Pack present but Ordered blank**: default `casesOrdered=1`.
- **Sygma token without a slash** (`20 LB`): treat as `unitsPerPack=1`,
  `sizeValue=20`, `sizeUnit=lb`.
- **Matching an existing product stocked in the old (box) unit**: name-match may
  surface a unit mismatch; the review screen shows the new per-unit definition
  so the user can reconcile. No automatic re-unit of historical stock.

## Testing

- **Vitest** (`tests/unit/`): `computeImportedQuantity`, `parsePackSizeToken`
  (all distributor token shapes — including `2/2.5GAL` → `2.5` and a
  slash-less `20 LB` → pack 1), `calculateUnitPrice` with pack-driven
  quantities. Cover mustard/baking-soda/butter/vodka/rice rows.
- **pgTAP** (new `supabase/tests/10_receipt_pack_quantity.sql`):
  `has_column('receipt_line_items','pack_quantity')`,
  `col_type_is(... 'integer')`, `col_is_null(...)`, round-trip insert with
  `pack_quantity = 500`, and insert with `pack_quantity = NULL` (retail row).
  Filter assertions by a fixed fixture `receipt_id` for determinism.
- No prompt is unit-tested directly; the math it must perform is extracted into
  the tested helpers.

## Known pre-existing limitations (out of scope)

These exist today, are **not introduced or worsened in kind** by this feature,
and each needs its own reprocessing/concurrency design. Documented here so they
are not mistaken for regressions:

- **Line-item insert is not idempotent.** `process-receipt` does a plain
  `insert` with no `ON CONFLICT`; reprocessing a receipt duplicates its line
  items (no unique constraint on `(receipt_id, line_sequence)`). Fixing this
  changes reprocessing semantics (replace vs. append) and is deferred to a
  dedicated task.
- **`current_stock` update is a client-side read-modify-write**
  (`useReceiptImport.tsx:659`), not a SQL `SET current_stock = current_stock +
  $delta`. Concurrent imports of the same product across tabs can under-count.
  Pre-existing; the larger post-fix quantities make a collision slightly more
  visible but do not change the root cause.

## Decided trade-offs

- **Stocking unit = inner unit, quantity = Ordered × Pack** (confirmed with
  domain owner via mustard/baking-soda/butter). Butter Ordered 2 × Pack 4 → 8
  cans.
- **No deduction-engine change** — chosen over wiring `package_qty` into the
  costing SQL, to guarantee zero regression risk to existing recipes (the domain
  owner's hard constraint). The raw pack is still persisted, leaving the door
  open to an explicit three-level model later if ever wanted.
- **`products.package_qty` is deliberately NOT populated** (revised after Phase
  2.5 Supabase review). `calculate_recipe_cost` multiplies `size_value ×
  package_qty`; writing the pack there would divide costs by the pack and corrupt
  P&L. Correctness is achieved entirely through quantity + per-inner `size_value`
  + per-inner `cost_per_unit`. The pack is kept only on
  `receipt_line_items.pack_quantity`.
- **Read-only pack visibility in the review UI** (over a silent multiply) so the
  extraction is auditable before import.
- **Idempotency + stock-race hardening deferred** (Phase 2.5 Supabase review
  flagged both). They are pre-existing and orthogonal to reading the pack column;
  fixing them here would expand scope into reprocessing semantics. Captured under
  "Known pre-existing limitations" for a follow-up task.
- **Semantic-token migration of the Package Definition box** folded in (Phase 2.5
  Frontend review) since we edit that box's copy anyway — correcting a CLAUDE.md
  color violation in the same PR rather than deepening it.
```
