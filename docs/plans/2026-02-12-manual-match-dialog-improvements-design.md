# Manual Match Dialog Improvements

**Date**: 2026-02-12
**Status**: Approved

## Problem

When linking an expense to a bank transaction via `ManualMatchDialog`, the transaction list filters out already-categorized transactions (`is_categorized = true`). This prevents users from linking older expenses to bank transactions that were auto-categorized or manually categorized but never linked to an expense.

Additionally, the dialog renders all transactions in a flat list without virtualization, which will degrade performance now that we're showing all transactions (not just uncategorized ones).

## Root Cause

- `ManualMatchDialog.tsx` line 39: `if (t.is_categorized || t.amount >= 0) return false;`
- The `is_categorized` flag was used as a proxy for "already handled," but categorization and expense-linking are separate concerns
- `usePendingOutflows.tsx` lines 177-180: `confirmMatch` only copies expense category to bank transaction if the bank transaction has no category, silently ignoring the user's manual categorization on the expense

## Changes

### 1. Remove `is_categorized` filter
**File**: `src/components/pending-outflows/ManualMatchDialog.tsx`

Change filter from `t.is_categorized || t.amount >= 0` to just `t.amount >= 0`. Show all debit transactions regardless of categorization status.

### 2. Add virtualization
**File**: `src/components/pending-outflows/ManualMatchDialog.tsx`

Apply the same performance pattern used in `BankTransactionList.tsx` and `POSSales.tsx`:
- `useVirtualizer` from `@tanstack/react-virtual` with `estimateSize: () => 72`
- Extract transaction row into `MemoizedMatchRow` with `React.memo` + custom comparison
- Pre-compute display values (formattedAmount, formattedDate, merchantName) in a `useMemo` Map
- Wrap `setSelectedTransactionId` in `useCallback`
- Replace `ScrollArea` with fixed-height `div` + `overflow-auto`

### 3. Add "Categorized" badge
**File**: `src/components/pending-outflows/ManualMatchDialog.tsx`

Show a small `text-[11px] bg-muted rounded-md px-1.5 py-0.5` badge on already-categorized transactions for visual context.

### 4. Update empty state text
**File**: `src/components/pending-outflows/ManualMatchDialog.tsx`

Change "No uncategorized transactions found" to "No transactions found".

### 5. Expense category wins on match
**File**: `src/hooks/usePendingOutflows.tsx`

In `confirmMatch` mutation (lines 177-186), remove the `!bankTransaction.category_id` guard so the expense's category always overrides the bank transaction's category when linking.

## Files Modified

| File | Change |
|------|--------|
| `src/components/pending-outflows/ManualMatchDialog.tsx` | Changes 1-4 |
| `src/hooks/usePendingOutflows.tsx` | Change 5 |

## What Stays the Same

- `amount >= 0` filter (only show debits)
- 1000-transaction limit in `useBankTransactionsWithRelations` query
- Search functionality (payee, description, date, amount)
- `confirmMatch` mutation behavior (link, mark cleared, merge notes, copy invoice)
- Dialog layout and actions footer
