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

Every available row belongs to a restaurant in `America/Chicago`.

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
  (`supabase/functions/generate-schedule/index.ts:326-336`).
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

| Operation | Condition | Action |
|---|---|---|
| INSERT | Both local columns are null | Derive the local columns from the legacy columns. |
| INSERT | A local column has a value | Derive the legacy columns from the local columns. |
| UPDATE | A local column changes | Derive the legacy columns from the local columns. |
| UPDATE | No local column changes, a legacy column changes | Derive both local columns from the legacy columns. |
| UPDATE | No time column changes | Do nothing. |

Rules for the trigger:

- The offset is the offset of **today** in the restaurant timezone. Today is
  `(now() AT TIME ZONE tz)::date`. A stale writer uses the same anchor, so the
  stale writer and the trigger agree.
- The offset is one fixed value for the date: the offset at noon local time.
  Two different local values then stay different. The `valid_time` constraint
  cannot fail on the day of a time change.
- The trigger function is `SECURITY DEFINER` with a fixed `search_path`. It
  must read `restaurants.timezone` for every caller. If RLS hides the
  restaurant from a caller, the fallback to UTC writes a wrong local value.
- A helper function gets the offset. An invalid timezone gives a zero offset
  through an `EXCEPTION` block. It does not read `pg_timezone_names`, because
  that read is slow (see the header of migration `20260724120000`).

The stale update rule derives **both** local columns. A stale dialog sends both
times. If only one column changed, the other column shows the old frame. The
stale user saw both values on the screen and saved them, so the row then
matches the screen.

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
- Run the column change, the backfill, the sync trigger, and the constraints in
  one transaction. `ALTER TABLE` takes a lock, so no write can pass between the
  backfill and the trigger.

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
  exception, they hold `v_w_start_tod` and `v_w_end_tod`.
- Keep `available_start` and `available_end` with their current values for
  stale clients.

A change to the return shape needs `DROP FUNCTION` and `CREATE FUNCTION` in one
transaction. The precedent is
`20260322170137_conflict_structured_data.sql:4`. Add an explicit `GRANT EXECUTE`
to `authenticated` and `service_role`. Only the client calls this function. No
SQL function calls it. Keep `STABLE` and the `search_path`.

End the migration with `NOTIFY pgrst, 'reload schema';`.

### 7.6 `bulk_set_employee_availability`

- Read the `start_time_local` and `end_time_local` keys of each JSONB element
  when they exist.
- If they do not exist, read the legacy keys. The trigger then derives the
  local values. This is the path of a stale client.
- Keep the signature, `SECURITY DEFINER`, and the grants.

### 7.7 Edge function: `generate-schedule`

- `supabase/functions/generate-schedule/index.ts:165-166` selects
  `start_time_local` and `end_time_local`.
- `convertRecurringToLocal` (`supabase/functions/_shared/availability-tz.ts:163`)
  does no timezone conversion. It trusts the stored `day_of_week`.
- A window with local `end <= start` is overnight. Split it into day D (start
  to `24:00:00`) and day D+1 (`00:00:00` to end).
- If the end is `00:00:00`, do not make an empty row on day D+1.
- A window occupies D and D+1. It never occupies D-1. This follows the lesson
  of 2026-07-12 in `memory/lessons.md`.
- `convertOne` and `convertExceptionsToLocal` stay for exceptions. `convertOne`
  recomputes the weekday with `getDay()`, so it is not a reference for the new
  code.
- Delete `dateForDayOfWeek` and the `weekStart` parameter if nothing uses them.

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

- `EffectiveSlot` in `src/lib/effectiveAvailability.ts` gets a frame marker,
  `'local' | 'utc'`. Recurring slots (`:96-101`) use the local columns and the
  marker `'local'`. Exception slots (`:78-84`) keep `'utc'`.
- One helper, for example `slotLocalTime(slot, tz, date)`, gives the local time
  of a slot. These sites use it:
  - `src/components/scheduling/TeamAvailabilityGrid.tsx:227`
  - `availabilityLabel` (`src/lib/effectiveAvailability.ts:225-235`)
  - `overnightPrevSlots` (`:247-248`)
  - `pushWindow` (`:317-318`)
- `src/pages/EmployeePortal.tsx:151-154,291` show the recurring local values.
  `:361` stays UTC for exceptions.
- `src/components/scheduling/DeleteAvailabilityDialog.tsx:58-93` shows recurring
  rows with no conversion. Exceptions stay.
- `src/hooks/usePlannerShiftConflicts.ts:104-105` gives local values.
- `src/lib/conflictFormatUtils.ts:18-27,79-97` formats `available_start_local`
  and `available_end_local` with no conversion.
- `src/hooks/useConflictDetection.tsx:24-25,79-80` maps the new fields.
- `src/lib/scheduleWarnings.ts:104` reads the local columns. This line compares
  a UTC availability value with a local shift template value, so
  `no_time_overlap` is not correct today. The change fixes that bug too. The
  template frame comes from the note at `src/lib/availabilityTimeUtils.ts:71-73`.
  The builder must check it before the change.
- Change `ConflictCheck` and `EmployeeAvailability` in
  `src/types/scheduling.ts:181-192,215-216`.
- Make both generated type files again with the `sync-types` skill:
  `src/types/supabase.ts` and `src/integrations/supabase/types.ts`.

Files that need no change (read in this audit):

- `src/components/AvailabilityExceptionDialog.tsx`
- `src/components/scheduling/ShiftPlanner/EmployeeMiniWeek.tsx`, because it reads
  only `isAvailable`
- `src/components/scheduling/availability/AvailabilityGrid.tsx`, because its rows
  are local form values
- `src/lib/timelineModel.ts`, because it calls `shiftOutsideAvailability`
- `EmployeeSidebar.tsx`, `GenerateScheduleDialog.tsx`, `ShiftPlannerTab.tsx`,
  `ShiftTimelineTab.tsx`, `TimelineBar.tsx`, `TimelineLane.tsx`,
  `useTimelineModel.ts`, `WeekScheduleMobile.tsx`, and `Scheduling.tsx`, because
  they pass availability data but do not read a time field
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
   - Rows where `created_at` and `updated_at` have different offsets.
   - Rows with an anchor on the day of a time change.
   - Rows in a restaurant with an invalid timezone.
4. Wait for an explicit yes from the owner.

The `supabase-prod` MCP server needs authentication again for this step. The
owner runs `claude`, then `/mcp`, then selects `supabase-prod`, then
Authenticate, in a real terminal.

Autonomous work stops at two open PRs with green CI. The plan delivers the
dry-run SQL as a read-only file. The dry run, the approval, and both merges
come after that point. The owner merges each PR.

## 9. Tests

Use `new Date(year, month, day)` for DST fixtures. Do not use noon-UTC ISO
strings (lesson in `memory/lessons.md`). Pin the timezone in E2E tests.

pgTAP:

- A local window gives the same conflict result on a July date and a December
  date.
- Trigger cases: all five rows of the table in section 7.2.
- A closed-day row written with local values has non-null legacy values.
- A write with no complete pair raises `not_null_violation`.
- The trigger gets the correct timezone for a caller who cannot read the
  restaurant row.
- A stale insert in CST and in CDT gives the correct local value.
- A stale save with no change keeps the local columns.
- Backfill: a CDT anchor, a CST anchor, a transition-day anchor, an invalid
  timezone, and an unchanged `updated_at`.
- Overnight windows, and the previous-day carry-over.
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
  `scheduleWarnings`.

E2E:

- `tests/helpers/e2e-supabase.ts`
- `tests/e2e/impact-aware-deletion.spec.ts`

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
- The location of the frame marker logic, if a simpler shape gives the same
  behavior. For example, `effectiveAvailability.ts` can convert exceptions at
  the source if it has the timezone.
- The split of commits inside each PR.
