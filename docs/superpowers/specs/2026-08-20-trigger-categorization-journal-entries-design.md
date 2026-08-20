# Design: journal entries for trigger-categorized bank transactions

- Date: 2026-08-20
- Branch: `claude/epic-tharp-6b7bcb`
- Status: approved direction from the task description; reviewed in Phase 2.5

## 1. Problem

The BEFORE INSERT trigger `auto_categorize_bank_transaction` categorizes a bank
transaction but creates no journal entry. The income statement reads only
`journal_entry_lines`. The transaction does not show on the income statement.
The categorization sweep cannot repair the row, because the row is already
categorized.

Evidence chain, with citations:

1. The trigger exists on `bank_transactions`
   (`supabase/migrations/20251111000000_enhanced_categorization_rules.sql:611-615`).
2. The latest trigger function sets `NEW.category_id`,
   `NEW.is_categorized := true`, and `NEW.supplier_id`, and increments
   `apply_count`. It creates no journal entry. It does not write `notes` or
   `matched_by`
   (`supabase/migrations/20260703090000_categorization_background_and_supplier_assign.sql:224-276`).
3. The income statement query reads only `journal_entry_lines` joined to
   `journal_entries`
   (`src/components/financial-statements/IncomeStatement.tsx:193-240`).
4. The sweep claims only rows where `is_categorized = false OR category_id IS
   NULL` (`supabase/migrations/20260804090300_bounded_categorization_sweep.sql:343`).
   A trigger-categorized row fails this predicate forever.

### Production measurement (2026-08-20, read-only)

- 5 categorized bank transactions have no journal entry, across 2 restaurants.
  All 5 were created on 2026-08-20, after the backfill from PR #766 ran on
  2026-08-19. All 5 have `rules_evaluated_at = '-infinity'`: the trigger
  preempted the sweep. The trigger produces new damage every day.
- 2 rows (1 restaurant, created 2026-03-11 and 2026-03-12) have
  `is_categorized = true`, `category_id IS NULL`, and `is_split = false`. This
  is the split-rule corruption described in section 2. The sweep evaluated them
  on 2026-08-20 and stamped the watermark, but no rule matches them now, so the
  sweep leaves them. The backfill skips them, because its predicate requires
  `category_id IS NOT NULL`
  (`supabase/migrations/20260819232450_backfill_bank_transaction_journal_entries.sql:74-75`).
  They are stuck: shown as categorized, with no category and no ledger entry.

## 2. A second trigger bug: split rules

`find_matching_rules_for_bank_transaction` returns split rules through the same
`LIMIT 1` path
(`supabase/migrations/20260703090000_categorization_background_and_supplier_assign.sql:30-101`).
The trigger ignores `is_split_rule` and copies `category_id` from the rule. A
split rule has no single `category_id`. The trigger then writes
`is_categorized = true` with `category_id = NULL`. The 2 stuck production rows
match this signature.

## 3. Facts that shape the options

1. The sweep (`apply_rules_to_bank_transactions_internal`) does the complete
   job: it categorizes, creates the journal entry, handles split rules, assigns
   the supplier, increments rule statistics, writes `notes`, stamps the
   watermark, and runs one `rebuild_account_balances` per batch
   (`supabase/migrations/20260804090300_bounded_categorization_sweep.sql`).
2. The Stripe sync edge function already calls the sweep after it inserts,
   with `p_batch_limit: 1000` and `p_skip_rebuild: true`, and rebuilds once
   later (`supabase/functions/stripe-sync-transactions/index.ts:375-400`).
   The trigger preempts that call and does a strictly worse job.
3. The CSV and manual import hook inserts rows and calls no sweep
   (`src/hooks/useBankStatementImport.tsx:465-531`).
4. The pg_cron job `categorization-backlog-drain` runs
   `drain_categorization_backlog()` every 5 minutes for every restaurant with
   an active `auto_apply` rule, permanently
   (`supabase/migrations/20260804091000_standing_categorization_sweep.sql:213-222`;
   drain function:
   `supabase/migrations/20260804090700_categorization_watermark_and_drain_convergence.sql:81-160`).
5. Every new row is a sweep candidate: `rules_evaluated_at` defaults to
   `'-infinity'`
   (`supabase/migrations/20260804090000_rules_evaluated_at_columns.sql`).
6. The rerunnable repair function
   `backfill_bank_transaction_journal_entries()` exists, is service-role only,
   and has a precedent for a one-time call inside a migration
   (`supabase/migrations/20260819232450_backfill_bank_transaction_journal_entries.sql:15-190`).
7. The public wrapper `apply_rules_to_bank_transactions(p_restaurant_id,
   p_batch_limit DEFAULT 100)` requires the owner or manager role
   (`supabase/migrations/20260703090000_categorization_background_and_supplier_assign.sql:780-804`).
   The client already calls it from `useApplyRulesV2`
   (`src/hooks/useCategorizationRulesV2.tsx:335-395`).
8. Only the trigger references `auto_apply_bank_categorization_rules`. No
   application code calls it (grep across `supabase/`, `src/`, `tests/`).
9. No code writes `bank_transactions.matched_by`. The sweep does not stamp it
   either (grep across migrations, `src/`, `supabase/functions/`).
10. The trigger only acts when the matched rule has `auto_apply = true`
    (`20260703090000...sql:224-276`). The cron drain serves the same set:
    restaurants with an active `auto_apply` rule. The removal loses no
    coverage.

## 4. Options

### Option A: AFTER ROW trigger that creates the journal entry — rejected

Add an AFTER INSERT row trigger that mirrors the journal logic of
`categorize_bank_transaction`
(`supabase/migrations/20260709120000_categorize_preserve_metadata_on_noop.sql:198-231`).

- This adds a fifth copy of the entry logic. Four copies exist:
  `categorize_bank_transaction`, the sweep, the bulk RPC, and the backfill.
- A per-row `rebuild_account_balances` is not acceptable for imports. The
  trigger has no batch boundary, so it cannot rebuild once per batch.
- The split-rule bug in the BEFORE trigger stays.

### Option B: AFTER statement trigger with transition tables — rejected

- Both insert paths insert row by row
  (`supabase/functions/stripe-sync-transactions/index.ts:247-296`;
  `src/hooks/useBankStatementImport.tsx:465-531`). A statement trigger fires
  once per statement, which is once per row here. The batch benefit is zero.
- The rebuild cost problem stays. The extra copy of the entry logic stays.

### Option C: delete the trigger; the sweep owns categorization — recommended

The task description names this direction: "move auto-apply out of the trigger
into the import path". The import paths are already wired to the sweep, or a
5-minute cron covers them. The trigger is not a feature. It is a race that
beats the sweep to the row and then blocks the sweep.

- Delete the trigger and its function. No new copy of any logic.
- The Stripe path keeps its inline sweep call. Result: same-request
  categorization, now with journal entries.
- The CSV path gets one best-effort wrapper call after import. The cron covers
  the rest within 5 minutes.
- The migration repairs production with the existing backfill function.

## 5. Design (Option C)

### 5.1 Migration `remove_bank_categorization_insert_trigger`

One new migration file, four steps, in this order:

1. `DROP TRIGGER IF EXISTS auto_categorize_bank_transaction ON bank_transactions;`
2. `DROP FUNCTION IF EXISTS auto_apply_bank_categorization_rules();`
   (the trigger depends on the function, so the trigger drops first).
3. Reset the stuck rows:
   ```sql
   UPDATE bank_transactions
   SET is_categorized = false, updated_at = now()
   WHERE is_categorized = true
     AND category_id IS NULL
     AND is_split = false;
   ```
   This state is inconsistent by construction. A categorized non-split row
   must have a category. The reset makes the rows honest: they show as
   uncategorized, and a future matching rule or a manual categorization can
   fix them. Production count today: 2 rows. Print the count with
   `RAISE NOTICE`.
4. Run the repair once:
   `PERFORM public.backfill_bank_transaction_journal_entries();` inside a DO
   block, with `SET statement_timeout = 0` around it, and `RAISE NOTICE` for
   the result. Precedent:
   `supabase/migrations/20260819232450_backfill_bank_transaction_journal_entries.sql:180-190`.
   Production count today: 5 candidate rows. A local `db reset` runs this
   against an empty database and it is a no-op.

Step 3 runs before step 4 so the reset rows cannot enter the backfill (they
cannot anyway: their `category_id` is NULL; the order makes the intent plain).

### 5.2 Client change: CSV and manual import

In `src/hooks/useBankStatementImport.tsx`, after the insert loop succeeds:

- Call `supabase.rpc('apply_rules_to_bank_transactions', { p_restaurant_id,
  p_batch_limit })` once, with `p_batch_limit` set to the count of imported
  rows, with a floor of 100.
- Wrap the call in try/catch and ignore the error. The wrapper rejects
  non-owner, non-manager callers
  (`20260703090000...sql:780-804`). The cron drain then categorizes the rows
  within 5 minutes. The import result must not fail because of this call.

### 5.3 Behavior changes, stated plainly

- A new bank transaction is uncategorized at INSERT time. The sweep
  categorizes it and creates the journal entry.
  - Stripe sync: in the same edge-function request as today. No visible change.
  - CSV import: at the end of the import call. On failure, within 5 minutes.
  - Tombstone restore and any other insert path: within 5 minutes.
- The row now also gets `notes = 'Auto-categorized by rule: <name>'` and the
  watermark stamp, which the trigger never wrote.
- INSERT gets cheaper: the per-row `find_matching_rules_for_bank_transaction`
  call disappears from the insert path.

### 5.4 Tests

pgTAP (`supabase/tests/`):

1. `categorization_background_rules.test.sql` tests (e) and (f) assert the
   trigger categorizes at INSERT (lines ~500-560). Rewrite them: INSERT leaves
   the row with `is_categorized = false` and `rules_evaluated_at =
   '-infinity'`; then `apply_rules_to_bank_transactions_internal` categorizes
   the row AND creates a journal entry with two balanced lines. Delete the
   `DISABLE TRIGGER` / `ENABLE TRIGGER` statements at lines 389 and 405 — they
   error once the trigger is gone.
2. `51_standing_categorization_sweep.sql` deactivates a rule across an INSERT
   as a trigger workaround (lines ~260-290) and references the trigger in
   comments (line 89). Delete the workaround and fix the comments.
3. New assertions in the rewritten test file: the trigger
   `auto_categorize_bank_transaction` and the function
   `auto_apply_bank_categorization_rules` do not exist (query `pg_trigger` and
   `pg_proc`). This pins the removal.

Unit tests (`tests/unit/`): the hook change is one fire-and-forget RPC call. If
`useBankStatementImport` has an existing test harness, add a case: the import
succeeds when the RPC rejects. If no harness exists, the pgTAP tests carry the
server behavior and the E2E suite carries the import flow; state this in the PR.

### 5.5 Performance

- No per-row `rebuild_account_balances` anywhere. The sweep rebuilds once per
  batch (`20260804090300...sql`, final block). The Stripe path passes
  `p_skip_rebuild: true` and rebuilds once per sync
  (`supabase/functions/stripe-sync-transactions/index.ts:375-400`).
- The backfill is set-based and rebuilds once per affected restaurant
  (`20260819232450...sql:155-160`). Today it targets 5 rows.

## 6. Risks

1. A restaurant could see an imported row as uncategorized for up to 5 minutes
   (CSV failure path, tombstone restore). The trade is deliberate: a correct
   ledger beats an instant label. The Stripe path, the main volume, keeps
   same-request categorization.
2. The migration runs a production data repair (2 resets + 5 backfills at
   today's counts). Both steps are idempotent and print their counts. The
   2,328-row precedent from PR #766 ran without incident.
3. Concurrent damage between deploy of this migration and the last
   trigger-categorized row: the backfill inside the migration catches rows
   created before the drop. Rows created after the drop are sweep candidates
   by default. No gap.

## 7. Out of scope

- `matched_by`: no code writes it today, in the trigger, the sweep, or
  anywhere else. Stamping attribution is a separate feature.
- The POS categorization path and its triggers.
- Reclassification flows (`categorize_bank_transaction` reclass branch).
- A scheduled call of `backfill_bank_transaction_journal_entries()`: with the
  producer gone, the repair runs once and the class of damage ends. A schedule
  would mask new producers instead of exposing them.
