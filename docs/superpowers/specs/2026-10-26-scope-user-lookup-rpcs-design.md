# Scope the user-lookup RPCs to the caller's tenants

Date: 2026-10-26
Audit: security audit 2026-10-26, fix 6 of 7 (medium).

## Problem

Two SECURITY DEFINER functions leak user data across tenants.

- `public.get_users_by_ids(uuid[])` returns `email` and `full_name` from
  `auth.users` for any id. It has no tenant check
  (`supabase/migrations/20260104000001_add_get_users_by_ids_function.sql:14-20`).
  The migration grants EXECUTE to `authenticated` only (line 25), but the
  default PUBLIC grant stays, so `anon` can call it.
- `public.verify_employee_can_login(p_user_id)` uses
  `COALESCE(p_user_id, auth.uid())`
  (`supabase/migrations/20251209000001_add_inactive_employee_auth_blocking.sql:46`).
  It returns the employee name and active state for any id. For an inactive
  employee it writes an `auth_audit_log` row for that id (lines 66-83). The
  migration grants EXECUTE to `anon` (line 106).

## Callers

- `get_users_by_ids`: one caller, `src/hooks/useTipSplitAuditLog.ts:45`. It
  runs after sign-in. It asks for the actors in the tip-split audit log of the
  selected restaurant. It uses the result only when `profiles` has no row for
  the actor (lines 52-61).
- `verify_employee_can_login`: no caller in `src/` or `supabase/functions/`.
  Only the generated types (`src/integrations/supabase/types.ts:12472`) and the
  pgTAP test refer to it. No path runs before sign-in or with the service role.

## Design

New migration `supabase/migrations/20261026120600_scope_user_lookup_rpcs.sql`.

1. `get_users_by_ids`: keep the return shape. Change the body to
   `LANGUAGE sql STABLE`. Return a row only when an `EXISTS` join of
   `user_restaurants` (caller side on `auth.uid()`, target side on the id)
   finds a shared restaurant. Other ids give no row, not an error. A caller
   with no JWT gets no rows.
2. `verify_employee_can_login`: keep the signature, so the generated types do
   not change. Use `auth.uid()` only. Raise `42501` when `auth.uid()` is NULL.
   Raise `42501` when `p_user_id` is not NULL and differs from `auth.uid()`.
   The raise comes before any read or audit write.
3. Both functions: `SET search_path = ''` and schema-qualified names.
4. Both functions: `REVOKE ALL ... FROM PUBLIC, anon` and
   `GRANT EXECUTE ... TO authenticated`. `CREATE OR REPLACE` keeps the old ACL,
   so the revoke is necessary.

No other function changes.

## Trade-off

The audit log can show an actor who later left the restaurant. That actor has
no `user_restaurants` row, so `get_users_by_ids` gives no row for that actor.
The hook then shows the entry with no user name. The `profiles` lookup runs
first, so this case occurs only when `profiles` also has no row. We accept
this. The other choice, a lookup through the audit log rows, would tie a
generic function to one table.

## Alternatives

- Raise an error for an out-of-tenant id in `get_users_by_ids`. Rejected: one
  former member in a list would break the whole audit view.
- Drop `verify_employee_can_login`. Rejected: the task scope is a fix, not a
  delete, and a later client can use the function after sign-in.

## TLA+ check

The change has no concurrent writers, cursors, locks, or retries. The
`run-tla` trigger list does not match.

## Tests

`supabase/tests/scope_user_lookup_rpcs.test.sql` (16 tests): grants for
`anon` and `authenticated`, `search_path`, anon call denied, coworker row,
no row for another tenant, mixed list, user with no restaurant, own data with
and without `p_user_id`, `42501` for another user, no audit row for a
rejected call, inactive own account blocked, no JWT rejected.

`supabase/tests/20251209000001_add_inactive_employee_auth_blocking.sql`: tests
1-4 now sign in as the user they check.
