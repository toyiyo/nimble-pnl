# Design: create journal entries on pending-outflow match

Date: 2026-08-20
Branch: `claude/optimistic-austin-73bb6a`
Author: Claude (development-workflow)

## Problem

The pending-outflow match flow categorizes a bank transaction with a direct
table update. It never creates a journal entry. The income statement reads
only `journal_entry_lines`. A matched expense therefore shows $0.00 on the
income statement.

Production evidence (2026-08-19, from the task briefing): 137 categorized
transactions carry `matched_at` and have no journal entry. The absolute
total is $103,148.41. Reproduce with:

```sql
SELECT count(*), sum(abs(bt.amount))
FROM bank_transactions bt
WHERE bt.is_categorized
  AND bt.matched_at IS NOT NULL
  AND NOT EXISTS (
    SELECT 1 FROM journal_entries je
    WHERE je.reference_type = 'bank_transaction'
      AND je.reference_id = bt.id
  );
```

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
3. Compute the merged notes with a containment guard:
   - When the bank transaction `notes` already contains the outflow
     `notes`, the merged value is the bank transaction `notes` unchanged.
   - Otherwise join the two non-empty values with `\n\n` (current merge,
     [usePendingOutflows.tsx:189-191](../../../src/hooks/usePendingOutflows.tsx)).
   The guard makes a re-merge a no-op, so a retry cannot duplicate text.
4. **If the outflow has a `category_id`:** call the RPC first:
   ```ts
   supabase.rpc('categorize_bank_transaction', {
     p_transaction_id: bankTransactionId,
     p_category_id: pendingOutflow.category_id,
     p_description: mergedNotes ?? null,
     p_normalized_payee: null,
     p_supplier_id: null,
   })
   ```
   On error, throw. Nothing else has changed yet. The RPC writes the
   merged notes and the journal entry in one transaction
   ([...sql:239](../../../supabase/migrations/20260709120000_categorize_preserve_metadata_on_noop.sql)).
5. Direct update to `bank_transactions` with **metadata only**:
   `matched_at`, `suggested_category_id` (only when the outflow has a
   category), and `expense_invoice_upload_id` (only when an upload
   exists). No `is_categorized`. No `category_id`. On the category path,
   no `notes` — the RPC already wrote them. On the no-category path,
   include the merged `notes` (only when non-empty) in this update.
6. Update the pending outflow: `status: 'cleared'`,
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

If step 5 or 6 fails after the RPC commits, the transaction is categorized
with a correct journal entry and the merged notes, and the outflow stays
pending. A retry calls the RPC again with the same category. The RPC
short-circuits as a no-op and preserves metadata
([...sql:89-113](../../../supabase/migrations/20260709120000_categorize_preserve_metadata_on_noop.sql)).
Steps 5 and 6 then complete the match. The flow is safe to re-run.

The retry cannot lose or duplicate notes (Phase 2.5 supabase reviewer,
major finding, fixed here):

- The RPC writes the merged notes atomically with the categorize. No stop
  state leaves `notes` cleared.
- On retry, step 2 re-fetches notes that already contain the outflow
  notes. The step-3 containment guard returns them unchanged, and the
  RPC no-op branch preserves them with COALESCE
  ([...sql:95-105](../../../supabase/migrations/20260709120000_categorize_preserve_metadata_on_noop.sql)).

### Notes handling

The RPC main path writes `notes = p_description` without COALESCE
([...sql:239](../../../supabase/migrations/20260709120000_categorize_preserve_metadata_on_noop.sql)).
The hook therefore always passes the full desired notes value
(`mergedNotes || null`, with `||` so an empty string normalizes to NULL)
as `p_description`. When both notes are empty, the RPC writes NULL — no
visible change. Exception: a stored empty-string `notes` becomes NULL
after a match; downstream reads treat both as empty (frontend reviewer,
minor, accepted). When only the bank transaction has notes, the merged
value equals them — no change. The direct update no longer carries
`notes` on the category path.

### No-category path (behavior change)

When the outflow has no `category_id`, skip the RPC and do **not** set
`is_categorized`, `category_id`, or `suggested_category_id`. Write only
`matched_at`, merged notes, and the invoice link, then clear the outflow.
The transaction stays in the review queue for a real categorize later.
The old behavior (categorized with no category) produced permanent
journal-less rows.

**User signal (Phase 2.5 frontend reviewer, major finding).** Without a
signal, this state hides itself: the cleared card shows only
"Cleared {date}"
([PendingOutflowCard.tsx:229-233](../../../src/components/pending-outflows/PendingOutflowCard.tsx))
and the Expenses totals exclude cleared outflows
([Expenses.tsx:44-46](../../../src/pages/Expenses.tsx)). Two signals fix
this:

1. `confirmMatch` returns a `categorized` flag. `onSuccess` shows
   "Expense matched and cleared" when true. When false it shows
   "Expense matched. Categorize the transaction on the Banking page."
2. The cleared branch of `PendingOutflowCard` adds a "Needs category"
   badge when `outflow.category_id` is null. The state is client-derivable:
   a cleared outflow with no category means the match skipped the
   categorize step.

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
3. **The journal entry description carries the merged notes.** The RPC
   uses `p_description` for the journal entry description with a fallback
   to the transaction description
   ([...sql:174](../../../supabase/migrations/20260709120000_categorize_preserve_metadata_on_noop.sql),
   [...sql:215](../../../supabase/migrations/20260709120000_categorize_preserve_metadata_on_noop.sql)).
   When notes exist, the entry description shows them instead of the raw
   transaction description. Accepted: the notes name the matched expense,
   which is more informative in the ledger. This also fills
   `transaction_reclassifications.reason` with the notes on a reclassify
   ([...sql:191-197](../../../supabase/migrations/20260709120000_categorize_preserve_metadata_on_noop.sql));
   with no notes, `reason` stays NULL (reviewer minor finding, accepted).

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
   outflow update; toast shows the mapped copy. Use the verbatim
   `RAISE EXCEPTION` text from the migration
   ([...sql:117](../../../supabase/migrations/20260709120000_categorize_preserve_metadata_on_noop.sql),
   [...sql:141](../../../supabase/migrations/20260709120000_categorize_preserve_metadata_on_noop.sql))
   in the test, so a future wording change in the SQL breaks the test
   instead of a silent fallback (frontend reviewer, minor). Add a comment
   in the hook that names the migration file next to the substrings.
4. No-category outflow → no RPC call; update contains only metadata; outflow
   cleared; the success toast shows the categorize reminder copy.
5. Notes merge preserved → the merged notes go to the RPC as
   `p_description`; the direct update carries no `notes` on the category
   path.
6. Containment guard → when the bank notes already contain the outflow
   notes, the merged value equals the bank notes (no duplication).

### E2E (`tests/e2e/pending-outflow-match.spec.ts`, new)

Follow the seeding pattern from
[bulk-edit-transactions.spec.ts:1-77](../../../tests/e2e/bulk-edit-transactions.spec.ts):
sign up, seed a connected bank, one uncategorized bank transaction, one
expense category, and one pending outflow with that category. Drive the
Expenses page to confirm a match. Render chain: `Expenses.tsx` renders
`PendingOutflowsList`
([PendingOutflowsList.tsx:146-153](../../../src/components/pending-outflows/PendingOutflowsList.tsx)
renders `PendingOutflowCard`), and the card renders `ManualMatchDialog`
and `MatchSuggestionCard`
([PendingOutflowCard.tsx:20-21](../../../src/components/pending-outflows/PendingOutflowCard.tsx)).
Assert:

- the pending outflow shows as cleared,
- `journal_entries` has one row with `reference_type = 'bank_transaction'`
  and `reference_id` = the transaction id (queried through the page's
  Supabase helper),
- the bank transaction has `matched_at` set and `is_categorized = true`.

No pgTAP: this change adds no SQL.

## Out of scope

- Historical repair (owned by `fix/bulk-categorize-journal-entries`).
- Approach B (atomic server RPC).
- The Single Dialog Pattern violation: `ManualMatchDialog` mounts once per
  card, not once at the list level (pre-existing; frontend reviewer,
  minor). Risk stays low while outflow lists stay under 100 rows.
- The Transfer-category read-path filtering (covered by an earlier fix, see
  `memory/lessons.md` entry on `isTransferCategoryType`).
