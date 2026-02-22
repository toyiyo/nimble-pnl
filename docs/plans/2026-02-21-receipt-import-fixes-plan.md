# Receipt Import Fixes Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Fix two customer-reported bugs: (1) make the purchase date editable after import with cascade to inventory transactions, and (2) track/display the total of only imported items instead of the full receipt total.

**Architecture:** Add an `imported_total` column to `receipt_imports` that stores the sum of imported item prices at import time. Modify the date change handler to cascade updates to `inventory_transactions` for already-imported receipts. Remove the UI guard that hides the date picker after import.

**Tech Stack:** PostgreSQL migration, React/TypeScript (hooks + components), Vitest

---

### Task 1: Database Migration — Add `imported_total` Column

**Files:**
- Create: `supabase/migrations/YYYYMMDDHHMMSS_add_imported_total_to_receipt_imports.sql`

**Step 1: Write the migration**

```sql
-- Add imported_total column to track sum of actually imported items
-- Separate from total_amount which stores the AI-extracted receipt total
ALTER TABLE public.receipt_imports
ADD COLUMN imported_total NUMERIC(10,2) DEFAULT NULL;

-- Add comment for documentation
COMMENT ON COLUMN public.receipt_imports.imported_total IS 'Sum of parsed_price for imported items (mapped/new_item). NULL until import is finalized. Distinct from total_amount which is the AI-extracted receipt total.';
```

**Step 2: Apply the migration**

Use the Supabase MCP tool `apply_migration` with name `add_imported_total_to_receipt_imports`.

**Step 3: Commit**

```bash
git add supabase/migrations/*_add_imported_total_to_receipt_imports.sql
git commit -m "feat: add imported_total column to receipt_imports"
```

---

### Task 2: Update `ReceiptImport` TypeScript Interface

**Files:**
- Modify: `src/hooks/useReceiptImport.tsx` (lines 27-43, the `ReceiptImport` interface)

**Step 1: Add `imported_total` to the interface**

In `src/hooks/useReceiptImport.tsx`, find the `ReceiptImport` interface (line 27) and add the new field after `total_amount`:

```typescript
export interface ReceiptImport {
  id: string;
  restaurant_id: string;
  vendor_name: string | null;
  supplier_id: string | null;
  raw_file_url: string | null;
  file_name: string | null;
  file_size: number | null;
  processed_at: string | null;
  status: string;
  total_amount: number | null;
  imported_total: number | null;  // <-- ADD THIS LINE
  raw_ocr_data: any;
  created_at: string;
  updated_at: string;
  processed_by: string | null;
  purchase_date: string | null;
}
```

**Step 2: Commit**

```bash
git add src/hooks/useReceiptImport.tsx
git commit -m "feat: add imported_total to ReceiptImport interface"
```

---

### Task 3: Write Tests for Imported Total Calculation

**Files:**
- Create: `tests/unit/receiptImportedTotal.test.ts`

**Step 1: Write the failing tests**

```typescript
import { describe, it, expect } from 'vitest';

/**
 * Tests for imported_total calculation logic.
 *
 * The imported total should sum parsed_price only for items
 * with mapping_status 'mapped' or 'new_item' — NOT 'skipped' or 'pending'.
 */

// Extract the calculation logic so it can be tested independently
export const calculateImportedTotal = (
  lineItems: Array<{ mapping_status: string; parsed_price: number | null }>
): number => {
  return lineItems
    .filter(item => item.mapping_status === 'mapped' || item.mapping_status === 'new_item')
    .reduce((sum, item) => sum + (item.parsed_price || 0), 0);
};

describe('Imported Total Calculation', () => {
  it('should sum parsed_price for mapped and new_item statuses only', () => {
    const lineItems = [
      { mapping_status: 'mapped', parsed_price: 25.50 },
      { mapping_status: 'new_item', parsed_price: 10.00 },
      { mapping_status: 'skipped', parsed_price: 15.00 },
      { mapping_status: 'pending', parsed_price: 5.00 },
    ];

    const total = calculateImportedTotal(lineItems);
    expect(total).toBe(35.50);
  });

  it('should return 0 when no items are mapped or new_item', () => {
    const lineItems = [
      { mapping_status: 'skipped', parsed_price: 15.00 },
      { mapping_status: 'pending', parsed_price: 5.00 },
    ];

    const total = calculateImportedTotal(lineItems);
    expect(total).toBe(0);
  });

  it('should handle null parsed_price as 0', () => {
    const lineItems = [
      { mapping_status: 'mapped', parsed_price: null },
      { mapping_status: 'mapped', parsed_price: 20.00 },
    ];

    const total = calculateImportedTotal(lineItems);
    expect(total).toBe(20.00);
  });

  it('should handle empty array', () => {
    const total = calculateImportedTotal([]);
    expect(total).toBe(0);
  });

  it('should sum all items when all are mapped', () => {
    const lineItems = [
      { mapping_status: 'mapped', parsed_price: 10.00 },
      { mapping_status: 'mapped', parsed_price: 20.00 },
      { mapping_status: 'mapped', parsed_price: 30.00 },
    ];

    const total = calculateImportedTotal(lineItems);
    expect(total).toBe(60.00);
  });
});
```

**Step 2: Run the tests to verify they pass**

```bash
npm run test -- tests/unit/receiptImportedTotal.test.ts
```

Expected: All 5 tests PASS (the calculation logic is defined in the test file itself).

**Step 3: Commit**

```bash
git add tests/unit/receiptImportedTotal.test.ts
git commit -m "test: add imported total calculation tests"
```

---

### Task 4: Calculate and Store `imported_total` During Bulk Import

**Files:**
- Modify: `src/hooks/useReceiptImport.tsx` — the `bulkImportLineItems` function (lines 523-826)

**Step 1: Add imported_total calculation to the import finalization**

In `src/hooks/useReceiptImport.tsx`, find the section at line 804-809 where the receipt is marked as imported:

```typescript
      // Mark receipt as imported
      await supabase
        .from('receipt_imports')
        .update({ status: 'imported' })
        .eq('id', receiptId);
```

Replace it with:

```typescript
      // Calculate imported total from successfully imported items
      const importedTotal = lineItems
        .filter(item =>
          (item.mapping_status === 'mapped' && item.matched_product_id) ||
          item.mapping_status === 'new_item'
        )
        .reduce((sum, item) => sum + (item.parsed_price || 0), 0);

      // Mark receipt as imported with calculated total
      await supabase
        .from('receipt_imports')
        .update({
          status: 'imported',
          imported_total: importedTotal
        })
        .eq('id', receiptId);
```

**Step 2: Run existing tests to verify nothing breaks**

```bash
npm run test -- tests/unit/receiptImportedTotal.test.ts tests/unit/receiptDuplicateItems.test.ts
```

Expected: All tests PASS.

**Step 3: Commit**

```bash
git add src/hooks/useReceiptImport.tsx
git commit -m "feat: calculate and store imported_total during bulk import"
```

---

### Task 5: Write Tests for Date Cascade Logic

**Files:**
- Create: `tests/unit/receiptDateCascade.test.ts`

**Step 1: Write the failing tests**

```typescript
import { describe, it, expect } from 'vitest';

/**
 * Tests for date cascade reference_id matching logic.
 *
 * When a user changes the purchase date on an already-imported receipt,
 * we need to find all inventory_transactions linked to that receipt
 * via the reference_id pattern: receipt_{receiptId}_{itemId}
 */

// The pattern used to find inventory transactions for a given receipt
export const buildReceiptReferencePattern = (receiptId: string): string => {
  return `receipt_${receiptId}_%`;
};

// Checks if a reference_id matches the pattern for a given receipt
export const matchesReceiptReference = (referenceId: string, receiptId: string): boolean => {
  return referenceId.startsWith(`receipt_${receiptId}_`);
};

describe('Receipt Date Cascade - Reference ID Matching', () => {
  const receiptId = 'abc-123-def';

  it('should build correct LIKE pattern for receipt reference', () => {
    const pattern = buildReceiptReferencePattern(receiptId);
    expect(pattern).toBe('receipt_abc-123-def_%');
  });

  it('should match reference_ids belonging to the receipt', () => {
    expect(matchesReceiptReference('receipt_abc-123-def_item1', receiptId)).toBe(true);
    expect(matchesReceiptReference('receipt_abc-123-def_item2', receiptId)).toBe(true);
  });

  it('should NOT match reference_ids from other receipts', () => {
    expect(matchesReceiptReference('receipt_xyz-789_item1', receiptId)).toBe(false);
  });

  it('should NOT match non-receipt reference_ids', () => {
    expect(matchesReceiptReference('manual_adjustment_123', receiptId)).toBe(false);
    expect(matchesReceiptReference('', receiptId)).toBe(false);
  });
});
```

**Step 2: Run the tests to verify they pass**

```bash
npm run test -- tests/unit/receiptDateCascade.test.ts
```

Expected: All 4 tests PASS.

**Step 3: Commit**

```bash
git add tests/unit/receiptDateCascade.test.ts
git commit -m "test: add date cascade reference_id matching tests"
```

---

### Task 6: Add Date Cascade to `handlePurchaseDateChange`

**Files:**
- Modify: `src/components/ReceiptMappingReview.tsx` — `handlePurchaseDateChange` function (lines 401-421)

**Step 1: Update the handler to cascade date changes for imported receipts**

Find the `handlePurchaseDateChange` function at line 401 in `src/components/ReceiptMappingReview.tsx`. Replace the entire function with:

```typescript
  const handlePurchaseDateChange = async (date: Date | undefined) => {
    if (!date) return;

    try {
      const { supabase } = await import('@/integrations/supabase/client');
      const dateString = format(date, 'yyyy-MM-dd');

      const { error } = await supabase
        .from('receipt_imports')
        .update({ purchase_date: dateString })
        .eq('id', receiptId);

      if (error) throw error;

      // If already imported, cascade date change to inventory transactions
      if (isImported) {
        const { error: txError } = await supabase
          .from('inventory_transactions')
          .update({ transaction_date: dateString })
          .like('reference_id', `receipt_${receiptId}_%`);

        if (txError) {
          console.error('Error cascading date to transactions:', txError);
          toast({
            title: "Partial Update",
            description: `Purchase date updated, but failed to update inventory transaction dates.`,
            variant: "destructive"
          });
        } else {
          toast({
            title: "Purchase Date Updated",
            description: `Set to ${format(date, 'PPP')}. Inventory transaction dates also updated.`
          });
        }
      } else {
        toast({ title: "Purchase Date Updated", description: `Set to ${format(date, 'PPP')}` });
      }

      setReceiptDetails(prev => prev ? { ...prev, purchase_date: dateString } : null);
    } catch (error) {
      console.error('Error updating purchase date:', error);
      toast({ title: "Error", description: "Failed to update purchase date", variant: "destructive" });
    }
  };
```

**Step 2: Run linting to check for issues**

```bash
npm run lint -- --no-error-on-unmatched-pattern src/components/ReceiptMappingReview.tsx
```

**Step 3: Commit**

```bash
git add src/components/ReceiptMappingReview.tsx
git commit -m "feat: cascade date changes to inventory transactions for imported receipts"
```

---

### Task 7: Make Date Editable After Import (UI Change)

**Files:**
- Modify: `src/components/ReceiptMappingReview.tsx` — lines 508-556 (vendor/date section)

**Step 1: Replace the `!isImported` guard with always-visible section**

Find lines 508-556 in `src/components/ReceiptMappingReview.tsx`. The current code is:

```tsx
          {/* Vendor & Date Section */}
          {!isImported && (
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 p-4 bg-muted/30 rounded-lg">
              <div className="space-y-2">
                <label className="text-sm font-medium text-muted-foreground">Vendor</label>
                <SearchableSupplierSelector
                  ...
                />
              </div>
              <div className="space-y-2">
                ...date picker...
              </div>
            </div>
          )}
```

Replace the entire block (lines 509-556) with:

```tsx
          {/* Vendor & Date Section */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 p-4 bg-muted/30 rounded-lg">
            <div className="space-y-2">
              <label className="text-sm font-medium text-muted-foreground">Vendor</label>
              {isImported ? (
                <div className="h-10 flex items-center px-3 text-[14px] bg-muted/30 border border-border/40 rounded-lg text-muted-foreground">
                  {receiptDetails?.vendor_name || 'Unknown vendor'}
                </div>
              ) : (
                <SearchableSupplierSelector
                  value={selectedSupplierId || undefined}
                  onValueChange={handleSupplierChange}
                  suppliers={suppliers}
                  placeholder="Select or create supplier..."
                  showNewIndicator={isNewSupplier}
                />
              )}
            </div>
            <div className="space-y-2">
              <label className="text-sm font-medium text-muted-foreground flex items-center gap-1">
                <CalendarIcon className="h-3.5 w-3.5" />
                Purchase Date
              </label>
              <Popover>
                <PopoverTrigger asChild>
                  <Button
                    variant="outline"
                    className={cn(
                      "w-full justify-start text-left font-normal",
                      !receiptDetails?.purchase_date && "text-muted-foreground"
                    )}
                  >
                    {receiptDetails?.purchase_date
                      ? format(new Date(receiptDetails.purchase_date), 'PPP')
                      : 'Pick a date'}
                    {receiptDetails?.purchase_date && (
                      <CheckCircle className="ml-auto h-4 w-4 text-green-600" />
                    )}
                  </Button>
                </PopoverTrigger>
                <PopoverContent className="w-auto p-0" align="start">
                  <Calendar
                    mode="single"
                    selected={receiptDetails?.purchase_date ? new Date(receiptDetails.purchase_date) : undefined}
                    onSelect={handlePurchaseDateChange}
                    disabled={(date) => date > new Date() || date < new Date("2000-01-01")}
                    initialFocus
                  />
                </PopoverContent>
              </Popover>
            </div>
          </div>
```

Key changes:
- Removed the `{!isImported && (` guard — section is always visible
- Vendor shows as read-only text when imported, editable `SearchableSupplierSelector` otherwise
- Date picker is always editable

**Step 2: Run linting**

```bash
npm run lint -- --no-error-on-unmatched-pattern src/components/ReceiptMappingReview.tsx
```

**Step 3: Commit**

```bash
git add src/components/ReceiptMappingReview.tsx
git commit -m "feat: show vendor/date section for imported receipts (date editable, vendor read-only)"
```

---

### Task 8: Display `imported_total` in Receipt History List

**Files:**
- Modify: `src/pages/ReceiptImport.tsx` — lines 155-157 (total display in history list)

**Step 1: Update the total display logic**

In `src/pages/ReceiptImport.tsx`, find lines 155-157:

```tsx
                            {receipt.total_amount && (
                              <div className="text-sm font-medium">Total: {formatCurrency(receipt.total_amount)}</div>
                            )}
```

Replace with:

```tsx
                            {(receipt.imported_total || receipt.total_amount) && (
                              <div className="text-sm">
                                <span className="font-medium">
                                  {formatCurrency(receipt.imported_total ?? receipt.total_amount)}
                                </span>
                                {receipt.imported_total != null && receipt.total_amount != null &&
                                 receipt.imported_total !== receipt.total_amount && (
                                  <span className="text-muted-foreground ml-1.5 text-xs">
                                    (Receipt total: {formatCurrency(receipt.total_amount)})
                                  </span>
                                )}
                              </div>
                            )}
```

Logic:
- If `imported_total` exists, show it as the primary amount
- If `imported_total` differs from `total_amount`, show receipt total as secondary text
- If only `total_amount` exists (pre-import), show that

**Step 2: The `ReceiptImport` type is currently imported with `select('*')` at line 289-292 of `useReceiptImport.tsx`, so the `imported_total` field will be included automatically.**

However, `receipt.imported_total` will cause a TypeScript error since we need to ensure the type has this field. We already added it in Task 2, so this should work.

**Step 3: Run linting**

```bash
npm run lint -- --no-error-on-unmatched-pattern src/pages/ReceiptImport.tsx
```

**Step 4: Commit**

```bash
git add src/pages/ReceiptImport.tsx
git commit -m "feat: display imported_total in receipt history with receipt total as secondary"
```

---

### Task 9: Run All Tests and Verify Build

**Files:** None (verification only)

**Step 1: Run all unit tests**

```bash
npm run test
```

Expected: All tests pass, including the new `receiptImportedTotal.test.ts` and `receiptDateCascade.test.ts`.

**Step 2: Run the build**

```bash
npm run build
```

Expected: Build succeeds with no TypeScript errors from our changes.

**Step 3: Verify no regressions**

Check that the existing receipt import tests still pass:

```bash
npm run test -- tests/unit/receipt
```

Expected: All receipt-related tests pass.

---

### Task 10: Final Commit and Cleanup

**Step 1: Review all changes**

```bash
git log --oneline -10
git diff main --stat
```

**Step 2: Verify the full change set looks correct**

Files changed should be:
- `supabase/migrations/*_add_imported_total_to_receipt_imports.sql` (new)
- `src/hooks/useReceiptImport.tsx` (interface + import logic)
- `src/components/ReceiptMappingReview.tsx` (date cascade + UI guard removal)
- `src/pages/ReceiptImport.tsx` (history total display)
- `tests/unit/receiptImportedTotal.test.ts` (new)
- `tests/unit/receiptDateCascade.test.ts` (new)
- `docs/plans/2026-02-21-receipt-import-fixes-design.md` (new)
- `docs/plans/2026-02-21-receipt-import-fixes-plan.md` (new)
