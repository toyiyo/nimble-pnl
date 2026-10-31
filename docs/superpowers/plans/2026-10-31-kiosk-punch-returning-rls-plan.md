# Kiosk punch RLS fix — plan

Design: `docs/superpowers/specs/2026-10-31-kiosk-punch-returning-rls-design.md`

## Task 1 — RED: pgTAP regression test

- Add `supabase/tests/time_punches_kiosk_insert_returning.sql`.
- Seed restaurants R1 and R2, a kiosk user K (role `kiosk` in R1), a staff
  user S with an employee row, a coworker employee CW, and one punch for CW
  created by a different user.
- Assert, as K: `INSERT ... RETURNING` lives; K sees its own punch; K sees 0
  rows created by someone else; K cannot insert into R2.
- Assert, as S: S sees 0 coworker punches.
- Run it. Expect the RETURNING assertion to fail.

## Task 2 — GREEN: migration

- Add `supabase/migrations/20261031120000_time_punches_creator_select.sql`
  with the policy from the design.
- Apply it to the local database. Run the new test and
  `supabase/tests/rls_employee_self_scope.sql`. Expect both to pass.

## Task 3 — E2E (blocked in this session)

- Extend `tests/e2e/kiosk-basic-punch.spec.ts` with a kiosk service account
  case: create the account, sign in on the kiosk, punch, and check the
  success state.
- This session cannot run Playwright: `npm install` fails because the proxy
  blocks `cdn.sheetjs.com`. Write the spec, and let CI run it.

## Task 4 — Verify and ship

- Run the full pgTAP suite against the local database.
- Push the branch and open the PR. CI runs unit, E2E, and SonarCloud.
- After merge, apply the migration to production. The kiosk then works with
  no app deploy.
