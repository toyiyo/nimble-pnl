# Plan: auto-link pending outflows to categorized bank transactions

Design: [2026-08-30-auto-link-categorized-transactions-design.md](../specs/2026-08-30-auto-link-categorized-transactions-design.md)
Branch: claude/compassionate-stonebraker-320f56

## Step 1: migration `20260830130000_auto_link_categorized_eligibility.sql`

`CREATE OR REPLACE` two functions.

**`auto_link_pending_outflows_internal`** (base:
`supabase/migrations/20260830100000_auto_link_pending_outflows.sql:84-423`):

1. `eligible_outflows` CTE: add `po.category_id` to the select list.
2. `eligible_transactions` CTE: delete the `bt.is_categorized = false`
   line (`20260830100000:171`). Add `bt.is_categorized` and
   `bt.category_id` to the select list.
3. `pairs` CTE: unchanged join conditions (identity only). Carry
   `eo.category_id`, `et.is_categorized`, `et.category_id` through.
4. After `unique_pairs`, add the linkability filter:
   `et.is_categorized = false` OR (a `journal_entries` row exists for the
   transaction AND (`eo.category_id IS NULL` OR
   `eo.category_id = et.category_id`)).
5. Post-claim re-check (`20260830100000:258-269`): delete the
   `v_bt.is_categorized` disjunct. After the match re-validation, add the
   linkability re-check on the locked rows: when `v_bt.is_categorized`,
   require the journal entry to exist and the categories to agree
   (`v_po.category_id IS NULL OR v_po.category_id = v_bt.category_id`);
   otherwise `CONTINUE`.
6. Write branches: keep the two existing branches for an uncategorized
   transaction. Add the categorized branch: update the transaction with
   the merged notes, `matched_at = now()`, `matched_by = NULL`,
   `expense_invoice_upload_id`, and `updated_at` only. Do not touch the
   journal entry, `category_id`, `is_categorized`, or
   `suggested_category_id`.
7. Outflow update (`20260830100000:398-405`): when the transaction was
   categorized and `v_po.category_id IS NULL`, also set
   `category_id = v_bt.category_id` (Case B).
8. Add `v_wrote_ledger boolean := false`. Set it true only in the branch
   that inserts or replaces a journal entry. Change the rebuild guard to
   `v_wrote_ledger AND NOT p_skip_rebuild`.
9. Keep the comment block, the `COMMENT ON FUNCTION`, and the grants in
   sync with the new behavior.

**`unlink_pending_outflow`** (base:
`supabase/migrations/20260830100100_unlink_pending_outflow.sql`):

1. Change the journal-entry lookup to also select `description`.
2. Add to `v_can_revert`: the description must match
   `'Matched pending outflow: %'` (design §4.3).
3. Update the function comment.

## Step 2: migration `20260830130100_idx_bank_transactions_auto_link_v2.sql`

`-- supabase: no-transaction` header. Two statements:

1. `CREATE INDEX CONCURRENTLY IF NOT EXISTS
   idx_bank_transactions_auto_link_v2 ON bank_transactions
   (restaurant_id, amount, transaction_date) WHERE amount < 0 AND
   is_split = false AND is_transfer = false AND excluded_reason IS NULL
   AND is_reconciled = false;`
2. `DROP INDEX CONCURRENTLY IF EXISTS idx_bank_transactions_auto_link;`

## Step 3: pgTAP tests (TDD: write first, watch them fail)

Change `supabase/tests/69_auto_link_pending_outflows.sql`:

1. Rename the scenario 9 assertion at line 246 to "categorized
   transaction without journal entry: outflow stays pending".
2. Add the scenarios from design §6: Case A (entry untouched — same id,
   description, line count), Case B (category copied to the outflow),
   Case C (no writes), the categorized-twin tie, unlink after a Case A
   link (`category_kept = true`, entry survives), unlink after an
   original-path link (`category_kept = false`), the rebuild skip for a
   Case A-only call, the `bulk_categorize_bank_transactions` marker
   scenario, and the structural re-validation pin via
   `pg_get_functiondef`.
3. Update the `plan(N)` count.

## Step 4: frontend toast text

1. `src/hooks/usePendingOutflows.tsx:382-383`: change the
   `category_kept = true` toast to state that the transaction keeps its
   category. New text: "Match undone. The transaction keeps its
   category."
2. `tests/unit/usePendingOutflows.test.ts:1074-1076`: change the pinned
   string assertion to the new text.

## Step 5: verify locally

1. `npm run typecheck` and `npm run lint`.
2. `npm run test` (unit; includes `migrationVersionUniqueness` and the
   toast assertion).
3. `npm run test:db` (pgTAP; coordinate the shared local Supabase stack —
   no parallel `db:reset`; CI is the authoritative signal on contention).

## Step 6: PR and CI

1. Commit per step with `git -C <worktree> add <explicit paths>`.
2. PII sweep before push.
3. Open the PR against `main`; run the CI feedback loop until green.

## Post-merge verification (read-only, production)

Follow design §5: re-run the classification query after two sweep ticks;
confirm the Case A and Case B pairs cleared, and that no journal entry
changed for Case A transactions.

## Out of scope

Design §7: no Case C automation, no sweep changes, no other frontend
changes.
