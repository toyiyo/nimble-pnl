# find_coverage MCP tool — design

Status: revised after the Phase 2.5 review. Waits for user approval.
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

The tool must not copy a conflict rule. These are the rules that exist now:

| Rule | Where it lives | Who uses it |
|---|---|---|
| Overlap | `intervalsOverlap` and `findShiftWarnings`, `supabase/functions/_shared/shiftWarnings.ts:22`, `:36` | Shift editor: `src/lib/shiftValidator.ts:16` imports the same module. Connector: `supabase/functions/_shared/schedulingContextTool.ts:7`. |
| Short rest (clopen) | `MIN_REST_HOURS = 8` and `restHoursBetween`, `shiftWarnings.ts:2`, `:31`; flag rule at `:64-72` | Same as above. |
| Time off | SQL `check_timeoff_conflict`, `supabase/migrations/20260723180000_timeoff_conflict_local_tz.sql:26`. It matches `approved` and `pending` requests (`:97`). | Editor: `src/hooks/useConflictDetection.tsx:38`. Grid: `get_shift_conflicts`, `supabase/migrations/20261011120000_get_shift_conflicts.sql:24`. |
| Availability | SQL `check_availability_conflict`, `supabase/migrations/20261105120100_availability_conflict_local_time.sql:12`. SECURITY INVOKER (`:29`). | Editor: `useConflictDetection.tsx:43`. Grid: `get_shift_conflicts.sql:29`. |
| Weekly hour cap value | `computeHourBudget`, `supabase/functions/_shared/schedule-prompt-builder.ts:184`. 40 h, or 18 h for an employee under 16 (`:170-178`, `:199-202`). | Roster (`schedulingContext.ts:68`, note "stored, not enforced" at `:61`). AI validator. |
| Weekly hour cap check | `schedule-validator.ts:488-506`: drop when the week total plus the shift is more than `max_weekly_hours` (`HOURS_EXCEED_WEEKLY_CAP`, `MINOR_HOURS_EXCEEDED`). | AI schedule generator only. The shift editor does not block it. |
| Consecutive-day cap | `longestConsecutiveRun`, `supabase/functions/_shared/schedule-validator.ts:146`. Rule: more than 5 days in a row → `CONSECUTIVE_DAYS_EXCEEDED` (`:510-521`). | AI schedule generator only. |
| Paid shift hours | `buildRoster`: `max(0, end - start - break/60)`, `schedulingContext.ts:78-79`. | Roster `scheduled_hours`. |

`schedule-validator.ts` also has a day-aware overlap test, `shiftsConflict`
(`:470-484`). It works on `(day, HH:MM)` rows from the AI generator. The tool
has real instants, so it uses `findShiftWarnings`, the editor rule.

Result: every rule already runs in a module that the edge function can import,
or in SQL. No rule is client-only, so no rule moves.

Other premises:

- `get_shift_conflicts` checks only shifts that exist
  (`get_shift_conflicts.sql:12-18`). A proposed slot is not a shift, so the
  tool cannot use it.
- PostgREST returns at most `max_rows = 1000` rows for one request
  (`supabase/config.toml:9`).
- Scheduling read tools are gated on `view:scheduling OR view:payroll`
  through `CAPABILITY_GATED_TOOLS`
  (`supabase/functions/_shared/tools-registry.ts:1085`). The dispatcher
  checks that list (`supabase/functions/ai-execute-tool/index.ts:3830`).
- The dispatcher forwards the user JWT (`ai-execute-tool/index.ts:3787-3791`),
  so RLS applies to every read.
- The dispatcher calls each tool from a `switch`
  (`ai-execute-tool/index.ts:3879`). A new tool needs one `case` there.
  `get_scheduling_context` uses one line (`index.ts:3922-3923`).
- The MCP server lists every tool from `getTools`
  (`supabase/functions/_shared/mcpHandler.ts:193`). A read tool gets
  `readOnlyHint: true` (`mcpHandler.ts:180`). A tool with no title entry gets
  a title from its name (`mcpHandler.ts:55`).
- Restaurant weeks start on Monday: `WEEK_STARTS_ON = 1`
  (`supabase/functions/_shared/labor/dateConfig.ts:8`), used by
  `weekStartDateStr` (`supabase/functions/_shared/labor/restaurantClock.ts:314`).
- `parseWallClock(wallClock, tz)` converts a local wall clock to a UTC
  instant (`restaurantClock.ts:380`). It only logs bad input outside tests
  (`:39-46`), and its regex accepts `25:99` (`:32`). The tool must check
  `HH:MM` itself.
- Employees come from `employees_secure`
  (`supabase/functions/_shared/employeeLaborColumns.ts:10`).
  `employees.is_active` exists
  (`20251209000000_add_employee_activation_tracking.sql:6`).
- `findShiftWarnings` skips only `cancelled` shifts (`shiftWarnings.ts:39`)
  and gives each overlap pair twice (`:60-61`).

## 3. Decisions

User answers:

1. **SQL access: one new batch RPC.** `get_slot_conflicts` calls the two
   existing `check_*` functions for each active employee. One round trip.
2. **Hard and soft rules: the strict set.**
   - HARD (employee goes to `excluded` with the reason): overlap with another
     shift, approved time off, availability conflict (unavailable, or the slot
     is outside the window).
   - SOFT (employee stays in `candidates` with a flag): short rest (< 8 h),
     pending time off, hours over `max_weekly_hours` after the slot.

Design decisions after the review:

3. **The consecutive-day cap is a SOFT flag, `over_consecutive_days`.** The
   tool uses the validator rule as it is:
   `longestConsecutiveRun(week days + slot date) > 5`. It is SOFT for the same
   reason as the hour cap: the shift editor does not block it, and a manager
   can approve it. The AI validator drops these shifts because no person
   checks its output.
4. **"Live shift"** means `status <> 'cancelled'`, the `findShiftWarnings`
   filter. Week hours include `completed` shifts, as `buildRoster` does
   (`schedulingContext.ts:77`).

## 4. Tool contract

### 4.1 Input

| Arg | Type | Required | Notes |
|---|---|---|---|
| `restaurant_id` | uuid | yes | Added by the MCP layer. |
| `date` | `YYYY-MM-DD` | yes | Restaurant-local day the slot starts. |
| `start` | `HH:MM` | yes | Local start time, 00:00 to 23:59. |
| `end` | `HH:MM` | yes | Local end time, 00:00 to 23:59. If `end < start`, the slot ends the next day. `end == start` is an error. |
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
              "end_date": "2026-12-01", "hours": 6,
              "week_start": "2026-11-30", "week_end": "2026-12-06" },
    "rank_order": ["match", "soft_flags", "fits_hour_cap", "hours_left", "consecutive_days", "name"],
    "candidates": [{
      "employee_id": "…", "name": "Ana", "position": "Server", "area": "FOH",
      "position_match": true, "area_match": true,
      "week_hours": 22.5,            // paid hours of live shifts in the restaurant week
      "max_weekly_hours": 40,
      "hours_left": 17.5,            // max_weekly_hours - week_hours
      "hours_left_after_slot": 11.5,
      "consecutive_days": 3,         // days in a row through the slot date, if the employee takes the slot
      "availability": "available",   // or "no_availability_set"
      "time_off": null,              // or { "status": "pending", "start_date", "end_date" }
      "flags": [ { "code": "short_rest", "message": "6.5 h of rest after the shift 2026-12-01 03:00-09:30" } ]
    }],
    "candidates_total": 14,
    "excluded": [{
      "employee_id": "…", "name": "Ben",
      "reasons": [ { "code": "overlap", "message": "Works 2026-12-01 15:00-19:00" } ]
    }],
    "excluded_total": 3,
    "data_limits": { … }              // only when a source is incomplete
  },
  "evidence": [ … ]
}
```

All times in the output are restaurant-local (`YYYY-MM-DD`, `HH:MM`). The
`tz` field names the zone. The tool formats `slot.start` and `slot.end` back
from the UTC instants. Thus a start time in a spring-forward gap shows the
real local start. `slot.hours` comes from the instants, so a 22:00-06:00 slot
on a fall-back night shows 9 h.

Codes: `overlap`, `time_off_approved`, `availability` (HARD);
`short_rest`, `time_off_pending`, `over_hour_cap`, `over_consecutive_days`
(SOFT).

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

`excluded` is sorted by name, then `employee_id`.

## 5. Computation

### 5.1 New SQL function `get_slot_conflicts`

New migration `supabase/migrations/20261128120000_get_slot_conflicts.sql`.
It returns **one row for each active employee**, so the row count is the
employee count (500 or fewer), not the conflict count.

```sql
CREATE OR REPLACE FUNCTION public.get_slot_conflicts(
  p_restaurant_id uuid, p_start timestamptz, p_end timestamptz)
RETURNS TABLE (employee_id uuid, has_recurring_availability boolean,
               conflicts jsonb)
LANGUAGE plpgsql STABLE SECURITY INVOKER SET search_path = public, pg_catalog
AS $$
BEGIN
  -- 24 hours plus one hour of slack: a fall-back DST night adds one real hour.
  IF p_start IS NULL OR p_end IS NULL OR p_end <= p_start
     OR p_end - p_start > interval '25 hours' THEN
    RAISE EXCEPTION 'get_slot_conflicts: bad window % to %', p_start, p_end
      USING ERRCODE = '22023';
  END IF;
  RETURN QUERY
  SELECT e.id,
         EXISTS (SELECT 1 FROM employee_availability ea
                 WHERE ea.employee_id = e.id AND ea.restaurant_id = p_restaurant_id),
         COALESCE((SELECT jsonb_agg(c) FROM (
             SELECT 'time_off'::text AS type, NULL::text AS source, t.status::text AS status,
                    t.start_date, t.end_date,
                    format('Time off %s (%s to %s)', t.status, t.start_date, t.end_date) AS message
             FROM check_timeoff_conflict(e.id, p_start, p_end) t WHERE t.has_conflict
             UNION ALL
             SELECT 'availability'::text, a.conflict_type::text, NULL::text,
                    NULL::date, NULL::date, a.message::text
             FROM check_availability_conflict(e.id, p_restaurant_id, p_start, p_end) a
             WHERE a.has_conflict) c), '[]'::jsonb)
  FROM employees e
  WHERE e.restaurant_id = p_restaurant_id AND e.is_active
  ORDER BY e.id;
END;
$$;
REVOKE ALL ON FUNCTION public.get_slot_conflicts(uuid, timestamptz, timestamptz) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_slot_conflicts(uuid, timestamptz, timestamptz) TO authenticated;
```

- It copies no rule. It calls the two `check_*` functions, the same way
  `get_shift_conflicts` does.
- SECURITY INVOKER: RLS on `employees`, `time_off_requests`,
  `employee_availability` and `availability_exceptions` applies to the
  caller. These tables already let any restaurant member read the rows
  (`20251114100000_create_scheduling_tables.sql:218-226`,
  `20251123100050_create_availability_tables.sql:67-71`, `:92-96`), so a
  direct call shows no new data.
- A bad window raises `22023`. It does not return zero rows, because zero
  rows reads as "no conflict".
- `has_recurring_availability` replaces a separate availability query. That
  query can have more than 1,000 rows and PostgREST cuts it.

pgTAP test `supabase/tests/get_slot_conflicts.test.sql`: approved time off,
pending time off, recurring unavailable day, slot outside the window, no
conflict (empty array), `has_recurring_availability` true and false,
inactive employee skipped, other restaurant skipped, `p_end <= p_start`
raises, a 26 h window raises, `anon` has no EXECUTE.

### 5.2 Loader `supabase/functions/_shared/mcpFindCoverageTool.ts`

`runFindCoverage(args, restaurantId, supabase, tz)`:

1. Check the args (section 4.1). Check `HH:MM` with a strict regex
   (`^([01]\d|2[0-3]):[0-5]\d$`) before `parseWallClock`. The end date is
   `date + 1` when `end < start`.
2. Load in parallel:
   - active employees from `employees_secure`
     (`id, name, position, area, date_of_birth, is_minor, status`), cap 500;
   - **near shifts** (`id, employee_id, start_time, end_time, status`):
     `start_time` from `slot_start - (MIN_REST_HOURS + 24) h` to
     `slot_end + 24 h`, `status <> 'cancelled'`, limit 1000. They feed the
     overlap and short-rest rules. If the result has 1000 rows, the tool
     returns an error. It does not guess with a cut list (fail closed).
   - **wide shifts** (same columns plus `break_duration`): local days from
     `min(week_start, date - 6)` to `max(week_end, date + 6)`, paged like
     `fetchShifts` (`schedulingContextTool.ts:116`). They feed week hours and
     the streak. If the pages hit their cap, `data_limits` names `shifts` and
     says that `week_hours` and `consecutive_days` can be low.
   - `get_slot_conflicts(restaurant, slot_start, slot_end)`. If the RPC
     returns an error, the tool returns an error. If it returns 1000 rows,
     the tool returns an error (fail closed).
3. Call the pure function `rankCoverage` (5.3).
4. Keep the text below `MAX_TOOL_TEXT_CHARS` (`mcpHandler.ts:40`): delete the
   flag and reason messages first, then cut `excluded` rows. The totals stay.

### 5.3 Pure module `supabase/functions/_shared/findCoverage.ts`

No I/O, so Vitest can import it (lesson 2026-05-07, "Pure handler in
`_shared/`").

- `slotWarnings(employeeId, slot, nearShifts)`: build a `WarnShift` with id
  `__slot__`. Run `findShiftWarnings` on the employee's near shifts plus the
  slot. Keep each warning where `shift_id` or `other_shift_id` is
  `__slot__`. `findShiftWarnings` puts the short-rest flag on the later shift
  (`shiftWarnings.ts:65-68`), so read both sides. Delete duplicates by the
  other shift's id.
- Week hours: sum `paidShiftHours(s)` for live shifts whose local start day is
  in the restaurant week. `paidShiftHours` is a new export of
  `schedulingContext.ts`. `buildRoster` calls it too, so the formula has one
  copy.
- Consecutive-day flag: `longestConsecutiveRun(week days + date) > 5`, with
  `longestConsecutiveRun` imported from `schedule-validator.ts`.
- `consecutive_days` (the value in the output and the rank key): the length
  of the run of local `YYYY-MM-DD` days that contains `date`, in the
  `date - 6` to `date + 6` range. Step days with `addDaysToDateStr`
  (UTC-anchored), not local `Date` math.
- `rankCoverage(input)`: apply the rules from section 3, build the rows,
  sort by section 4.3.

### 5.4 Registration

- `tools-registry.ts`: add the tool definition and add `find_coverage` to
  `CAPABILITY_GATED_TOOLS`. Same gate as `get_scheduling_context`.
- `ai-execute-tool/index.ts`: add one import and one `case`. The task brief
  says "change `tools-registry.ts` only", but the dispatcher `switch`
  (`index.ts:3879`) has no other way to reach a tool. The change is 3 lines.
- `schedulingContext.ts`: export `paidShiftHours` and call it in
  `buildRoster`. About 5 lines. No behavior change.
- `mcpHandler.ts`: no change. The title comes from the name.

## 6. Tests

`tests/unit/findCoverage.test.ts` (pure module):

- Rank order: one test for each key in 4.3, plus one full mixed list.
- Each exclusion reason: `overlap`, `time_off_approved`, `availability`
  (unavailable day, and outside the window), more than one reason on one
  employee.
- Each soft flag: `short_rest` before the slot, `short_rest` after the slot,
  `time_off_pending`, `over_hour_cap`, `over_consecutive_days`.
- Overnight slot: overlap with a next-day morning shift.
- Overlap gives one reason, not two.
- Week hours skip cancelled shifts and subtract breaks.
- Consecutive days across a gap and across the week edge.
- Local times and `tz` in the output.

`tests/unit/mcpFindCoverageTool.test.ts` (loader, with a mock client): each
bad arg (`date`, `24:00`, `25:00`, `end == start`, `limit`), overnight slot
instants, a fall-back DST night (9 h), a spring-forward start, RPC error,
RPC at 1000 rows, near shifts at 1000 rows, wide shifts at the page cap
(`data_limits`), text-size trim.

`tests/unit/tools-registry.test.ts`: `find_coverage` is in
`CAPABILITY_GATED_TOOLS`, `missingRequiredArgs` returns `date`, `start`,
`end`, and the description names the rank order.

`tests/unit/getSchedulingContext.test.ts` stays green after the
`paidShiftHours` export.

pgTAP: section 5.1.

E2E: justified exception. The tool has no UI. It runs only through the MCP
edge function, which the Playwright suite does not drive.

## 7. Risks

- **Parallel sessions.** The availability session can change
  `check_availability_conflict`. `get_slot_conflicts` reads only
  `has_conflict`, `conflict_type` and `message`, so a new column does not
  break it. A new signature does break it; the pgTAP test catches that. The
  read-tool session can change `schedulingContext.ts`; the `paidShiftHours`
  change is small.
- **Load.** For each employee, `check_timeoff_conflict` reads `employees`,
  `restaurants` and `time_off_requests`
  (`20260723180000_timeoff_conflict_local_tz.sql:50-53`, `:95-99`).
  `check_availability_conflict` reads `restaurants`, then
  `availability_exceptions` and `employee_availability` for each local date
  of the slot (`20261105120100_availability_conflict_local_time.sql:57`,
  `:91-96`, `:132-137`, `:161-166`). For 500 employees and an overnight slot
  that is about 3,000 to 4,000 index probes, plus the RLS check on each row.
  Budget: 1 s. Measure it with `EXPLAIN (ANALYZE, BUFFERS)` on a local
  database with 500 seeded employees in Phase 4, and write the result in the
  PR. If local Supabase cannot run, the PR says so.
- **No `(restaurant_id, start_time)` index on `shifts`.** Only single-column
  indexes exist (`20251114100000_create_scheduling_tables.sql:69-71`). The
  near-shift query is narrow (about 3 days), so the cost is low. An index is
  a separate change.
- **Masked birth dates.** Without `view:employee_pii`, `date_of_birth` is
  NULL. `computeHourBudget` then uses 18 h when `is_minor` is true
  (`schedule-prompt-builder.ts:199-202`).
- **Timezone fallback (pre-existing).** The SQL functions fall back to `UTC`
  for a blank timezone (`20260723180000_timeoff_conflict_local_tz.sql:55`).
  The edge function falls back to another zone
  (`supabase/functions/_shared/timezone.ts:15`). For a restaurant with a NULL
  timezone, the tool and SQL can disagree on the local day. This design does
  not fix it.

## 8. Review fold (Phase 2.5)

| Finding | Severity | Action |
|---|---|---|
| Rule table leaves out `schedule-validator.ts` rules | critical | Fixed: table rows added; decision 3; `longestConsecutiveRun` reused. |
| "One index lookup per call" is false | critical | Fixed: section 7 text, budget, measurement step. |
| Minor cap text is wrong | critical | Fixed: "40 h, or 18 h for an employee under 16". |
| 24-hour guard fails open | major | Fixed: `end == start` rejected; RPC raises `22023`; 25 h slack. |
| RPC result can be cut at 1000 rows | major | Fixed: one row per employee; 1000 rows is an error. |
| Recurring availability query can be cut | major | Fixed: `has_recurring_availability` column. |
| Shift window too wide, overlap zone can be cut | major | Fixed: near and wide loads; near load fails closed; streak range ±6 days. |
| `weekHours` copies the hours formula | major | Fixed: `paidShiftHours` export. |
| No casts in `UNION ALL` | minor | Fixed in 5.1. |
| `parseWallClock` accepts `25:99` | minor | Fixed: strict `HH:MM` regex; tests. |
| DST cases not defined | minor | Fixed: section 4.2 text; tests. |
| Timezone fallback mismatch | minor | Pre-existing. Section 7. Follow-up task. |
| Overlap pair given twice | minor | Fixed: duplicates deleted. |
| "Live shift" not defined | minor | Fixed: decision 4. |
| Streak day math | minor | Fixed: `addDaysToDateStr`, `longestConsecutiveRun`. |
| `CAPS.availability = 2000` above `max_rows` in `schedulingContextTool.ts:44` | pre-existing | Not in scope. Follow-up task. |
