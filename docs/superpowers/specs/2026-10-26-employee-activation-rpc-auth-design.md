# Design: tenant check for `deactivate_employee` and `reactivate_employee`

Date: 2026-10-26
Severity: high (security audit, fix 5 of 7)

## Problem

Any caller with an employee UUID can deactivate or reactivate an employee in
any restaurant. The anon key is sufficient.

- `deactivate_employee` is `SECURITY DEFINER` and does no auth check
  (`supabase/migrations/20260106000000_deactivate_employee_termination_date.sql:8-44`).
- `reactivate_employee` is `SECURITY DEFINER` and does no auth check
  (`supabase/migrations/20251209000000_add_employee_activation_tracking.sql:126-151`).
- Neither function sets `search_path`
  (`20260106000000_deactivate_employee_termination_date.sql:44`,
  `20251209000000_add_employee_activation_tracking.sql:151`).
- Neither migration revokes the default `PUBLIC` EXECUTE. The migrations only
  add a grant to `authenticated`
  (`20260106000000_deactivate_employee_termination_date.sql:47`,
  `20251209000000_add_employee_activation_tracking.sql:154-155`).
  The audit shows that `anon` has EXECUTE in production.
- `deactivate_employee` sets `termination_date` and cancels future
  `scheduled` shifts (`20260106000000_deactivate_employee_termination_date.sql:20-41`).
  An attacker can stop payroll for an employee and empty a schedule.
- Both functions write the caller-supplied `p_deactivated_by` /
  `p_reactivated_by` into the audit columns
  (`20260106000000_deactivate_employee_termination_date.sql:26`,
  `20251209000000_add_employee_activation_tracking.sql:144`).
- `reactivate_employee` writes `p_new_hourly_rate` with no check
  (`20251209000000_add_employee_activation_tracking.sql:145`). The hook drops
  the rate when the caller has no `view:pay_rates`
  (`src/hooks/useEmployees.tsx:263-273`). The hook comment says that the UI is
  "not the gate".
- Both functions return the full `employees` row (`RETURNING *`). The column
  grants hide 8 pay and PII columns from `authenticated`, and
  `employees_secure` masks them
  (`supabase/migrations/20260806110000_employee_column_gating.sql:90-97`,
  `:126-133`). The RPC return skips that mask.

## Capability

Use `manage:employees`.

- The employees area grants "hire, edit and terminate" at level `manage`
  (`src/lib/permissions/areaData.ts:76`).
- `user_has_capability` maps `manage:employees` to area `employees`, level
  `manage` (`supabase/migrations/20260805120000_page_areas.sql:377`).
- The legacy role fallback gives `manage:employees` to owner, manager and
  operations_manager (`supabase/migrations/20260805120000_page_areas.sql:259`).

The reference pattern is `update_shift_series`
(`supabase/migrations/20260815110000_allow_update_locked_shift_series.sql:25-36`):
`SECURITY DEFINER`, `SET search_path = public, pg_temp`, then
`IF NOT public.user_has_capability(...) THEN RAISE EXCEPTION`.
The new code adds `USING ERRCODE = '42501'`, `IS NOT TRUE` and a
`REVOKE ... FROM PUBLIC, anon` to that pattern.

## Change

One new migration `supabase/migrations/20261026120500_secure_employee_activation_rpcs.sql`.

1. `CREATE OR REPLACE` both functions with the same signature and return type.
2. At the start, read `restaurant_id` from `public.employees` for
   `p_employee_id`.
3. Raise `42501` when the employee does not exist. Raise the same error when
   `auth.uid()` does not have `manage:employees` in that restaurant. Use
   `IS NOT TRUE`, so a NULL result also denies. With one message for both
   cases, a caller cannot probe for employee ids.
4. In `reactivate_employee`, when `p_new_hourly_rate IS NOT NULL`, also require
   `view:pay_rates`. This is the server gate that the hook comment asks for.
   The UI sends `null` when the caller does not have the flag
   (`src/hooks/useEmployees.tsx:267-273`), so no UI flow breaks.
5. Write `auth.uid()` into `deactivated_by` / `reactivated_by`. The
   `p_deactivated_by` / `p_reactivated_by` parameters stay in the signature
   for compatibility, but the functions ignore them. The only caller passes
   `user.id` (`src/hooks/useEmployees.tsx:219`, `src/hooks/useEmployees.tsx:272`).
   Thus the stored value does not change for real users.
6. Add `AND restaurant_id = v_restaurant_id` to each UPDATE, so the write
   uses the restaurant that the check used.
7. Mask the returned row with the rule of `employees_secure`: pay columns
   need `view:pay_rates`, PII columns need `view:employee_pii`, and the
   employee always sees the own row. The return type does not change.
8. Set `search_path = public, pg_temp`. Qualify all table names with `public.`.
9. Add `COMMENT ON FUNCTION` for both functions. State the capability and the
   ignored actor parameter.
10. `REVOKE EXECUTE ... FROM PUBLIC, anon`. `GRANT EXECUTE ... TO authenticated`.

No service-role bypass. No edge function calls these RPCs (search of
`supabase/functions/` finds no match). `update_shift_series` also has no bypass.

## Frontend

The only callers are `useDeactivateEmployee` and `useReactivateEmployee`
(`src/hooks/useEmployees.tsx:206-296`). They run as `authenticated`. They
show `error.message` in a toast (`src/hooks/useEmployees.tsx:237-243`,
`src/hooks/useEmployees.tsx:288-294`). They only check that `data` is not
null (`src/hooks/useEmployees.tsx:226`, `:277`), so the masked row is safe.
No frontend change is necessary for an authorized caller.

## Tests

New file `supabase/tests/employee_activation_rpc_auth.test.sql`:

- `anon` and `PUBLIC` do not have EXECUTE on the two functions.
- `authenticated` has EXECUTE.
- Both functions are `SECURITY DEFINER` and have `search_path` set.
- A manager of restaurant A cannot deactivate or reactivate an employee of
  restaurant B. The employee row and the shifts of B do not change.
- A `staff` member of B cannot deactivate the employee of B.
- A caller with no JWT cannot deactivate.
- An unknown employee id gives the same `42501` error, for both functions.
- A service-role JWT with no `sub` cannot deactivate.
- Only one overload of each function exists.
- A manager of B can deactivate and reactivate the employee of B. The audit
  column holds `auth.uid()`, not the spoofed parameter.
- A reactivate with a rate and no `view:pay_rates` fails.
- The returned row hides pay and PII from a caller with no flags. A manager
  with the flags gets them.

Change the two old suites that call the RPCs as `postgres` with no membership:
`supabase/tests/09_employee_activation.sql` and
`supabase/tests/20260106000000_deactivate_employee_termination_date.sql`.
Add a membership row and a JWT `sub` so the caller passes the new check.

## Decided trade-offs

- The full Supabase stack cannot start in this cloud session: the container
  registry refuses the image pull ("Data limit exceeded"). Local runs use
  PostgreSQL 16 with pgTAP and a stub schema. CI runs every suite on real
  Supabase.
- No E2E spec. The change is an authorization gate in SQL. The UI flow does not
  change for an authorized user. pgTAP tests the role, the JWT and the RPC
  together.
- `manage:employees` alone is enough to cancel the future shifts on
  deactivate. No `edit:scheduling` check. The shift cancel is a part of the
  termination, as before this change.
- The UI shows the Deactivate and Reactivate actions to view-only roles
  (`src/components/EmployeeList.tsx:334-354`). Their call now fails with a
  toast. A follow-up change hides the actions. This PR keeps the fix in SQL.
- The two functions have the same gate block. A shared helper is not
  necessary for two copies.
- No TLA+ model. There are no new concurrent writers, cursors, or state machines.
