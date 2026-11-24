# Availability in Local Time: Design

Date: 2026-11-05
Branch: `fix/availability-local-time`
Base: `origin/main` at `6e152c69`

All `file:line` citations refer to that base.

## 1. Intent

An employee says "I work 10:00 to 22:00 on Fridays." That sentence is a
wall-clock time. It stays the same in July and in December.

The app stores it as a UTC clock value. The app uses the offset of the save
date to make that value. A reader then uses the offset of the shift date. When
the two dates are on different sides of a time change, the window moves one
hour.

The owner reported availability warnings after the fall time change. This
design makes the stored value a wall-clock time. No reader or writer then uses
an offset for a recurring window.

## 2. Evidence from production

Every available row belongs to a restaurant in `America/Chicago`. The source is
read-only queries on production on 2026-11-05. The dry-run SQL of section 8
repeats the row counts.

| Measure | Result |
|---|---|
| Available rows in `employee_availability` | 526 |
| Rows that read one hour earlier now | 521 |
| Rows that do not move | 5 |
| Date range of writes | 2025-11-23 to 2026-10-28 |
| Conflicts, Oct 18 to Oct 31 | 48 (10 false, 38 real) |
| Conflicts, Nov 1 to Nov 14 | 62 (48 false, 14 real) |

The 10 false conflicts in October are probably the same bug in the opposite
direction. This is not confirmed.

## 3. Root cause

- `employee_availability.start_time` and `end_time` are `TIME` columns with UTC
  clock values. `day_of_week` is restaurant-local.
- The writer uses the offset of today. See
  `src/components/AvailabilityDialog.tsx:89-90` and
  `src/lib/availabilityTimeUtils.ts:88`.
- The readers use the offset of the shift date or the grid cell date. See
  `supabase/migrations/20260724120000_availability_conflict_tz_exception_fallback.sql:164-167`,
  `src/lib/effectiveAvailability.ts:96-101`, and
  `src/components/scheduling/TeamAvailabilityGrid.tsx:227`.
- `src/lib/availabilityTimeUtils.ts:83-86` says that this design is "lossy by
  design".

`availability_exceptions` do not have this bug. An exception has its own date,
so the writer and the reader use the same offset. Exceptions keep their UTC
values.

## 4. Goals

1. A recurring window shows the same wall-clock time on every date of the year.
2. A recurring window gives the same conflict result on every date of the year.
3. Existing rows go back to the wall-clock time that the user entered.
4. A browser tab with an old bundle cannot corrupt a row. It also cannot show a
   window that is more wrong than it shows today.
5. A rollback of the frontend or the edge function stays safe.

## 5. Non-goals

- A change to the storage of `availability_exceptions`.
- A change to the limit of one slot for each day in `setSlot`
  (`supabase/functions/generate-schedule/index.ts:326-336`). `setSlot` is
  last-wins. This limit exists today and stays. For this reason, an overnight
  window stays one window on day D (see the overnight rule below).
- Exceptions with more than one slot.
- A visual change. The UI stays the same.
- A global detector that reloads stale bundles.

## 6. Anti-goals

The fix fails, even if the tests pass, in these conditions:

- The migration changes a window to a time that the user did not enter or see.
- The migration aborts on one bad timezone and blocks the deploy.
- A stale tab writes a UTC value into a local column.
- The fix makes new false warnings on a day of a time change.

## 7. Decisions

### 7.1 Add new columns. Do not change the meaning of the old columns (my call)

The fix uses an expand and contract change. The rule is: **nothing that a stale
client reads changes meaning.**

Add these nullable columns to `employee_availability`:

- `start_time_local TIME`
- `end_time_local TIME`

Keep `start_time` and `end_time` as UTC values during the transition.

Stale clients are real. Migration
`20260522040000_fix_bulk_set_availability_local_to_utc_batch2.sql:1-5` fixed a
batch from a stale bundle after a fix merged. The app has no global detector
for stale bundles.

Two options were rejected:

| Option | Why it was rejected |
|---|---|
| Change the old columns in place | Stale tabs write UTC into a local column. Stale tabs read local as UTC. There is no rollback. |
| Add a `times_are_local` marker | This fixes stale writes. It does not fix stale reads. |

### 7.2 A trigger keeps the two frames in step (my call)

Add a `BEFORE INSERT OR UPDATE` trigger on `employee_availability`.

INSERT:

| Condition | Action |
|---|---|
| Both local columns have a value | Derive both legacy columns from the local columns. Local wins over any legacy value in the write. |
| Both local columns are null, both legacy columns have a value | Derive both local columns from the legacy columns. |
| Any other shape | Raise `not_null_violation`. |

UPDATE:

| Condition | Action |
|---|---|
| A local column becomes null | Raise `not_null_violation`. |
| A local column changes | Derive both legacy columns from the local columns. Local wins over any legacy value in the write. |
| No local column changes, a legacy column becomes null | Raise `not_null_violation`. |
| No local column changes, a legacy column changes | Derive only the local column of each legacy column that changed. Keep the other local column. |
| No time column changes | Do nothing. |

Rules for the trigger:

- The offset is the offset of **today** in the restaurant timezone. Today is
  `(now() AT TIME ZONE tz)::date`.
- The offset is one fixed value for the date: the offset at noon local time.
  Two different local values then stay different. The `valid_time` constraint
  cannot fail on the day of a time change.
- A stale writer uses the offset of the window time on the browser date. That
  value and the trigger value agree, except on the day of a time change. On
  that day the local value that the trigger derives wins.
- Known limit of the stale path: on the day of a time change, the trigger uses
  one noon offset for both times. A window time before the change then gets a
  local value that is one hour wrong. This occurs only when an old client
  writes the legacy columns on that day. Old clients exist only in the expand
  phase. The ship of PR 2 does not stop the risk at once: open browser tabs
  keep the old bundle until they reload. The contract PR waits for those tabs
  to age out. A wrong local value that a stale writer saves stays until a
  person corrects the row. Query 4 of the dry run cannot find all such rows,
  because a later edit moves `updated_at` off the time change day.
- Gate for the stale path: a stale write can be wrong only on a time change
  day. All restaurants with availability use `America/Chicago` (production,
  2026-11-23). The next time change there is 2027-03-14. Ship PR 2 and the
  contract PR before 2027-03-07, so that old tabs age out before that day.
  Then no stale write can occur on a time change day. This gate is a
  mitigation, not a fix: the trigger keeps one noon offset while legacy
  writes are possible.
- Fallback if the expand phase goes past 2027-03-07: before 2027-03-14,
  ship a migration that records each legacy-path write as it occurs. The
  migration adds a log table and an `AFTER INSERT OR UPDATE` trigger on
  `employee_availability`. The trigger writes one log row when the legacy
  columns change and the local columns do not change in the same statement.
  The log row holds the id, both frames, and `now()`. The log row is written
  in the same transaction as the edit, so no later edit can hide it. A
  snapshot job that runs after the day can miss rows: a late job start lets
  an edit move `updated_at` first. Do not use a snapshot job. After
  2027-03-14, check each logged row from that local date with the owner
  (review on PR #874). The contract PR deletes the log trigger and the log
  table. The fallback is not built now. It is a production change, so it
  needs the explicit consent of the owner.
- Known risk until PR 2: a change to `restaurants.timezone` does not update
  the legacy columns. The local columns stay correct, and all PR 1 readers
  use them. Old clients read the legacy columns, so they show the old zone
  until the next save of the row. The risk stops when PR 2 ships
  (hardening review on PR #874).
- Time `24:00` is not a valid input for `time + interval`, because Postgres
  wraps it to the same value as `00:00`. The helper
  `availability_shift_time` reads `24:00` as `23:59:59` before the shift. The
  backfill and the trigger both use it. Production has 0 rows with `24:00`.
- Accepted loss: a `24:00` end loses one second. A `00:00` to `24:00` window
  is 23:59:59 long after the shift. A schedule uses minutes, so the loss has
  no effect.
- Accepted limit: `23:59:59` and `24:00` give the same shifted value. A row
  from `23:59:59` to `24:00` then has equal endpoints, and a check constraint
  rejects it (SQLSTATE `23514`). This applies to the backfill and to both
  trigger directions. The UI sends HH:MM only, so it cannot send `23:59:59`.
  Production has 0 such rows. pgTAP tests in
  `supabase/tests/availability_local_time.sql` lock this behavior.
- An available row with null times is available all day. The readers return
  one window from `00:00` to `24:00`, the same as `toWindows` in
  `schedulingContext.ts`. Production has 0 available rows with null times.
- The trigger function is `SECURITY DEFINER` with
  `SET search_path = public, pg_catalog`. It must read `restaurants.timezone`
  for every caller. If RLS hides the restaurant from a caller, the fallback to
  UTC writes a wrong local value.
- A helper function gets the offset. An invalid timezone gives a zero offset
  through an `EXCEPTION` block. It does not read `pg_timezone_names`, because
  that read is slow (see the header of migration `20260724120000`).
- Run `REVOKE ALL ... FROM PUBLIC, anon` on the trigger function and the helper.

The stale update rule works on each column. A stale dialog sends both times, but
the column that the user did not edit returns its old legacy value. That column
counts as not changed, so its correct local value stays. A stale tab that sends
one column has the same result.

Example: a row holds 10:00 local and 15:00 UTC from a CDT save. In CST the stale
dialog shows 09:00. The user edits only the end time. The local start stays
10:00, which is the time that the user entered.

A stale save with no change keeps the local columns. The legacy values do not
change in that case, so the correct local values stay.

Every row keeps four non-null time values, also a row with
`is_available = false`:

- New clients send placeholder local times for a closed day, as they do today
  with the legacy columns.
- The trigger always writes both legacy columns when it has local values. A
  stale dialog prefill then always reads a value.
- If a write gives no complete pair in either frame, the trigger raises
  `not_null_violation`. This keeps the guarantee of the old `NOT NULL`.

### 7.3 Constraints

- Drop `NOT NULL` on `start_time` and `end_time`. New clients omit them, so the
  generated `Insert` type must show them as optional. The trigger fills them.
- Add `CHECK (end_time_local <> start_time_local)`. A null passes.
- Keep `valid_time` (`20260321100000_fix_availability_overnight_constraint.sql`).
- The local columns stay nullable until the contract change (section 7.10).

### 7.4 Backfill: one offset for each row, from the write date (my call)

For each row:

```text
anchor = (COALESCE(updated_at, created_at) AT TIME ZONE tz)::date
local  = UTC clock value + offset at noon local on the anchor date
```

A plain `(anchor + time) AT TIME ZONE 'UTC' AT TIME ZONE tz` is not correct on
the day of a time change. Example: a row written on 2026-11-01 holds 23:00
local as 05:00 UTC. That expression reads 00:00 CDT.

Rules for the backfill:

- Convert all rows, also the rows with `is_available = false`. Only the dialog
  prefill reads those rows.
- Keep the legacy values. The backfill only adds data, so a rollback is safe.
- An invalid timezone must not abort the migration. It uses a zero offset.
- Keep `updated_at` unchanged. The migration must disable the trigger
  `update_employee_availability_updated_at`
  (`20251123100050_create_availability_tables.sql:117-120`) for the backfill.
  Without this step the backfill erases the evidence of the write date.
- Run all steps in one explicit `BEGIN` and `COMMIT`. `ALTER TABLE` takes a
  lock, so no write can pass between the backfill and the trigger.
- Keep this order. The sync trigger must not exist during the backfill. If it
  exists, it overwrites the legacy values that are the source of the backfill.
  1. Add the local columns and drop `NOT NULL` on the legacy columns.
  2. Disable `update_employee_availability_updated_at`.
  3. Run the backfill.
  4. Enable `update_employee_availability_updated_at`.
  5. Create the sync trigger.
  6. Add the constraint of section 7.3.

Known limits of the anchor:

- `updated_at` is an approximation of the write date. An edit of only
  `is_available`, or a save with no change, moves `updated_at`. If that edit is
  on the other side of a time change, the local value is one hour off. The
  dry-run list in section 8 shows these rows.
- The client uses the offset of the window time on the save date. The backfill
  uses the noon offset. These differ only for a window before 02:00 local that
  was saved on the day of a time change. The dry-run list shows these rows.

The May fix migrations `20260522000000` and `20260522040000` do not cause a
problem. Those rows have `created_at` on 2026-05-22 and were fixed the same
day, so `updated_at` gives the same CDT anchor.

### 7.5 `check_availability_conflict`

Base file:
`supabase/migrations/20260724120000_availability_conflict_tz_exception_fallback.sql`.

- The recurring loop (`:164-167`) and the previous-day loop (`:187-190`) use
  `start_time_local` and `end_time_local` directly. They do no conversion.
- The exception branch (`:128-131`) keeps the UTC conversion.
- The `v_tz := 'UTC'` handler (`:91-95`) stays. The header at `:14-24` explains
  why.
- Add two return columns, `available_start_local` and `available_end_local`.
  They hold a local value for both recurring and exception conflicts. For an
  exception, they hold `v_w_start_tod` and `v_w_end_tod`. Capture them with the
  same first-window rule as `v_last_start` and `v_last_end`.
- The previous-day test (`:191`) changes to `end <= start AND end <> '00:00:00'`.
  A window of 18:00 to 00:00 ends at midnight of its own day. It does not spill
  into the next day. Today the test marks that next day as an occupied day, so
  a day with no data gives a false conflict.
- Keep `available_start` and `available_end` with their current values for
  stale clients.

A change to the return shape needs `DROP FUNCTION` and `CREATE FUNCTION` in one
transaction. The precedent is
`20260322170137_conflict_structured_data.sql:4`. That precedent has no grants.
After `CREATE`, the default privileges give `EXECUTE` to `PUBLIC`. So run
`REVOKE ALL ... FROM PUBLIC, anon`, then `GRANT EXECUTE` to `authenticated` and
`service_role`. Only the client calls this function. No SQL function calls it.
Keep `SECURITY INVOKER`, `STABLE`, and the `search_path`.

End the migration with `NOTIFY pgrst, 'reload schema';`.

### 7.6 `bulk_set_employee_availability`

- Read the `start_time_local` and `end_time_local` keys of each JSONB element
  when they exist.
- If they do not exist, read the legacy keys. The trigger then derives the
  local values. This is the path of a stale client.
- If both frames exist in an element, the local keys win.
- The bulk RPC adds no shape check. The trigger raises `not_null_violation` for
  an incomplete pair, as the old `NOT NULL` did.
- Keep the signature, `SECURITY DEFINER`, and the grants.

### 7.7 Edge function: `generate-schedule`

- `supabase/functions/generate-schedule/index.ts:165-166` selects
  `start_time_local` and `end_time_local`.
- `convertRecurringToLocal` (`supabase/functions/_shared/availability-tz.ts:163`)
  does no timezone conversion. It trusts the stored `day_of_week`.
- A window with local `end < start` is overnight. Keep it as one window on
  day D, with `isOvernight: true`. Do not split it. `withinWindow` reads
  `end < start` as overnight, and `setSlot` keeps one window for each day.
  A split D+1 piece replaces the own window of D+1, and an overnight shift
  then fails `withinWindow` (Codex review on PR #874).
- This follows the rule of the other overnight features: business hours,
  `ShiftInterval`, clock-in attribution, and `check_availability_conflict`
  keep one interval on its start day.
- Known regression: the solver does not look at the window of the day
  before. A shift from 00:00 to 02:00 on day D+1 does not match an overnight
  window on day D. On main, a restaurant in a non-UTC zone got a split D+1
  piece, so this shift matched there. On main, the `UTC` zone already has
  this limit. We accept the regression, because the split piece replaced the
  own window of D+1 (see above), which is a worse failure. A later PR can add
  a D+1 match in the validator. The test `keeps an overnight window as one
  window on its start day` in `tests/unit/availability-tz.test.ts` pins the
  current behavior.
- If the end is `00:00:00`, write `24:00:00` on day D.
- A window never occupies D-1. This follows the lesson
  of 2026-07-12 in `memory/lessons.md`.
- `convertOne` and `convertExceptionsToLocal` stay for exceptions. `convertOne`
  recomputes the weekday with `getDay()`, so it is not a reference for the new
  code.
- Delete `dateForDayOfWeek` and the `weekStart` parameter if nothing uses them.
  The call site at `generate-schedule/index.ts:302-311` and its tests then
  change.

The downstream consumers (`schedule-solver.ts`, `schedule-prompt-builder.ts`,
`schedule-validator.ts`) receive `LocalAvail`. Their frame does not change.

### 7.8 Frontend

Writers (no conversion):

- `src/components/AvailabilityDialog.tsx:67-68` reads the local columns.
  `:89-90` writes them.
- `src/components/EmployeeDialog.tsx:489` and
  `src/components/scheduling/availability/BulkSetAvailabilitySheet.tsx:88` stop
  the call to `convertAvailabilityWindowsToUtc`. Delete that function from
  `src/lib/availabilityTimeUtils.ts` with its "lossy by design" note.
- `src/hooks/useBulkSetAvailability.ts:48` sends the `*_local` keys.

Readers:

- **Every `EffectiveSlot` is local.** `computeEffectiveAvailability`
  (`src/lib/effectiveAvailability.ts:30`) gets a `timezone` parameter. Recurring
  slots (`:96-101`) read the local columns. Exception slots (`:78-84`) convert to
  local at this one place, with the exception's own date as the anchor. Parse
  that date with `new Date(year, month, day)`. No frame marker exists. A mix of
  frames then cannot reach a label or a comparison. `sourceRecord` stays raw.
- The three callers pass the timezone:
  `src/components/scheduling/TeamAvailabilityGrid.tsx:402`,
  `src/components/scheduling/ShiftPlanner/ShiftPlannerTab.tsx:250`, and
  `src/pages/Scheduling.tsx:534`.
- These sites stop the conversion of slot times:
  - `src/components/scheduling/TeamAvailabilityGrid.tsx:227`
  - `availabilityLabel` (`src/lib/effectiveAvailability.ts:225-235`). Delete its
    `timezone` and `date` parameters. Change its caller
    `src/components/scheduling/ShiftPlanner/EmployeeMiniWeek.tsx:83`.
  - `overnightPrevSlots` (`:240-251`). Its filter changes to
    `end <= start AND end <> 00:00`, the same as the RPC in section 7.5.
  - `pushWindow` (`:314-324`). Keep `we += 1440`, because a window of 18:00 to
    00:00 on its own day ends at 24:00.
- A null local value counts as no window. The sync trigger and the backfill keep
  the columns non-null. PR 2 merges after PR 1, so a null does not occur.
- `src/pages/EmployeePortal.tsx:151-154,291` show the recurring local values.
  `:361` stays UTC for exceptions.
- `src/components/scheduling/DeleteAvailabilityDialog.tsx:58-93` shows recurring
  rows with no conversion. Exceptions stay.
- `src/hooks/usePlannerShiftConflicts.ts:104-105` sets `available_start_local`
  and `available_end_local` from the slot. Slots are local on recurring days and
  on exception days.
- `src/lib/conflictFormatUtils.ts:18-27,62-97` formats `available_start_local`
  and `available_end_local` with no conversion. If they are null, the message
  shows no time range. Delete `extractDateAnchor` if nothing uses it.
- `src/hooks/useConflictDetection.tsx:24-25,79-80` maps the new fields.
- `src/lib/scheduleWarnings.ts:104` reads `avail.start_time_local` and
  `avail.end_time_local`. This line compares a UTC availability value with a
  local template value, so `no_time_overlap` is not correct today. The change
  fixes that bug too. Template times are local:
  `src/components/scheduling/ShiftPlanner/TemplateFormDialog.tsx:160-161` saves
  the raw input, and `supabase/functions/_shared/schedule-solver.ts:153-154`
  reads them as local.
- `src/hooks/useBulkSetAvailability.ts:24-30` gets a user message for
  `not_null_violation`.
- `src/components/EmployeeDialog.tsx` and `BulkSetAvailabilitySheet.tsx` pass
  closed-day rows through with local placeholder times.
- Change the comments that state the old UTC contract:
  `src/types/scheduling.ts:215-216`, `BulkSetAvailabilitySheet.tsx:26-30`,
  `src/lib/availabilityTimeUtils.ts:66-87`, and
  `src/lib/conflictFormatUtils.ts:6-17,80-88`.
- Change `ConflictCheck` and `EmployeeAvailability` in
  `src/types/scheduling.ts:181-192,215-216`. Type the new fields as
  `string | null`.
- Make both generated type files again with the `sync-types` skill:
  `src/types/supabase.ts` and `src/integrations/supabase/types.ts`. The dropped
  `NOT NULL` makes the legacy `Row` fields nullable. Fix the type errors that
  this gives.

Files that need no change (read in this audit):

- `src/components/AvailabilityExceptionDialog.tsx`
- `src/components/scheduling/availability/AvailabilityGrid.tsx`, because its rows
  are local form values
- `src/lib/timelineModel.ts`, because it calls `shiftOutsideAvailability`
- `EmployeeSidebar.tsx`, `GenerateScheduleDialog.tsx`, `ShiftTimelineTab.tsx`,
  `TimelineBar.tsx`, `TimelineLane.tsx`, `useTimelineModel.ts`, and
  `WeekScheduleMobile.tsx`, because they pass availability data but do not read
  a time field
- `src/pages/SchedulingWeeklyAvailabilityChip.tsx`, because it reads no time field
- `src/lib/availabilityDefaults.ts`, because its input is already local
- `src/hooks/useAvailability.tsx` and `src/hooks/useCRUDEntity.tsx`. `select('*')`
  returns the new columns, and `.update(rest)` sends them as they are.
- `src/hooks/useEmployeesMissingAvailability.ts`
- `src/hooks/useGenerateSchedule.ts`
- `src/lib/shiftMutationPipeline.ts`
- `supabase/functions/_shared/availabilityReminderHandler.ts`

### 7.9 Deploy order: two PRs (my call)

`.github/workflows/deploy-supabase.yml` runs on a push to `main` that touches
`supabase/**`. It runs `supabase db push --include-all`, then
`supabase functions deploy`. Vercel deploys the frontend on its own. The order
of the two is not fixed.

A frontend that goes live before the migration reads `undefined` for the local
columns and fails on writes. So this change ships as two stacked PRs:

| PR | Contents | Effect on merge |
|---|---|---|
| PR 1 | Migration, RPC changes, edge function, pgTAP and edge tests | The conflict check becomes correct. The production data write runs. |
| PR 2 | Frontend, generated types, unit tests | The grid, the dialogs, and the planner become correct. |

Merge PR 2 only after the deploy of PR 1 is complete. Between the two merges,
the live frontend is a stale client. The trigger and the legacy columns cover
that state, so PR 1 tests the stale path on production.

PR 1 fixes the warnings from `check_availability_conflict`. The planner badges
use `shiftOutsideAvailability` in the browser. They stay wrong until PR 2.

### 7.10 Contract step (later PR)

After stale tabs age out, a separate PR makes these changes:

- Delete `start_time`, `end_time`, and the sync trigger.
- Delete the function `backfill_employee_availability_local()`. It exists only for pgTAP.
- Delete `available_start` and `available_end` from the RPC return shape.
- Rename nothing. The local names stay.
- Set `NOT NULL` on the local columns.

Wait at least 30 days after PR 2. This PR is not in this scope.

## 8. Production gate

**Merge of PR 1 writes to production.** The deploy workflow runs the migration
with no further approval.

Before the merge:

1. Run a read-only dry run on production.
2. Show the owner the exact row counts: the total rows, the rows for each old
   and new value pair, and the rows that need review.
3. Show the rows that need review:
   - Rows with any time change between `created_at` and `updated_at`. The
     check looks at each local day in the range, not only at the two endpoints.
   - Rows with an anchor on the day of a time change.
   - Rows in a restaurant with an invalid timezone.
   - Rows with a null `created_at` or `updated_at`. Query 3 cannot check
     these rows. Production has 0 such rows on 2026-11-23.
4. Wait for an explicit yes from the owner.

Run `get_project_url` on the `supabase-prod` MCP server before the first query.
If its tools fail, the owner must authenticate it again. The owner runs `claude`,
then `/mcp`, then selects `supabase-prod`, then Authenticate, in a real terminal.

Autonomous work stops at two open PRs with green CI. The plan delivers the
dry-run SQL as a read-only file. The dry run, the approval, and both merges
come after that point. The owner merges each PR.

## 9. Tests

Use `new Date(year, month, day)` for DST fixtures. Do not use noon-UTC ISO
strings (lesson in `memory/lessons.md`). Pin the timezone in E2E tests.

pgTAP:

- A local window gives the same conflict result on a July date and a December
  date.
- Trigger cases: all rows of both tables in section 7.2.
- A stale update of one column keeps the other local column.
- The sync trigger does not exist while the backfill runs: the legacy values do
  not change.
- The grants of `check_availability_conflict` exclude `anon`.
- A closed-day row written with local values has non-null legacy values.
- A write with no complete pair raises `not_null_violation`.
- The trigger gets the correct timezone for a caller who cannot read the
  restaurant row.
- A stale insert in CST and in CDT gives the correct local value.
- A stale save with no change keeps the local columns.
- Backfill: a CDT anchor, a CST anchor, a transition-day anchor, an invalid
  timezone, and an unchanged `updated_at`.
- Overnight windows, and the previous-day carry-over.
- A window of 18:00 to 00:00 gives no conflict on the next day.
- A local start past 24:00 UTC: 17:00 Pacific and 20:00 Eastern.
- `available_start_local` for recurring and exception conflicts.
- The bulk RPC with local keys and with legacy keys.

Update these existing files to the local frame:

- `supabase/tests/availability_conflict_local_tz.sql`
- `supabase/tests/availability_conflict_utc.sql`
- `supabase/tests/availability_overnight.sql`
- `supabase/tests/availability_conflict_structured.sql`
- `supabase/tests/bulk_set_employee_availability.test.sql`
- `supabase/tests/user_has_restaurant_access.test.sql`
- `supabase/tests/link_employee_to_user.sql`

Unit and edge tests:

- `tests/unit/availability-tz.test.ts`: recurring cases at lines 11-215 change.
  Exception cases from line 216 stay.
- `tests/unit/availabilityTimeUtils.test.ts`
- `tests/unit/BulkSetAvailabilitySheet.test.tsx`
- `tests/unit/useBulkSetAvailability.test.tsx`
- `tests/unit/DeleteAvailabilityDialog.test.tsx`
- The unit tests for `conflictFormatUtils`, `effectiveAvailability`, and
  `scheduleWarnings`. Add a window of 18:00 to 00:00, and an exception slot on a
  day of a time change.
- `tests/unit/EmployeeMiniWeek.test.tsx`
- `tests/unit/useConflictDetection.test.ts`
- `tests/unit/usePlannerShiftConflicts.test.ts`
- The unit tests for `AvailabilityDialog`, `EmployeeDialog.availabilitySection`,
  `TeamAvailabilityGrid`, `timelineBarLiveAvailability`,
  `shiftPlannerTab.availabilityWiring`, `scheduleAvailabilityChip`, and
  `availabilityDefaults`.

E2E:

- `tests/helpers/e2e-supabase.ts`
- `tests/e2e/impact-aware-deletion.spec.ts`
- `tests/e2e/scheduling-conflicts.spec.ts`: the helper at line 79 writes the
  local columns.

## 10. Success criteria

- A window of 10:00 to 22:00 in `America/Chicago` shows as 10:00 to 22:00 in the
  dialog, the grid, the portal, and the conflict message on a date in July and a
  date in December.
- A shift of 10:00 to 22:00 gives no conflict on both dates.
- The 48 false conflicts of Nov 1 to Nov 14 give no conflict after the backfill.
  The 14 real conflicts stay.
- A write from a stale bundle gives a correct local value.
- `npm run test`, `npm run test:db`, `npm run typecheck`, and `npm run lint`
  pass.

## 11. Left to the builder

- The exact names of the helper and trigger functions.
- The split of commits inside each PR.

## 12. Decided trade-offs

These items come from the Phase 2.5 reviews. They stay out of this change.

- **Error states on two screens.** `TeamAvailabilityGrid.tsx:489` and
  `EmployeePortal.tsx:251` have a loading state but no error state. A failed
  fetch reads as "No availability set". This gap exists today and this change
  does not make it worse. Section 5 keeps the UI the same. It becomes a separate
  task.
- **Tenant check in the self-service RLS policies.**
  `20251123100100_add_employee_self_service_rls.sql:55-90` checks only
  `is_current_user_employee(employee_id)`. The policy does not check
  `restaurant_id`. This gap exists today. The trigger reads a wrong timezone only
  for the row of the employee who sends it. It becomes a separate task.
- **A stale edit can fail the local check.** The column rule of section 7.2 can
  derive an end value that equals the kept local start. The constraint then
  rejects the save. No data changes. The user reloads and saves again.
- **Stale conflict results for up to 10 seconds.** `['conflict-check', ...]`
  (`src/hooks/useConflictDetection.tsx`, `staleTime` 10000) is not invalidated
  after an availability edit. This exists today.
- **`useCheckConflicts` consumers ignore loading and error**
  (`ShiftDialog.tsx:111`, `TimelineShiftEditor.tsx:131`). This exists today.
- **`select('*')` in `src/hooks/useAvailability.tsx:20-22`.** This exists today.
