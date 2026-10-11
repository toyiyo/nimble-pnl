# Connector scheduling context — design

Date: 2026-10-11
Branch: `feature/connector-scheduling-context`
Status: approved by the user ("Approve, add labor items"). Writing is STE-aligned.

## 1. Problem

The MCP connector gives Claude the shifts of a week, but not the data that the
Scheduling page shows next to the shifts. A user report:

> The connector returned shifts but not the availability and time-off flags
> you're seeing, so the conflicts above are the ones I could work out from the
> schedule itself.

Root cause: `executeGetScheduleOverview`
(`supabase/functions/ai-execute-tool/index.ts:2264`) reads only the `shifts`
table, with `employee:employees(id, name, position)`. It does not read
availability, exceptions, time off, templates, staffing settings, trades,
claims, or the publish state. Claude cannot see the flags that the UI shows.

Scope (user answer): "whatever we surface in the UI currently".
Shape (user answer): add conflict flags to `get_schedule_overview`, and add one
new tool, `get_scheduling_context`.
Labor (user answer): add the daily labor %, the labor budget, and the hourly
staffing suggestions, with the same capability gates as the UI.

## 2. Existing code that this design uses

| Item | Location |
|------|----------|
| Connector tool list and MCP text | `supabase/functions/_shared/mcpHandler.ts` (`INSTRUCTIONS` at L92, `MAX_TOOL_TEXT_CHARS = 40_000` at L40) |
| Tool definitions | `supabase/functions/_shared/tools-registry.ts` (`get_schedule_overview` at L280–310) |
| Capability-gated tools | `tools-registry.ts:1065` (`CAPABILITY_GATED_TOOLS`) |
| Pay gate | `hasPayRatesCapability`, `tools-registry.ts:1148` |
| Roles excluded from the connector | `supabase/functions/_shared/connectorRoles.ts` (staff, kiosk) |
| Time-off conflict RPC | `check_timeoff_conflict(p_employee_id, p_start_time, p_end_time)`, test `supabase/tests/timeoff_conflict_local_tz.sql` |
| Availability conflict RPC | `check_availability_conflict(p_employee_id, p_restaurant_id, p_start_time, p_end_time)`, tests `supabase/tests/availability_conflict_*.sql` |
| Client copy of conflict rules | `src/hooks/usePlannerShiftConflicts.ts` (`CONFLICTABLE_TIME_OFF` at L29, skip of cancelled and completed at L125) |
| Overlap and clopen rule | `src/lib/shiftValidator.ts` (`MIN_REST_HOURS = 8` at L32) |
| Time-off chip (approved only) | `src/lib/scheduleTimeOff.ts:70–78` |
| Open spots | `computeOpenShiftCount`, `src/pages/Scheduling.tsx:177` |
| Labor % gate | `canViewLaborPercent`, `src/pages/Scheduling.tsx:462` (view:pay_rates AND view:pos_sales) |
| Daily labor % | `src/lib/dailyLaborPercent.ts` (`computeDailyLaborPercent` L45, `projectDailySales` L80, cap 999 at L43) |
| Projected sales source | `lookbackSalesQueryOptions`, `src/hooks/useWeekStaffingSuggestions.ts:155` (`get_hourly_sales_pattern`, `p_view: 'by_date'`) |
| Labor budget | `calculateLaborBudget`, `src/hooks/useScheduleLaborBudget.ts:27–90` |
| Break-even inputs | `executeGetBreakEvenProgress`, `ai-execute-tool/index.ts:3210` (avgDailySales and dailyBreakEven at L3276–3300) |
| Hourly staffing (Deno) | `supabase/functions/_shared/hourlyStaffing.ts` (`minStaffFromCrew` L48, `recommendStaffForHour` L62, `recommendForSlots` L75) |
| Hourly sales wrapper | `fetchHourlySalesPattern`, `ai-execute-tool/index.ts:3062` |
| Availability time zone | `supabase/functions/_shared/availability-tz.ts` |
| Restaurant-day groups | `supabase/functions/_shared/scheduleOverview.ts` |
| Minor hour budget | `computeHourBudget`, `supabase/functions/_shared/schedule-prompt-builder.ts:184` |

RLS check on production: every restaurant member can SELECT
`employee_availability`, `availability_exceptions`, `time_off_requests`,
`shift_templates`, `staffing_settings`, and `schedule_publications`. This
design needs no RLS change. All data tools run with the user JWT, so RLS
applies.

Two exceptions:

- `shift_trades`: a user with edit:scheduling sees all trades. Other members
  see only the trades that target them or that have no target.
- `open_shift_claims`: a user with edit:scheduling sees all claims. Other
  members see only their own claims.

For these two tables, a user without edit:scheduling gets a partial list. The
tool must not show a partial list as a full list (see 4.2, item 6).

## 3. Part 1 — conflict flags in `get_schedule_overview`

### 3.1 New SQL RPC `get_shift_conflicts`

Return types on production (checked 2026-10-11):

- `check_timeoff_conflict` → `TABLE(has_conflict boolean, time_off_id uuid,
  start_date date, end_date date, status text)`. It can return one row for each
  overlapping request. It returns no message.
- `check_availability_conflict` → `TABLE(has_conflict boolean, conflict_type
  text, message text, available_start time, available_end time)`.
  `conflict_type` is `exception` or `recurring`.
- Both are plpgsql, STABLE, SECURITY INVOKER, `search_path = public,
  pg_catalog`.

```sql
CREATE OR REPLACE FUNCTION public.get_shift_conflicts(
  p_restaurant_id uuid, p_start timestamptz, p_end timestamptz)
RETURNS TABLE (shift_id uuid, conflict_type text, source text,
               status text, message text)
LANGUAGE sql STABLE SECURITY INVOKER SET search_path = public, pg_catalog
AS $$
  WITH s AS (
    SELECT id, employee_id, restaurant_id, start_time, end_time
    FROM shifts
    WHERE restaurant_id = p_restaurant_id
      AND start_time >= p_start AND start_time < p_end
      AND employee_id IS NOT NULL                       -- open shifts have no person
      AND status NOT IN ('cancelled', 'completed')      -- usePlannerShiftConflicts.ts:125
      AND p_end - p_start <= interval '32 days'         -- hard window limit
  )
  SELECT s.id, 'time_off', NULL, t.status,
         format('Time off %s (%s to %s)', t.status, t.start_date, t.end_date)
  FROM s CROSS JOIN LATERAL
       check_timeoff_conflict(s.employee_id, s.start_time, s.end_time) t
  WHERE t.has_conflict
  UNION ALL
  SELECT s.id, 'availability', a.conflict_type, NULL, a.message
  FROM s CROSS JOIN LATERAL
       check_availability_conflict(s.employee_id, s.restaurant_id,
                                   s.start_time, s.end_time) a
  WHERE a.has_conflict;
$$;

REVOKE ALL ON FUNCTION public.get_shift_conflicts(uuid, timestamptz, timestamptz)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_shift_conflicts(uuid, timestamptz, timestamptz)
  TO authenticated;
```

- The rules stay in one place: the two existing functions.
- The RPC passes `s.restaurant_id` from the shift row. It does not pass a
  value from the caller.
- Type mapping: the result `type` is `time_off` or `availability`. The
  availability `source` is `exception` or `recurring`.
- Several time-off requests give several `time_off` rows for one shift. The
  tool keeps all of them.
- SECURITY INVOKER: RLS on `shifts` and on the source tables applies to the
  caller. The `shifts` SELECT policy needs view:scheduling or view:payroll.
- The tool calls one RPC for the full window. This prevents an N+1 pattern
  between the edge function and the database.

Cost inside the database: the LATERAL calls run once for each shift. Postgres
cannot inline a plpgsql function. Measurement on production, with
`EXPLAIN ANALYZE`, on the restaurant with the most shifts in the last 31 days:
171 live shifts, 48.9 ms in total, about 0.18 ms for each shift. The maximum
for one restaurant in 31 days is 2,553 shifts. At the same rate, that is about
0.5 s. This cost is acceptable. Fallback: if a later measurement is above 2 s,
write one set-based query that joins `shifts` to the source tables once.
No new index is necessary. The plan uses a `BitmapAnd` of
`idx_shifts_restaurant_position_status` and `idx_shifts_start_time`.

### 3.2 Result shape

Review note: the frontend reviewer asked for one set-based query in place of
the LATERAL calls. The measurement in 3.1 shows about 0.5 s at the largest
restaurant. The design keeps the LATERAL form, so the rules stay in one place.
The fallback in 3.1 applies if the cost grows.


Each shift in `shifts_by_date` gets:

```json
"conflicts": [
  { "type": "time_off", "status": "approved", "message": "..." },
  { "type": "availability", "message": "..." },
  { "type": "overlap", "message": "Overlaps the 14:00-22:00 shift" },
  { "type": "clopen", "message": "Only 6.5 h of rest after the previous shift" }
]
```

The top level gets `conflicted_shift_count`. A shift with no conflict has no
`conflicts` key. This keeps the text short.

### 3.3 Overlap and clopen warnings (editor rules)

The planner grid does not show these two rules. `validateShift`
(`src/lib/shiftValidator.ts:49-92`) runs only in the shift editor
(`TimelineShiftEditor.tsx:144`). The editor shows a warning when a manager
saves a shift with an overlap or with less than 8 h of rest. A schedule that
Claude proposes goes through the same editor rules, so Claude needs them.

- Each item has `"rule": "editor"`. The time-off and availability items have
  `"rule": "grid"`. The connector text says that the grid does not show
  editor rules.
- Move the pure pair check of `validateShift` to
  `supabase/functions/_shared/shiftWarnings.ts`. `src/lib/shiftValidator.ts`
  imports it from there. One copy, no port.
- The check skips cancelled shifts and uses `MIN_REST_HOURS = 8`
  (`shiftValidator.ts:32`). Fixtures: a shift that ends at midnight, a
  cancelled shift, 7.9 h and 8.0 h of rest.

## 4. Part 2 — new tool `get_scheduling_context`

### 4.1 Contract

- Params: `start_date`, `end_date` (YYYY-MM-DD, restaurant local), maximum 31
  days. Default: the current restaurant week.
- Gate: add the tool to `CAPABILITY_GATED_TOOLS` (view:scheduling OR
  view:payroll), as `get_schedule_overview`.
- Read-only. Not on `MCP_EXCLUDED_TOOLS`.
- One parallel fetch (`Promise.all`) of all sources. Explicit columns, no `*`.
- Every query filters by `restaurant_id` and by the period in SQL, not in
  JavaScript. Row caps: employees 500, time off 1,000, exceptions 2,000.
- The period dates are restaurant-local. The tool converts them to UTC bounds
  with the restaurant time zone, as `scheduleOverview.ts` does.

### 4.2 Sections

1. `roster`: active employees. Fields: id, name, position, area,
   employment_type, is_minor, scheduled_hours, shift_count,
   missing_availability, and max_weekly_hours.
   - `missing_availability` uses the predicate of
     `src/hooks/useEmployeesMissingAvailability.ts`: active, with no recurring
     row. An employee with only exceptions is still missing.
   - `max_weekly_hours` comes from `computeHourBudget`. The page applies no
     weekly-cap rule. The connector text says that the value is stored but
     not enforced.
   - `scheduled_hours` excludes cancelled shifts, as `costedShifts` in
     `Scheduling.tsx` does.
2. `availability`: for each employee, the weekly recurring pattern one time
   (7 weekdays, local windows, `notes`). Then the exceptions with a date in the
   period (date, window or unavailable, `reason`). An exception overrides the
   recurring row for its date. Overnight windows from the previous day count,
   as in `check_availability_conflict`. Use `availability-tz.ts` for the
   conversion. An employee with no recurring row and no exception has
   `"not_set"`.
3. `conflicts`: a summary of Part 1 for the period. Shape:
   `[{ shift_id, employee_id, date, type, source, status, message }]`. It uses
   the same RPC and the same Deno helper as `get_schedule_overview`.
4. `time_off`: requests that overlap the period. Fields: employee_id, dates,
   status, reason. `blocks_scheduling: true` for `approved` and `pending`
   (`CONFLICTABLE_TIME_OFF`, `usePlannerShiftConflicts.ts:29`). `denied` and
   `cancelled` are not returned.
5. `coverage`: active templates with capacity and days, the open spots for each
   template and date (`computeOpenShiftCount` rule, `Scheduling.tsx:177`), and
   the `staffing_settings` minimums (min_staff, min_crew). The open-spot count
   is always present. `can_broadcast_open_shifts` is true only when the week is
   published and `open_shifts_enabled` is true (`Scheduling.tsx:1177`).
6. `pending`: shift trades and open-shift claims with status
   `pending_approval`, and time-off requests with status `pending`. The page
   counts all pending time-off requests, not only the visible week
   (`Scheduling.tsx:373`). The tool does the same and labels the scope. The tool
   checks edit:scheduling. If the check fails, `trades` and `claims` are
   `{ "hidden": true, "reason": "needs edit:scheduling" }`. The time-off
   list does not need this check.
7. `publish_state`: for each week in the period, `published` or `draft`. Use
   the binary rule of `useWeekPublicationStatus`
   (`src/hooks/useSchedulePublish.tsx:526`): a week is published when it has
   published shifts AND a `schedule_publications` row.
8. `labor` (see 4.3).

### 4.3 Labor items and gates

Rule: one copy of each labor rule. Move the pure page code to
`supabase/functions/_shared/labor/`. The `src/` files import from there, as
`src/hooks/useScheduledLaborCosts.tsx` already imports
`_shared/labor/scheduledLaborCost.ts`. Deno already maps `date-fns`
(`supabase/functions/deno.json`). The moved code uses relative imports only.

| New `_shared/labor/` file | Moved from | `src/` file after the move |
|---------------------------|------------|----------------------------|
| `breakEven.ts` (`calculateBreakEven`, `calculateMonthlyProgress`, `parseLocalDate`, needed types) | `src/lib/breakEvenCalculator.ts`, `monthlyBreakEvenProgress.ts`, `parseLocalDate.ts` | re-export, same names |
| `laborBudget.ts` (`calculateLaborBudget`) | `src/hooks/useScheduleLaborBudget.ts:27-90` | hook imports it |
| `dailyLaborPercent.ts` (`computeDailyLaborPercent`, `projectDailySales`, cap 999, `dayStringToDow`) | `src/lib/dailyLaborPercent.ts`, `staffingApply.ts:52` | re-export |
| `staffingGuardrail.ts` (`computeAvgHourlyRateCents`, `hasHourlyWageData`, `checkLaborGuardrail`, default 1500 cents) | `src/lib/staffingCalculator.ts:4-39,124-134` | re-export |

Items:

| Item | Rule | Gate |
|------|------|------|
| `scheduled_labor` | `loadScheduledLaborCost` (`_shared/labor/scheduledLaborCost.ts:143`). Excludes cancelled shifts. Returns `total`, `hidden_cost_count` ("N hidden" on the ribbon, `ScheduleMetricsRibbon.tsx:55`), and `is_average_high` (`:186`). | view:pay_rates |
| `daily_labor_percent` | `computeDailyLaborPercent` and `projectDailySales`. Projection excludes today and weekdays with total ≤ 0. `null` when projected sales are 0. `over_target` when `Math.round(percent) > target_labor_pct`. Cap 999. | view:pay_rates AND view:pos_sales |
| `labor_budget` | `calculateLaborBudget`. Fixed entry: monthly/100/30×7. Percent entry: avgDailySales×pct×7, else dailyBreakEven×pct×7. Tiers: <80 ok, ≤100 warning, else over. | view:pay_rates; a percent entry also needs view:pos_sales |
| `staffing_suggestions` | `recommendForSlots` (`hourlyStaffing.ts:75`) with `get_hourly_sales_pattern` over `lookback_weeks`. Headcount only. | view:pos_sales |
| `staffing_suggestions.labor` | `avg_hourly_rate`, `labor_pct`, `estimated_cost`, `over_target` (strict `>`, `checkLaborGuardrail`), `has_wage_data`. When `has_wage_data` is false, the rate is the 1500-cent fallback, and the tool says so. | view:pay_rates AND view:pos_sales |

Break-even inputs: the Deno loader does the same two loads as
`useBreakEvenAnalysis`. It does not reuse `executeGetBreakEvenProgress`,
because that helper averages only days with sales, has no contribution-margin
step, and has no utility costs.

- Daily sales: `get_daily_sales_totals` from
  `min(today − 13 days, start of month)` to today (`useBreakEvenAnalysis.ts:118`).
  `calculateBreakEven` fills missing dates with 0.
- Utility costs: the same `bank_transactions` query as
  `useBreakEvenAnalysis.ts:71-94`. RLS applies to it, as on the page.

Gates:

- The server has no `view:pos_sales` check now. Add and export
  `hasPosSalesCapability(restaurantId, supabase)` next to
  `hasPayRatesCapability` (`tools-registry.ts:1148`). Use the exact string
  `view:pos_sales`, the same `callCapabilityRpc` call, and the same
  fail-closed log.
- The tool resolves the gates first. It starts a sales or pay query only when
  the gate passes.
- When a gate fails, the item is `{ "hidden": true, "reason": "..." }`, in the
  same form as `payHidden()`. The tool never returns a masked $0 as a real
  value.
- When `staffing_settings` has no row, or a load fails, the item is
  `{ "unavailable": true, "reason": "..." }`. The tool does not omit the
  field.

### 4.4 Size limit

The tool text must stay below `MAX_TOOL_TEXT_CHARS` (40 000). For a 31-day
period with many employees, the `availability` section is the largest. Rules:

- The availability section uses the weekly pattern plus dated exceptions
  (4.2, item 2). It does not list each date. For 40 employees this is about
  280 pattern cells, not 1,240 date cells.
- Omit `staffing_suggestions` hours with no sales.
- The tool computes the final JSON length itself. It does not rely on
  `capText` (`mcpHandler.ts:272-274`), because a cut there makes invalid JSON.
- If the text is too long, the tool deletes whole sections in this order until
  the text fits: `labor.staffing_suggestions`, `publish_state`, `coverage`,
  `pending`. It then sets `truncated: true` and `omitted_sections: [...]`.
- The tool never deletes `roster`, `availability`, `time_off`, or `conflicts`.
  These sections answer the user report in section 1.
- A unit test proves the limit for 40 employees and 31 days. The fixture uses
  a different window on each weekday and one exception per employee per week.
- The new `conflicts` keys in `get_schedule_overview` count against the same
  cap. A unit test checks a 31-day overview with conflicts on 20% of shifts.

## 5. Part 3 — connector text

- `INSTRUCTIONS` (`mcpHandler.ts:92`): add one sentence. "Call
  get_scheduling_context before you propose or change a schedule."
- `MCP_TOOL_TITLES`: add `get_scheduling_context: 'Get scheduling context'`.
- `get_schedule_overview` description: say that each shift has `conflicts`.
- Update `tests/unit/mcpHandler.test.ts` for the new tool and the new text.

## 6. Security

- Every query runs with the user JWT. RLS applies.
- RLS does not protect sales data. `unified_sales` and
  `restaurant_operating_costs` allow SELECT for every member.
  `get_hourly_sales_pattern` checks membership only. `get_daily_sales_totals`
  has no check. So `hasPosSalesCapability` is the only boundary for sales.
  The tool checks the gate before it starts a sales query. A unit test proves
  that no sales query runs when the gate fails.
- The new RPC is SECURITY INVOKER and filters by `p_restaurant_id`.
- Staff and kiosk roles cannot use the connector (`connectorRoles.ts`).
- Pay and sales values stay behind the same gates as the UI.
- Third-party text (notes, reasons) is data. The MCP instructions already tell
  Claude to treat tool text as data.

## 7. Tests

| Test | Type |
|------|------|
| `supabase/tests/get_shift_conflicts.sql`: time off approved and pending, denied ignored, two overlapping requests give two rows, exception overrides recurring (`source` mapping), overnight window, cancelled and completed shifts skipped, open shift (null employee) skipped, window above 32 days returns no rows, member of restaurant A who calls with restaurant B id gets no rows, role without view:scheduling and view:payroll gets no rows, `has_function_privilege('anon', ...)` is false | pgTAP |
| `tests/unit/shiftConflictFixtures.test.ts`: the same fixture list as the pgTAP test, run through `usePlannerShiftConflicts` rules, so SQL and client rules stay equal | Vitest |
| `tests/unit/shiftWarnings.test.ts`: overlap, clopen at 7.9 h and 8.0 h, cancelled shift skipped, midnight end | Vitest |
| Existing tests of `breakEvenCalculator`, `dailyLaborPercent`, `staffingCalculator`, `useScheduleLaborBudget`, `shiftValidator`: they must pass with no change after the move | Vitest |
| `tests/unit/laborEdgeCases.test.ts`: sales 0, today excluded, rate 0, no wage data, cancelled shifts, 999 cap, zero-fill of missing sales dates | Vitest |
| `tests/unit/schedulingContext.test.ts`: section builders, gates hidden, size limit with weekday-varying data, section drop order, trades and claims hidden without edit:scheduling | Vitest |
| `tests/unit/schedulingContextGates.test.ts`: for `daily_labor_percent`, percent-entry `labor_budget`, and `staffing_suggestions`, the sales RPC mock is not called when the gate fails; `hasPosSalesCapability` fails closed on an RPC error | Vitest |
| `tests/unit/mcpHandler.test.ts`: tool title, instructions, gate list | Vitest |
| `tests/e2e/ai-chat.spec.ts`: no UI change. The connector has no browser surface. E2E exception: the pgTAP and unit tests cover the change. | Exception |

## 8. Out of scope

- `generate-schedule` does not read `time_off_requests`
  (`supabase/functions/generate-schedule/index.ts:134–200`). This is a separate
  gap. A follow-up task tracks it.
- Write tools for schedules. The connector stays read-only for scheduling.
- The consecutive-day and weekly-cap rules of
  `_shared/schedule-validator.ts`. The Scheduling page applies neither rule.
  The roster returns `max_weekly_hours` as stored data only.
