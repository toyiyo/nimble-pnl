# find_coverage MCP tool — design

Status: draft, waits for user approval.
Branch: `claude/sharp-mendel-jbpkq0`.
TLA+: not required. The tool only reads data (task brief).

## 1. Problem

A manager asks the connector "who can cover this shift?" or "who could use
extra hours?". Today Claude must call `get_scheduling_context`, then work out
hours, rest gaps, availability and time off for each employee by hand. That
takes many calls and Claude can get the rules wrong.

`find_coverage` answers the question in one call. It returns a ranked list of
employees who can work one slot, and a separate list of employees who cannot,
with the reason.

## 2. Existing rules (premises, with citations)

The tool must not copy the conflict rules. These are the rules that exist now:

| Rule | Where it lives | Who uses it |
|---|---|---|
| Overlap | `intervalsOverlap` and `findShiftWarnings`, `supabase/functions/_shared/shiftWarnings.ts:22`, `:36` | Shift editor: `src/lib/shiftValidator.ts:16` imports the same module. Connector: `supabase/functions/_shared/schedulingContextTool.ts:7`. |
| Short rest (clopen) | `MIN_REST_HOURS = 8` and `restHoursBetween`, `supabase/functions/_shared/shiftWarnings.ts:2`, `:31`; flag rule at `:64-72` | Same as above. |
| Time off | SQL `check_timeoff_conflict`, `supabase/migrations/20260723180000_timeoff_conflict_local_tz.sql:26`. It matches `approved` and `pending` requests (`:97`). | Editor: `src/hooks/useConflictDetection.tsx:38`. Grid: `get_shift_conflicts`, `supabase/migrations/20261011120000_get_shift_conflicts.sql:24`. |
| Availability | SQL `check_availability_conflict`, `supabase/migrations/20261105120100_availability_conflict_local_time.sql:12`. SECURITY INVOKER (`:29`). | Editor: `src/hooks/useConflictDetection.tsx:43`. Grid: `get_shift_conflicts.sql:29`. |
| Weekly hour cap | `computeHourBudget`, `supabase/functions/_shared/schedule-prompt-builder.ts:184`. 40 h for adults, lower caps for minors. The roster marks it "stored, not enforced" (`supabase/functions/_shared/schedulingContext.ts:61`). | `buildRoster`, `schedulingContext.ts:68`. |

Result: overlap and short rest already run in a shared module that the edge
function imports. Time off and availability already run in SQL. No rule is
client-only, so no rule moves.

Other premises:

- `get_shift_conflicts` checks only shifts that exist
  (`get_shift_conflicts.sql:12-18`). A proposed slot is not a shift, so the
  tool cannot use it.
- Scheduling read tools are gated on `view:scheduling OR view:payroll`
  through `CAPABILITY_GATED_TOOLS`
  (`supabase/functions/_shared/tools-registry.ts:1085`). The dispatcher
  checks that list (`supabase/functions/ai-execute-tool/index.ts:3830`).
- The dispatcher calls each tool from a `switch`
  (`supabase/functions/ai-execute-tool/index.ts:3879`). A new tool needs one
  `case` there. `get_scheduling_context` uses one line
  (`index.ts:3922-3923`).
- The MCP server lists every tool from `getTools`
  (`supabase/functions/_shared/mcpHandler.ts:193`). A read tool gets
  `readOnlyHint: true` (`mcpHandler.ts:180`). A tool with no title entry gets
  a title from its name (`mcpHandler.ts:55`).
- Restaurant weeks start on Monday: `WEEK_STARTS_ON = 1`
  (`supabase/functions/_shared/labor/dateConfig.ts:8`), used by
  `weekStartDateStr` (`supabase/functions/_shared/labor/restaurantClock.ts:314`).
- `parseWallClock(wallClock, tz)` converts a local wall clock to a UTC
  instant and handles DST gaps (`restaurantClock.ts:380`).
- Employees come from `employees_secure`
  (`supabase/functions/_shared/employeeLaborColumns.ts:10`).

## 3. Decisions (user answers)

1. **SQL access: one new batch RPC.** `get_slot_conflicts` calls the two
   existing `check_*` functions for each active employee. One round trip.
2. **Hard and soft rules: the strict set.**
   - HARD (employee goes to `excluded` with the reason): overlap with another
     shift, approved time off, availability conflict (unavailable, or the slot
     is outside the window).
   - SOFT (employee stays in `candidates` with a flag): short rest (< 8 h),
     pending time off, hours over `max_weekly_hours` after the slot.

## 4. Tool contract

### 4.1 Input

| Arg | Type | Required | Notes |
|---|---|---|---|
| `restaurant_id` | uuid | yes | Added by the MCP layer. |
| `date` | `YYYY-MM-DD` | yes | Restaurant-local day the slot starts. |
| `start` | `HH:MM` | yes | Local start time, 24 h clock. |
| `end` | `HH:MM` | yes | Local end time. If `end <= start`, the slot ends the next day (overnight). |
| `area` | string | no | Rank key. Case-insensitive, trimmed. It does not filter. |
| `position` | string | no | Rank key. Case-insensitive, trimmed. It does not filter. |
| `limit` | integer | no | Max rows in `candidates`. Default 25, max 100. |

Bad input returns `{ ok: false, error: { code: 'INVALID_ARGUMENTS', message } }`,
the same shape as `schedulingContextTool.ts:79`.

### 4.2 Output

```jsonc
{
  "ok": true,
  "data": {
    "tz": "America/Chicago",
    "slot": { "date": "2026-12-01", "start": "16:00", "end": "22:00",
              "ends_next_day": false, "hours": 6,
              "week_start": "2026-11-30", "week_end": "2026-12-06" },
    "rank_order": ["match", "soft_flags", "fits_hour_cap", "hours_left", "consecutive_days", "name"],
    "candidates": [{
      "employee_id": "…", "name": "Ana", "position": "Server", "area": "FOH",
      "position_match": true, "area_match": true,
      "week_hours": 22.5,            // live shifts in the restaurant week, minus breaks
      "max_weekly_hours": 40,
      "hours_left": 17.5,            // max_weekly_hours - week_hours
      "hours_left_after_slot": 11.5,
      "consecutive_days": 3,         // days in a row if the employee takes the slot
      "availability": "available",   // or "no_availability_set"
      "time_off": null,              // or { "status": "pending", "start_date", "end_date" }
      "flags": [ { "code": "short_rest", "message": "Only 6.5 h of rest after the shift that ends 2026-12-01 09:30" } ]
    }],
    "candidates_total": 14,
    "excluded": [{
      "employee_id": "…", "name": "Ben",
      "reasons": [ { "code": "overlap", "message": "Works 15:00-19:00 on 2026-12-01" } ]
    }],
    "excluded_total": 3,
    "data_limits": { … }              // only when a source hits its row cap
  },
  "evidence": [ … ]
}
```

All times in the output are restaurant-local (`YYYY-MM-DD`, `HH:MM`). The
`tz` field names the zone.

Flag and reason codes: `overlap`, `time_off_approved`, `availability`
(HARD); `short_rest`, `time_off_pending`, `over_hour_cap` (SOFT).

### 4.3 Rank order (also in the tool description)

Sort `candidates` by these keys, in order:

1. **Match.** Both `position` and `area` match, then position only, then area
   only, then no match. If the caller gives no filter, the key is equal for
   all.
2. **Soft flags.** Fewer flags first.
3. **Fits the hour cap.** `hours_left_after_slot >= 0` first.
4. **Hours left.** More `hours_left` first. This puts the employees who can
   use extra hours at the top.
5. **Consecutive days.** Fewer days in a row first.
6. **Name.** A to Z, then `employee_id`, so the order is stable.

`excluded` is sorted by name.

## 5. Computation

### 5.1 New SQL function `get_slot_conflicts`

New migration `supabase/migrations/20261128120000_get_slot_conflicts.sql`:

```sql
CREATE OR REPLACE FUNCTION public.get_slot_conflicts(
  p_restaurant_id uuid, p_start timestamptz, p_end timestamptz)
RETURNS TABLE (employee_id uuid, conflict_type text, source text,
               status text, start_date date, end_date date, message text)
LANGUAGE sql STABLE SECURITY INVOKER SET search_path = public, pg_catalog
AS $$
  WITH e AS (
    SELECT id FROM employees
    WHERE restaurant_id = p_restaurant_id AND is_active
      AND p_end > p_start AND p_end - p_start <= interval '24 hours'
  )
  SELECT e.id, 'time_off', NULL, t.status, t.start_date, t.end_date,
         format('Time off %s (%s to %s)', t.status, t.start_date, t.end_date)
  FROM e CROSS JOIN LATERAL check_timeoff_conflict(e.id, p_start, p_end) t
  WHERE t.has_conflict
  UNION ALL
  SELECT e.id, 'availability', a.conflict_type, NULL, NULL, NULL, a.message
  FROM e CROSS JOIN LATERAL
       check_availability_conflict(e.id, p_restaurant_id, p_start, p_end) a
  WHERE a.has_conflict;
$$;
REVOKE ALL ON FUNCTION public.get_slot_conflicts(uuid, timestamptz, timestamptz) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_slot_conflicts(uuid, timestamptz, timestamptz) TO authenticated;
```

- It copies no rule. It only calls the two `check_*` functions, the same way
  `get_shift_conflicts` does.
- SECURITY INVOKER: RLS on `employees`, `time_off_requests`,
  `employee_availability` and `availability_exceptions` applies to the
  caller.
- The `24 hours` guard stops a large window. The tool also checks the length.

pgTAP test `supabase/tests/get_slot_conflicts.test.sql`: approved time off,
pending time off, recurring unavailable day, slot outside the window, no
conflict, inactive employee skipped, other restaurant skipped, bad window
returns no rows, `anon` has no EXECUTE.

### 5.2 Loader `supabase/functions/_shared/mcpFindCoverageTool.ts`

`runFindCoverage(args, restaurantId, supabase, tz)`:

1. Check the args. Build local wall clocks and convert them with
   `parseWallClock` (`restaurantClock.ts:380`). An overnight slot uses
   `date + 1` for the end.
2. Window for shifts: from `min(week_start, date - 13)` to
   `max(week_end, date + 13)`, local days, plus `MIN_REST_HOURS` and 24 h of
   margin. This covers the week hours, the rest and overlap checks, and a
   streak of up to 14 days.
3. Load in parallel:
   - active employees from `employees_secure`
     (`id, name, position, area, date_of_birth, is_minor, status`), cap 500;
   - live shifts in the window (`id, employee_id, start_time, end_time,
     break_duration, status`), paged like `fetchShifts`
     (`schedulingContextTool.ts:116`);
   - recurring availability rows (`employee_id` only), to tell
     `available` from `no_availability_set`;
   - `get_slot_conflicts(restaurant, slot_start, slot_end)`.
4. Call the pure function `rankCoverage` (5.3).
5. Return the result. Use `fitToLimit`-style trimming so the text stays
   below `MAX_TOOL_TEXT_CHARS` (`mcpHandler.ts:40`): drop flag messages
   first, then cut `excluded` rows, and report the totals.

### 5.3 Pure module `supabase/functions/_shared/findCoverage.ts`

No I/O, so Vitest can import it (lesson 2026-05-07, "Pure handler in
`_shared/`").

- `slotWarnings(employeeId, slot, shifts)`: build a `WarnShift` with id
  `__slot__` and run `findShiftWarnings` on the employee's shifts plus the
  slot. Keep each warning where `shift_id` or `other_shift_id` is
  `__slot__`. `findShiftWarnings` puts the short-rest flag on the later
  shift (`shiftWarnings.ts:65-68`), so both sides must be read.
- `weekHours(employeeId, shifts, weekStart, weekEnd, tz)`: sum of
  `end - start - break` for live shifts that start in the restaurant week,
  the same math as `buildRoster` (`schedulingContext.ts:78-79`).
- `consecutiveDays(employeeId, shifts, date, tz)`: count the local dates
  with a live shift that join the slot date with no gap, plus the slot date.
  Bound: 14 days on each side.
- `rankCoverage(input)`: apply the HARD and SOFT rules from section 3, build
  the rows, sort by section 4.3.

### 5.4 Registration

- `tools-registry.ts`: add the tool definition and add `find_coverage` to
  `CAPABILITY_GATED_TOOLS`. Same gate as `get_scheduling_context`.
- `ai-execute-tool/index.ts`: add one import and one `case`. The task brief
  says "change `tools-registry.ts` only", but the dispatcher `switch`
  (`index.ts:3879`) has no other way to reach a tool. The change is 3 lines.
- `mcpHandler.ts`: no change. The title comes from the name.

## 6. Tests

`tests/unit/findCoverage.test.ts` (pure module):

- Rank order: one test for each key in 4.3, plus one full mixed list.
- Each exclusion reason: `overlap`, `time_off_approved`, `availability`
  (unavailable day, and outside the window), more than one reason on one
  employee.
- Each soft flag: `short_rest` before the slot, `short_rest` after the slot,
  `time_off_pending`, `over_hour_cap`.
- Overnight slot: overlap with a next-day morning shift.
- Week hours skip cancelled shifts and subtract breaks.
- Consecutive days across a gap and across the week edge.
- Local times and `tz` in the output.

`tests/unit/mcpFindCoverageTool.test.ts` (loader, with a mock client): arg
errors, RPC error, query error, data limits, text-size trimming.

`tests/unit/tools-registry.test.ts`: `find_coverage` is in
`CAPABILITY_GATED_TOOLS` and its required args are
`date`, `start`, `end`.

pgTAP: section 5.1.

E2E: justified exception. The tool has no UI. It runs only through the MCP
edge function, which the Playwright suite does not drive.

## 7. Risks

- **Parallel sessions.** The availability session can change
  `check_availability_conflict`. `get_slot_conflicts` calls it by name and
  reads only `has_conflict`, `conflict_type` and `message`, so a new column
  does not break it. A new signature does break it; the pgTAP test catches
  that.
- **Load.** 500 employees means 1,000 calls to the `check_*` functions in
  one SQL statement. Each call is an index lookup on `employee_id`. That is
  the same cost as `get_shift_conflicts` on a 500-shift week.
- **Masked birth dates.** Without `view:employee_pii`, `date_of_birth` is
  NULL. `computeHourBudget` then uses the strict minor cap when `is_minor`
  is true (`schedule-prompt-builder.ts:199-202`).
