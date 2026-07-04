# Invoice Pack-Quantity Importer Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the invoice importer read the distributor "pack" column (inner units per case) so imported stock is `Ordered × Pack` in the inner unit, with per-inner-unit size and cost — without changing the recipe-costing engine.

**Architecture:** Extraction-only fix. The AI extracts `casesOrdered` and `unitsPerPack`; `parsedQuantity = casesOrdered × unitsPerPack`; `packageType` = the inner unit; `size_value`/`size_unit` keep their per-single-unit meaning. Deterministic math lives in tested pure helpers. A new nullable `receipt_line_items.pack_quantity` column stores the pack for audit/UI. `products.package_qty` is deliberately NOT written (it multiplies `size_value` in `calculate_recipe_cost`).

**Tech Stack:** Supabase Postgres migration + pgTAP, Deno edge function (`process-receipt`), React/TS hook (`useReceiptImport`), Vitest, shadcn/Tailwind UI (`ReceiptItemRow`).

**Spec:** `docs/superpowers/specs/2026-07-02-invoice-pack-quantity-design.md`

---

## File Structure

- **Create:** `supabase/migrations/20260702120000_add_pack_quantity_to_receipt_line_items.sql` — adds nullable `pack_quantity INTEGER`.
- **Create:** `supabase/tests/48_receipt_pack_quantity.sql` — pgTAP column + round-trip tests.
- **Modify:** `src/utils/receiptImportUtils.ts` — add `parsePackSizeToken`, `computeImportedQuantity`.
- **Modify:** `tests/unit/receiptImportUtils.test.ts` (create if absent) — helper tests.
- **Modify:** `supabase/functions/process-receipt/index.ts` — `ParsedLineItem` fields, prompt, insert mapping.
- **Modify:** `src/hooks/useReceiptImport.tsx` — `ReceiptLineItem` interface, import mapping (no `package_qty` write).
- **Modify:** `src/components/receipt/ReceiptItemRow.tsx` — pack summary line, package-definition copy, semantic tokens, a11y.
- **Modify:** `src/integrations/supabase/types.ts` and `src/types/supabase.ts` — add `pack_quantity` to `receipt_line_items` Row/Insert/Update.

---

## Task 1: Migration — add `pack_quantity` column

**Files:**
- Create: `supabase/migrations/20260702120000_add_pack_quantity_to_receipt_line_items.sql`

- [ ] **Step 1: Write the migration**

```sql
-- Add distributor "pack" (inner units per purchasing case) to receipt line items.
-- Audit/display metadata only. NOT the products.package_qty costing field.
-- Example (PFG item 87750): 1 case, pack 500 packets of .32 oz each → pack_quantity = 500.

ALTER TABLE receipt_line_items
ADD COLUMN IF NOT EXISTS pack_quantity INTEGER;

COMMENT ON COLUMN receipt_line_items.pack_quantity IS
  'Distributor pack: inner units per purchasing case (audit/display only). '
  'Distinct from products.package_qty, which drives calculate_recipe_cost.';
```

- [ ] **Step 2: Apply locally and verify**

Run: `npm run db:reset` (or `supabase db reset`)
Expected: reset completes; no error on the new migration.

Verify column exists:
Run: `psql "$DATABASE_URL" -c "\d receipt_line_items" | grep pack_quantity`
Expected: `pack_quantity | integer |` row printed.

- [ ] **Step 3: Commit**

```bash
git add supabase/migrations/20260702120000_add_pack_quantity_to_receipt_line_items.sql
git commit -m "feat(invoice): add pack_quantity column to receipt_line_items"
```

---

## Task 2: pgTAP test for `pack_quantity`

**Files:**
- Create: `supabase/tests/48_receipt_pack_quantity.sql`

- [ ] **Step 1: Write the failing test** (mirrors the fixture pattern in `09_receipt_package_size.sql`)

```sql
-- File: supabase/tests/48_receipt_pack_quantity.sql
-- Description: Tests for receipt_line_items.pack_quantity (distributor pack column)

BEGIN;
SELECT plan(5);

SET LOCAL role TO postgres;
SET LOCAL "request.jwt.claims" TO '{"sub": "00000000-0000-0000-0000-000000000000"}';

ALTER TABLE receipt_line_items DISABLE ROW LEVEL SECURITY;
ALTER TABLE receipt_imports DISABLE ROW LEVEL SECURITY;
ALTER TABLE restaurants DISABLE ROW LEVEL SECURITY;

-- Column contract
SELECT has_column('receipt_line_items', 'pack_quantity', 'pack_quantity column exists');
SELECT col_type_is('receipt_line_items', 'pack_quantity', 'integer', 'pack_quantity is integer');
SELECT col_is_null('receipt_line_items', 'pack_quantity', 'pack_quantity is nullable');

-- Fixtures
INSERT INTO restaurants (id, name, address, phone) VALUES
  ('00000000-0000-0000-0000-000000000971', 'Pack Qty Test Restaurant', '1 Test St', '555-0002')
ON CONFLICT (id) DO NOTHING;

INSERT INTO receipt_imports (id, restaurant_id, file_name, processed_by, status) VALUES
  ('00000000-0000-0000-0000-000000000972', '00000000-0000-0000-0000-000000000971', 'pfg.pdf', '00000000-0000-0000-0000-000000000000', 'processed')
ON CONFLICT (id) DO NOTHING;

-- Mustard row: pack 500
INSERT INTO receipt_line_items (id, receipt_id, raw_text, parsed_name, parsed_quantity, package_type, size_value, size_unit, pack_quantity, line_sequence)
VALUES ('00000000-0000-0000-0000-000000000973', '00000000-0000-0000-0000-000000000972',
        'GULDENS MUSTARD PACKET', 'Guldens Mustard Packet', 500, 'packet', 0.32, 'oz', 500, 1);

-- Retail row: no pack
INSERT INTO receipt_line_items (id, receipt_id, raw_text, parsed_name, parsed_quantity, package_type, size_value, size_unit, pack_quantity, line_sequence)
VALUES ('00000000-0000-0000-0000-000000000974', '00000000-0000-0000-0000-000000000972',
        'ROMA TOMATOES', 'Roma Tomatoes', 0.62, NULL, 0.62, 'lb', NULL, 2);

SELECT is(
  (SELECT pack_quantity FROM receipt_line_items WHERE id = '00000000-0000-0000-0000-000000000973'),
  500, 'pack_quantity round-trips as 500 for mustard');

SELECT is(
  (SELECT pack_quantity FROM receipt_line_items WHERE id = '00000000-0000-0000-0000-000000000974'),
  NULL::integer, 'pack_quantity is NULL for retail row');

SELECT * FROM finish();
ROLLBACK;
```

- [ ] **Step 2: Run the test**

Run: `npm run test:db`
Expected: `48_receipt_pack_quantity.sql` reports `ok 1..5`, all passing (column applied by Task 1 migration).

- [ ] **Step 3: Commit**

```bash
git add supabase/tests/48_receipt_pack_quantity.sql
git commit -m "test(invoice): pgTAP coverage for pack_quantity column"
```

---

## Task 3: Pure helpers — `parsePackSizeToken` + `computeImportedQuantity`

**Files:**
- Modify: `src/utils/receiptImportUtils.ts`
- Test: `tests/unit/receiptImportUtils.test.ts` (create if missing)

- [ ] **Step 1: Write the failing tests**

Create `tests/unit/receiptImportUtils.test.ts` (or append if it exists):

```typescript
import { describe, it, expect } from 'vitest';
import { parsePackSizeToken, computeImportedQuantity } from '@/utils/receiptImportUtils';

describe('computeImportedQuantity', () => {
  it('multiplies cases by pack (butter: 2 × 4 = 8)', () => {
    expect(computeImportedQuantity({ casesOrdered: 2, unitsPerPack: 4 })).toBe(8);
  });
  it('mustard 1 × 500 = 500', () => {
    expect(computeImportedQuantity({ casesOrdered: 1, unitsPerPack: 500 })).toBe(500);
  });
  it('defaults null/zero inputs to 1 (vodka: 1 × 1 = 1)', () => {
    expect(computeImportedQuantity({ casesOrdered: null, unitsPerPack: null })).toBe(1);
    expect(computeImportedQuantity({ casesOrdered: 0, unitsPerPack: 0 })).toBe(1);
  });
});

describe('parsePackSizeToken (Sygma pack/size tokens)', () => {
  it('parses "8/32 OZ" → pack 8, size 32 oz', () => {
    expect(parsePackSizeToken('8/32 OZ')).toEqual({ unitsPerPack: 8, sizeValue: 32, sizeUnit: 'oz' });
  });
  it('parses "1/20 LB" → pack 1, size 20 lb', () => {
    expect(parsePackSizeToken('1/20 LB')).toEqual({ unitsPerPack: 1, sizeValue: 20, sizeUnit: 'lb' });
  });
  it('parses decimal size "2/2.5GAL" → pack 2, size 2.5 gal (parseFloat, not parseInt)', () => {
    expect(parsePackSizeToken('2/2.5GAL')).toEqual({ unitsPerPack: 2, sizeValue: 2.5, sizeUnit: 'gal' });
  });
  it('treats a slash-less token "20 LB" as pack 1', () => {
    expect(parsePackSizeToken('20 LB')).toEqual({ unitsPerPack: 1, sizeValue: 20, sizeUnit: 'lb' });
  });
  it('returns null for an unparseable token', () => {
    expect(parsePackSizeToken('')).toBeNull();
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `npm run test -- receiptImportUtils`
Expected: FAIL — `parsePackSizeToken`/`computeImportedQuantity` not exported.

- [ ] **Step 3: Implement the helpers**

Append to `src/utils/receiptImportUtils.ts`:

```typescript
export interface ImportedQuantityInput {
  casesOrdered?: number | null;
  unitsPerPack?: number | null;
}

/**
 * Total inner units received = cases ordered × units per pack.
 * Both inputs default to 1 so a missing/zero value never zeroes the quantity.
 */
export function computeImportedQuantity({ casesOrdered, unitsPerPack }: ImportedQuantityInput): number {
  const cases = Math.max(1, casesOrdered || 0);
  const pack = Math.max(1, unitsPerPack || 0);
  return cases * pack;
}

export interface ParsedPackSize {
  unitsPerPack: number;
  sizeValue: number;
  sizeUnit: string;
}

/**
 * Parse a Sygma-style "pack/size unit" token, e.g. "8/32 OZ", "1/20 LB", "2/2.5GAL".
 * A token with no slash (e.g. "20 LB") is treated as pack = 1.
 * Returns null when no numeric size can be found.
 */
export function parsePackSizeToken(token: string): ParsedPackSize | null {
  if (!token) return null;
  const trimmed = token.trim();
  const hasSlash = trimmed.includes('/');
  const [packPart, sizePart] = hasSlash ? trimmed.split('/', 2) : ['1', trimmed];

  const unitsPerPack = hasSlash ? Math.max(1, parseInt(packPart, 10) || 1) : 1;

  // size like "2.5GAL" or "32 OZ" → number then unit (parseFloat keeps decimals)
  const sizeMatch = sizePart.trim().match(/^([\d.]+)\s*([a-zA-Z ]+)$/);
  if (!sizeMatch) return null;
  const sizeValue = parseFloat(sizeMatch[1]);
  if (Number.isNaN(sizeValue)) return null;
  const sizeUnit = sizeMatch[2].trim().toLowerCase();

  return { unitsPerPack, sizeValue, sizeUnit };
}
```

- [ ] **Step 4: Run to verify pass**

Run: `npm run test -- receiptImportUtils`
Expected: PASS (all helper tests green).

- [ ] **Step 5: Commit**

```bash
git add src/utils/receiptImportUtils.ts tests/unit/receiptImportUtils.test.ts
git commit -m "feat(invoice): pack/size token + imported-quantity helpers"
```

---

## Task 4: AI extraction — `ParsedLineItem`, prompt, and insert mapping

**Files:**
- Modify: `supabase/functions/process-receipt/index.ts:14-26` (interface), `:86-238` (prompt), `:912-925` (insert)

- [ ] **Step 1: Extend `ParsedLineItem`**

Replace the interface at lines 14-26:

```typescript
interface ParsedLineItem {
  rawText: string;
  parsedName: string;
  parsedQuantity: number;      // TOTAL inner units = casesOrdered × unitsPerPack
  parsedUnit: string;
  casesOrdered?: number;       // NEW: purchasing containers on the line (PFG "Ordered", Sygma "N CS")
  unitsPerPack?: number;       // NEW: inner units per case (PFG "Pack" column, Sygma numerator)
  packageType?: string;        // Inner/stocking unit (packet, can, bottle, bag)
  sizeValue?: number;          // Amount per SINGLE inner unit (.32, 5, 750)
  sizeUnit?: string;           // Measurement unit (oz, lb, ml)
  unitPrice?: number;          // Price per inner unit
  lineTotal?: number;          // Line extension total
  parsedPrice?: number;        // DEPRECATED
  confidenceScore: number;
}
```

- [ ] **Step 2: Update the prompt — pack section, examples, and JSON schema**

In `RECEIPT_ANALYSIS_PROMPT` (lines 86-238):

(a) After the "THREE-FIELD EXTRACTION SYSTEM" block, insert a distributor pack section:

```
**DISTRIBUTOR PACK/SIZE (PFG, Sygma, US Foods, Sysco):**
Wholesale invoices ship items in CASES that contain multiple inner units you stock and use.
- casesOrdered = the number of CASES ordered/shipped (PFG "Ordered"/"Shipped" column; Sygma leftmost "N CS").
- unitsPerPack = how many INNER units are inside ONE case (PFG "Pack" column; Sygma the number BEFORE the slash in a "pack/size" token like "8/32 OZ" → 8).
- parsedQuantity = casesOrdered × unitsPerPack  (TOTAL inner units received — this is what we stock).
- packageType = the INNER unit you stock and sell (packet, can, bottle, bag, jar) — NOT "case" or "box".
- sizeValue + sizeUnit = the size of ONE inner unit (PFG "Size" column; Sygma the part AFTER the slash, e.g. "32 OZ").
- unitPrice = lineTotal / parsedQuantity (price per inner unit).
Sygma "pack/size" examples: "1/20 LB" → pack 1, size 20 lb; "8/32 OZ" → pack 8, size 32 oz; "2/2.5GAL" → pack 2, size 2.5 gal.
```

(b) Replace Example 3 (the beer case, lines ~138-140) so it no longer discards the pack:

```
Example 3: "1 case 12x355ML BEER"  (PFG: Ordered 1, Pack 12, Size 355 ML)
→ casesOrdered=1, unitsPerPack=12, parsedQuantity=12, parsedUnit="each", packageType="can", sizeValue=355, sizeUnit="ml"
(1 case × 12 = 12 cans received; each can is 355 ml)
```

(c) Add three worked distributor examples after Example 8:

```
Example 9 (PFG mustard): Item 87750 "GULDENS MUSTARD PACKET"  Ordered 1, Pack 500, Size .32 OZ, Ext 29.96
→ casesOrdered=1, unitsPerPack=500, parsedQuantity=500, parsedUnit="each", packageType="packet", sizeValue=0.32, sizeUnit="oz", unitPrice=0.0599, lineTotal=29.96

Example 10 (PFG baking soda): "PACKER BAKING SODA"  Ordered 1, Pack 12, Size 2 LB, Ext 33.30
→ casesOrdered=1, unitsPerPack=12, parsedQuantity=12, parsedUnit="each", packageType="can", sizeValue=2, sizeUnit="lb", unitPrice=2.775, lineTotal=33.30

Example 11 (PFG butter): "WTZLPRTZ BUTTER CLARIFIED"  Ordered 2, Pack 4, Size 5 LB, Ext 152.40
→ casesOrdered=2, unitsPerPack=4, parsedQuantity=8, parsedUnit="each", packageType="can", sizeValue=5, sizeUnit="lb", unitPrice=19.05, lineTotal=152.40
```

(d) Add the two fields to the JSON schema line-item object (after `"parsedQuantity"`, lines ~225):

```
      "casesOrdered": numeric_cases_ordered,
      "unitsPerPack": numeric_inner_units_per_case,
```

(e) Add a fallback rule so non-distributor receipts are unchanged:

```
**IF NO CASE/PACK IS PRESENT (retail receipts, produce by weight):**
Set casesOrdered=parsedQuantity and unitsPerPack=1, so parsedQuantity is unchanged.
```

- [ ] **Step 3: Map `pack_quantity` in the DB insert**

In the `lineItems.map(...)` at lines 912-925, add one field:

```typescript
      pack_quantity: item.unitsPerPack ?? null,   // NEW: distributor pack (audit/UI)
```

- [ ] **Step 4: Typecheck the edge function**

Run: `npx deno check supabase/functions/process-receipt/index.ts` (if deno available) OR `npm run typecheck` for the repo.
Expected: no type errors on the changed interface/insert.

- [ ] **Step 5: Commit**

```bash
git add supabase/functions/process-receipt/index.ts
git commit -m "feat(invoice): extract pack/cases in process-receipt, quantity = cases × pack"
```

---

## Task 5: Frontend interface + import mapping

**Files:**
- Modify: `src/hooks/useReceiptImport.tsx:67-89` (interface), `:606-816` (bulk import), `:619-623` (select)
- Modify: `src/integrations/supabase/types.ts`, `src/types/supabase.ts` (generated types)

- [ ] **Step 1: Add `pack_quantity` to `ReceiptLineItem`**

In the interface at lines 67-89, after `size_unit` add:

```typescript
  pack_quantity: number | null;  // Distributor pack: inner units per case (audit/UI)
```

- [ ] **Step 2: Add `pack_quantity` to generated Supabase types**

In both `src/integrations/supabase/types.ts` and `src/types/supabase.ts`, in the `receipt_line_items` `Row`, `Insert`, and `Update` blocks, add:

```typescript
          pack_quantity: number | null
```
(for `Insert`/`Update`: `pack_quantity?: number | null`)

- [ ] **Step 3: Confirm import mapping needs no `package_qty` write**

In `bulkImportLineItems` new-product block (lines 793-816), verify `productData` does **NOT** set `package_qty` (it must not — see spec "What explicitly does NOT change"). `current_stock: item.parsed_quantity` and `cost_per_unit: unitPrice` already produce correct per-inner-unit values once `parsed_quantity` is the total. No code change unless a `package_qty` write exists (it does not today). Leave as-is.

- [ ] **Step 4: Typecheck**

Run: `npm run typecheck`
Expected: PASS — `pack_quantity` resolves on `ReceiptLineItem` and the generated Row type.

- [ ] **Step 5: Commit**

```bash
git add src/hooks/useReceiptImport.tsx src/integrations/supabase/types.ts src/types/supabase.ts
git commit -m "feat(invoice): surface pack_quantity on ReceiptLineItem + generated types"
```

---

## Task 6: Receipt review UI — pack summary line + package-definition copy

**Files:**
- Modify: `src/components/receipt/ReceiptItemRow.tsx:275-383`

- [ ] **Step 1: Add the read-only pack summary line under the Qty field**

Immediately after the `grid grid-cols-3` Qty/Price block (closes at line 312), insert:

```tsx
{item.pack_quantity && item.pack_quantity > 1 && (
  <p
    className="text-[13px] text-muted-foreground"
    aria-live="polite"
  >
    {Math.max(1, Math.round((item.parsed_quantity || 0) / item.pack_quantity))} {' '}
    {Math.max(1, Math.round((item.parsed_quantity || 0) / item.pack_quantity)) === 1 ? 'case' : 'cases'}
    {' × '}{item.pack_quantity} {' = '}
    {item.parsed_quantity} {pluralizeUnit(item.package_type || item.parsed_unit, item.parsed_quantity)}
  </p>
)}
```

Where `pluralizeUnit(unit, n)` is a tiny local helper (add near the top of the component file):

```tsx
const pluralizeUnit = (unit: string | null | undefined, n: number | null): string => {
  const u = unit || 'unit';
  return (n ?? 0) === 1 ? u : `${u}s`;
};
```

- [ ] **Step 2: Update the "Package Definition" box copy + migrate to semantic tokens**

Replace the green box block (lines 370-383) with a semantic-token version whose copy reflects the inner unit:

```tsx
{item.size_value && item.size_unit && (item.package_type || item.parsed_unit) && (
  <div className="p-3 bg-muted/30 border border-border/40 rounded-md">
    <div className="flex items-center gap-2 mb-1">
      <div className="w-5 h-5 bg-foreground rounded-full flex items-center justify-center">
        <span aria-hidden="true" className="text-background text-xs font-bold">✓</span>
      </div>
      <span className="text-[13px] font-semibold text-foreground">Your Package Definition:</span>
    </div>
    <div className="text-[14px] font-medium text-foreground pl-7">
      {item.pack_quantity && item.pack_quantity > 1 ? (
        <>
          {item.parsed_quantity} {pluralizeUnit(item.package_type || item.parsed_unit, item.parsed_quantity)},
          {' '}each containing{' '}
          <span className="bg-muted px-2 py-0.5 rounded">{item.size_value} {item.size_unit}</span>
        </>
      ) : (
        <>
          1 {item.package_type || item.parsed_unit || 'unit'} containing{' '}
          <span className="bg-muted px-2 py-0.5 rounded">{item.size_value} {item.size_unit}</span>
        </>
      )}
    </div>
  </div>
)}
```

- [ ] **Step 3: Typecheck + lint**

Run: `npm run typecheck && npm run lint`
Expected: PASS. No raw color classes remain in the edited block (grep check below).

Run: `grep -n "green-" src/components/receipt/ReceiptItemRow.tsx`
Expected: no matches in the Package Definition block (only pre-existing tier styles, if any, remain).

- [ ] **Step 4: Commit**

```bash
git add src/components/receipt/ReceiptItemRow.tsx
git commit -m "feat(invoice): show pack breakdown + inner-unit package definition in review UI"
```

---

## Task 7: Full verification pass

**Files:** none (verification only)

- [ ] **Step 1: Run the full local suite**

Run: `npm run typecheck && npm run lint && npm run test && npm run test:db && npm run build`
Expected: all green. If `test:db` requires a running DB, ensure `npm run db:start` first.

- [ ] **Step 2: Manual sanity (optional, if dev stack running)**

Import the PFG sample; confirm Gulden's shows Qty 500, "1 case × 500 = 500 packets", per-unit ≈ $0.06, and "500 packets, each containing 0.32 oz".

- [ ] **Step 3: Update progress.md and proceed to Phase 5+ of the dev workflow.**

---

## Self-Review Notes

- **Spec coverage:** migration (Task 1), pgTAP (Task 2), helpers+tests (Task 3), AI prompt+interface+insert (Task 4), frontend interface/types + no-package_qty guard (Task 5), UI summary+copy+semantic tokens+a11y (Task 6), verify (Task 7). Idempotency/stock-race explicitly out of scope per spec.
- **Type consistency:** `casesOrdered`/`unitsPerPack` (ParsedLineItem, camelCase in edge fn) → `pack_quantity` (snake_case DB/ReceiptLineItem). Helpers: `computeImportedQuantity`, `parsePackSizeToken`, `pluralizeUnit` used consistently.
- **No placeholders:** every code step shows full code.
