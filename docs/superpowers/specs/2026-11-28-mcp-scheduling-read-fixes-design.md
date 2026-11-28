# MCP scheduling read tools: data fixes (design)

Status: approved by the user on 2026-11-28 (option 1 for `restaurant_id`).
Branch: `claude/great-pasteur-39dxrh`.
Text is STE-aligned (`docs/STE100_STYLE.md`).

## Problem

The user found 5 data problems in the EasyShiftHQ MCP scheduling read tools.
The data is from December for one restaurant in `America/Chicago`.

1. `coverage.open_spots` shows `assigned: 0` for every slot. The planner UI
   shows the same slots as full. The tool reports 188 open spots that do not
   exist.
2. Shift times are in UTC only.
3. A shift has its own position. The tools do not show when it is different
   from the employee position.
4. `get_scheduling_context` gives hours for the full period only, not per week.
5. A tool can run without `restaurant_id`.

## Root cause of problem 1

The MCP and the planner UI use different rules to put a shift in a template
slot.

- The planner UI uses `shift_template_id` when it is set
  (`src/hooks/useShiftPlanner.ts:170-178`). When it is null, the UI matches on
  local start time, local end time, position, day of week, and area. It uses
  active templates only (`src/hooks/useShiftPlanner.ts:152`,
  `src/hooks/useShiftPlanner.ts:184-197`, `src/lib/templateAreaMatch.ts:63-76`).
- The SQL helper `shift_template_assigned_count` uses the same two branches
  (`supabase/migrations/20260720120000_shift_fill_by_assignment.sql:16-31`).
- The MCP `buildCoverage` skips every shift with no `shift_template_id`
  (`supabase/functions/_shared/schedulingContext.ts:409`). It has no fallback.

Two writers make shifts with no `shift_template_id`:

- Apply week template:
  `supabase/migrations/20261006120000_editable_week_templates.sql:290-293`.
- Copy week: `supabase/migrations/20260303200000_copy_week_shifts_rpc.sql:28-31`.

A week from one of these writers is full in the UI and empty in the MCP.

The MCP template query does not read `area`
(`supabase/functions/_shared/schedulingContextTool.ts:202`). The area rule
needs it.

This session has no production access. The cause comes from the code. This
read-only query confirms it on production:

```sql
SELECT count(*) FILTER (WHERE shift_template_id IS NULL) AS no_template, count(*) AS total
FROM shifts
WHERE restaurant_id = '<id>'
  AND start_time >= '2026-12-01T06:00Z' AND start_time < '2027-01-01T06:00Z'
  AND status <> 'cancelled';
```

## Design

### 1. Coverage match

- Add `supabase/functions/_shared/templateShiftMatch.ts`. It is pure and has no
  Deno imports, so Vitest can import it.
- `slotKeyForShift(shift, templates, employeeArea, tz)` returns one
  `templateId|date` key or `null`:
  - Cancelled shift: `null`.
  - `shift_template_id` set: the key of that template, if the template is in the
    list. Else `null`. A linked shift never falls back to the time match. This
    is the UI rule (`src/hooks/useShiftPlanner.ts:170-178`).
  - `shift_template_id` null: filter active templates on exact local
    `HH:MM:SS` start and end, position, day of week of the local start, and
    area. A null area on either side matches. Prefer the template with the same
    area as the employee. Else take the first candidate in input order. This is
    `findAreaAwareTemplate` (`src/lib/templateAreaMatch.ts:63-76`).
- The function returns one key for each shift. So one shift can fill one slot
  only.
- `buildCoverage` takes a new optional `employeeAreas` map. It counts distinct
  employees for each key, the same as `distinctAssignedCount`
  (`src/lib/shiftFill.ts`).
- `runGetSchedulingContext` reads `area` on templates and passes the employee
  areas from the roster rows.
- A parity test runs `buildTemplateGridData` (UI) and `buildCoverage` (MCP) on
  the same rows. The counts must be equal. If the rules drift, the test fails.

The fallback must not see inactive templates. The MCP loads active templates
only (`supabase/functions/_shared/schedulingContextTool.ts:202-203`). A shift
linked to an inactive template is not in any MCP slot. The UI shows it under a
hidden lane, and the MCP does not list hidden lanes. So the counts agree for
every listed slot.

### 2. Local time

Add these fields to each shift row. The UTC fields do not change.

- `start_time_local`, `end_time_local`: ISO 8601 with the offset, for example
  `2026-12-05T17:00:00-06:00`.
- `tz`: the IANA zone, for example `America/Chicago`.

Rows that get the fields:

- `get_schedule_overview`: each row in `shifts_by_date`
  (`supabase/functions/_shared/scheduleOverview.ts:43-56`).
- `get_scheduling_context`: each entry in `conflicts`
  (`supabase/functions/_shared/schedulingContext.ts:280-302`).
- `get_time_punches`: each row in `shifts`
  (`supabase/functions/_shared/timePunchShifts.ts:20-30`).

A shared helper `localIso(iso, tz)` in `templateShiftMatch.ts` makes the value.

### 3. Position mismatch

Add `shift_position`, `employee_position`, and `position_mismatch` to:

- `get_schedule_overview` rows. The current `position` field falls back to the
  employee position (`supabase/functions/_shared/scheduleOverview.ts:51`). That
  fallback hides the mismatch. The field stays the same for current callers.
- `get_scheduling_context` conflict entries. The employee position comes from
  the roster rows.

The compare ignores case and outer spaces. When one side is null or empty,
`position_mismatch` is `false`.

`get_time_punches` rows have no shift position. They do not get the flag.

### 4. Hours per week

Add `weekly_hours` to each roster entry, next to `max_weekly_hours`:

```json
{ "week_start": "2026-11-30", "scheduled_hours": 32.5,
  "partial_week": false, "over_max_weekly_hours": false }
```

- A week is Monday to Sunday in restaurant time. The week of a shift is the
  week of its local start date. This is the rule of `mondayOf` and of the
  publish check (`supabase/functions/_shared/schedulingContextTool.ts:57-60`,
  `supabase/functions/_shared/schedulingContextTool.ts:243-250`).
- The list has one entry for each week that touches the period, also with 0
  hours.
- `partial_week` is `true` when the period does not hold all 7 days of the week.
- The hours rule is the same as `scheduled_hours`: cancelled shifts do not
  count, and the break is subtracted
  (`supabase/functions/_shared/schedulingContext.ts:76-82`).

### 5. Required `restaurant_id`

No MCP path reads the restaurant that is selected in the UI.
`supabase/functions/_shared/mcpHandler.ts:314-335` reads `restaurant_id` from
the arguments. `supabase/functions/ai-execute-tool/index.ts:3799-3815` reads it
from the body and checks the membership.

One implicit fallback exists. A call without `restaurant_id` uses the only
restaurant of the user (`supabase/functions/_shared/mcpHandler.ts:321-322`).

The user chose option 1: `restaurant_id` is required for every MCP data tool.

- `toMcpTool` puts `restaurant_id` in `required` for each data tool
  (`supabase/functions/_shared/mcpHandler.ts:166-182`).
- `callTool` refuses a call without `restaurant_id`, also when the user has one
  restaurant. The error tells Claude to call `list_restaurants`.
- `list_restaurants` does not change.
- The property description no longer says that it can be omitted
  (`supabase/functions/_shared/mcpHandler.ts:146-150`).
- New tools from the other sessions get the rule with no change, because
  `toMcpTool` handles every tool in the catalog.

## TLA+

Not needed. The tools only read data. There is no concurrency. The one-slot
rule is true by construction, because `slotKeyForShift` returns one key. A unit
test checks that no shift fills two slots and that `open = capacity - assigned`.

## Tests (each written first, and each fails before the fix)

| Problem | Test file | Check |
|---|---|---|
| 1 | `tests/unit/templateShiftMatch.test.ts` | A shift with no template id fills the slot that matches on time, position, day and area. |
| 1 | `tests/unit/schedulingContext.test.ts` | `buildCoverage` gives `assigned > 0` for a week from "apply week template". |
| 1 | `tests/unit/coverageParity.test.ts` | UI grid counts equal MCP counts on the same rows. |
| 2 | `tests/unit/scheduleOverview.test.ts`, `schedulingContext.test.ts`, `timePunchShifts.test.ts` | Rows have `start_time_local`, `end_time_local`, `tz`, in `America/Chicago`. |
| 3 | `tests/unit/scheduleOverview.test.ts`, `schedulingContext.test.ts` | `position_mismatch` is `true` with both values. |
| 4 | `tests/unit/schedulingContext.test.ts` | `weekly_hours` per Monday week, `partial_week`, `over_max_weekly_hours`. |
| 5 | `tests/unit/mcpHandler.test.ts` | The schema requires `restaurant_id`. A call without it fails, also with one restaurant. |

## Compatibility

All current fields stay. All changes add fields, except one: a call without
`restaurant_id` now fails. The user approved that change.

## Decided trade-offs

- A legacy shift with two equal candidates (same time, position and area) goes
  to the first template in input order. This copies the UI. The SQL helper
  orders by `st.id` in that case
  (`supabase/migrations/20260720120000_shift_fill_by_assignment.sql:127`).
  The task asks for the UI rule, so the MCP follows the UI.
- The write paths that do not stamp `shift_template_id` do not change here.
  The week templates session owns those writers.
