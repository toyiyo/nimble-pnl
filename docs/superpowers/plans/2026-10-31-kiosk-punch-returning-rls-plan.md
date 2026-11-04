# Kiosk punch RLS fix — plan

Design: `docs/superpowers/specs/2026-10-31-kiosk-punch-returning-rls-design.md`

## Task 1 — RED: pgTAP regression test

- Add `supabase/tests/time_punches_kiosk_insert_returning.sql`.
- Seed restaurants R1 and R2, a kiosk user K (role `kiosk` in R1), a staff
  user S with an employee row, a coworker employee CW, and one punch for CW
  created by a different user.
- Assert every case in the design "Tests" section: RETURNING lives, the
  5-minute window, the membership check, staff self-scope, the R2 insert
  block, and a manager bulk RETURNING.
- Run it. Expect the RETURNING assertion to fail.

## Task 2 — GREEN: migration

- Add `supabase/migrations/20261031120000_time_punches_creator_select.sql`
  with the bounded policy from the design (5-minute window, membership check,
  `lock_timeout`).
- Apply it to the local database. Run the new test and
  `supabase/tests/rls_employee_self_scope.sql`. Expect both to pass.

## Task 3 — E2E

- Add `tests/e2e/kiosk-service-account-punch.spec.ts`. Seed an employee and a
  PIN as the owner, change the role to `kiosk`, punch, and check the stored row.
- Move `setUserRole` and a new `seedEmployeeWithPin` into
  `tests/helpers/e2e-supabase.ts`.

## Task 3b — Review fixes

- Add `supabase/migrations/20261031120100_employee_tips_kiosk_insert.sql` and
  `supabase/tests/employee_tips_kiosk_insert.sql`.
- Add `supabase/functions/_shared/kioskAccountRetire.ts`, its unit test, and
  use it in `create-kiosk-service-account`.
- Extend the E2E spec with a clock-out and a tip.

## Task 4 — Verify and ship

- Run the full pgTAP suite against the local database.
- Push the branch and open the PR. CI runs unit, E2E, and SonarCloud.
- Before the production apply, run the `pg_policies` query from the design and
  compare it with local.
- After merge, apply the migration to production. The kiosk then works with
  no app deploy.
- File follow-up issues for each item in the design "Decided trade-offs".
- Follow the "Data recovery" steps in the design. Let each kiosk queue flush
  before a manager enters missing punches by hand.
