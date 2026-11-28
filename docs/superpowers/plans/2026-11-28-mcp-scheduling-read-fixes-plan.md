# Plan: MCP scheduling read tools data fixes

Design: `docs/superpowers/specs/2026-11-28-mcp-scheduling-read-fixes-design.md`.
Branch: `claude/great-pasteur-39dxrh`.
Text is STE-aligned (`docs/STE100_STYLE.md`).

Use TDD for each task. Write the failing test first, run it, and see it fail.
Then write the code, run the test, and see it pass. Commit each task with
explicit paths.

Keep all current response fields. Add new fields only.

Do not touch new tool files from other sessions. Change only the files in this
plan.

## Task 1: pure matcher and local time helper

Files:
- create `supabase/functions/_shared/templateShiftMatch.ts`
- create `tests/unit/templateShiftMatch.test.ts`

Steps:
1. Test `slotKeyForShift`:
   - a linked shift (`shift_template_id` set) gives `templateId|localDate`;
   - a linked shift to a template not in the list gives `null`, also when the
     time matches another template;
   - a cancelled shift gives `null`;
   - a legacy shift (no template id) matches on local `HH:MM:SS` start and
     end, position, day of week, and area, in `America/Chicago`;
   - the legacy branch ignores inactive templates;
   - a same-area template wins over a null-area template;
   - a different area does not match; a null area on either side matches;
   - a 17:00 local Chicago shift (23:00Z) keys to the local date;
   - a DST week (2026-03-08, 2026-11-01) keeps the local time match.
2. Test `localIso(iso, tz)` gives `2026-12-05T17:00:00-06:00` for
   `2026-12-05T23:00:00Z` in `America/Chicago`, and `-05:00` in July.
3. Test `positionMismatch(shiftPos, employeePos)`: case and outer spaces do not
   count; null or empty on either side gives `false`.
4. Write the module. Use `date-fns-tz` (`toZonedTime`, `formatInTimeZone`).
   No Deno imports.

## Task 2: coverage uses the matcher (problem 1)

Files:
- `supabase/functions/_shared/schedulingContext.ts` (`buildCoverage`, `TemplateRow`)
- `supabase/functions/_shared/schedulingContextTool.ts` (template query)
- `tests/unit/schedulingContext.test.ts`
- create `tests/unit/coverageParity.test.ts`

Steps:
1. Test: a week of legacy shifts (no template id, made by "apply week
   template") gives `assigned` equal to the distinct staff count and the right
   `open` and `total_open_spots`.
2. Test: one employee with two shifts in one slot counts once.
3. Test: the sum of `assigned` over all slots is not more than the number of
   live shifts (no shift fills two slots), and `open = capacity - assigned`.
4. Parity test: build shifts and templates; run `buildTemplateGridData` from
   `src/hooks/useShiftPlanner.ts` with the tz, and count distinct employees per
   bucket; run `buildCoverage`; expect equal counts for every slot. Include
   linked, legacy, area, cancelled, and wrong-day shifts.
5. Change `buildCoverage` to take an optional `employeeAreas: Map<string,
   string | null>` and to use `slotKeyForShift`.
6. Change the template query to select `area` and to order by `start_time`,
   then `id`. Pass the employee areas from the employee rows.

## Task 3: local time and position flags on shift rows (problems 2 and 3)

Files:
- `supabase/functions/_shared/scheduleOverview.ts` (`groupShiftsByRestaurantDay`)
- `supabase/functions/_shared/schedulingContext.ts` (`buildConflictList`)
- `supabase/functions/_shared/schedulingContextTool.ts` (pass positions)
- `supabase/functions/_shared/timePunchShifts.ts`
- `tests/unit/scheduleOverview.test.ts`, `tests/unit/schedulingContext.test.ts`,
  `tests/unit/timePunchShifts.test.ts`

Steps:
1. Tests: overview rows have `start_time_local`, `end_time_local`, `tz`,
   `shift_position`, `employee_position`, `position_mismatch`. The `position`
   field does not change.
2. Tests: conflict entries have the same new fields. The employee position
   comes from a map that the caller passes.
3. Tests: time punch rows have `start_time_local`, `end_time_local`, `tz`.
4. Write the code. Keep all current fields.

## Task 4: hours per week (problem 4)

Files:
- `supabase/functions/_shared/schedulingContext.ts` (`buildRoster`, `RosterEntry`)
- `supabase/functions/_shared/schedulingContextTool.ts` (pass `tz`)
- `tests/unit/schedulingContext.test.ts`

Steps:
1. Tests: a period of 2026-12-01 to 2026-12-14 gives weeks `2026-11-30`,
   `2026-12-07`, `2026-12-14`; the first and the last have `partial_week:
   true`; the hours go to the week of the local start date (a Sunday 23:30
   Chicago shift goes to that Sunday's week); cancelled shifts and breaks
   follow the `scheduled_hours` rule; `over_max_weekly_hours` is `true` above
   `max_weekly_hours`.
2. Add an optional `tz` argument to `buildRoster` (default `UTC`), so the
   current callers do not break.
3. Write the code. `scheduled_hours` does not change.

## Task 5: required restaurant_id (problem 5, option 1)

Files:
- `supabase/functions/_shared/mcpHandler.ts`
- `tests/unit/mcpHandler.test.ts`

Steps:
1. Test: every data tool schema has `restaurant_id` in `required`;
   `list_restaurants` has no required fields.
2. Test: a call without `restaurant_id` fails for a user with one restaurant.
   Change the current test "uses the only restaurant when restaurant_id is
   missing" to expect the error. The error tells Claude to call
   `list_restaurants`.
3. Test: a tool with its own `required` list keeps it, with `restaurant_id`
   first.
4. Write the code. Change the property description and the server instructions
   text where they say that `restaurant_id` can be omitted.

## Task 6: docs

Files:
- `docs/CLAUDE_INTEGRATION.md`

Steps:
1. Describe the new fields and the required `restaurant_id`.

## Verify

Run `npm run test`, `npm run typecheck`, `npm run lint`, `npm run build`.
Run `deno check` on `supabase/functions/ai-execute-tool/index.ts` and
`supabase/functions/mcp/index.ts` when Deno is on the path.
