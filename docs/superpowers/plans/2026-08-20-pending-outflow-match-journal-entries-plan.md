# Plan: create journal entries on pending-outflow match

Design: `docs/superpowers/specs/2026-08-20-pending-outflow-match-journal-entries-design.md`
Branch: `claude/optimistic-austin-73bb6a`

Each task follows RED → GREEN → REFACTOR → COMMIT. Run
`npx vitest run <file>` for the RED and GREEN steps. Stage explicit paths
only.

## Task 1: rewrite the confirmMatch category path

Files: `src/hooks/usePendingOutflows.tsx`,
`tests/unit/usePendingOutflows.test.ts`

RED — add tests to the `confirmMatch` describe block:
- "calls categorize_bank_transaction with the outflow category and the
  merged notes": expect `supabase.rpc` called with
  `('categorize_bank_transaction', { p_transaction_id, p_category_id:
  'cat-456', p_description: 'Bank notes\n\nExpense notes',
  p_normalized_payee: null, p_supplier_id: null })`.
- "calls the RPC before the bank_transactions update": record call order
  with a shared array.
- "sends a metadata-only update": the `bank_transactions` update payload
  has `matched_at`, `suggested_category_id`, `expense_invoice_upload_id`
  and does NOT have `is_categorized`, `category_id`, or `notes`.
- "keeps the bank notes unchanged when they already contain the outflow
  notes": bank notes `'A\n\nB'`, outflow notes `'B'` → `p_description:
  'A\n\nB'`.

GREEN — in `confirmMatch.mutationFn`:
1. Keep the two fetches (outflow with uploads; bank transaction `notes`).
2. Compute `mergedNotes`: when `bankNotes?.includes(outflowNotes)`, use
   `bankNotes`; else `[bankNotes, outflowNotes].filter(Boolean)
   .join('\n\n')`. Normalize with `|| null`.
3. When `pendingOutflow.category_id` exists, call
   `supabase.rpc('categorize_bank_transaction', {...})` with
   `p_description: mergedNotes`. Throw on error. Add a comment: the guard
   substrings in `onError` come from
   `supabase/migrations/20260709120000_categorize_preserve_metadata_on_noop.sql`.
4. Build the metadata update: `matched_at`, `suggested_category_id` (when
   a category exists), `expense_invoice_upload_id` (when an upload
   exists). On the category path do not include `notes`.
5. Keep the pending-outflow update unchanged.
6. Return `{ pendingOutflowId, bankTransactionId, categorized: true }`.

COMMIT: `fix(banking): create journal entries on pending-outflow match`

## Task 2: no-category path and the success toast split

Files: same as Task 1.

RED:
- "skips the RPC when the outflow has no category": `supabase.rpc` not
  called; update payload has no `is_categorized`, no `category_id`, no
  `suggested_category_id`; it has `matched_at` and `notes` (merged).
- "shows the categorize reminder on a no-category match":
  `toast.success` called with "Expense matched. Categorize the
  transaction on the Banking page."
- "shows the cleared toast on a categorized match": `toast.success`
  called with "Expense matched and cleared".

GREEN: branch on `pendingOutflow.category_id`; return
`categorized: false` on the no-category path and include the merged
`notes` in the metadata update; split the `onSuccess` toast on
`data.categorized`.

COMMIT: `fix(banking): keep an uncategorized transaction in review on match`

## Task 3: guard-error mapping

Files: same as Task 1.

RED (use the verbatim RAISE text from the migration):
- "maps the reconciled guard": rpc rejects with message
  `Cannot categorize a reconciled transaction. Use reclassification
  instead by updating the category of an already categorized
  transaction.` → `toast.error` called with "This transaction is
  reconciled. Reclassify it from the Banking page instead."; no
  `bank_transactions` update; no `pending_outflows` update.
- "maps the closed-period guard": message starts
  `Cannot categorize transaction in closed fiscal period.` → toast
  "This transaction is in a closed fiscal period. Reopen the period
  before you match it."
- "keeps the generic copy for other errors": message `boom` →
  `Failed to confirm match: boom`.

GREEN: map in `onError` with `message.includes('reconciled')` and
`message.includes('closed fiscal period')`.

COMMIT: `fix(banking): map the categorize guard errors on match`

## Task 4: query invalidation extension

Files: same as Task 1.

RED: "invalidates the ledger queries on success": assert
`invalidateQueries` for `['income-statement']`, `['balance-sheet']`,
`['chart-of-accounts']` plus the existing three keys.

GREEN: extend `onSuccess`.

COMMIT: `fix(banking): invalidate ledger queries after a match`

## Task 5: ManualMatchDialog error handling

Files: `src/components/pending-outflows/ManualMatchDialog.tsx`,
`tests/unit/manualMatchDialogError.test.tsx` (new; follow the
`pendingOutflowsSingleDialog.test.tsx` mock style)

RED: "keeps the dialog open when the match fails": mock the mutation to
reject; click Confirm; expect `onClose` not called and no unhandled
rejection.

GREEN: wrap the `mutateAsync` call in try/catch; return on error.

COMMIT: `fix(banking): keep the match dialog open on a failed confirm`

## Task 6: Needs-category badge on the cleared card

Files: `src/components/pending-outflows/PendingOutflowCard.tsx`,
`tests/unit/pendingOutflowCardNeedsCategory.test.tsx` (new)

RED: "shows the badge on a cleared no-category outflow" and "hides the
badge on a cleared categorized outflow".

GREEN: in the cleared branch, when `!outflow.category_id`, add a Badge
"Needs category" beside the cleared date. Style: semantic tokens,
`text-[11px] px-1.5 py-0.5 rounded-md bg-muted` per CLAUDE.md.

COMMIT: `feat(banking): show a needs-category badge on a cleared match`

## Task 7: E2E — match creates a journal entry

Files: `tests/e2e/pending-outflow-match.spec.ts` (new)

Follow `tests/e2e/bulk-edit-transactions.spec.ts`: `generateTestUser`,
`signUpAndCreateRestaurant`, `exposeSupabaseHelpers`. Seed one connected
bank, one uncategorized transaction (amount `-100`), one expense chart
account, one pending outflow with that category and a near-equal amount.
Open `/expenses`, open the manual match dialog (or a suggested match),
confirm. Assert through the page Supabase helper:
- one `journal_entries` row with `reference_type = 'bank_transaction'`
  and `reference_id` = the transaction id, with two lines;
- the transaction has `is_categorized = true` and `matched_at` set;
- the outflow row has `status = 'cleared'`.

Run: `npx playwright test pending-outflow-match --reporter=line` in the
foreground.

COMMIT: `test(banking): e2e for the pending-outflow match ledger write`

## Task order

1 → 2 → 3 → 4 (same files, sequential) → 5 → 6 → 7.
