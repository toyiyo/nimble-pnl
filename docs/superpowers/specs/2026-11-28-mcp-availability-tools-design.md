# MCP Availability Write Tools: Design

Date: 2026-11-28
Branch: `claude/gallant-lovelace-745b9z`
Base: `origin/main` at `a5da522` (PR #874 merged)

All `file:line` citations refer to that base. This text is STE-aligned.

## 1. Intent

A manager talks to Claude through the EasyShiftHQ connector. The manager says
"Ana cannot work Fridays after 18:00" or "Ana is off on March 14". Today Claude
cannot change availability. Only the UI can.

This design adds three MCP tools:

| Tool | Kind | What it does |
|---|---|---|
| `get_availability` | read | Returns the recurring rows and the exceptions of a restaurant or of one employee, in local time and in the stored frame. |
| `update_availability` | write | Replaces the recurring row of one employee on one weekday. |
| `add_availability_exception` | write | Replaces the exceptions of one employee on one date. |

The write tools use the `preview` / `confirmed` pattern. The preview lists the
shifts that conflict with the new availability. The preview also returns a
`preview_token`. The confirm must send the same token. A confirm with a stale
token writes nothing.

## 2. Facts about the current code

### 2.1 Storage after PR #874

- `employee_availability` has `start_time_local` and `end_time_local`. These
  columns hold the restaurant wall clock
  (`supabase/migrations/20261105120000_availability_local_time.sql:133-134`).
- The trigger `sync_employee_availability_frames` fills the legacy UTC columns
  `start_time` and `end_time` from the local columns. It uses the noon offset of
  today (`20261105120000_availability_local_time.sql:83`, `:86-88`, `:109-111`).
  A write that sends only the local columns is the supported path.
- The trigger rejects an INSERT without a complete time pair
  (`20261105120000_availability_local_time.sql:94-96`). A closed day therefore
  needs placeholder times.
- `CHECK (end_time_local <> start_time_local)`
  (`20261105120000_availability_local_time.sql:155-156`).
- `availability_exceptions` keeps UTC clock values. PR #874 did not change them
  (design of PR #874, section 3; `supabase/migrations/20251123100050_create_availability_tables.sql:18-32`).
- No unique key exists on `(employee_id, day_of_week)` or on
  `(employee_id, date)` (`20251123100050_create_availability_tables.sql:2-32`).
  `bulk_set_employee_availability` replaces all rows of a day with delete and
  insert (`supabase/migrations/20261105120200_bulk_set_availability_local_keys.sql:85-109`).

### 2.2 Conversion helpers of the UI

- `localTimeToUtcTime(localTime, timezone, referenceDate)` uses
  `fromZonedTime` on the reference date
  (`src/lib/availabilityTimeUtils.ts:45-63`).
- `utcTimeToLocalTime(utcTime, timezone, referenceDate)` builds the instant
  `<referenceDate>T<utcTime>Z` and reads its local clock
  (`src/lib/availabilityTimeUtils.ts:18-36`).
- The exception dialog writes with the exception date as the reference
  (`src/components/AvailabilityExceptionDialog.tsx:88-89`). It reads with the
  same reference (`src/components/AvailabilityExceptionDialog.tsx:60-63`).
- The conflict RPC reads an exception with the same anchor:
  `((date + start_time) AT TIME ZONE 'UTC') AT TIME ZONE tz`
  (`supabase/migrations/20261105120100_availability_conflict_local_time.sql:106-109`).

### 2.3 MCP write path

- `WRITE_TOOLS` in `supabase/functions/_shared/tools-registry.ts:944-948`
  marks a tool as destructive. `mcpHandler.ts:179` then sets
  `destructiveHint: true`.
- `WRITE_TOOL_NAMES` in `supabase/functions/_shared/aiWriteTools.ts:9-13` is
  the client copy of the same list.
- `ai-execute-tool` dispatches with a `switch`
  (`supabase/functions/ai-execute-tool/index.ts:3880-3966`). The role gate is at
  `:3830-3848`.
- `hasEditSchedulingCapability` exists and fails closed
  (`supabase/functions/_shared/tools-registry.ts:1206-1222`).
- `edit:scheduling` is true for `owner`, `manager`, `operations_manager`, and
  `collaborator_operations_manager`
  (`supabase/migrations/20260730140000_user_has_capability_from_areas.sql:146`).
  The `role_id` path can also give it through role areas.
- `user_has_restaurant_access(p, true)` allows only `owner` and `manager`
  (`supabase/migrations/20260521222200_create_user_has_restaurant_access_helper.sql:37`).
  So that check and `edit:scheduling` do not agree.
- `canUseCapabilityGatedTool` always calls `hasSchedulingOrPayrollCapability`
  (`supabase/functions/_shared/tools-registry.ts:1236-1246`). The 403 body says
  `'view:scheduling or view:payroll'` (`supabase/functions/ai-execute-tool/index.ts:3837`).
  A write tool must not use that gate.
- The existing write tools do not protect against a stale preview. The confirm
  writes whatever it gets
  (`supabase/functions/ai-execute-tool/index.ts:3486-3510`).

## 3. Finding: the UI reads some exceptions one hour off

The UI reader anchors the stored UTC clock to the exception date. For a window
in the evening, the real UTC instant is on the next UTC date. The two dates
have different offsets only on the day of a time change. On that day, the read
is one hour off.

Proof with `date-fns-tz` 3, `America/Chicago`:

| Exception | Stored UTC | UI shows | Correct |
|---|---|---|---|
| 2027-03-14, 20:00 | 01:00:00 | 19:00 | 20:00 |
| 2027-11-07, 20:00 | 02:00:00 | 21:00 | 20:00 |
| 2027-03-20, 20:00 | 01:00:00 | 20:00 | 20:00 |

The stored value is correct. The UI dialog and the conflict RPC read it
wrong. This is a display bug, not a data problem. The TLA+ counterfactual
`AvailabilityWrites_UiReader.cfg` finds it (section 9).

**Decision (my call):** this PR does not fix the UI reader or the RPC. The task
says "do not change the format again", and a reader fix is a separate change.
`get_availability` shows the problem instead (section 5). I propose a
follow-up issue for the reader fix.

## 4. Goals

1. A manager can read and change availability through Claude.
2. The local time that a read returns is equal to the local time that the write
   received.
3. An exception has priority over the recurring row on its date.
4. A stale preview never commits.
5. The output lets the user tell a display bug from a data problem.
6. The write uses the same storage format and the same conversion as the UI.

## 5. Tool contracts

All tools take `restaurant_id`. Times are `HH:MM`, 24-hour, restaurant local.
`day` is `sunday` .. `saturday` or `0` .. `6`. `date` is `YYYY-MM-DD` in the
restaurant calendar.

### 5.1 `get_availability(restaurant_id, employee_id?)`

`get_scheduling_context` returns availability for a period
(`supabase/functions/_shared/schedulingContextTool.ts:194-196`). It does not
return the stored frame or the time zone. This tool fills that gap.

Response for each row:

```json
{
  "tz": "America/Chicago",
  "recurring": [{
    "employee_id": "...", "employee_name": "Ana", "day": "friday", "day_of_week": 5,
    "available": true, "start": "10:00", "end": "18:00", "note": null,
    "stored": { "frame": "local", "start_time_local": "10:00:00", "end_time_local": "18:00:00",
                "start_time_utc_legacy": "16:00:00", "end_time_utc_legacy": "00:00:00" }
  }],
  "exceptions": [{
    "employee_id": "...", "date": "2027-03-14", "available": true,
    "start": "20:00", "end": "23:00", "note": "late shift ok",
    "stored": { "frame": "utc", "start_time": "01:00:00", "end_time": "04:00:00" },
    "ui_shows": { "start": "19:00", "end": "22:00" },
    "display_mismatch": true
  }]
}
```

Rules:

- `start` / `end` of an exception come from the canonical reader: pick the UTC
  date (D-1, D, D+1) whose instant has the local date D. The end is the first
  instant after the start with the stored end clock.
- `ui_shows` is the value of `utcTimeToLocalTime(stored, tz, date)`, the UI
  rule. The tool adds `ui_shows` and `display_mismatch: true` only when the two
  values differ.
- A row whose stored data cannot give a valid local window gets
  `data_problem: "<reason>"`. Example: a recurring row with null local columns,
  or an exception with only one time.
- The response has a `how_to_read` text: "`start`/`end` are the times the
  employee gave. `stored` is the raw database value. `display_mismatch` means
  the app screen shows a different time than the data holds."

Role: `view:scheduling` or `view:payroll`, the same gate as
`get_scheduling_context` (`tools-registry.ts:1085`).

### 5.2 `update_availability`

Arguments: `restaurant_id`, `employee_id`, `day`, then `start` and `end`, or
`unavailable: true`. Optional `note`. Flags `preview` and `confirmed`, and
`preview_token` for the confirm.

Write: delete all rows of `(employee_id, day_of_week)`, then insert one row
with `start_time_local`, `end_time_local`, `is_available`, `notes`. The
trigger fills the legacy columns. For `unavailable: true`, the row gets the
placeholder `00:00` to `23:59`. The readers skip the times of a closed row
(`20261105120100_availability_conflict_local_time.sql:138-141`).

Input rules:

- `start` and `end` are `HH:MM` from `00:00` to `23:59`. `start <> end`.
- `end < start` is an overnight window. The readers support it
  (`supabase/functions/_shared/availability-tz.ts:192-195`).
- `end = 00:00` means midnight at the end of the day
  (`availability-tz.ts:187-190`).
- `24:00` is rejected. The message says "use 00:00 for midnight".

### 5.3 `add_availability_exception`

Arguments: `restaurant_id`, `employee_id`, `date`, then `start` and `end`, or
`unavailable: true`. Optional `note` (stored in `reason`). Same flags.

Write: delete all exceptions of `(employee_id, date)`, then insert one row.

The edge function computes the UTC clocks. The SQL function stores them as it
gets them. Reason: Postgres and `date-fns-tz` pick different instants for a gap
time and for an ambiguous time. Postgres gives `2027-11-07 01:30` → `07:30`
UTC. `date-fns-tz` gives `06:30` UTC (Phase 2.5 review). The UI uses
`date-fns-tz`, so the MCP writer must use it too.

- Start: `fromZonedTime(date + start, tz)`, the same as `localTimeToUtcTime`
  with the exception date (`src/lib/availabilityTimeUtils.ts:45-63`).
- End: the same rule, but anchored to `date + 1` when `end <= start` (an
  overnight window or a `00:00` end). Without this rule, a 20:00–00:00 window on
  2027-03-14 stores `06:00`, and the reader returns `01:00`.
- `unavailable: true` stores `start_time = end_time = NULL`
  (`supabase/migrations/20260321100000_fix_availability_overnight_constraint.sql:11-14`).
- A unit test checks that the TS port and `src/lib/availabilityTimeUtils.ts`
  return equal values.

Input rules:

- A local time that does not exist on that date is rejected (spring change,
  `02:00` to `02:59`). The message names the gap. The rule: convert local to
  UTC and back. If the result is not equal to the input, the time is in the gap.
  The end time uses its own anchor date for this check.
- A local time that occurs two times (fall change, `01:00` to `01:59`) is
  accepted. Both instants have the same local clock, so the read returns the
  input. The preview shows a note.
- An overnight exception (`end < start`) is accepted, as the constraint allows
  (`supabase/migrations/20260321100000_fix_availability_overnight_constraint.sql:10-14`).

### 5.4 Preview and confirm

Preview response:

```json
{
  "preview": true,
  "change": { "employee": "Ana", "day": "friday", "before": [...], "after": {...} },
  "tz": "America/Chicago",
  "stored_after": { "start_time_local": "10:00:00", "end_time_local": "18:00:00" },
  "conflicting_shifts": [
    { "shift_id": "...", "date": "2026-12-04", "start": "17:00", "end": "23:00",
      "position": "Server", "status": "published", "reason": "ends after 18:00" }
  ],
  "skipped_dates": [{ "date": "2026-12-11", "reason": "exception on this date has priority" }],
  "preview_token": "9f2c...",
  "message": "Confirm with confirmed: true and the same preview_token."
}
```

Conflict rules:

- Recurring change: check the shifts of the employee from today (restaurant
  local) to 28 days ahead, on that weekday. A date with an exception is not
  checked. It goes into `skipped_dates`.
- Exception: check the shifts of the employee on that date.
- A shift belongs to its local start date. The check is the same as the RPC:
  the shift must be inside the window. An overnight window ends on the next day
  (`20261105120100_availability_conflict_local_time.sql:150-156`).
- `unavailable: true` makes every shift on the day a conflict.
- The preview reads at most 200 shifts. If it hits the cap, it says so.

Confirm:

- The confirm calls one SQL function. The function takes the lock, computes the
  token again, compares, and writes. A different token gives `STALE_PREVIEW`
  and no write. The response tells Claude to run the preview again.
- The confirm returns the row that the read path returns (section 5.1). The
  user can see at once that the read value is equal to the input.

## 6. Token and lock (my call)

`preview_token` = `md5` of one `jsonb::text` value that holds:

- `restaurant_id` and `employee_id`,
- the restaurant timezone,
- the content of every row of the key, ordered by `id`
  (`id`, `is_available`, local or UTC times, note). The query filters by
  `restaurant_id`, `employee_id`, and the day or the date.
- the normalized input of the write (`kind`, `day` or `date`, `available`,
  local `start` and `end`, the UTC values for an exception, `note`).

One SQL function computes it: `availability_write_token(...)`. The preview
and the confirm both call it, so the TS code never hashes. A confirm with
other arguments than the preview gives a different token, so it fails.

Lock in the confirm function, in this order. Each step is its own statement.

1. `SELECT ... FOR UPDATE` on the rows of the key. A UI UPDATE or DELETE waits.
2. `SELECT 1 FROM employees WHERE id = p_employee_id AND restaurant_id = p_restaurant_id FOR UPDATE`.
   A UI INSERT of a new availability row takes `FOR KEY SHARE` on the
   employee row through the foreign key
   (`supabase/migrations/20251123100050_create_availability_tables.sql:5`, `:21`).
   `FOR UPDATE` conflicts with it. An open insert must commit first. After this
   step, no new row of this employee can appear.
3. Compute the token in a new statement. Under READ COMMITTED, a new statement
   gets a new snapshot, so it sees every commit before the locks.
4. Compare, then delete and insert.

The order is rows first, employee second. `bulk_set_employee_availability`
uses the same order: its DELETE takes row locks, then its INSERT takes
`FOR KEY SHARE` on the employee
(`supabase/migrations/20261105120200_bulk_set_availability_local_keys.sql:87-114`).
With the same order, the two functions cannot deadlock. As a second guard, the
edge function retries the confirm one time on `40P01`.

The lock holds for milliseconds. `FOR UPDATE` on the employee row also blocks,
for that time, inserts into every table with a foreign key to the employee (for
example `shifts` and `time_punches`). `restaurants.timezone` is part of the
token, so a time zone change between preview and confirm also makes the token
stale.

## 7. Files

| File | Change |
|---|---|
| `supabase/functions/_shared/mcpAvailabilityTools.ts` | New. Tool definitions, input parse, conversions, conflict check, handlers. Pure parts have no Deno imports. |
| `supabase/functions/_shared/tools-registry.ts` | Register: push the 3 definitions, add the 2 writes to `WRITE_TOOLS`, and filter the tool list by capability (`:929-931`): hide `get_availability` without view access, hide the 2 writes without `edit:scheduling`. |
| `supabase/functions/_shared/aiWriteTools.ts` | Add the 2 write names to `WRITE_TOOL_NAMES`. |
| `supabase/functions/ai-execute-tool/index.ts` | One gate branch before `isCapabilityGatedTool` (`:3830`) that calls `canUseAvailabilityTool`, and 3 `case` lines that call `runAvailabilityTool`. The task asks for registry-only changes, but the dispatcher must gate and route the names. |
| `supabase/migrations/20261128120000_mcp_availability_writes.sql` | New. `availability_write_token`, `mcp_set_recurring_availability`, `mcp_set_availability_exception`. |
| `supabase/tests/mcp_availability_writes.test.sql` | New pgTAP tests. |
| `tests/unit/mcpAvailabilityTools.test.ts` | New unit tests, with DST dates in `America/Chicago`. |
| `specs/tla/availability-writes/` | TLA+ spec and 7 configs. |
| `docs/CLAUDE_INTEGRATION.md` | Add the 3 tools to the tool list. |

### 7.1 SQL functions

All are `SECURITY DEFINER`, `SET search_path = public, pg_catalog`, and start
with `user_has_capability(p_restaurant_id, 'edit:scheduling')`. The edge gate
uses the same capability, so the two gates agree. `SECURITY DEFINER` skips RLS,
so this check is the gate. Each function checks that the employee belongs to
the restaurant.
`REVOKE ... FROM PUBLIC, anon`, `GRANT ... TO authenticated`.

- `availability_write_token(p_restaurant_id, p_employee_id, p_kind, p_day_of_week, p_date, p_is_available, p_start, p_end, p_note) RETURNS text`. `STABLE`.
- `mcp_set_recurring_availability(p_restaurant_id, p_employee_id, p_day_of_week, p_is_available, p_start_local, p_end_local, p_note, p_token) RETURNS employee_availability`.
- `mcp_set_availability_exception(p_restaurant_id, p_employee_id, p_date, p_is_available, p_start_local, p_end_local, p_start_utc, p_end_utc, p_note, p_token) RETURNS availability_exceptions`.
  It stores the UTC clocks from the edge function. The local values go into the
  token only.

Errors: `42501` forbidden, `23503` employee not in restaurant, `PT409` stale
token (`STALE_PREVIEW`), `PT422` bad input. The custom codes do not collide
with `40001`, which retry layers read as a serialization failure, or with
`22007`, which Postgres raises for malformed input.

### 7.2 Why the write is in SQL

The delete and insert must be atomic, and the token check must run under the
lock. PostgREST gives one transaction per RPC call. Two REST calls from the
edge function cannot hold a lock between them.

## 8. Roles

| Tool | Gate | Where |
|---|---|---|
| `get_availability` | `view:scheduling` or `view:payroll` | `hasSchedulingOrPayrollCapability` |
| `update_availability` | `edit:scheduling` | `hasEditSchedulingCapability` |
| `add_availability_exception` | `edit:scheduling` | `hasEditSchedulingCapability` |

The SQL functions check `edit:scheduling` again. Both gates fail closed.
`collaborator_accountant` has `view:payroll`, so it can read availability. It
does not have `edit:scheduling`, so it cannot write.

## 9. TLA+ check

Spec: `specs/tla/availability-writes/AvailabilityWrites.tla`.

Model: one employee, 3 dates, the middle date has the time change. Actors: the
MCP client (preview, then confirm or abandon) and the UI (direct writes and
deletes). Recurring rows keep the local hour. Exceptions keep the UTC clock
from `fromZonedTime`. The confirm is one atomic step, because the SQL function
holds the locks of section 6. Time unit: one hour. CST = UTC-6, CDT = UTC-5,
change at 02:00.

Invariants:

| Invariant | Bad outcome that it forbids |
|---|---|
| `NoStaleCommit` | A confirm writes over a change that the preview did not see. |
| `RoundTrip` | A read returns a local time that is not equal to the last MCP write. |
| `ExceptionWins` | The effective availability of a date with an exception is not the exception. |

Configs:

| Config | Change from the design | Expect | Invariant that breaks |
|---|---|---|---|
| `AvailabilityWrites.cfg` | none, spring change | pass | - |
| `AvailabilityWrites_Fall.cfg` | none, fall change | pass | - |
| `AvailabilityWrites_NoToken.cfg` | confirm skips the token check | violation | `NoStaleCommit` |
| `AvailabilityWrites_UiReader.cfg` | read exceptions with the UI anchor, spring | violation | `RoundTrip` |
| `AvailabilityWrites_UiReaderFall.cfg` | UI anchor, fall | violation | `RoundTrip` |
| `AvailabilityWrites_NoGapCheck.cfg` | accept 02:00 on the spring date | violation | `RoundTrip` |
| `AvailabilityWrites_LatestWins.cfg` | the latest write wins, not the exception | violation | `ExceptionWins` |
| `AvailabilityWrites_EndSameDay.cfg` | anchor the end to the start date | violation | `RoundTrip` |

Output of `.claude/skills/run-tla/tlc.sh all specs/tla/availability-writes`:

```text
OK    AvailabilityWrites: pass (expected pass; 824335 distinct states found) log=/tmp/tlc-logs/AvailabilityWrites.log
OK    AvailabilityWrites_EndSameDay: violation (expected violation; 1439 distinct states found) log=/tmp/tlc-logs/AvailabilityWrites_EndSameDay.log
OK    AvailabilityWrites_Fall: pass (expected pass; 960217 distinct states found) log=/tmp/tlc-logs/AvailabilityWrites_Fall.log
OK    AvailabilityWrites_LatestWins: violation (expected violation; 1920 distinct states found) log=/tmp/tlc-logs/AvailabilityWrites_LatestWins.log
OK    AvailabilityWrites_NoGapCheck: violation (expected violation; 1226 distinct states found) log=/tmp/tlc-logs/AvailabilityWrites_NoGapCheck.log
OK    AvailabilityWrites_NoToken: violation (expected violation; 2247 distinct states found) log=/tmp/tlc-logs/AvailabilityWrites_NoToken.log
OK    AvailabilityWrites_UiReader: violation (expected violation; 1707 distinct states found) log=/tmp/tlc-logs/AvailabilityWrites_UiReader.log
OK    AvailabilityWrites_UiReaderFall: violation (expected violation; 1937 distinct states found) log=/tmp/tlc-logs/AvailabilityWrites_UiReaderFall.log
---- 8/8 configs matched their EXPECT
```

The `UiReader` trace: the MCP writes an exception of 20:00 on the change date.
The stored UTC clock is 01:00. The UI anchor reads 19:00. This is the bug of
section 3.

The model writes full windows `<<start, end>>`: `<<20, 0>>` (ends at midnight
on the next date), `<<1, 3>>`, and `<<2, 4>>` (both touch the change hour).

Limits of the model: one employee, one hour as the time unit. The legacy UTC
columns are not modeled, because no MCP reader uses them. The confirm is one
step; section 6 gives the lock argument for that.

## 10. Tests

- Unit (`tests/unit/mcpAvailabilityTools.test.ts`):
  - input parse: day names, `HH:MM`, `24:00`, equal times, `unavailable`.
  - exception local to UTC: equal to `localTimeToUtcTime` for 2027-03-13,
    2027-03-14, 2027-03-15, 2027-11-06, 2027-11-07, 2027-11-08, at 00:30,
    01:30, 03:00, 12:00, 20:00, 23:30.
  - gap rejection on 2027-03-14 02:30, also for an end on the next date.
    Ambiguous 2027-11-07 01:30 stores `06:30:00` and reads back `01:30`.
  - end anchor: 2027-03-14 20:00–00:00 stores `01:00:00`–`05:00:00` and reads
    back `20:00`–`00:00`.
  - canonical reader round trip for every case above.
  - `ui_shows` and `display_mismatch` on 2027-03-14 and 2027-11-07 at 20:00.
  - conflict check: inside, outside, overnight window, midnight end, closed day,
    exception date skipped.
  - role gate: staff and a collaborator get `TOOL_PERMISSION_DENIED`.
  - stale token: the handler maps SQLSTATE `40001` to `STALE_PREVIEW`.
  - registry: the 2 writes are in `WRITE_TOOLS` and `WRITE_TOOL_NAMES`.
- pgTAP (`supabase/tests/mcp_availability_writes.test.sql`):
  - recurring write stores the local input and the trigger fills the legacy
    columns.
  - the token changes after a UI update, a UI insert, and a time zone change.
  - a stale token raises `40001` and changes no row.
  - the exception write stores the UTC values that it gets.
  - an incomplete time pair raises `PT422`.
  - staff, `collaborator_accountant`, and a user of another restaurant get
    `42501`. `operations_manager` can write.
  - an employee of another restaurant gives `23503`.
  - the recurring write does not touch exceptions.
- E2E: justified exception. The tools have no UI. The seam is the MCP endpoint.
  I plan a Deno-free handler test with a fake client, and the pgTAP tests cover
  the SQL seam.

## 11. Decided trade-offs

- Phase 2.5 review: all critical and major findings are fixed in this
  document. The tool `canUseAvailabilityTool` changes the dispatcher, which the
  task did not list. The change is one gate branch and 3 `case` lines.

- The UI reader bug of section 3 stays. `get_availability` shows it. A
  follow-up fixes the readers.
- A write replaces all rows of the key. The UI can keep more than one window per
  day in the data, but the MCP tool sets one window. The preview shows all rows
  of `before`, so the user sees what goes away.
- Employee self-service through MCP is out of scope.

## 12. Environment blockers

- `npm install` failed at first: the network blocked `cdn.sheetjs.com`, the
  source of the `xlsx` package. A personal environment `nimble-pnl` now allows
  that host. `npm install` passes.
- The local Supabase does not run here (`supabase` MCP: `ECONNREFUSED`). pgTAP
  runs in CI only, unless Docker is available.
