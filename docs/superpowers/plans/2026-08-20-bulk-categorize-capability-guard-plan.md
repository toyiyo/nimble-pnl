# Plan: capability guard for bulk_categorize_bank_transactions

Design: docs/superpowers/specs/2026-08-20-bulk-categorize-capability-guard-design.md

## Task 1: RED — pgTAP tests for the capability guard

File: `supabase/tests/22_bulk_categorize_bank_transactions.sql`

1. Add fixtures after the existing R_MAIN block:
   - auth.users row `...000602`, email `bulk-categorize-staff@example.com`.
   - auth.users row `...000603`, email `bulk-categorize-accountant@example.com`.
   - user_restaurants: user `...000602` in R_MAIN (`...000610`) with role `staff`.
   - user_restaurants: user `...000603` in R_MAIN with role `collaborator_accountant`.
   - One bank_transactions row `...000715`, R_MAIN, amount -12.00,
     `transaction_date` `2026-08-01`, uncategorized, not a transfer,
     not reconciled. Warning: the date must sit outside the closed
     fiscal period fixture 2020-01-01 to 2020-01-31
     (supabase/tests/22_bulk_categorize_bank_transactions.sql:156-160).
     A date inside it makes the RPC skip the row with reason
     `closed_period`, and test 24 fails.
2. Add three tests after test 21 (before `finish()`):
   - Test 22: impersonate user `...000602` via
     `set_config('request.jwt.claims', ...)`. Call the RPC with
     `ARRAY['...000715']`, category `...000612`, restaurant `...000610`.
     Assert `throws_like '%Access denied%'`.
   - Test 23: as postgres, check row `...000715` still has
     `is_categorized = false` and no journal entry references it.
   - Test 24: impersonate user `...000603`. Call the RPC with the same
     arguments. Assert `categorized_count = 1`.
   - Restore impersonation to user `...000601` after test 24 if any test
     follows; none does today.
3. Change `plan(34)` to `plan(37)`.
4. Run `npm run db:reset`, then `npm run test:db`. Expect tests 22, 23,
   and 24 to fail on the old function: the staff call in test 22 does
   not raise, so it categorizes row `...000715` as a real side effect;
   test 23 then finds the row already categorized; and test 24 reuses
   the same row and category, so it lands in the "already
   categorized, same category" branch (`unchanged_count`) instead of
   `categorized_count`.

## Task 2: GREEN — the migration

File: `supabase/migrations/20260820100000_bulk_categorize_capability_guard.sql`

1. Header comment: purpose, provenance (full body sourced from
   20260819231210, the only prior definition), pointer to the design doc.
2. `CREATE OR REPLACE FUNCTION public.bulk_categorize_bank_transactions`
   with the 20260819231210 body plus Guard 1b after Guard 1:
   ```sql
   IF NOT public.user_has_capability(p_restaurant_id, 'edit:transactions') THEN
     RAISE EXCEPTION 'Access denied: you cannot edit transactions for this restaurant';
   END IF;
   ```
3. Repeat the REVOKE/GRANT block from 20260819231210:302-304.
4. Run `npm run test:db`. All 37 tests pass.

## Task 3: Documentation amendment

File: `docs/superpowers/specs/2026-08-19-bulk-categorize-journal-entries-design.md`

1. Add one amendment note under the section 5 guard list: the guard is
   membership + `edit:transactions` capability since 2026-08-20. Point to
   the new design doc and migration.

## Task 4: Verify

0. Run `npm run db:reset` first. The shared local db carries a sibling
   branch's migration (20260820120000_bank_delete_rpcs_membership_guard,
   from the modest-mcclintock-f69894 worktree). Its guards make
   supabase/tests/deleted_bank_transactions_tombstone.sql fail in this
   worktree (that suite calls the delete RPCs with `auth.uid()` NULL).
   A reset restores this branch's clean baseline.
1. `npm run test:db` — all suites.
2. `npm run test` — unit suites (no code change expected to affect them).
3. `npm run typecheck`, `npm run lint`, `npm run build`.
4. E2E: run `tests/e2e/bulk-edit-transactions.spec.ts` in the foreground.
   It drives the allowed owner path and must stay green.
5. E2E gate statement: justified exception for the denied path. A role
   without `edit:transactions` also lacks `view:transactions`, so no UI
   flow reaches the RPC for that role. pgTAP test 22 covers the denial at
   the RPC boundary. The allowed path keeps its existing E2E spec.

## Dependencies

Task 1 before Task 2 (RED before GREEN). Task 3 and Task 4 after Task 2.
