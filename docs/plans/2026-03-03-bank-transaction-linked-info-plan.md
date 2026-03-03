# Bank Transaction Linked Info Display — Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Show an inline subtitle row on bank transaction rows that have a linked expense invoice or pending outflow, displaying the vendor name, notes/memo, and a payment type badge.

**Architecture:** Extend the existing Supabase query with two lightweight joins (`pending_outflows` via reverse FK, `expense_invoice_uploads` via forward FK). Add `linkedInfo` to the pre-computed `displayValuesMap`. Render a subtitle line in both desktop (MemoizedTransactionRow) and mobile (BankTransactionCard) components.

**Tech Stack:** React, TypeScript, Supabase PostgREST joins, @tanstack/react-virtual, Vitest

---

## Tasks

### Task 1: Add linked data to BankTransaction interface and query

**Files:**
- Modify: `src/hooks/useBankTransactions.tsx:24-76` (interface)
- Modify: `src/hooks/useBankTransactions.tsx:98-136` (query)

**Step 1: Update BankTransaction interface**

Add the new linked data types to the interface. Add these fields after the `chart_account` field (line 58):

```typescript
  // Linked outflow data (pending_outflows via reverse FK)
  linked_outflows?: Array<{
    vendor_name: string;
    notes: string | null;
    reference_number: string | null;
    payment_method: string;
  }> | null;
  // Expense invoice data (expense_invoice_uploads via forward FK)
  expense_invoice_upload?: {
    vendor_name: string | null;
    invoice_number: string | null;
  } | null;
```

Note: Supabase reverse FK joins return arrays (one-to-many), so `linked_outflows` is an array. In practice a bank transaction usually has 0 or 1 linked outflow.

Also add `expense_invoice_upload_id` to the fetched fields list (move it from the "NOT fetched" comment section to the main interface).

**Step 2: Update buildBaseQuery to include joins**

In `buildBaseQuery` (line 98-136), add `expense_invoice_upload_id` to the column list and add two new joins:

```typescript
const buildBaseQuery = (restaurantId: string) =>
  supabase
    .from('bank_transactions')
    .select(`
      id,
      restaurant_id,
      connected_bank_id,
      transaction_date,
      posted_date,
      amount,
      description,
      merchant_name,
      normalized_payee,
      category_id,
      suggested_category_id,
      suggested_payee,
      supplier_id,
      expense_invoice_upload_id,
      status,
      is_categorized,
      is_reconciled,
      is_split,
      is_transfer,
      transfer_pair_id,
      excluded_reason,
      ai_confidence,
      ai_reasoning,
      notes,
      created_at,
      updated_at,
      connected_bank:connected_banks(
        id,
        institution_name
      ),
      chart_account:chart_of_accounts!category_id(
        id,
        account_name
      ),
      linked_outflows:pending_outflows!linked_bank_transaction_id(
        vendor_name,
        notes,
        reference_number,
        payment_method
      ),
      expense_invoice_upload:expense_invoice_uploads!expense_invoice_upload_id(
        vendor_name,
        invoice_number
      )
    `, { count: 'exact' })
    .eq('restaurant_id', restaurantId);
```

**Step 3: Update the "NOT fetched" comment**

Move `expense_invoice_upload_id` and `expense_invoice_upload` out of the "NOT fetched" comment since they are now fetched. Update the comment to only mention `supplier`, `raw_data`, etc.

**Step 4: Run build to verify no type errors**

Run: `npm run build 2>&1 | head -30`
Expected: No new type errors (existing errors may be present).

**Step 5: Commit**

```bash
git add src/hooks/useBankTransactions.tsx
git commit -m "feat(banking): add linked outflow and expense joins to bank transaction query"
```

---

### Task 2: Add linkedInfo to display values and helper function

**Files:**
- Create: `src/lib/bankTransactionLinkedInfo.ts`
- Test: `tests/unit/bankTransactionLinkedInfo.test.ts`

**Step 1: Write the failing tests**

Create `tests/unit/bankTransactionLinkedInfo.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import { computeLinkedInfo, type LinkedInfoResult } from '@/lib/bankTransactionLinkedInfo';

describe('computeLinkedInfo', () => {
  it('returns null when no linked data exists', () => {
    const result = computeLinkedInfo({
      linked_outflows: null,
      expense_invoice_upload: null,
      expense_invoice_upload_id: null,
    });
    expect(result).toBeNull();
  });

  it('returns null for empty linked_outflows array', () => {
    const result = computeLinkedInfo({
      linked_outflows: [],
      expense_invoice_upload: null,
      expense_invoice_upload_id: null,
    });
    expect(result).toBeNull();
  });

  it('returns check info from linked outflow with payment_method=check', () => {
    const result = computeLinkedInfo({
      linked_outflows: [{
        vendor_name: 'Brand LLC',
        notes: 'Accounting services',
        reference_number: '5',
        payment_method: 'check',
      }],
      expense_invoice_upload: null,
      expense_invoice_upload_id: null,
    });
    expect(result).toEqual({
      type: 'check',
      badge: 'Check #5',
      vendor: 'Brand LLC',
      detail: 'Accounting services',
    });
  });

  it('returns ACH info from linked outflow with payment_method=ach', () => {
    const result = computeLinkedInfo({
      linked_outflows: [{
        vendor_name: 'Sysco Foods',
        notes: 'Weekly delivery payment',
        reference_number: 'ACH-1234',
        payment_method: 'ach',
      }],
      expense_invoice_upload: null,
      expense_invoice_upload_id: null,
    });
    expect(result).toEqual({
      type: 'ach',
      badge: 'ACH',
      vendor: 'Sysco Foods',
      detail: 'Weekly delivery payment',
    });
  });

  it('returns other payment info from linked outflow with payment_method=other', () => {
    const result = computeLinkedInfo({
      linked_outflows: [{
        vendor_name: 'Office Depot',
        notes: 'Supplies',
        reference_number: null,
        payment_method: 'other',
      }],
      expense_invoice_upload: null,
      expense_invoice_upload_id: null,
    });
    expect(result).toEqual({
      type: 'other',
      badge: 'Payment',
      vendor: 'Office Depot',
      detail: 'Supplies',
    });
  });

  it('returns invoice info from expense_invoice_upload', () => {
    const result = computeLinkedInfo({
      linked_outflows: null,
      expense_invoice_upload: {
        vendor_name: 'ACME Corp',
        invoice_number: 'INV-2026-042',
      },
      expense_invoice_upload_id: 'some-uuid',
    });
    expect(result).toEqual({
      type: 'invoice',
      badge: 'Invoice',
      vendor: 'ACME Corp',
      detail: 'INV-2026-042',
    });
  });

  it('returns invoice info with null invoice_number', () => {
    const result = computeLinkedInfo({
      linked_outflows: null,
      expense_invoice_upload: {
        vendor_name: 'ACME Corp',
        invoice_number: null,
      },
      expense_invoice_upload_id: 'some-uuid',
    });
    expect(result).toEqual({
      type: 'invoice',
      badge: 'Invoice',
      vendor: 'ACME Corp',
      detail: null,
    });
  });

  it('prefers linked_outflow over expense_invoice_upload when both exist', () => {
    const result = computeLinkedInfo({
      linked_outflows: [{
        vendor_name: 'Brand LLC',
        notes: 'From outflow',
        reference_number: '10',
        payment_method: 'check',
      }],
      expense_invoice_upload: {
        vendor_name: 'Brand LLC',
        invoice_number: 'INV-001',
      },
      expense_invoice_upload_id: 'some-uuid',
    });
    expect(result?.type).toBe('check');
    expect(result?.detail).toBe('From outflow');
  });

  it('handles check with no reference_number', () => {
    const result = computeLinkedInfo({
      linked_outflows: [{
        vendor_name: 'Brand LLC',
        notes: null,
        reference_number: null,
        payment_method: 'check',
      }],
      expense_invoice_upload: null,
      expense_invoice_upload_id: null,
    });
    expect(result).toEqual({
      type: 'check',
      badge: 'Check',
      vendor: 'Brand LLC',
      detail: null,
    });
  });

  it('truncates long detail text to 80 chars', () => {
    const longNotes = 'A'.repeat(100);
    const result = computeLinkedInfo({
      linked_outflows: [{
        vendor_name: 'Brand LLC',
        notes: longNotes,
        reference_number: null,
        payment_method: 'check',
      }],
      expense_invoice_upload: null,
      expense_invoice_upload_id: null,
    });
    expect(result?.detail?.length).toBeLessThanOrEqual(83); // 80 + '...'
    expect(result?.detail?.endsWith('...')).toBe(true);
  });
});
```

**Step 2: Run test to verify it fails**

Run: `npx vitest run tests/unit/bankTransactionLinkedInfo.test.ts`
Expected: FAIL — module not found

**Step 3: Write minimal implementation**

Create `src/lib/bankTransactionLinkedInfo.ts`:

```typescript
export interface LinkedInfoInput {
  linked_outflows?: Array<{
    vendor_name: string;
    notes: string | null;
    reference_number: string | null;
    payment_method: string;
  }> | null;
  expense_invoice_upload?: {
    vendor_name: string | null;
    invoice_number: string | null;
  } | null;
  expense_invoice_upload_id?: string | null;
}

export interface LinkedInfoResult {
  type: 'check' | 'ach' | 'invoice' | 'other';
  badge: string;
  vendor: string | null;
  detail: string | null;
}

const MAX_DETAIL_LENGTH = 80;

function truncate(text: string | null): string | null {
  if (!text) return null;
  if (text.length <= MAX_DETAIL_LENGTH) return text;
  return text.slice(0, MAX_DETAIL_LENGTH) + '...';
}

export function computeLinkedInfo(input: LinkedInfoInput): LinkedInfoResult | null {
  const outflow = input.linked_outflows?.[0];

  if (outflow) {
    const method = outflow.payment_method;

    if (method === 'check') {
      return {
        type: 'check',
        badge: outflow.reference_number ? `Check #${outflow.reference_number}` : 'Check',
        vendor: outflow.vendor_name,
        detail: truncate(outflow.notes),
      };
    }

    if (method === 'ach') {
      return {
        type: 'ach',
        badge: 'ACH',
        vendor: outflow.vendor_name,
        detail: truncate(outflow.notes),
      };
    }

    return {
      type: 'other',
      badge: 'Payment',
      vendor: outflow.vendor_name,
      detail: truncate(outflow.notes),
    };
  }

  if (input.expense_invoice_upload_id && input.expense_invoice_upload) {
    return {
      type: 'invoice',
      badge: 'Invoice',
      vendor: input.expense_invoice_upload.vendor_name,
      detail: truncate(input.expense_invoice_upload.invoice_number),
    };
  }

  return null;
}
```

**Step 4: Run tests to verify they pass**

Run: `npx vitest run tests/unit/bankTransactionLinkedInfo.test.ts`
Expected: All 10 tests PASS

**Step 5: Commit**

```bash
git add src/lib/bankTransactionLinkedInfo.ts tests/unit/bankTransactionLinkedInfo.test.ts
git commit -m "feat(banking): add computeLinkedInfo utility with tests"
```

---

### Task 3: Integrate linkedInfo into displayValuesMap and MemoizedTransactionRow

**Files:**
- Modify: `src/components/banking/MemoizedTransactionRow.tsx:18-25` (interface)
- Modify: `src/components/banking/MemoizedTransactionRow.tsx:128-137` (description column)
- Modify: `src/components/banking/MemoizedTransactionRow.tsx:303-320` (memo comparison)
- Modify: `src/components/banking/BankTransactionList.tsx:4` (import)
- Modify: `src/components/banking/BankTransactionList.tsx:125-146` (displayValuesMap)

**Step 1: Update TransactionDisplayValues interface**

In `MemoizedTransactionRow.tsx`, add `linkedInfo` to the `TransactionDisplayValues` interface (after line 24):

```typescript
export interface TransactionDisplayValues {
  isNegative: boolean;
  formattedAmount: string;
  formattedDate: string;
  suggestedCategoryName?: string;
  currentCategoryName?: string;
  hasSuggestion: boolean;
  linkedInfo?: LinkedInfoResult | null;
}
```

Add import at top of file:

```typescript
import { LinkedInfoResult } from "@/lib/bankTransactionLinkedInfo";
```

**Step 2: Add subtitle rendering in the description column**

Replace the description column block (lines 128-137) with:

```typescript
      {/* Description column */}
      <div className={COLUMN_WIDTHS.description}>
        <div className="flex flex-col">
          <span className="font-medium truncate">{transaction.description}</span>
          {displayValues.linkedInfo && (
            <div className="flex items-center gap-1.5 mt-1 text-[13px] text-muted-foreground">
              <Badge
                variant="outline"
                className="text-[11px] px-1.5 py-0 h-5 font-medium bg-muted/50 border-border/60 shrink-0"
              >
                {displayValues.linkedInfo.type === 'invoice' && <FileText className="h-3 w-3 mr-1" />}
                {displayValues.linkedInfo.type === 'check' && <Hash className="h-3 w-3 mr-1" />}
                {displayValues.linkedInfo.type === 'ach' && <ArrowRightLeft className="h-3 w-3 mr-1" />}
                {displayValues.linkedInfo.type === 'other' && <FileText className="h-3 w-3 mr-1" />}
                {displayValues.linkedInfo.badge}
              </Badge>
              <span className="truncate">
                {[displayValues.linkedInfo.vendor, displayValues.linkedInfo.detail]
                  .filter(Boolean)
                  .join(' — ')}
              </span>
            </div>
          )}
          <TransactionBadges
            isTransfer={transaction.is_transfer}
            isSplit={transaction.is_split}
            className="mt-1"
          />
        </div>
      </div>
```

Add `Hash` and `ArrowRightLeft` to the lucide-react import at top of file:

```typescript
import { Check, Edit, Trash2, FileText, Split, CheckCircle2, MoreVertical, Sparkles, Settings2, Hash, ArrowRightLeft } from "lucide-react";
```

**Step 3: Update memo comparison**

The `displayValues` is already compared by reference (line 319), and since we're adding `linkedInfo` to the `displayValuesMap` computation (which creates new objects when data changes), no change is needed to the memo comparison. The existing `prevProps.displayValues === nextProps.displayValues` check covers it.

**Step 4: Add computeLinkedInfo to displayValuesMap in BankTransactionList**

In `BankTransactionList.tsx`, add import:

```typescript
import { computeLinkedInfo } from "@/lib/bankTransactionLinkedInfo";
```

Update the `displayValuesMap` computation (lines 132-144) to include `linkedInfo`:

```typescript
    for (const txn of transactions) {
      const suggestedCategory = accounts?.find(a => a.id === txn.suggested_category_id);
      const currentCategory = accounts?.find(a => a.id === txn.category_id);

      map.set(txn.id, {
        isNegative: txn.amount < 0,
        formattedAmount: currencyFormatter.format(Math.abs(txn.amount)),
        formattedDate: formatTransactionDate(txn.transaction_date, 'MMM dd, yyyy'),
        suggestedCategoryName: suggestedCategory?.account_name,
        currentCategoryName: currentCategory?.account_name,
        hasSuggestion: !txn.is_categorized && !!suggestedCategory,
        linkedInfo: computeLinkedInfo(txn),
      });
    }
```

**Step 5: Run build to verify no type errors**

Run: `npm run build 2>&1 | head -30`
Expected: No new type errors

**Step 6: Commit**

```bash
git add src/components/banking/MemoizedTransactionRow.tsx src/components/banking/BankTransactionList.tsx
git commit -m "feat(banking): display linked expense/check info as subtitle in transaction rows"
```

---

### Task 4: Add linked info to mobile BankTransactionCard

**Files:**
- Modify: `src/components/banking/BankTransactionCard.tsx:5` (import)
- Modify: `src/components/banking/BankTransactionCard.tsx:46-48` (after description)

**Step 1: Add imports**

Add to the lucide-react import:

```typescript
import { Check, Edit, Trash2, FileText, Split, CheckCircle2, Sparkles, Settings2, Hash, ArrowRightLeft } from "lucide-react";
```

Add the utility import:

```typescript
import { computeLinkedInfo } from "@/lib/bankTransactionLinkedInfo";
```

**Step 2: Compute linkedInfo and render subtitle**

After the description div (line 48) and before the closing `</div>` of the flex-1 container, add the linked info display. First compute it at the top of the component (after line 33):

```typescript
  const linkedInfo = computeLinkedInfo(transaction);
```

Then add the subtitle rendering after the description (after line 48, inside the `flex-1` div):

```typescript
              {linkedInfo && (
                <div className="flex items-center gap-1.5 mt-1 text-[13px] text-muted-foreground">
                  <Badge
                    variant="outline"
                    className="text-[11px] px-1.5 py-0 h-5 font-medium bg-muted/50 border-border/60 shrink-0"
                  >
                    {linkedInfo.type === 'invoice' && <FileText className="h-3 w-3 mr-1" />}
                    {linkedInfo.type === 'check' && <Hash className="h-3 w-3 mr-1" />}
                    {linkedInfo.type === 'ach' && <ArrowRightLeft className="h-3 w-3 mr-1" />}
                    {linkedInfo.type === 'other' && <FileText className="h-3 w-3 mr-1" />}
                    {linkedInfo.badge}
                  </Badge>
                  <span className="truncate">
                    {[linkedInfo.vendor, linkedInfo.detail]
                      .filter(Boolean)
                      .join(' — ')}
                  </span>
                </div>
              )}
```

**Step 3: Run build to verify**

Run: `npm run build 2>&1 | head -30`
Expected: No new type errors

**Step 4: Commit**

```bash
git add src/components/banking/BankTransactionCard.tsx
git commit -m "feat(banking): display linked info subtitle on mobile transaction cards"
```

---

### Task 5: Run full verification

**Step 1: Run unit tests**

Run: `npx vitest run`
Expected: All tests pass (including new bankTransactionLinkedInfo tests)

**Step 2: Run lint**

Run: `npm run lint 2>&1 | tail -5`
Expected: No new lint errors in our changed files

**Step 3: Run build**

Run: `npm run build`
Expected: Build succeeds

**Step 4: Final commit (if any fixes needed)**

If any fixes are needed from verification, commit them.

---

### Summary of files changed

| File | Action | Description |
|------|--------|-------------|
| `src/hooks/useBankTransactions.tsx` | Modify | Add joins + interface fields |
| `src/lib/bankTransactionLinkedInfo.ts` | Create | Pure utility: computeLinkedInfo |
| `tests/unit/bankTransactionLinkedInfo.test.ts` | Create | 10 tests for computeLinkedInfo |
| `src/components/banking/MemoizedTransactionRow.tsx` | Modify | Render subtitle row with badge |
| `src/components/banking/BankTransactionList.tsx` | Modify | Add linkedInfo to displayValuesMap |
| `src/components/banking/BankTransactionCard.tsx` | Modify | Render subtitle on mobile |
