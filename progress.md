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
