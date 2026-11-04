# Plan: Bulk categorize must create journal entries

Date: 2026-08-19
Branch: `fix/bulk-categorize-journal-entries`
Design: docs/superpowers/specs/2026-08-19-bulk-categorize-journal-entries-design.md
Worktree: .claude/worktrees/bulk-categorize-journal-entries

Read the design doc before any task. It carries every decision, every
guard, and every citation. Do not re-decide a decision the design records.

## Build order (TDD: write each test first, watch it fail, then build)

### Task 1: pgTAP tests for the bulk RPC (red)

File: `supabase/tests/22_bulk_categorize_bank_transactions.sql`

Follow the repo pgTAP pattern: `BEGIN; SELECT plan(N); ...; SELECT * FROM finish(); ROLLBACK;`.
Impersonate a user with
`SELECT set_config('request.jwt.claims', '{"sub":"<uuid>","role":"authenticated"}', true);`.

Fixtures: two restaurants, one membership, chart accounts (cash `1000`,
one active expense category, one inactive category), bank transactions in
the states the design's section 5 table lists.

Test cases (design section 8, first pgTAP row):
1. No membership: the call raises `Unauthorized`.
2. Inactive category: the call raises `Category not found or inactive`.
3. No cash account `1000`: the call raises `Cash account (1000) not found`.
4. Empty array: the call raises.
5. Array over 500 ids: the call raises.
6. Negative amount: entry with debit category / credit cash, both `ABS()`.
7. Positive amount: entry with debit cash / credit category.
8. `suggested_category_id` is NULL after the call.
9. Same category again: `unchanged_count = 1`, no new entry.
10. Different category on a categorized row: `RECLASS-` entry plus a
    `transaction_reclassifications` row, `reclassified_count = 1`.
11. Reconciled and uncategorized: row lands in `skipped` with reason
    `reconciled`.
12. Reconciled and categorized: reclassification succeeds.
13. Date inside a closed fiscal period: reason `closed_period`.
14. Cross-tenant id in the array: reason `not_found`; other rows succeed.
15. Result shape: keys `success`, `categorized_count`, `reclassified_count`,
    `unchanged_count`, `skipped`.
16. `entry_date` equals the UTC calendar day of `transaction_date`.

### Task 2: migration A — the bulk RPC (green)

File: `supabase/migrations/<STAMP-A>_add_bulk_categorize_bank_transactions.sql`

Build the function exactly as design section 5 specifies. The design fixes:
signature, `SECURITY DEFINER`, `SET search_path = public, pg_temp`,
`SET statement_timeout TO '120s'`, grants, the four set-level guards, the
per-row branch table, the sign convention, the entry-number format with
`clock_timestamp()`, the `suggested_category_id = NULL` addition, the
per-row `BEGIN...EXCEPTION` trap, one `rebuild_account_balances` at the
end, and the result shape.

Mirror source (read it first):
`supabase/migrations/20260709120000_categorize_preserve_metadata_on_noop.sql`.

Run `npm run test:db` until Task 1 is green. Use `npm run db:reset` to
apply migrations locally. Never run `supabase test db` directly.

### Task 3: pgTAP tests for the backfill (red)

File: `supabase/tests/23_backfill_bank_transaction_journal_entries.sql`

Test cases (design section 8, second pgTAP row):
1. A categorized, entry-less transaction gains one entry and two lines
   with the correct sign convention.
2. A second call creates nothing (idempotent; count the rows).
3. A transfer row (`is_transfer = true`) gains nothing.
4. A row inside a closed fiscal period gains nothing.
5. A restaurant without a cash account `1000` gains nothing.
6. A row with an inactive category gains nothing.
7. The function returns `entries_created`, `lines_created`,
   `restaurants_rebuilt`.

### Task 4: migration B — the backfill (green)

File: `supabase/migrations/<STAMP-B>_backfill_bank_transaction_journal_entries.sql`
`<STAMP-B>` must sort after `<STAMP-A>`.

Build per design section 7: the kept function with the revoke + the
`service_role` grant, the candidate predicate, the two-statement CTE insert
with `ON CONFLICT ON CONSTRAINT unique_journal_entry_reference DO NOTHING`,
the `row_number()` entry-number suffix, `created_by NULL`, the explicit
UTC `entry_date` cast, the per-restaurant rebuild loop, and the
`SET statement_timeout = 0; ... RESET statement_timeout;` bracket around
the one migration-time call inside a `DO $$ ... RAISE NOTICE ... $$` block.

### Task 5: vitest for the hook (red), then the hook change (green)

Test file: `tests/unit/useBulkTransactionActions.test.ts`
Code file: `src/hooks/useBulkTransactionActions.tsx` (only
`useBulkCategorizeTransactions` changes).

Test cases (design section 8, Vitest row):
1. The mutation calls `supabase.rpc('bulk_categorize_bank_transactions', ...)`
   with the three `p_` params.
2. 501 ids produce two RPC calls; the result aggregates counts and
   `skipped` across both.
3. An RPC error rejects the mutation; the error toast shows
   `error.message`.
4. A result with `skipped` rows shows an error toast with grouped reasons
   and `duration: 10000`.
5. Success invalidates `['bank-transactions']`, `['income-statement']`,
   `['balance-sheet']`, `['chart-of-accounts']`.
6. The success toast count equals `categorized_count + reclassified_count`.

Follow the existing mock pattern in `tests/unit/` hook tests (see
`useAssignRole.test.ts` for the `supabase.rpc` mock shape).

### Task 6: E2E extension

File: `tests/e2e/bulk-edit-transactions.spec.ts` (extend; do not create a
new spec). The current first test stops at the dialog heading assertion
(line 118). Extend it: pick a category in the dialog, apply, and assert
the rows show the category label after the toast. Use accessible
selectors (`getByRole`, `getByLabel`). Import helpers from
`'../helpers/e2e-supabase'`; seed with `generateTestUser()` fixtures as the
spec already does.

### Task 7: types

Run the local type generation if the repo scripts provide one; otherwise
add the RPC signature to `src/integrations/supabase/types.ts` following the
`bulk_delete_bank_transactions` entry shape.

## Migration timestamps

Generate `<STAMP-A>`/`<STAMP-B>` at file-creation time as
`20260819HHMMSS` from the current clock. Before the push, check
`git log origin/main -- supabase/migrations/ | head` and the newest
filename; the newest on origin/main today is `20260815110000_...`. If a
newer migration lands on origin/main first, re-stamp both files above it.

## Verification gate (all must pass before the PR)

```bash
npm run typecheck
npm run lint
npm run test
npm run test:db
npx playwright test tests/e2e/bulk-edit-transactions.spec.ts --reporter=line
```

Bound every command with the Bash tool `timeout` parameter. Never poll
with `ps aux | grep`. This machine has no `timeout`/`gtimeout` binary.

## PR

Title: `fix(banking): create journal entries on bulk categorize`
Body: root cause, the three deliverables, the production repair counts
(2,328 entries, ~4,656 lines, 6 restaurants), the review verdicts, and the
follow-up chips filed. STE-aligned prose. End with the
`🤖 Generated with [Claude Code](https://claude.com/claude-code)` footer.

The backfill runs in production when CI applies the migration after merge.
State that in the PR body so the merger knows the merge triggers the
repair.

## Out of scope (do not build)

- The auto-apply trigger producer (chip filed).
- The pending-outflow producer (chip filed).
- The `bulk_delete_bank_transactions` membership gap (chip filed).
- Restaurant-local entry dates (chip filed).
- The Undo stub.
