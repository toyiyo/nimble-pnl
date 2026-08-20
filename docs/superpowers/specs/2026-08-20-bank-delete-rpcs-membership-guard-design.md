# Design: Membership guard for the bank delete RPCs

Date: 2026-08-20
Branch: fix/bank-delete-rpcs-membership-guard
Author: Claude (task from Jose Delgado)

## Problem

Four SECURITY DEFINER functions delete or restore bank data. Each function
has `GRANT EXECUTE ... TO authenticated`. No function checks that the caller
is a member of `p_restaurant_id`. The caller supplies `p_restaurant_id` as an
argument. An authenticated user from one tenant can pass another tenant's
`restaurant_id` and delete that tenant's data.

The four functions live in
`supabase/migrations/20260301000001_update_delete_functions_with_tombstone.sql`.
This migration holds the latest definition of each function
(later migrations do not redefine them; only
`20260201153920_add_bulk_delete_bank_transactions.sql` and
`20260201170000_fix_delete_bank_transaction_security.sql` touch these names,
and both are earlier):

| Function | Definition | SECURITY DEFINER | Grant |
|---|---|---|---|
| `delete_bank_transaction(uuid, uuid)` | lines 10–87 | line 16 | line 90 |
| `bulk_delete_bank_transactions(uuid[], uuid)` | lines 100–180 | line 106 | line 183 |
| `restore_deleted_transaction(uuid, uuid)` | lines 194–280 | line 200 | line 283 |
| `permanently_delete_tombstone(uuid, uuid)` | lines 293–324 | line 299 | line 327 |

Each function filters rows by `p_restaurant_id` only. Example:
`bulk_delete_bank_transactions` validates that the transactions belong to
`p_restaurant_id` (lines 113–130) and then deletes them (lines 163–170). The
only use of `auth.uid()` is the tombstone `deleted_by` value (line 157 for
bulk, line 68 for single). The prior "security fix" migration
(`20260201170000_fix_delete_bank_transaction_security.sql:20-31`) validated
the transaction-to-restaurant link, not the caller's membership. The gap has
existed since that migration.

Impact per function for a cross-tenant caller:

- `delete_bank_transaction`: deletes one `bank_transactions` row and its
  `bank_transaction_splits` rows (lines 73–79).
- `bulk_delete_bank_transactions`: deletes many rows and their splits
  (lines 163–170).
- `restore_deleted_transaction`: deletes tombstones and inserts rows into
  `bank_transactions` (lines 231, 249–272).
- `permanently_delete_tombstone`: deletes a tombstone, which re-opens the
  re-import path for that transaction (lines 305–307).

## Fix

Add a caller membership guard as the first statement of each function body.
Use the exact pattern from `categorize_bank_transaction`
(`supabase/migrations/20260709120000_categorize_preserve_metadata_on_noop.sql:57-65`):

```sql
IF NOT EXISTS (
  SELECT 1
  FROM user_restaurants
  WHERE restaurant_id = p_restaurant_id
    AND user_id = auth.uid()
) THEN
  RAISE EXCEPTION 'Unauthorized: user does not have access to this restaurant';
END IF;
```

`user_restaurants` is the canonical membership table. The access helper
`user_has_restaurant_access` reads the same table
(`supabase/migrations/20260521222200_create_user_has_restaurant_access_helper.sql:30-39`).
Collaborator roles are rows in `user_restaurants` with a `role` value, so the
guard does not block collaborators.

One new migration re-creates all four functions with the guard. The rest of
each body stays byte-identical. `CREATE OR REPLACE` keeps the existing
grants. Migration file:
`supabase/migrations/20260820120000_bank_delete_rpcs_membership_guard.sql`.

## Approaches considered

1. **Inline EXISTS guard per function (chosen).** Matches the
   `categorize_bank_transaction` precedent and the task instruction. No new
   dependency.
2. **Call `user_has_restaurant_access(p_restaurant_id)`.** Same table, same
   result. Rejected: the categorize precedent inlines the check, and the
   task instruction names the inline pattern.
3. **Revoke EXECUTE and route through an edge function.** Rejected: large
   blast radius for the client hooks, no added protection over the guard.

## Caller impact

Only client hooks call these RPCs. No edge function calls them (grep over
`supabase/functions/` finds no reference).

- `src/hooks/useBankTransactions.tsx:465` — `delete_bank_transaction`.
- `src/hooks/useBulkTransactionActions.tsx:308` — `bulk_delete_bank_transactions`.
- `src/hooks/useDeletedBankTransactions.tsx:85,95` — restore and
  permanent-delete.

Each hook passes the selected restaurant's id from the app context. A
legitimate caller is a member of that restaurant, so the guard passes. The
guard raises only for cross-tenant calls, which surface as an RPC error in
the hooks' existing error paths.

Service-role note: `auth.uid()` is NULL for service-role calls, so the guard
would raise. No edge function or cron job calls these four functions, so no
service path breaks.

## Tests

### pgTAP (new file `supabase/tests/65_bank_delete_rpcs_membership_guard.sql`)

Impersonation via `set_config('request.jwt.claims', '{"sub":"<uuid>","role":"authenticated"}', true)`,
same as `supabase/tests/22_bulk_categorize_bank_transactions.sql:163`.

Fixtures: victim restaurant with a connected bank, transactions, splits, and
one tombstone; a member user of the victim restaurant; an attacker user who
is a member of a different restaurant only.

Tests, attacker impersonated (each of the four functions):
- `throws_ok` with message `Unauthorized: user does not have access to this restaurant`.
- Target rows stay intact after the failed call.

Tests, member impersonated:
- Each of the four functions returns `success: true` on the victim
  restaurant's own data.

Test, no JWT claims (`auth.uid()` NULL):
- `bulk_delete_bank_transactions` raises. This pins the service-role
  behavior.

### pgTAP (change existing file)

`supabase/tests/deleted_bank_transactions_tombstone.sql` calls all four
functions as `postgres` with no JWT claims (lines 158–165, 189–196, 212–219,
237–244, 268–275, 294–301, 315–322). After the guard, these calls raise. Fix:
add an `auth.users` row plus a `user_restaurants` membership for the test
restaurant, and set the JWT claims before the functional tests.

### E2E (new file `tests/e2e/bank-delete-cross-tenant.spec.ts`)

The seam is: browser client → PostgREST → RPC. Unit tests do not cover it.

- Sign up user A, create restaurant A, seed a connected bank and one
  transaction (same seed shape as `tests/e2e/bulk-edit-transactions.spec.ts`).
- Sign up user B in a second browser context, create restaurant B.
- As user B, call `supabase.rpc('bulk_delete_bank_transactions', ...)` with
  restaurant A's id. Expect an error.
- As user A, confirm the transaction still exists.
- As user A, call the same RPC on own data. Expect success. This pins the
  no-regression path.

## Out of scope

- A repository-wide audit of other SECURITY DEFINER functions. The sibling
  branch `fix/secdef-execute-grants` tracks related work.
- RLS changes on `bank_transactions` or `deleted_bank_transactions`.
- Type regeneration: no function signature changes.

## Decided trade-offs

- The guard raises an exception instead of returning
  `jsonb_build_object('success', false, ...)`. This matches
  `categorize_bank_transaction` and makes cross-tenant calls loud. The
  hooks already treat RPC errors as failures.
