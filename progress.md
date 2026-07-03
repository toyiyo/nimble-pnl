# Progress: Categorization background rule application + supplier-assign

## Spec
Link: docs/superpowers/specs/2026-07-02-categorization-background-and-supplier-assign-design.md

## Current Phase
Phase 4–9: dev-build-and-ship workflow — launched

## Completed Tasks
- [x] Phase 0: lessons consulted (PR #565 gate-less cron precedent; PR #488 verify_jwt lesson)
- [x] Phase 1: worktree `.claude/worktrees/categorization-background`, branch `fix/categorization-background`
- [x] Phase 2: design doc committed (a45afa06); user approved supplier=assign + backfill-in-migration
- [x] Phase 2.5: both reviewers ran; all critical/major findings folded (6fe450d9)
- [x] Phase 3: plan committed (c07be3a1) — docs/superpowers/plans/2026-07-02-categorization-background-plan.md
- [x] Phase 4-9: dev-build-and-ship workflow (7 plan tasks)
  - [x] Task 1a (plan step 1): Write failing pgTAP tests for supplier-assign semantics (tests a–f) — commit eb24d877
        File: supabase/tests/categorization_background_rules.test.sql
        RED confirmed: "column m.supplier_id does not exist" on test (a); fixture insert succeeds
  - [x] Task 1b (plan step 2): Run npm run test:db — RED verified
        Direct psql run of categorization_background_rules.test.sql confirms:
        ERROR: column m.supplier_id does not exist (line 205, test a)
        All subsequent tests abort as expected. Full suite stopped at deadlock
        in pre-existing 20251209000001_add_inactive_employee_auth_blocking.sql
        (unrelated intermittent failure); our file not yet reached by full suite.
  - [x] Task 1, step 3: Implement migration §1–§3 (GREEN) — commit 39886317
        Files: supabase/migrations/20260703090000_categorization_background_and_supplier_assign.sql (§1–§3)
               supabase/tests/categorization_background_rules.test.sql (plan fixed to 8)
        GREEN confirmed: 1511/1511 pgTAP tests pass; 8 new supplier-semantics tests (a–f) all pass.
  - [x] Task 1d: §2 matches_bank_transaction_rule — already implemented in commit 39886317 (part of §1–§3 GREEN);
        tests confirmed green (1511/1511) in this phase.
  - [x] Task 1e: §3 auto_apply_bank_categorization_rules — already implemented in commit 39886317 (part of §1–§3 GREEN);
        adds cr.supplier_id to SELECT list and NEW.supplier_id := COALESCE(NEW.supplier_id, v_matching_rule.supplier_id)
        in the apply branch. GREEN confirmed: 1511/1511 pgTAP tests pass; trigger tests (e, f) both pass.
  - [x] Task 1f (plan step "Run npm run test:db to verify Task 1 tests pass and no regressions"):
        npm run test:db: 1511/1511 passed, 0 failed. All Task 1 supplier-semantics tests (a–f) confirmed green,
        no regressions in existing suite.
  - [x] Task 1g (plan step 5, task 7/36): Commit Task 1 (supplier-assign semantics in three bank match/apply paths) — commit 39886317
        Files: supabase/migrations/20260703090000_categorization_background_and_supplier_assign.sql (§1–§3)
               supabase/tests/categorization_background_rules.test.sql
        Message: "fix(categorization): supplier on bank rules assigns instead of filters when other criteria exist"
        All 1511 pgTAP tests green; 8 new supplier-semantics tests (a–f) pass.
  - [x] Task 2a (plan Task 2 step 1, task 8/36): Write failing pgTAP tests (g–i) for apply_rules_to_pos_sales_internal — commit 03057d49
        File: supabase/tests/categorization_background_rules.test.sql (plan 8→14, +169 lines)
        RED confirmed: ERROR at line 437 "function apply_rules_to_pos_sales_internal(uuid,integer) does not exist"
        Tests (a–f) still pass (8 GREEN); tests (g)(h)(i) abort as expected (function missing).
        Fixtures: Restaurant G (c1a00007 prefix), 2 chart_of_accounts rows (expense+cash/1000),
                  POS rule (item_name 'Sales Tax' contains, auto_apply), unified_sales row
                  (inserted with skip trigger flag, is_categorized=false), non-member UUID for (i).
  - [x] Task 2b (plan Task 2 step 2, task 9/36): Run npm run test:db to verify tests fail (internal function not yet created)
        RED confirmed via npm run test:db:
        - Tests (a)-(f): 8/8 PASS (Task 1 supplier-semantics still green)
        - Line 437: ERROR "function apply_rules_to_pos_sales_internal(uuid,integer) does not exist"
        - Tests (g)(h)(i) abort as expected; exit code 3 (SQL error in test file)
  - [x] Task 2c (plan Task 2 step 3, task 10/36): Implement migration §4 — apply_rules_to_pos_sales_internal + public wrapper — commit 8bbfa920
        File: supabase/migrations/20260703090000_categorization_background_and_supplier_assign.sql (§4 appended, +170 lines)
        GREEN confirmed: npm run test:db → 1517/1517 passed, 0 failed.
        All 14 tests (a–i) in categorization_background_rules.test.sql pass:
          (g) privilege trio: authenticated/anon=false, service_role=true
          (h) NULL-auth functional path: applied_count=1, sale is_categorized=true
          (i) public wrapper raises 'Permission denied...' for non-member sub
        Message: "fix(categorization): auth-free internal POS rule engine + hardened public wrapper"
  - [x] Task 2d (plan Task 2 step 4, task 11/36): Run npm run test:db to verify Task 2 tests pass
        GREEN confirmed: npm run test:db → 1517/1517 passed, 0 failed.
        All 14 tests (a–i) green; Task 2 (g)(h)(i) POS internal function tests all pass.
        No commit needed — verification only step.
  - [x] Task 2e (plan Task 2 step 5, task 12/36): Commit Task 2 (auth-free internal POS rule engine + hardened public wrapper) — commit 8bbfa920
        Already committed in Task 2c phase. Commit message: "fix(categorization): auth-free internal POS rule engine + hardened public wrapper"
        Files: supabase/migrations/20260703090000_categorization_background_and_supplier_assign.sql (§4 appended, +170 lines)
        Migration §4 creates apply_rules_to_pos_sales_internal (SECURITY DEFINER, SET search_path=public, no auth check)
        and replaces the public apply_rules_to_pos_sales wrapper to delegate to it while keeping owner/manager permission check.
        REVOKE EXECUTE from PUBLIC/anon/authenticated; GRANT EXECUTE to service_role only.
        Public wrapper also gains SET search_path=public (fixes unpinned SECURITY DEFINER injection risk).
        All 1517/1517 pgTAP tests green; 14 tests in categorization_background_rules.test.sql (a–i all pass).

  - [x] Task 3b (plan Task 3 step 2, task 14/36): Run npm run test:db to verify tests fail (bank-transactions-internal not yet created)
        RED confirmed via npm run test:db:
        - Tests (a)-(n, i.e., 14 tests): all PASS (Tasks 1 and 2 supplier-semantics still green)
        - Line 584: ERROR "function apply_rules_to_bank_transactions_internal(uuid,integer) does not exist"
        - Tests (j)(k)(l) abort as expected; exit code 3 (SQL error in test file)
        No commit needed — verification only step.
  - [x] Task 3a (plan Task 3 step 1, task 13/36): Write failing pgTAP tests (j–l) for apply_rules_to_bank_transactions_internal — commit 90877e19
        File: supabase/tests/categorization_background_rules.test.sql (plan 14→22, +174 lines)
        RED confirmed: ERROR at line 584 "function apply_rules_to_bank_transactions_internal(uuid,integer) does not exist"
        Tests (a–i) still pass (14 GREEN); tests (j)(k)(l) abort as expected (function missing).
        Fixtures: Restaurant H (c1a00008 prefix), chart_of_accounts (expense+cash/1000),
                  Supplier H (VENDOR-H Corp), Rule H (description 'VENDOR-H' contains + supplier_id=d08,
                  auto_apply), connected bank H, bank txn h01 (inserted with trigger disabled, supplier NULL).
        Tests added:
          (j) privilege trio: authenticated/anon=false, service_role=true (3 assertions)
          (k) NULL-auth batch: applied_count=1, is_categorized=true, supplier_id=d08 from rule,
              journal_entries row with created_by IS NULL (4 assertions)
          (l) public wrapper raises 'Permission denied...' for non-member sub (1 assertion)
  - [x] Task 3c (plan Task 3 step 3, task 15/36): Implement migration §5 — apply_rules_to_bank_transactions_internal + supplier assignment + public wrapper — commit 3d9115f2
        File: supabase/migrations/20260703090000_categorization_background_and_supplier_assign.sql (§5 appended, +339 lines)
        GREEN confirmed: npm run test:db → 1525/1525 passed, 0 failed.
        All 22 tests (a–l) in categorization_background_rules.test.sql pass:
          (j) privilege trio: authenticated/anon=false, service_role=true
          (k) NULL-auth batch: applied_count=1, is_categorized=true, supplier_id=d08 from rule,
              journal_entries row with created_by IS NULL
          (l) public wrapper raises 'Permission denied...' for non-member sub
        Key changes vs. apply_rules_to_bank_transactions:
          1. Removed permission check block
          2. Added matched.supplier_id AS rule_supplier_id to cursor SELECT
          3. Non-split UPDATE uses COALESCE(v_transaction.supplier_id, v_transaction.rule_supplier_id, supplier_id)
          4. auth.uid() in journal_entries INSERT tolerates NULL (column is NULLABLE per prod verification)
          5. REVOKE EXECUTE from PUBLIC/anon/authenticated; GRANT to service_role
          6. Public wrapper re-declared with SET search_path=public; delegates to internal
  - [x] Task 3d (plan Task 3 step 4, task 16/36): Run npm run test:db to verify Task 3 tests pass
        GREEN confirmed: npm run test:db → 1525/1525 passed, 0 failed.
        All 22 tests (a–l) in categorization_background_rules.test.sql pass:
          (j) privilege trio ok 15–17: authenticated/anon=false, service_role=true
          (k) NULL-auth batch ok 18–21: applied_count=1, is_categorized=true, supplier_id assigned,
              journal_entries row with created_by IS NULL
          (l) public wrapper ok 22: raises 'Permission denied...' for non-member sub
        Tasks 1 (a–h) and 2 (g–i) also all green — no regressions.
        No commit needed — verification only step.
  - [x] Task 3e (plan Task 3 step 5, task 17/36): Commit Task 3 (auth-free internal bank rule engine assigns rule supplier) — commit 3d9115f2
        Commit message: "fix(categorization): auth-free internal bank rule engine assigns rule supplier"
        Files: supabase/migrations/20260703090000_categorization_background_and_supplier_assign.sql (§5 appended, +339 lines)
        Migration §5 creates apply_rules_to_bank_transactions_internal (SECURITY DEFINER, SET search_path=public, no auth check)
        and replaces the public apply_rules_to_bank_transactions wrapper to delegate to it while keeping owner/manager permission check.
        Supplier assignment: NON-SPLIT UPDATE uses COALESCE(v_transaction.supplier_id, v_transaction.rule_supplier_id, supplier_id)
        REVOKE EXECUTE from PUBLIC/anon/authenticated; GRANT EXECUTE to service_role only.
        All 1525/1525 pgTAP tests green; 22 tests in categorization_background_rules.test.sql (a–l all pass).

## CI Status
- PR: not yet created

## Blockers
- none

## Key Decisions
- Supplier on bank rules = ASSIGN (not filter) when other criteria exist; strict filter for supplier-only rules (user choice)
- One-time backfill runs inside the migration (user choice)
- Internal/public split: `apply_rules_to_*_internal` (no auth check, REVOKE anon/authenticated, GRANT service_role); public wrappers keep auth checks
- Migration rewrites the 4 gated sync functions DYNAMICALLY (pg_get_functiondef + regexp_replace of the auth.uid() gate + EXECUTE; RAISE if pattern missing) — avoids stale-source transcription entirely

## Verified production facts (2026-07-02, via supabase-prod MCP)
- Gated sync fns (all contain `IF auth.uid() IS NOT NULL THEN PERFORM apply_rules_to_pos_sales(p_restaurant_id, 10000); ELSE RAISE LOG ...`):
  `sync_toast_to_unified_sales(uuid)`, `sync_toast_to_unified_sales(uuid,date,date)`,
  `_sync_focus_to_unified_sales_impl(uuid,date,date)`, `_sync_focus_transactions_to_unified_sales_impl(uuid,date,date)`
- `sync_shift4_to_unified_sales`: NO gate, NO trigger bypass — untouched
- `journal_entries.created_by` is NULLABLE → NULL-auth journal inserts OK
- `split_pos_sale` skips auth check when auth.uid() IS NULL → split rules OK in background
- `rebuild_account_balances` does not use auth.uid()
- Cron: `toast-unified-sales-sync` (*/5m, `SELECT sync_all_toast_to_unified_sales()`), same for shift4/focus
- `stripe-sync-transactions/index.ts:297` calls `apply_rules_to_bank_transactions` with service role → currently RAISES permission denied
- Blast radius: 11,744 uncategorized POS rows/30d across 3 restaurants w/ active auto_apply rules (1,509 tax rows)
- SYGMA rules: `724c6c53-…` and `9cc372b5-…` (restaurant 7c0c76e3), both supplier_id=efb84198 (SYGMA), description contains SYGMA, apply_count=0
- 10 active bank rules carry supplier_id; 7,958/8,058 bank_transactions have supplier_id NULL
- Local migration sources: apply fns in `20260209000000_add_auth_to_apply_rule_functions.sql`; matchers/trigger fns in `20251111000000_enhanced_categorization_rules.sql`; toast sync in `20260215200000_fix_toast_sync_timeout.sql`

## Prod verification queries (for post-merge check)
- Uncategorized tax rows: `SELECT count(*) FROM unified_sales WHERE restaurant_id='7c0c76e3-e770-401b-a2a9-c1edd407efed' AND item_name ILIKE '%sales tax%' AND is_categorized IS NOT TRUE;` → expect 0 and stays 0 after next 5-min cron
- SYGMA: `SELECT is_categorized, supplier_id FROM bank_transactions WHERE description ILIKE '%sygma%';` → categorized with supplier tagged
