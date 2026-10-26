# Plan: tenant check for `deactivate_employee` and `reactivate_employee`

Design: `docs/superpowers/specs/2026-10-26-employee-activation-rpc-auth-design.md`

## Task 1: Write the failing pgTAP suite

- Create `supabase/tests/employee_activation_rpc_auth.test.sql`.
- Run it against the current functions. Expect failures on the grant checks,
  the cross-tenant checks and the `search_path` check.

## Task 2: Write the migration

- Create `supabase/migrations/20261026120500_secure_employee_activation_rpcs.sql`.
- Run the new suite. Expect all assertions to pass.

## Task 3: Change the old suites

- `supabase/tests/09_employee_activation.sql`: add a JWT `sub` and an `owner`
  membership for the caller.
- `supabase/tests/20260106000000_deactivate_employee_termination_date.sql`:
  add an `owner` membership for the caller.

## Task 4: Verify

- Run `npm run typecheck`, `npm run lint`, `npm run test`.
- Push. CI runs the full pgTAP suite on real Supabase.
