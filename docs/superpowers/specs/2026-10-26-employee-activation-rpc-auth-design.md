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
  the rate when the caller has no `view:pay_rates`, and its comment says that
  the UI is "not the gate" (`src/hooks/useEmployees.tsx:263-273`).

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

## Change

One new migration `supabase/migrations/20261026120500_secure_employee_activation_rpcs.sql`.

1. `CREATE OR REPLACE` both functions with the same signature and return type.
2. At the start, read `restaurant_id` from `public.employees` for
   `p_employee_id`.
3. Raise `42501` with one message when the employee does not exist, or when
   `auth.uid()` does not have `manage:employees` in that restaurant. One
   message for both cases stops a caller from probing for employee ids.
4. In `reactivate_employee`, when `p_new_hourly_rate IS NOT NULL`, also require
   `view:pay_rates`. This is the server gate that the hook comment asks for.
   The UI sends `null` when the caller does not have the flag
   (`src/hooks/useEmployees.tsx:267-273`), so no UI flow breaks.
5. Write `auth.uid()` into `deactivated_by` / `reactivated_by`. The
   `p_deactivated_by` / `p_reactivated_by` parameters stay in the signature
   for compatibility, but the functions ignore them. The only caller passes
   `user.id` (`src/hooks/useEmployees.tsx:219`, `src/hooks/useEmployees.tsx:272`),
   so the stored value does not change for real users.
6. `SET search_path = public, pg_temp`. Qualify all table names with `public.`.
7. `REVOKE EXECUTE ... FROM PUBLIC, anon`. `GRANT EXECUTE ... TO authenticated`.

No service-role bypass. No edge function calls these RPCs (search of
`supabase/functions/` finds no match). `update_shift_series` also has no bypass.

## Frontend

The only callers are `useDeactivateEmployee` and `useReactivateEmployee`
(`src/hooks/useEmployees.tsx:206-296`). They run as `authenticated`, and they
show `error.message` in a toast (`src/hooks/useEmployees.tsx:237-243`,
`src/hooks/useEmployees.tsx:288-294`). No frontend change is necessary.

## Tests

New file `supabase/tests/employee_activation_rpc_auth.test.sql`:

- `anon` and `PUBLIC` do not have EXECUTE on the two functions.
- `authenticated` has EXECUTE.
- Both functions are `SECURITY DEFINER` and have `search_path` set.
- A manager of restaurant A cannot deactivate or reactivate an employee of
  restaurant B. The employee row and the shifts of B do not change.
- A `staff` member of B cannot deactivate the employee of B.
- A caller with no JWT cannot deactivate.
- An unknown employee id gives the same `42501` error.
- A manager of B can deactivate and reactivate the employee of B. The audit
  column holds `auth.uid()`, not the spoofed parameter.
- A reactivate with a rate and no `view:pay_rates` fails.

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
  change for an authorized user. pgTAP covers the seam (role, JWT, RPC).
- No TLA+ model. There are no new concurrent writers, cursors, or state machines.
