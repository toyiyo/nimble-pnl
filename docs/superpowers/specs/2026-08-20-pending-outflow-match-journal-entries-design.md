# Design: create journal entries on pending-outflow match

Date: 2026-08-20
Branch: `claude/optimistic-austin-73bb6a`
Author: Claude (development-workflow)

## Problem

The pending-outflow match flow categorizes a bank transaction with a direct
table update. It never creates a journal entry. The income statement reads
only `journal_entry_lines`. A matched expense therefore shows $0.00 on the
income statement.

Production evidence (2026-08-19): 137 categorized transactions carry
`matched_at` and have no journal entry. The absolute total is $103,148.41.

The backfill for historical rows ships on the branch
`fix/bulk-categorize-journal-entries`. This task stops the continuing
producer only.

## Root cause (citations)

- `confirmMatch` builds a direct update with `is_categorized: true` and
  `matched_at` ([usePendingOutflows.tsx:172-175](../../../src/hooks/usePendingOutflows.tsx)).
- It copies `category_id` and `suggested_category_id` from the pending
  outflow ([usePendingOutflows.tsx:177-186](../../../src/hooks/usePendingOutflows.tsx)).
- It merges notes ([usePendingOutflows.tsx:188-194](../../../src/hooks/usePendingOutflows.tsx))
  and links the invoice upload
  ([usePendingOutflows.tsx:196-200](../../../src/hooks/usePendingOutflows.tsx)).
- It writes all of this straight to `bank_transactions`
  ([usePendingOutflows.tsx:202-208](../../../src/hooks/usePendingOutflows.tsx)).
  No code path creates a journal entry.
- The income statement reads only `journal_entry_lines`
  ([IncomeStatement.tsx:207-221](../../../src/components/financial-statements/IncomeStatement.tsx)).
- The authoritative categorize RPC `categorize_bank_transaction` creates the
  journal entry and the lines
  ([20260709120000_categorize_preserve_metadata_on_noop.sql:198-231](../../../supabase/migrations/20260709120000_categorize_preserve_metadata_on_noop.sql)),
  handles reclassification
  ([...sql:164-197](../../../supabase/migrations/20260709120000_categorize_preserve_metadata_on_noop.sql)),
  and rebuilds account balances
  ([...sql:246](../../../supabase/migrations/20260709120000_categorize_preserve_metadata_on_noop.sql)).

A second defect sits in the same block. `pending_outflows.category_id` is
nullable
([20251107141500_pending_outflows.sql:6](../../../supabase/migrations/20251107141500_pending_outflows.sql));
most historical rows have NULL
([20260522120100_pending_outflows_category_index.sql:10](../../../supabase/migrations/20260522120100_pending_outflows_category_index.sql)).
When the outflow has no category, `confirmMatch` still writes
`is_categorized: true` with no `category_id`
([usePendingOutflows.tsx:172-180](../../../src/hooks/usePendingOutflows.tsx)).
The review queue filters on `is_categorized = false`
([useBankTransactions.tsx:165-168](../../../src/hooks/useBankTransactions.tsx)),
so that transaction leaves the queue and can never reach the income
statement.

## Approaches considered

### A. Call the RPC from the hook; keep a slim metadata update (chosen)

Replace the direct category write with a `categorize_bank_transaction` RPC
call. Keep only the match-metadata fields in the direct update. This is the
approach the task prescribes. The frontend already calls this RPC the same
way in `useCategorizeTransaction`
([useBankTransactions.tsx:424-430](../../../src/hooks/useBankTransactions.tsx)).

- Pro: no migration. The RPC is authoritative and tested.
- Pro: reclassification, closed-period, and reconciled guards come free.
- Con: the flow spans three client calls. It is not atomic. See
  "Decided trade-offs".

### B. New server RPC `confirm_pending_outflow_match`

One SECURITY DEFINER function does the categorize, the metadata write, and
the outflow update in one transaction.

- Pro: atomic.
- Con: new migration, new pgTAP surface, duplicated categorize logic or a
  nested call. Larger scope than the task asks for.

### C. Append an RPC call after the existing direct update

- Con: double-writes `category_id`. The direct update marks the transaction
  categorized before the RPC guards run, so the RPC would treat the write as
  a reclassification of the very same category and short-circuit without a
  journal entry
  ([...sql:89-113](../../../supabase/migrations/20260709120000_categorize_preserve_metadata_on_noop.sql)).
  This approach cannot work. Rejected.

Decision: **A**.

## Design

### `confirmMatch` flow (new order)

1. Fetch the pending outflow with invoice uploads (unchanged,
   [usePendingOutflows.tsx:142-159](../../../src/hooks/usePendingOutflows.tsx)).
2. Fetch the bank transaction `notes` (unchanged shape,
   [usePendingOutflows.tsx:161-169](../../../src/hooks/usePendingOutflows.tsx)).
3. **If the outflow has a `category_id`:** call the RPC first:
   ```ts
   supabase.rpc('categorize_bank_transaction', {
     p_transaction_id: bankTransactionId,
     p_category_id: pendingOutflow.category_id,
     p_description: null,
     p_normalized_payee: null,
     p_supplier_id: null,
   })
   ```
   On error, throw. Nothing else has changed yet.
4. Direct update to `bank_transactions` with **metadata only**:
   `matched_at`, `suggested_category_id` (only when the outflow has a
   category), merged `notes` (only when non-empty), and
   `expense_invoice_upload_id` (only when an upload exists).
   No `is_categorized`. No `category_id`.
5. Update the pending outflow: `status: 'cleared'`,
   `linked_bank_transaction_id`, `cleared_at` (unchanged,
   [usePendingOutflows.tsx:210-220](../../../src/hooks/usePendingOutflows.tsx)).

### Why the RPC runs first

The RPC carries the guards: reconciled transactions
([...sql:115-118](../../../supabase/migrations/20260709120000_categorize_preserve_metadata_on_noop.sql))
and closed fiscal periods
([...sql:131-142](../../../supabase/migrations/20260709120000_categorize_preserve_metadata_on_noop.sql)).
When a guard fires, the mutation throws before any write. The match stays
fully pending. The user sees one clear error.

### Retry safety

If step 4 or 5 fails after the RPC commits, the transaction is categorized
with a correct journal entry, and the outflow stays pending. A retry calls
the RPC again with the same category. The RPC short-circuits as a no-op and
preserves metadata
([...sql:89-113](../../../supabase/migrations/20260709120000_categorize_preserve_metadata_on_noop.sql)).
Steps 4 and 5 then complete the match. The flow is safe to re-run.

### Notes handling

The RPC main path writes `notes = p_description` without COALESCE
([...sql:239](../../../supabase/migrations/20260709120000_categorize_preserve_metadata_on_noop.sql)).
The hook passes `p_description: null`, so the RPC clears `notes` for one
step. Step 4 writes the merged notes back in the same mutation. The hook
reads the pre-RPC `notes` in step 2, so no data is lost. When both notes are
empty, the merged value is empty and step 4 skips the field; the cleared
NULL equals the prior NULL.

### No-category path (behavior change)

When the outflow has no `category_id`, skip the RPC and do **not** set
`is_categorized`, `category_id`, or `suggested_category_id`. Write only
`matched_at`, merged notes, and the invoice link, then clear the outflow.
The transaction stays in the review queue for real categorization later.
The old behavior (categorized with no category) produced permanent
journal-less rows.

### UI error handling

- `confirmMatch.onError` maps the two RPC guard errors to clear copy:
  - message contains `reconciled` → "This transaction is reconciled.
    Reclassify it from the Banking page instead."
  - message contains `closed fiscal period` → "This transaction is in a
    closed fiscal period. Reopen the period before you match it."
  - any other error keeps the current
    `Failed to confirm match: ${error.message}` form
    ([usePendingOutflows.tsx:230-232](../../../src/hooks/usePendingOutflows.tsx)).
- `ManualMatchDialog.handleConfirm` awaits `mutateAsync` and then calls
  `onClose()` with no try/catch
  ([ManualMatchDialog.tsx:180-189](../../../src/components/pending-outflows/ManualMatchDialog.tsx)).
  A rejection leaves an unhandled promise and still closes nothing. Wrap the
  await in try/catch: on error, keep the dialog open and return. The
  mutation's `onError` toast already shows the message.

### Query invalidation

The match now moves ledger data. Extend `confirmMatch.onSuccess`
([usePendingOutflows.tsx:224-229](../../../src/hooks/usePendingOutflows.tsx))
with the same keys the bulk fix invalidates
([useBulkTransactionActions.tsx:88-93](../../../src/hooks/useBulkTransactionActions.tsx)):
`['income-statement']`, `['balance-sheet']`, `['chart-of-accounts']`.
Keep the existing three keys.

## Decided trade-offs

1. **Non-atomic client orchestration.** Three sequential client calls can
   stop mid-flow. The order (RPC first) makes every stop state safe and
   every retry converge. A server-side atomic RPC (approach B) stays
   available as a follow-up if partial states show up in production.
2. **Guard errors block the whole match.** A reconciled or closed-period
   transaction cannot take a metadata-only match. A silent metadata-only
   match would recreate the journal-less state this task deletes.
3. **Notes clear-then-restore window.** One RPC step clears `notes` before
   step 4 restores the merged value. The window is one round trip inside one
   mutation. Accepted; approach B would delete the window at the cost of a
   migration.

## Test plan

### Unit (`tests/unit/usePendingOutflows.test.ts`, extend)

The file already mocks `supabase.from` and `supabase.rpc`
([usePendingOutflows.test.ts:8-30](../../../tests/unit/usePendingOutflows.test.ts)).
Add cases:

1. Match with category → RPC called with the outflow's category; direct
   update contains no `is_categorized` and no `category_id`; outflow
   cleared.
2. RPC order → the RPC runs before the `bank_transactions` update.
3. RPC guard error → mutation rejects; no `bank_transactions` update; no
   outflow update; toast shows the mapped copy.
4. No-category outflow → no RPC call; update contains only metadata; outflow
   cleared.
5. Notes merge preserved → merged notes still land in the direct update.

### E2E (`tests/e2e/pending-outflow-match.spec.ts`, new)

Follow the seeding pattern from
[bulk-edit-transactions.spec.ts:1-77](../../../tests/e2e/bulk-edit-transactions.spec.ts):
sign up, seed a connected bank, one uncategorized bank transaction, one
expense category, and one pending outflow with that category. Drive the
Expenses page ([Expenses.tsx:17-18](../../../src/pages/Expenses.tsx)) to
confirm a match. Assert:

- the pending outflow shows as cleared,
- `journal_entries` has one row with `reference_type = 'bank_transaction'`
  and `reference_id` = the transaction id (queried through the page's
  Supabase helper),
- the bank transaction has `matched_at` set and `is_categorized = true`.

No pgTAP: this change adds no SQL.

## Out of scope

- Historical repair (owned by `fix/bulk-categorize-journal-entries`).
- Approach B (atomic server RPC).
- The Transfer-category read-path filtering (covered by an earlier fix, see
  `memory/lessons.md` entry on `isTransferCategoryType`).
