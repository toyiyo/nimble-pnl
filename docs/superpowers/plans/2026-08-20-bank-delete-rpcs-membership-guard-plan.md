# Plan: Membership guard for the bank delete RPCs

Date: 2026-08-20
Design: docs/superpowers/specs/2026-08-20-bank-delete-rpcs-membership-guard-design.md
Branch: fix/bank-delete-rpcs-membership-guard

Each task is small and commits on its own. Tasks 1–2 follow TDD order:
tests first (RED), then the migration (GREEN).

## Task 1 — pgTAP guard tests (RED)

Create `supabase/tests/65_bank_delete_rpcs_membership_guard.sql`.

Fixtures (all ids in a reserved `65...` uuid range, `ON CONFLICT` safe):
- `auth.users`: member user, attacker user.
- Victim restaurant + `user_restaurants` row for the member user.
- Attacker restaurant + `user_restaurants` row for the attacker user.
- Victim `connected_banks` row, four `bank_transactions` rows, one
  `bank_transaction_splits` row, one tombstone row (insert direct into
  `deleted_bank_transactions`).

Tests (plan count matches the test bodies):
1. Attacker claims set. `throws_ok` for each of the four functions with
   message `Unauthorized: user does not have access to this restaurant`
   (4 tests).
2. Victim rows stay intact after the four failed calls: transaction count,
   split count, tombstone count (3 tests).
3. No claims set (`auth.uid()` NULL). `throws_ok` for each of the four
   functions (4 tests).
4. Member claims set. `delete_bank_transaction` returns `success: true`;
   `bulk_delete_bank_transactions` returns `success: true`;
   `restore_deleted_transaction` returns `success: true`;
   `permanently_delete_tombstone` returns `success: true` (4 tests).

Run `npm run test:db`. The new file must fail (attacker calls succeed
today). Commit the RED state is not allowed to break CI on main — the
commit for this task lands together with Task 2 only if the runner blocks
red commits; otherwise commit RED first, then Task 2 turns it GREEN.

## Task 2 — Guard migration (GREEN)

Create
`supabase/migrations/20260820120000_bank_delete_rpcs_membership_guard.sql`.

- `CREATE OR REPLACE` all four functions from
  `20260301000001_update_delete_functions_with_tombstone.sql` with the
  membership guard as the first statement in each `BEGIN` block.
- Guard text identical to
  `20260709120000_categorize_preserve_metadata_on_noop.sql:57-65`.
- Keep bodies byte-identical otherwise. Keep `SECURITY DEFINER`,
  `SET search_path = public`, grants, and comments.
- Run `npx supabase db reset` then `npm run test:db`. All green.

## Task 3 — Update the existing tombstone test

Change `supabase/tests/deleted_bank_transactions_tombstone.sql`:
- Add an `auth.users` fixture row and a `user_restaurants` membership for
  restaurant `a0000000-0000-0000-0000-000000000001`.
- Set `request.jwt.claims` before the functional tests (Test 13 on).
- Plan count stays 27.
- Run `npm run test:db`. All green.

## Task 4 — E2E cross-tenant spec

Create `tests/e2e/bank-delete-cross-tenant.spec.ts`:
- User A: `signUpAndCreateRestaurant`, `exposeSupabaseHelpers`, seed
  `connected_banks` + one `bank_transactions` row (seed shape from
  `tests/e2e/bulk-edit-transactions.spec.ts`).
- User B in a second browser context: sign up, own restaurant.
- User B calls `supabase.rpc('bulk_delete_bank_transactions', ...)` with
  restaurant A's id. Assert the RPC returns an error.
- User A confirms the transaction still exists.
- User A calls the same RPC on own data. Assert success and row gone.
- Run the spec locally.

## Task 5 — Full verify

- `npm run test`, `npm run test:db`, `npm run typecheck`, `npm run lint`,
  `npm run build`, and the new E2E spec.
- E2E gate statement: Covered — `tests/e2e/bank-delete-cross-tenant.spec.ts`
  asserts the cross-tenant denial and the member success path end to end.

## Dependencies

Task 2 depends on Task 1 (TDD order). Task 3 depends on Task 2. Task 4
depends on Task 2. Task 5 depends on all.
