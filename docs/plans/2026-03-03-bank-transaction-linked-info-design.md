# Bank Transaction Linked Info Display

**Date:** 2026-03-03
**Status:** Approved

## Problem

Bank transactions often show cryptic descriptions like "Check #5" while the linked expense or pending outflow has rich context: "Check 5, paid to Brand LLC for accounting services." Accounting and managers reviewing transactions can't quickly understand what each transaction is for without clicking into the detail view.

## Solution

Show an inline subtitle row on bank transaction rows that have a linked expense invoice or pending outflow. The subtitle displays the vendor name and notes/memo from the linked record, with a small badge indicating the payment type (Check, Invoice, ACH).

## Data Model

No new tables or migrations. Extend the existing Supabase query with two lightweight joins:

1. `pending_outflows` via reverse FK `linked_bank_transaction_id` — fields: `vendor_name`, `notes`, `reference_number`, `payment_method`, `status`
2. `expense_invoice_uploads` via FK `expense_invoice_upload_id` — fields: `vendor_name`, `invoice_number`

Add `expense_invoice_upload_id` to the SELECT column list (already exists on table, currently excluded from list query).

## UI Design

### Desktop Row (MemoizedTransactionRow)

When a transaction has `linked_outflow` or `expense_invoice_upload`:

```
┌──────────────────────────────────────────────────────────────┐
│ 03/01  Check #5                              -$1,200.00     │
│        [Check #5] Brand LLC — Accounting svcs  ✓ Matched    │
│        Payee  │  Acct  │  Category  │  Actions              │
└──────────────────────────────────────────────────────────────┘
```

- **Badge:** Payment type indicator — `[Check #N]`, `[Invoice]`, `[ACH]`
- **Vendor:** From `linked_outflow.vendor_name` or `expense_invoice_upload.vendor_name`
- **Notes:** From `linked_outflow.notes` (truncated if long)
- **Styling:** `text-[13px] text-muted-foreground` for visual hierarchy
- **Icons:** `FileText` (invoice), `Hash` (check), `ArrowRightLeft` (ACH)

### Mobile Card (TransactionCard)

Same subtitle treatment below the description text.

### Visibility

Subtitle only appears for transactions with linked records. Unmatched transactions keep their current single-line display.

### Performance

- Pre-compute `linkedInfo` string in `displayValuesMap` (keeps memo row pure)
- Virtualizer uses `measureElement` so dynamic row heights work automatically
- Join data is null for unlinked transactions — negligible payload increase

## Files to Modify

1. `src/hooks/useBankTransactions.tsx` — Add joins, update interface
2. `src/components/banking/BankTransactionList.tsx` — Add `linkedInfo` to displayValuesMap
3. `src/components/banking/MemoizedTransactionRow.tsx` — Render subtitle row
4. `src/components/banking/TransactionCard.tsx` — Render subtitle on mobile
5. `tests/unit/` — Unit tests for display value computation
