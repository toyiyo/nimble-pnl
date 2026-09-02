# Design: raise the focus-backfill-sync cron timeout to 120 s

Date: 2026-09-01
Author: Claude (directive from Jose M Delgado)
Status: approved by user directive ("fix the cron timeout on jobid 28")

## Problem

The `focus-backfill-sync` pg_cron job (production jobid 28) calls the edge
function with `timeout_milliseconds := 5000`. The current definition comes from
[supabase/migrations/20260703120000_focus_backfill_reliability.sql:41-52](../../../supabase/migrations/20260703120000_focus_backfill_reliability.sql).

One backfill run takes 50 to 90 seconds in production. The pg_net worker
aborts the HTTP request after 5 seconds and then retries it. The retry starts
a second edge worker. The first worker continues, because the edge runtime
does not stop a handler when the client disconnects.

Two concurrent workers read the same `sync_cursor` and request the same
business date from Focus. The vendor returns HTTP 400 to one worker. That
worker writes `last_error` on the connection row. The user sees the message
"Focus POS Lynk API returned HTTP 400" in the UI.

The compare-and-swap guard on `sync_cursor` keeps the data correct. The
handler reads the cursor at
`supabase/functions/_shared/focusBackfillSyncHandler.ts:260` and writes it
back with `.eq('sync_cursor', readCursor)` at
`focusBackfillSyncHandler.ts:297-303`. The error is cosmetic, but it repeats
on every 5-minute tick during a backfill.

Evidence from production on 2026-09-01:

- `cron.job_run_details` shows one `net.http_post` enqueue per tick.
- The edge logs show two `focus-backfill-sync` completions from one tick
  (14:36:17 and 14:36:32).
- The `last_error` write at 14:10:28 landed between the order writes of one
  sequential batch. Only a second concurrent worker can do that.

## Decision

Reschedule the `focus-backfill-sync` cron with
`timeout_milliseconds := 120000`. Keep the schedule, URL, headers, and body
identical. The 120-second value covers the slowest observed run (90 s) with
margin, and stays below the Supabase request idle timeout (150 s, see
https://supabase.com/docs/guides/functions/limits).

Note: `cron.unschedule` plus `cron.schedule` assigns a new jobid. The number
28 does not survive this migration. Monitoring and runbooks must key on
`jobname = 'focus-backfill-sync'`, not on the numeric id.

Do not change jobid 37 (`focus-bulk-sync`). Its fan-out with
`generate_series` is intentional
([supabase/migrations/20260704200320_focus_sync_frequency.sql:112-124](../../../supabase/migrations/20260704200320_focus_sync_frequency.sql)),
and its workers claim connections atomically with `FOR UPDATE SKIP LOCKED`
([supabase/migrations/20260704200320_focus_sync_frequency.sql:88](../../../supabase/migrations/20260704200320_focus_sync_frequency.sql)),
so a duplicate dispatch there is safe.

Out of scope: the generic error mapping in
`supabase/functions/_shared/focusLynkClient.ts:380` discards the vendor 400
response body. That is a separate improvement.

## Change

One new migration: `supabase/migrations/20260901120000_focus_backfill_cron_timeout.sql`.

The migration copies the idempotent reschedule pattern from
[supabase/migrations/20260703120000_focus_backfill_reliability.sql:34-52](../../../supabase/migrations/20260703120000_focus_backfill_reliability.sql):

1. `CREATE EXTENSION IF NOT EXISTS pg_cron; CREATE EXTENSION IF NOT EXISTS pg_net;`
2. A `DO` block that calls `cron.unschedule('focus-backfill-sync')` when the
   job exists.
3. `cron.schedule('focus-backfill-sync', '*/5 * * * *', ...)` with the same
   `net.http_post` command and `timeout_milliseconds := 120000`.

Both MCP servers are read-only against production. CI applies the migration
on merge to `main`.

## Tests

One new pgTAP file: `supabase/tests/52_focus_backfill_cron_timeout.sql`.
It follows the pattern of
[supabase/tests/49_focus_backfill_reliability.sql:24-41](../../../supabase/tests/49_focus_backfill_reliability.sql):

1. The `focus-backfill-sync` job exists and keeps the `*/5 * * * *` schedule.
2. The job command contains `timeout_milliseconds := 120000`.
3. The job command does not contain `timeout_milliseconds := 5000`.
4. The job command keeps the hardcoded production URL.
5. The `focus-bulk-sync` job command is unchanged: it keeps
   `timeout_milliseconds := 5000` and the `generate_series` fan-out.

No TypeScript changes. No unit tests.

## Risks

- A slow Focus response can hold a pg_net worker for up to 120 s. The pg_net
  queue is asynchronous, so the cron transaction itself does not wait. Other
  jobs are not blocked.
- If a run exceeds 120 s, the duplicate-worker race returns. The observed
  ceiling is 90 s, but the worst case per business day is higher: the initial
  Lynk call is bounded by `TIMEOUT_MS = 30_000`
  (`supabase/functions/_shared/focusLynkClient.ts:44`), and an "InProgress"
  response adds up to 4 status polls with a 5 s delay and a 30 s bound each
  (`focusLynkClient.ts:47,50`). The budget check in
  `focusBackfillBatch.ts:157` runs before each day, not around each network
  call, so one slow day can push a run to roughly 170 s. This is a residual
  risk. The 120 s value fixes the every-tick race that production shows
  today; it does not make a pathologically slow vendor response safe. If the
  race returns, the next step is a connection-keyed idempotency guard in the
  handler, not a larger timeout.
