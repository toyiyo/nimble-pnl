# Stale pending outflows: 60-day runway rule and a daily cron — design

Status: draft for review. Text is STE-aligned.

Follow-up to `docs/superpowers/specs/2026-09-30-runway-30-day-burn-design.md`
(PR #837), section 6.1.

## 1. Problem

Two defects remain in the cash runway (milestone M2).

### 1.1 Old open outflows reduce the book balance

`useLiquidityMetrics` reads every open pending outflow and subtracts the sum
from the bank balance:

- `src/hooks/useLiquidityMetrics.tsx:71-75` selects `amount, status` with
  `status IN ('pending','stale_30','stale_60','stale_90')`. It has no date
  filter.
- `src/hooks/useLiquidityMetrics.tsx:79-80` sets
  `bookBalance = currentBalance - totalPendingOutflows`.
- `src/hooks/useLiquidityMetrics.tsx:129-139` divides `bookBalance` by the
  net daily burn to get `daysOfCash`.

A check that does not clear in 60 days is almost never a real future
withdrawal. It is a lost check, a void that nobody recorded, or a data entry
error. Prod data (read-only queries, 2026-09-30):

- One restaurant has 51 open rows, $56,191. Only $494 is 0-30 days old.
  $40,134 is more than 90 days old. One row has an `issue_date` in 2005.
- 8 restaurants hold $384,634 of open outflows older than 90 days.

### 1.2 The stale statuses never get set

- `public.mark_stale_pending_outflows()` exists
  (`supabase/migrations/20251107172140_a7b1bc64-aaa5-4a65-83ab-a21a18c9df0d.sql:14-37`).
  It moves `pending` rows to `stale_30` (30-59 days), `stale_60` (60-89 days)
  and `stale_90` (90+ days) by `issue_date`.
- No pg_cron job calls it. Prod `cron.job` has 16 jobs and none of them
  calls this function (checked 2026-09-30).
- Prod status counts: `pending` 247, `cleared` 469, `voided` 11, no
  `stale_*` row.
- The UI has labels for the stale statuses
  (`src/components/pending-outflows/PendingOutflowCard.tsx:52-66`), but no
  user sees them.

## 2. Goals

1. The runway subtracts only open outflows with an `issue_date` in the last
   60 days, or in the future.
2. A daily pg_cron job calls `mark_stale_pending_outflows()`, so old rows show
   as Stale on the pending outflows page.

Not goals: no change to the burn math, no change to P&L or expense readers,
no change to the pending outflows page layout.

## 3. Approach

### 3.1 Options for the 60-day rule

| Option | Rule | Result |
|---|---|---|
| A (recommended) | `issue_date >= today - 59 days` plus the current status list | Correct today, with no dependency on the cron job. Easy to test. |
| B | Status in (`pending`, `stale_30`) only | Correct only after the cron job runs. Wrong for up to 1 day after a row ages. Wrong if the cron job stops. |
| C | Both A and B | No gain over A. Two rules to keep in sync. |

Option A. The cutoff equals the `stale_60` boundary in the SQL function
(`issue_date <= CURRENT_DATE - 60 days` is stale_60). So after the cron runs,
"inside the window" equals "status is `pending` or `stale_30`". The two
features agree.

### 3.2 Hook change (`src/hooks/useLiquidityMetrics.tsx`)

- Add an exported constant `OPEN_OUTFLOW_WINDOW_DAYS = 60`.
- Compute the cutoff from the current date, not from `endDate`. The bank
  balance at `:59-68` is the current balance, so the outflows that reduce it
  must also be current:

  ```ts
  const outflowCutoff = format(subDays(new Date(), OPEN_OUTFLOW_WINDOW_DAYS - 1), 'yyyy-MM-dd');
  ...
    .in('status', ['pending', 'stale_30', 'stale_60', 'stale_90'])
    .gte('issue_date', outflowCutoff);
  ```

- Keep the status list. It excludes `cleared` and `voided` rows.
- `issue_date` is `NOT NULL` in prod (`information_schema`, checked
  2026-09-30). No null case.
- Future-dated rows (post-dated checks) stay in the sum. `.gte` keeps them.
  Prod has 0 such rows today.
- The query key does not change. `staleTime` is 30 s
  (`src/hooks/useLiquidityMetrics.tsx:210`). This only marks the data stale.
  A refetch occurs on the next mount or window focus (`:211-212`). See
  trade-off 6.6.

No other line of the hook changes. No markup changes, but the shown numbers
change. The runway on `src/pages/Index.tsx`, on
`src/components/BankSnapshotSection.tsx` and on
`src/components/banking/LiquidityTab.tsx` all come from `bookBalance`. The
`recommendation` text (`:181-192`, shown at `LiquidityTab.tsx:103`) now cites
the in-window amount.

### 3.3 Cron migration (`supabase/migrations/<timestamp>_schedule_mark_stale_pending_outflows.sql`)

- Use the idempotent pattern from
  `supabase/migrations/20260925120000_shift_trade_reminders.sql:465-478`:
  `cron.unschedule` in a `DO` block, then `cron.schedule`.
- Job name `mark-stale-pending-outflows`. Schedule `15 6 * * *` (06:15 UTC,
  daily). The database time zone is UTC (prod `current_setting('TimeZone')`).
  06:15 UTC is after midnight in all US zones. Minute 15 avoids the jobs at
  minute 0.
- Command: `SELECT public.mark_stale_pending_outflows();`. It is plain SQL,
  so no Vault secret and no `net.http_post` is necessary.
- Revoke `EXECUTE` on the function from `PUBLIC`, `anon` and `authenticated`.
  Today all three have it (prod `proacl`). The function is `SECURITY INVOKER`,
  so RLS limits the damage, but no client calls it (no match in `src/` or
  `supabase/functions/`). Then grant `EXECUTE` to `postgres` and
  `service_role`, as the precedent migrations do. `postgres` owns the
  function, so the grant to it is explicit but not necessary.
- File name: `20260930120000_schedule_mark_stale_pending_outflows.sql`. The
  last migration on main is `20260928120000`. Check `ls supabase/migrations`
  again before the PR.
- The function body does not change.
- The migration does not run the function once. The first cron run does
  the backfill within 24 hours of the deploy.

### 3.4 Effect on prod data after the deploy (state to the user)

The first cron run changes the status of these prod rows (counts from a
read-only query, 2026-09-30):

| New status | Rows |
|---|---|
| `stale_30` | 81 |
| `stale_60` | 19 |
| `stale_90` | 70 |
| Total | 170 rows in 8 restaurants, table `pending_outflows` |

Only the `status` column and `updated_at` (trigger
`update_pending_outflows_updated_at`) change. No row is deleted. Amounts do
not change. The plan approval is the user's approval for this write.

## 4. Readers of the stale statuses

A cron job moves rows out of `pending`. Each reader must still treat a
`stale_*` row as open. I checked each one:

| Reader | Accepts `stale_*` | Citation |
|---|---|---|
| `auto_link_pending_outflows_internal` | yes | `supabase/migrations/20260830130000_auto_link_categorized_eligibility.sql:112`, `:233` |
| `unlink_pending_outflow` (and the auto-link undo) | yes, it recomputes the stale status | `supabase/migrations/20260830100100_unlink_pending_outflow.sql:135-137`, `20260830130000_...:602-604` |
| `suggest_pending_outflow_matches` | yes | `supabase/migrations/20260830100400_suggest_matches_per_transaction_rank.sql:91` |
| `drain_categorization_backlog` | yes | prod `pg_get_functiondef` (checked 2026-09-30) |
| `usePendingOutflows` matching | yes | `src/hooks/usePendingOutflows.tsx:12`, `:435` |
| `PendingOutflowsList`, `PendingOutflowCard` | yes | `src/components/pending-outflows/PendingOutflowsList.tsx:41`, `:61`; `PendingOutflowCard.tsx:177` |
| `useMonthlyMetrics`, `useTopVendors`, `expenseDataFetcher`, `cogsFetch` | yes | `src/hooks/useMonthlyMetrics.tsx:355`, `src/hooks/useTopVendors.tsx:60`, `src/lib/expenseDataFetcher.ts:147`, `src/services/cogsFetch.ts:93` |
| `periodLaborCost`, AI tools | yes | `supabase/functions/_shared/labor/periodLaborCost.ts:319`, `supabase/functions/ai-execute-tool/index.ts:2482`, `:2537` |
| `Expenses` page book balance | yes | `src/pages/Expenses.tsx:44-48` |

No reader filters on `status = 'pending'` alone. No reader keys a cache on
`pending_outflows.updated_at`. So the cron job changes only the label that
users see.

## 5. Tests

### 5.1 Unit (`tests/unit/useLiquidityMetrics.test.tsx`)

The existing builder (`createResolvingBuilder`) has `select`, `eq` and `in`.
Add `gte` to it. Use `vi.useFakeTimers()` with a fixed "now".

- The pending-outflows query calls `.gte('issue_date', <today - 59 days>)`.
  Check the exact string on a fixed date, and on a month edge.
- The returned `bookBalance` equals `currentBalance - sum(mocked rows)`
  (the mock returns only the rows that the filter keeps).
- `OPEN_OUTFLOW_WINDOW_DAYS` is 60.
- Outcome change: a balance of 10,000, a net burn of 100 per day and in-window
  outflows of 500 give `daysOfCash` 95 and `runwayStatus` `healthy`. Use the
  existing mocks. This pins the math for the in-window rows.

### 5.2 pgTAP (`supabase/tests/<n>_mark_stale_pending_outflows_cron.test.sql`)

- The job `mark-stale-pending-outflows` exists, with schedule `15 6 * * *`
  and a command that calls `public.mark_stale_pending_outflows()`.
- `anon` and `authenticated` do not have `EXECUTE`. `service_role` has it.
- Behavior: insert rows with `issue_date` of today, -29, -30, -59, -60, -89,
  -90 and -400 days, plus one `cleared` row of -400 days. Call the function.
  Check `pending`, `pending`, `stale_30`, `stale_30`, `stale_60`, `stale_60`,
  `stale_90`, `stale_90`, `cleared`.
- Call the function a second time. The statuses do not change (idempotent).

### 5.3 E2E

Justified exception. The hook change has no new UI. The pending outflows page
already renders the stale labels (`PendingOutflowCard.tsx:52-66`). No seed
helper exists for connected banks and balances. The unit and pgTAP tests
cover the logic. The existing dashboard specs must still pass.

## 6. Decided trade-offs

1. **Device date vs UTC date.** The hook uses the browser's local date. The
   cron uses `CURRENT_DATE` in UTC. At the boundary, the two can differ by 1
   day for a few hours. The effect is one day of one row. Accepted.
2. **No UI line for the excluded amount.** The runway does not show "$X of
   old checks are not counted". The Stale labels on the pending outflows page
   show the old rows. A runway note is a possible follow-up.
3. **The 2005 row.** It is a data entry error. The new rule excludes it and
   the cron marks it `stale_90`. No direct prod write.
4. **Expenses page book balance.** `src/pages/Expenses.tsx:44-48` has the
   same "subtract all open outflows" math. It is out of scope here, because
   the user asked to fix the runway problems one at a time. Listed as a
   follow-up.
5. **No one-time run in the migration.** A one-time run gives a faster
   backfill but runs inside the deploy transaction. The cron does it within
   24 hours.

6. **Midnight with the tab open.** The cutoff uses `new Date()` inside the
   query function. A page that stays open and focused across midnight keeps
   the old cutoff until the next focus or mount. The effect is at most one
   day of one row. Accepted. No `refetchInterval`.
7. **Two totals disagree.** The pending outflows page sums all open rows
   (`src/components/pending-outflows/PendingOutflowsList.tsx:56-62`,
   `src/hooks/usePendingOutflows.tsx:434-438`). The runway sums only the
   60-day window. After the cron runs, the page shows the old rows with Stale
   labels, which explains the gap. A split total ("in window" and "stale") is
   a follow-up.

## 7. Follow-ups (not in this PR)

- The same 60-day rule for the Expenses page book balance (6.4).
- A runway note for the excluded old amount (6.2).
- A split total on the pending outflows page (6.7).
- Local-day edges for the hook (runway design 6.6).
