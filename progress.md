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
  - [x] Task 4a (plan Task 4 step 1, task 18/36): Write failing pgTAP tests (m1–m4) for sync-function gate rewrite — commit 65811813
        File: supabase/tests/categorization_background_rules.test.sql (plan 22→26, +77 lines)
        RED confirmed: Tests m1–m4 fail ("not ok 23–26"); prior 22 tests (a–l) still green.
        Tests added:
          (m1) sync_toast_to_unified_sales(uuid): def not like '%skipping batch categorization%'
               AND def like '%apply_rules_to_pos_sales_internal%'
          (m2) sync_toast_to_unified_sales(uuid,date,date): same assertion
          (m3) _sync_focus_to_unified_sales_impl(uuid,date,date): same assertion
          (m4) _sync_focus_transactions_to_unified_sales_impl(uuid,date,date): same assertion
        Suite result: 1525 passed, 4 failed (new m1–m4), exit code indicates failure as expected.
  - [x] Task 4b (plan Task 4 step 2, task 19/36): Run npm run test:db to verify tests fail (sync functions not yet patched)
        RED confirmed via npm run test:db:
        - Tests (a)-(l): 22/22 PASS (Tasks 1, 2, 3 still all green)
        - not ok 23 - (m1) sync_toast_to_unified_sales(uuid) categorizes unconditionally via internal engine
        - not ok 24 - (m2) sync_toast_to_unified_sales(uuid,date,date) categorizes unconditionally via internal engine
        - not ok 25 - (m3) _sync_focus_to_unified_sales_impl(uuid,date,date) categorizes unconditionally via internal engine
        - not ok 26 - (m4) _sync_focus_transactions_to_unified_sales_impl(uuid,date,date) categorizes unconditionally via internal engine
        Total: 1529 tests, 1525 passed, 4 failed — exactly the 4 new m1-m4 tests failing as expected.
        No commit needed — verification only step.
  - [x] Task 4c (plan Task 4 step 3, task 20/36): Implement migration §6 — dynamic gate rewrite DO-block — commit 68ce1473
        File: supabase/migrations/20260703090000_categorization_background_and_supplier_assign.sql (§6 appended, +70 lines)
        GREEN confirmed: npm run test:db → 1529/1529 passed, 0 failed.
        All 26 tests (a–m4) in categorization_background_rules.test.sql pass:
          (m1) sync_toast_to_unified_sales(uuid): no gate, calls apply_rules_to_pos_sales_internal
          (m2) sync_toast_to_unified_sales(uuid,date,date): same
          (m3) _sync_focus_to_unified_sales_impl(uuid,date,date): same
          (m4) _sync_focus_transactions_to_unified_sales_impl(uuid,date,date): same
        Implementation: DO-block reads each sync function via pg_get_functiondef, regexp_replaces
        the auth-gated categorization block (IF auth.uid() IS NOT NULL THEN PERFORM apply_rules_to_pos_sales...)
        with unconditional PERFORM apply_rules_to_pos_sales_internal(p_restaurant_id, 10000);
        Idempotent: skips already-patched functions (LIKE '%apply_rules_to_pos_sales_internal%' guard).
        Drift guard: RAISE EXCEPTION if gate pattern not found and function not already patched.
        Authorization header (IF auth.uid() IS NOT NULL AND NOT EXISTS...) preserved — regex only
        matches the categorization gate (pattern requires IS NOT NULL THEN\s*PERFORM apply_rules_to_pos_sales).
        Message: "fix(categorization): sync functions categorize unconditionally via internal engine (dynamic gate rewrite)"
  - [x] Task 4d (plan Task 4 step 4, task 21/36): Run npm run test:db to verify Task 4 tests pass
        GREEN confirmed: npm run test:db → 1529/1529 passed, 0 failed.
        All 26 tests (a–m4) in categorization_background_rules.test.sql pass:
          (m1) ok 23 - sync_toast_to_unified_sales(uuid) categorizes unconditionally via internal engine
          (m2) ok 24 - sync_toast_to_unified_sales(uuid,date,date) categorizes unconditionally via internal engine
          (m3) ok 25 - _sync_focus_to_unified_sales_impl(uuid,date,date) categorizes unconditionally via internal engine
          (m4) ok 26 - _sync_focus_transactions_to_unified_sales_impl(uuid,date,date) categorizes unconditionally via internal engine
        Tasks 1 (a–h), 2 (g–i), and 3 (j–l) also all green — no regressions.
        No commit needed — verification only step.
  - [x] Task 4e (plan Task 4 step 5, task 22/36): Commit Task 4 (sync functions categorize unconditionally via internal engine) — commit 68ce1473
        Commit message: "fix(categorization): sync functions categorize unconditionally via internal engine (dynamic gate rewrite)"
        Files: supabase/migrations/20260703090000_categorization_background_and_supplier_assign.sql (§6 appended, +70 lines)
        Migration §6 DO-block reads each of the four gated sync functions via pg_get_functiondef, regexp_replaces
        the auth-gated categorization block (IF auth.uid() IS NOT NULL THEN PERFORM apply_rules_to_pos_sales...)
        with unconditional PERFORM apply_rules_to_pos_sales_internal(p_restaurant_id, 10000).
        Idempotent: skips already-patched functions. Drift guard: RAISE EXCEPTION if gate pattern not found and
        function not already patched. Authorization header preserved — regex only matches the categorization gate.
        All 1529/1529 pgTAP tests green; 26 tests (a–m4) in categorization_background_rules.test.sql pass.

  - [x] Task 5a (plan Task 5 step 1, task 23/36): Write failing pgTAP test (n) for §7 one-time backfill — commit 8e597a0b
        File: supabase/tests/categorization_background_rules.test.sql (plan 26→27, +102 lines net)
        RED confirmed: test 27 "(n) backfill loop drains POS backlog: Delivery Fee row is_categorized=true" FAILS (1 failure);
        all prior 26 tests (a–m4) still pass (1529/1530 total).
        Fixtures added:
          Restaurant I (c1a00009 prefix, UUID 000000000901), expense CoA (000000000906, code 5300),
          cash CoA (000000000907, code 1000), Rule I (000000000900: pos_sales 'Delivery Fee' contains, auto_apply),
          Sale I (000000000201: unified_sales item_name='Delivery Fee', is_categorized=false, inserted with skip trigger).
        The DO-block (backfill inner loop for Restaurant I) is commented out in the test — row stays uncategorized.
        GREEN phase (task 5b): uncomment/add DO-block in test + append §7 to migration.
  - [x] Task 5b (plan Task 5 step 2, task 24/36): Run npm run test:db to verify test (n) fails
        RED confirmed via npm run test:db:
        - Tests (a)-(m4): 26/26 PASS (Tasks 1-4 still all green)
        - not ok 27 - (n) backfill loop drains POS backlog: Delivery Fee row is_categorized=true
        - Total: 1530 tests, 1529 passed, 1 failed — exactly the 1 new (n) backfill test failing as expected.
        - §7 not yet appended to migration; row stays uncategorized (DO-block commented out in test fixture).
        No commit needed — verification only step.
  - [x] Task 5c (plan Task 5 step 3, task 25/36): Implement migration §7 — per-restaurant drain loop for POS and bank backlogs — commit 80e6e821
        Files: supabase/migrations/20260703090000_categorization_background_and_supplier_assign.sql (§7 appended, +65 lines)
               supabase/tests/categorization_background_rules.test.sql (DO-block uncommented, RED→GREEN)
        GREEN confirmed: npm run test:db → 27/27 tests pass in categorization_background_rules.test.sql;
          (n) ok 27 - backfill loop drains POS backlog: Delivery Fee row is_categorized=true
          All prior 26 tests (a–m4) still green; 1 pre-existing unrelated failure (enqueue_weekly_brief_jobs)
        Migration §7 DO-block:
          - POS loop: per restaurant, 5000/batch, 50-round cap, BEGIN/EXCEPTION per restaurant
          - Bank loop: per restaurant, 1000/batch, 50-round cap, BEGIN/EXCEPTION per restaurant
          - Counter i reset at start of each restaurant block (separate for POS and bank)
          - No-op on empty databases (no matching categorization_rules → loop body never runs)
        Message: "fix(categorization): backfill stuck uncategorized backlog in-migration"
  - [x] Task 5d (plan Task 5 step 4, task 26/36): Run npm run test:db to verify full suite green
        GREEN confirmed: npm run test:db → 1530/1530 passed, 0 failed.
        All 27 tests in categorization_background_rules.test.sql pass:
          (a)-(h) supplier-semantics tests (Task 1) — ok 1-8
          (g)-(i) POS internal engine tests (Task 2) — ok 9-14
          (j)-(l) bank internal engine tests (Task 3) — ok 15-22
          (m1)-(m4) sync function gate rewrite tests (Task 4) — ok 23-26
          (n) backfill convergence test (Task 5) — ok 27
        Note: local DB did not have the migration applied; applied via psql -f before running tests.
        No commit needed — verification only step.
  - [x] Task 5e (plan Task 5 step 5, task 27/36): Commit Task 5 (backfill stuck uncategorized backlog in-migration) — commit 80e6e821
        Commit already created in Task 5c phase.
        Commit message: "fix(categorization): backfill stuck uncategorized backlog in-migration"
        Files: supabase/migrations/20260703090000_categorization_background_and_supplier_assign.sql (§7 appended, +65 lines)
               supabase/tests/categorization_background_rules.test.sql (DO-block uncommented, RED→GREEN)
        Migration §7 DO-block drains uncategorized backlogs per restaurant:
          - POS loop: calls apply_rules_to_pos_sales_internal(restaurant_id, 5000), 50-round cap per restaurant
          - Bank loop: calls apply_rules_to_bank_transactions_internal(restaurant_id, 1000), 50-round cap per restaurant
          - Per-restaurant i counter reset ensures fair budget across all restaurants
          - BEGIN/EXCEPTION per restaurant so one failure doesn't abort others
          - No-op on empty/new databases (no matching categorization_rules)
        All 1530/1530 pgTAP tests green; 27 tests in categorization_background_rules.test.sql (a–n all pass).

  - [x] Task 6a (plan Task 6 step 1, task 28/36): Check existing stripe-sync unit tests for RPC name assertion; write failing test if needed — commit ae79d4e2
        File: tests/unit/stripe-sync-rpc-name.test.ts (new, 30 lines)
        Checked: tests/unit/stripe-sync-tombstone.test.ts — no RPC name assertion present.
        Created static source-audit test: reads supabase/functions/stripe-sync-transactions/index.ts,
          asserts source contains 'apply_rules_to_bank_transactions_internal'
          AND does not contain 'apply_rules_to_bank_transactions' (the auth-gated public wrapper).
        RED confirmed: test fails — source currently calls public wrapper ('apply_rules_to_bank_transactions'), not internal.
        Vitest output: 1 failed; first assertion fires ("expected ... to contain 'apply_rules_to_bank_transactions_internal'").
  - [x] Task 6b (plan Task 6 step 2, task 29/36): Change stripe-sync-transactions index.ts line 297 RPC from apply_rules_to_bank_transactions to apply_rules_to_bank_transactions_internal with p_batch_limit 1000 — commit bfc02c6b
        File: supabase/functions/stripe-sync-transactions/index.ts (line 297 patched)
        GREEN confirmed: npm run test -- tests/unit/stripe-sync-rpc-name.test.ts → 1 passed.
        Full unit suite: 5279 tests passed (5 pre-existing focus* failures, unrelated to this change).
        typecheck: clean (tsc --noEmit, 0 errors).
        Change: rpc('apply_rules_to_bank_transactions') → rpc('apply_rules_to_bank_transactions_internal', { p_restaurant_id, p_batch_limit: 1000 })
        Comment added explaining why internal engine is needed (auth.uid() is NULL for service-role callers).
        Message: "fix(banking): stripe sync applies rules via internal engine (service-role safe)"
  - [x] Task 6c (plan Task 6 step 3, task 30/36): Run npm run test and npm run typecheck to verify pass
        npm run test: 5279 tests passed (5 pre-existing focus* test file errors, all in tests/unit/focus*.test.ts — unrelated to this change; stripe-sync-rpc-name.test.ts passes individually: 1 passed).
        npm run typecheck: clean (0 errors, tsc --noEmit exit 0).
        No commit needed — verification only step.
  - [x] Task 6d (plan Task 6 step 4, task 31/36): Commit Task 6 (stripe sync applies rules via internal engine, service-role safe) — commit bfc02c6b
        Commit already created in Task 6b phase.
        Commit message: "fix(banking): stripe sync applies rules via internal engine (service-role safe)"
        File: supabase/functions/stripe-sync-transactions/index.ts (line 297 patched)
        Test: tests/unit/stripe-sync-rpc-name.test.ts — 1 passed (GREEN confirmed).
        Change: rpc('apply_rules_to_bank_transactions') → rpc('apply_rules_to_bank_transactions_internal', { p_restaurant_id, p_batch_limit: 1000 })
        Rationale: service-role callers have auth.uid()=NULL; the public wrapper raises 'Permission denied';
        the internal engine skips auth check and is GRANT EXECUTE to service_role only.
        Batch limit 1000 (not 5000) chosen because bank rows create journal entries (heavier per row than POS).

  - [x] Task 7a (plan Task 7 step 1, task 32/36): Write failing RTL component tests for EnhancedCategoryRulesDialog — commit fa490305
        File: tests/unit/enhancedCategoryRulesValidation.test.tsx (new, 305 lines)
        RED confirmed: 4 of 5 tests fail on current code; 1 passes (regression guard):
          (i)  too-generic gate: "payment" + supplierId set → expects toast.error; current code suppresses it (supplier in hasOtherSpecificity)
          (ii) short-pattern guard: 2-char pattern + amountMin → expects no error; current code fires it (!supplierId guard)
          (iii) inline alert suppression: only supplier set → no alert; ALREADY PASSES (regression guard)
          (iv-a) "tagged with this supplier" help text when description present → element missing (RED)
          (iv-b) "already linked to this supplier" help text when supplier-only → element missing (RED)
        Message: "test(banking): RED RTL tests for EnhancedCategoryRulesDialog supplier-assign UI changes"
  - [x] Task 7b (plan Task 7 step 2, task 33/36): Run npm run test to verify component tests fail
        RED confirmed via npm run test -- tests/unit/enhancedCategoryRulesValidation.test.tsx:
        - 4 FAILED: (i) too-generic gate, (ii) short-pattern guard, (iv-a) tagged help text, (iv-b) filter help text
        - 1 PASSED: (iii) inline alert suppression (regression guard)
        - Exact failure reasons match what 7a documented: supplierId in hasOtherSpecificity suppresses (i); !supplierId guard fires (ii); sub-labels missing for (iv-a)/(iv-b)
        No commit needed — verification only step.
  - [x] Task 7c (plan Task 7 step 3, task 34/36): Implement all five changes in EnhancedCategoryRulesDialog.tsx — commit c9344b27
        File: src/components/banking/EnhancedCategoryRulesDialog.tsx
        Changes:
          1. Submit gate (too-generic): removed supplierId from hasOtherSpecificity; error message changed to "Add an amount range..."
          2. Short-pattern guard: condition changed from !supplierId to !amountMin && !amountMax
          3. Inline alert: updated condition to (isEmpty && !supplierId || isGeneric) && !hasOtherCriteria so supplier-only rules don't trigger warning
          4. Supplier help text: conditional sub-label below SearchableSupplierSelector — "tagged with this supplier" when desc/amount set, "already linked to this supplier" when supplier-only
          5. renderRuleConditions: supplier shows "Assigns supplier: X" when rule has desc/amount, "Supplier: X" when supplier-only
          6. A11y: <p> dialog subtitle replaced with <DialogDescription> so Radix wires aria-describedby
        GREEN confirmed: npm run test -- tests/unit/enhancedCategoryRulesValidation.test.tsx → 5/5 passed
        Full suite: 5284 passed (5 pre-existing focus* file errors, unrelated); typecheck clean.

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
