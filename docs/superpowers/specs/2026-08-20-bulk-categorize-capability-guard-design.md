# Design: capability guard for bulk_categorize_bank_transactions

Date: 2026-08-20
Branch: claude/elastic-sinoussi-c3d042
Task: add a capability check to the `bulk_categorize_bank_transactions`
RPC. Add pgTAP tests for the new check.

## 1. Problem

`bulk_categorize_bank_transactions` is a SECURITY DEFINER RPC. It checks
only membership: any `user_restaurants` row for `p_restaurant_id` passes
(supabase/migrations/20260819231210_add_bulk_categorize_bank_transactions.sql:66-72).

The RLS UPDATE policy on `bank_transactions` is stricter. It requires
`user_has_capability(restaurant_id, 'edit:transactions')`
(supabase/migrations/20260120100100_update_rls_for_collaborators.sql:174-177).
No later migration replaces that policy (grep for
"Users can update transactions" matches only that file).

SECURITY DEFINER bypasses RLS. A member without `edit:transactions` — a
staff, chef, or kiosk role — can call the RPC directly. The call writes
real journal entries. The old hook path could not do this: it made a
direct UPDATE, and the RLS policy filtered it to zero rows. Commit
f4e049b7 (PR #766) deleted that direct `.update()` call in
src/hooks/useBulkTransactionActions.tsx and added the RPC call.

The membership-only guard was a documented design choice
(docs/superpowers/specs/2026-08-19-bulk-categorize-journal-entries-design.md:124-127,
mirror of migration 20260709120000 lines 57-65). This change tightens
that documented behavior. This document is the design note for the
change.

## 2. Decision: add one capability guard

Add Guard 1b after the membership guard, before every read and write:

```sql
-- Guard 1b: capability. The bank_transactions UPDATE policy requires
-- edit:transactions (20260120100100:174-177). SECURITY DEFINER bypasses
-- that policy, so the function must apply the same gate itself.
IF NOT public.user_has_capability(p_restaurant_id, 'edit:transactions') THEN
  RAISE EXCEPTION 'Access denied: you cannot edit transactions for this restaurant';
END IF;
```

This mirrors the project's existing capability gate in a SECURITY
DEFINER RPC: `update_shift_series` checks
`user_has_capability(p_restaurant_id, 'edit:scheduling')` and raises
`Access denied: ...`
(supabase/migrations/20260815110000_allow_update_locked_shift_series.sql:34-36).

Keep Guard 1 (membership) unchanged. The two guards give two distinct
error messages. A non-member gets `Unauthorized: ...`. A member without
the capability gets `Access denied: ...`. pgTAP test 1 pins the first
message (supabase/tests/22_bulk_categorize_bank_transactions.sql:168-176).

`edit:transactions` also matches the INSERT policy on `journal_entries`
(supabase/migrations/20260120100100_update_rls_for_collaborators.sql:319-322),
the other table this RPC writes. One capability covers both write targets.

## 3. Who keeps access, who loses it

`user_has_capability` resolves `edit:transactions` on two paths:

- Legacy role string: `owner`, `manager`, `collaborator_accountant`
  (supabase/migrations/20260806140000_legacy_role_sensitive_flags.sql:92).
- Custom role (`role_id` set): any role whose areas grant
  `transactions` at level `manage`
  (supabase/migrations/20260806140000_legacy_role_sensitive_flags.sql:246).

The function fails closed: no membership row returns FALSE
(20260806140000, `IF NOT FOUND THEN RETURN FALSE`).

Losers: members with the roles `staff`, `chef`, `kiosk`,
`operations_manager`, `collaborator_operations_manager`, and custom
roles without `transactions` at level `manage`. None of these reach the
bulk categorize UI: the `bank_transactions` SELECT policy requires
`view:transactions`, and the same roles lack that capability too
(supabase/migrations/20260120100100_update_rls_for_collaborators.sql), so
the Transactions page shows them no rows. Only a direct RPC call loses
access. That is the hole this change closes.

## 4. Caller audit (per the 2026-07-04 / 2026-07-22 lessons)

Every caller of `bulk_categorize_bank_transactions`:

| Caller | Identity | Effect of the new guard |
|---|---|---|
| src/hooks/useBulkTransactionActions.tsx:111 | authenticated user client | Pass for every role the UI admits |
| tests/unit/useBulkTransactionActions.test.ts | mock | none |
| supabase/tests/22_bulk_categorize_bank_transactions.sql | impersonated user 601, role `owner` | Pass — owner holds `edit:transactions` |
| supabase/migrations/20260819232450 | comment only, not a call | none |

No service-role client, edge function, or pg_cron job calls this RPC.
`auth.uid()` is never NULL on a live path.

## 5. Migration

New file: `supabase/migrations/20260820100000_bulk_categorize_capability_guard.sql`.

- Full-body `CREATE OR REPLACE FUNCTION`, sourced from the only prior
  definition, 20260819231210 (checked: no later migration redefines it;
  origin/main tip f4e049b7 adds none). Provenance comment in the header.
- The only body change: Guard 1b, inserted after Guard 1.
- Keep `SECURITY DEFINER`, `SET search_path = public, pg_temp`,
  `SET statement_timeout TO '120s'`, and the existing REVOKE/GRANT block.
- No prefix collision: no `20260820*` migration exists on the branch or
  on origin/main.

## 6. Tests (pgTAP)

Change `supabase/tests/22_bulk_categorize_bank_transactions.sql`:

- New fixtures: a staff user and a collaborator_accountant user, both
  members of R_MAIN. One extra uncategorized transaction for the
  accountant test.
- New test A: impersonate the staff user, call the RPC,
  `throws_like '%Access denied%'`.
- New test B: after test A, check the target row is still uncategorized.
  This pins fail-closed behavior.
- New test C: impersonate the collaborator_accountant, call the RPC,
  check `categorized_count = 1`. This pins that the guard does not
  remove an existing privilege (the PR #633 lesson: a guard that drops a
  live role's access is a regression dressed as a security fix).
- Update `plan(34)` to the new count.
- Existing tests keep their impersonation of user 601 (`owner`) and stay
  green.

## 7. Out of scope

- `bulk_delete_bank_transactions`: its membership-check gap is tracked
  by a separate follow-up task
  (docs/superpowers/specs/2026-08-19-bulk-categorize-journal-entries-design.md:79).
  That task is in flight on the sibling worktree modest-mcclintock-f69894
  (migration 20260820120000_bank_delete_rpcs_membership_guard.sql).
- `categorize_bank_transaction` (single row): membership-only today
  (supabase/migrations/20260709120000_categorize_preserve_metadata_on_noop.sql:57-65).
  The design review marked this gap `major`: a caller without
  `edit:transactions` can call the single-row RPC in a loop and get the
  effect the new bulk guard blocks. The task brief scopes this change to
  the bulk RPC only. Action: a tracked follow-up task exists for the
  single-row RPC (created 2026-08-20, same guard pattern). The bulk fix
  still has value on its own: it removes the 500-rows-per-call surface
  and it sets the guard pattern the follow-up copies.
- Frontend: no change. The RPC signature is unchanged, so
  src/integrations/supabase/types.ts is unchanged.

## 8. E2E position

tests/e2e/bulk-edit-transactions.spec.ts already drives the allowed path
(owner bulk-categorizes two rows through the UI) and must stay green.
The denied path is a direct-RPC surface with no reachable UI: a role
without `edit:transactions` also lacks `view:transactions`, so the page
lists no rows to select. pgTAP covers the denial at the RPC boundary.
No new E2E spec.

## 9. Documentation

Add a short amendment note to
docs/superpowers/specs/2026-08-19-bulk-categorize-journal-entries-design.md
section 5, under the guard list: the membership-only guard was replaced
by membership + capability on 2026-08-20, with a pointer to this
document and the new migration.
