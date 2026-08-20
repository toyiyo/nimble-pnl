# Plan: delete the insert trigger; the sweep creates the journal entries

Date: 2026-08-20
Branch: `claude/epic-tharp-6b7bcb`
Design: docs/superpowers/specs/2026-08-20-trigger-categorization-journal-entries-design.md
Worktree: .claude/worktrees/epic-tharp-6b7bcb

Read the design doc before any task. It carries every decision, every
guard, and every citation. Do not re-decide a decision the design records.

## Build order (TDD: change each test first, watch it fail, then build)

### Task 1: pgTAP rewrite (red)

File: `supabase/tests/categorization_background_rules.test.sql`

1. Add a Cash account fixture for restaurant E: one `chart_of_accounts`
   row with `account_code = '1000'`, restaurant
   `c1a00000-0000-0000-0000-000000000e01`, and a new unique id in the
   `c1a00000-...-0f0X` series. Warning: without this row the sweep logs a
   WARNING and skips the whole batch
   (`supabase/tests/51_standing_categorization_sweep.sql:104-108`).
2. Rewrite test (e) (lines ~499-542). Keep the INSERT. Assert after the
   INSERT: `is_categorized = false`, `category_id IS NULL`,
   `supplier_id IS NULL`. Then call
   `apply_rules_to_bank_transactions_internal('c1a00000-0000-0000-0000-000000000e01', 100)`.
   Assert: `is_categorized = true`, `category_id =
   'c1a00000-0000-0000-0000-000000000f05'`, `supplier_id =
   'c1a00000-0000-0000-0000-000000000d04'`, one `journal_entries` row with
   `reference_type = 'bank_transaction'` and `reference_id` equal to the
   transaction id, and two `journal_entry_lines` rows with debit sum =
   credit sum = 200.00.
3. Rewrite test (f) (lines ~544-571). Keep the INSERT with supplier
   `...d05`. Call the internal function again. The row is a candidate
   because `rules_evaluated_at` defaults to `'-infinity'`. Assert:
   `supplier_id` stays `...d05` (COALESCE: the transaction supplier wins)
   and `category_id = ...f05`.
4. Add two existence tests: `pg_trigger` has no row named
   `auto_categorize_bank_transaction` on `bank_transactions`; `pg_proc`
   has no row named `auto_apply_bank_categorization_rules`.
5. Delete lines 389 and 405 (`ALTER TABLE ... DISABLE TRIGGER` /
   `ENABLE TRIGGER`). Fix the comments at lines 12-16, 46-47, and
   383-388: the trigger is gone; the sweep owns categorization.
6. Change `SELECT plan(N)` to the new assertion count.
7. Run `npm run test:db`. Red state: the trigger still exists, so the
   after-INSERT assertions and the existence tests fail.

### Task 2: sweep test simplify

File: `supabase/tests/51_standing_categorization_sweep.sql`

1. Delete the two `UPDATE categorization_rules SET is_active = ...`
   statements at lines 271-272 and 282-283 (the trigger workaround).
2. Fix the comments at lines 84-90 and 266-270. Keep the POS trigger part
   of the 84-90 comment: the POS trigger stays. The bank row is a sweep
   candidate because `rules_evaluated_at` defaults to `'-infinity'`.

Note: this file goes red only in one direction. With the trigger still
present and the rule active, the INSERT at line 274 arrives
pre-categorized and test 9 passes for the wrong reason. After Task 3 the
sweep does the work and the test passes for the right reason. State this
in the commit message.

### Task 3: the migration (green)

File: `supabase/migrations/<STAMP>_remove_bank_categorization_insert_trigger.sql`

Build exactly the design's section 5.1, in this order:

1. Header comment: the root cause and the design doc path.
2. `DROP TRIGGER IF EXISTS auto_categorize_bank_transaction ON public.bank_transactions;`
3. `DROP FUNCTION IF EXISTS public.auto_apply_bank_categorization_rules();`
4. The reset, inside a `DO` block with `GET DIAGNOSTICS` and
   `RAISE NOTICE` for the row count:
   ```sql
   UPDATE bank_transactions
   SET is_categorized = false, updated_at = now()
   WHERE is_categorized = true
     AND category_id IS NULL
     AND is_split = false
     AND is_reconciled = false
     AND excluded_reason IS NULL;
   ```
5. `SET statement_timeout = 0;`, then a `DO` block that calls
   `public.backfill_bank_transaction_journal_entries()` and raises a
   NOTICE with the result, then `RESET statement_timeout;`. Precedent:
   `supabase/migrations/20260819232450_backfill_bank_transaction_journal_entries.sql:180-190`.

Run `npm run db:reset`, then `npm run test:db` until green. Never run
`supabase test db` directly.

### Task 4: the import hook change

File: `src/hooks/useBankStatementImport.tsx` (import loop: lines 465-531).

After the import loop succeeds and the statement lines are marked
imported, call the wrapper once, best-effort:

- `supabase.rpc('apply_rules_to_bank_transactions', { p_restaurant_id, p_batch_limit })`
  with `p_batch_limit` = the imported row count, floor 100.
- `supabase.rpc` returns `{ error }`; it does not throw. Ignore the
  error. Do not change the import result. The cron drains the rows within
  5 minutes on failure. A `collaborator_accountant` always takes the cron
  path (the wrapper rejects the role).
- Read the surrounding code first and reuse its restaurant-id variable.

No unit harness exists for this hook (design section 5.4). The pgTAP
tests carry the server behavior. State this in the PR body.

### Task 5: types

No type change. `apply_rules_to_bank_transactions` already exists in
`src/integrations/supabase/types.ts:10606`.

## Migration timestamp

Generate `<STAMP>` as `20260820HHMMSS` from the current clock. The newest
migration on origin/main is `20260819232450_...`. Before the push, check
`git log origin/main -- supabase/migrations/ | head`. If a newer migration
landed, re-stamp above it.

## Verification gate (all must pass before the PR)

```bash
npm run typecheck
npm run lint
npm run test
npm run test:db
npx playwright test tests/e2e/bulk-edit-transactions.spec.ts tests/e2e/transactions-freestanding-combobox-scroll.spec.ts --reporter=line
```

The second spec inserts `bank_transactions` rows directly
(`tests/e2e/transactions-freestanding-combobox-scroll.spec.ts:85`), so it
is the closest canary for the trigger removal.

Bound every command with the Bash tool `timeout` parameter. Never poll
with `ps aux | grep`. This machine has no `timeout`/`gtimeout` binary.

## PR

Title: `fix(banking): create journal entries on rule categorization`
Body: the root-cause chain (trigger categorizes → no journal entry →
income statement omits the row → sweep blocked), the deletion decision
with the design doc link, the production counts at design time (5
backfill candidates, 2 resets — the migration prints live counts), the
reviewer verdict, the filed chip (sweep `is_reconciled` guard), the
no-unit-harness statement, and this line: the merge triggers the
production repair when CI applies the migration. End with the
`🤖 Generated with [Claude Code](https://claude.com/claude-code)` footer.

## Out of scope (do not build)

- `matched_by` stamping (no code writes it today).
- The POS categorization trigger.
- The sweep `is_reconciled` guard (chip `task_8502c8c2` filed).
- A scheduled call of the backfill function.
