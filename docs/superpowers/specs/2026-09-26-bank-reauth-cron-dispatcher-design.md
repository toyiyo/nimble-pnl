# Design: bank-reauth-notices cron dispatcher

Date: 2026-09-26
Branch: `fix/bank-reauth-cron-dispatcher`

## Problem

The `bank-reauth-notices` pg_cron job builds its URL from
`current_setting('app.settings.supabase_url')` without `missing_ok`
(`supabase/migrations/20260723130200_schedule_bank_reauth_notices.sql:202`).
The job also reads `current_setting('app.settings.service_role_key')` without
`missing_ok` (`20260723130200_schedule_bank_reauth_notices.sql:205`).

Production does not set `app.settings.supabase_url`
(`supabase/migrations/20260702160000_focus_crons_gateless.sql:6-9`).
The call raises on each run, and no notice sends.

### Production evidence (read-only SELECTs, 2026-09-26)

- `cron.job` jobid 41, `bank-reauth-notices`, `0 9 * * *`, active.
- `cron.job_run_details` for jobid 41: 64 runs since 2026-07-25. All 64 failed
  with `ERROR:  unrecognized configuration parameter "app.settings.supabase_url"`.
- `public.bank_reauth_notices`: 0 rows. No notice has ever sent.
- `public.connected_banks` with `status = 'requires_reauth'` and a
  `deactivated_at`: 0 rows. The fix does not start a burst of old notices.
- `vault.secrets` has 1 row named `supabase_service_role_key`.
- Edge log: `POST | 200 | https://ncdujvdgqtaunuyigflp.supabase.co/functions/v1/shift-trade-reminders`
  at 2026-09-26 18:15 UTC. That call uses the Vault key through
  `dispatch_shift_trade_reminders()`. The Vault key therefore passes the
  service-role Bearer check.

## Reference fix

PR #812 fixed the same problem for `shift-trade-reminders` with
`public.dispatch_shift_trade_reminders()`
(`supabase/migrations/20260925120000_shift_trade_reminders.sql:419-463`):

- A constant project URL (`:427`).
- The key from `app.settings.service_role_key` with `missing_ok` (`:428`), then
  from the Vault secret `supabase_service_role_key` (`:430-440`).
- With no key, it returns NULL and sends nothing (`:442-444`).
- `REVOKE EXECUTE ... FROM PUBLIC, anon, authenticated` and a grant to
  `service_role` (`:462-463`).
- The cron command is `SELECT public.dispatch_shift_trade_reminders();` (`:474-478`).

## Design

One new migration, `20260926130000_dispatch_bank_reauth_notices.sql`:

1. `CREATE OR REPLACE FUNCTION public.dispatch_bank_reauth_notices() RETURNS bigint`.
   The body is the reference body with the path
   `/functions/v1/bank-reauth-notices`. `SECURITY DEFINER`,
   `SET search_path = public, pg_temp`, `VOLATILE`.
2. The same `REVOKE` and `GRANT` statements as the reference.
3. `cron.unschedule('bank-reauth-notices')` in a `DO` block with an
   `EXCEPTION WHEN OTHERS` guard, then `cron.schedule('bank-reauth-notices',
   '0 9 * * *', $$SELECT public.dispatch_bank_reauth_notices();$$)`.
   The schedule does not change.

The edge function checks the Bearer against `SUPABASE_SERVICE_ROLE_KEY`
(`supabase/functions/bank-reauth-notices/index.ts:56`, `:72-79`). The function
does not change. `verify_jwt = false` stays (`supabase/config.toml:255-256`).

`timeout_milliseconds := 120000` stays as in the reference. The worker sends
email to a small cohort, and the pg_net default of 5 s can cut a run short.

### Other approaches (not taken)

- Add `missing_ok` to the cron command only. The URL is then NULL, and
  `net.http_post` gets a NULL URL. The job fails in a new way and still sends
  nothing. Rejected.
- Set `app.settings.supabase_url` in production by hand. No migration sets
  it, so a new database or a branch database does not get it. The URL guard
  in `20260702160000_focus_crons_gateless.sql:19-20` exists for this reason.
  Rejected.

## Tests (pgTAP)

New file `supabase/tests/76_bank_reauth_cron_dispatcher.test.sql`:

1. The cron job `bank-reauth-notices` has schedule `0 9 * * *`.
2. The cron command calls `public.dispatch_bank_reauth_notices()`.
3. The cron command does not contain `app.settings`.
4. The dispatcher does not read `app.settings.supabase_url`.
5. The dispatcher reads the key setting only with `missing_ok`.
6. With no key setting and no Vault secret, the dispatcher returns NULL.
   The test deletes the Vault secret `supabase_service_role_key` inside the
   test transaction, so the call always runs. `ROLLBACK` restores the secret.
   The reference test skips the call when the secret exists
   (`supabase/tests/73_shift_trade_reminders_schema.test.sql:181-188`). This
   test does not skip.
7. The "no key" call adds no row to `net.http_request_queue`.
8. With a test key in `app.settings.service_role_key`, the dispatcher returns
   a request id.
9. That queue row has the URL
   `https://ncdujvdgqtaunuyigflp.supabase.co/functions/v1/bank-reauth-notices`.
10. That queue row has the header `Authorization: Bearer <test key>`.
11. `anon` cannot execute the dispatcher.
12. `authenticated` cannot execute the dispatcher.
13. `service_role` can execute the dispatcher.

The pg_net worker reads only committed queue rows. The test ends with
`ROLLBACK`, so no request leaves the local database. The `postgres` role can
read `net.http_request_queue` and delete from `vault.secrets` in a local
transaction (checked on the local stack, 2026-09-26).

## E2E

Justified exception: the change is a pg_cron command and a SQL dispatcher. No
page, route, or request path changes. The Playwright suite cannot drive pg_cron.

## TLA+

TLA+: not applicable (no concurrent writers). The cron has one writer. The
edge function already dedupes with `ON CONFLICT DO NOTHING` on
`bank_reauth_notices_once` (`supabase/functions/bank-reauth-notices/index.ts:126`,
constraint at `supabase/migrations/20260723130100_bank_reauth_notices.sql:30`).

## Deploy note

After the merge, the deployer must check that the Vault secret
`supabase_service_role_key` exists and matches the edge function's
`SUPABASE_SERVICE_ROLE_KEY`. On 2026-09-26 the secret exists, and
`shift-trade-reminders` gets HTTP 200 with it. After 09:00 UTC on the next
day, check `cron.job_run_details` for the job named `bank-reauth-notices`
(the reschedule gives it a new jobid) and the edge log for
`POST | 200 | .../functions/v1/bank-reauth-notices`.
