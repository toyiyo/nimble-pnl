# Plan: bank-reauth-notices cron dispatcher

Design: `docs/superpowers/specs/2026-09-26-bank-reauth-cron-dispatcher-design.md`
Branch: `fix/bank-reauth-cron-dispatcher`

## Task 1: pgTAP test (RED)

1. Write `supabase/tests/76_bank_reauth_cron_dispatcher.test.sql` with the 10
   cases from the design, section "Tests (pgTAP)".
2. Use `BEGIN; SELECT plan(10); ... SELECT * FROM finish(); ROLLBACK;`.
3. Copy the "no key" guard from
   `supabase/tests/73_shift_trade_reminders_schema.test.sql:178-188`.
4. Run `npm run db:reset`, then run the file with `npx supabase test db`.
5. Expect failures: the dispatcher does not exist, and the cron command still
   reads `app.settings`.

## Task 2: migration (GREEN)

1. Write `supabase/migrations/20260926130000_dispatch_bank_reauth_notices.sql`.
2. Add `public.dispatch_bank_reauth_notices()` with the reference body and the
   path `/functions/v1/bank-reauth-notices`.
3. Add the `COMMENT`, the `REVOKE`, and the `GRANT`.
4. Unschedule and reschedule `bank-reauth-notices` at `0 9 * * *` with
   `SELECT public.dispatch_bank_reauth_notices();`.
5. Run `npm run db:reset` and the full `npm run test:db`. Expect all green.
6. Commit the test and the migration together.

## Task 3: verify and ship

1. Run `npm run test:db`, `npm run typecheck`, `npm run lint`, `npm run build`,
   and `npm run test`.
2. Open the PR. The PR body tells the deployer to check the Vault secret
   `supabase_service_role_key` and the first run after 09:00 UTC.
