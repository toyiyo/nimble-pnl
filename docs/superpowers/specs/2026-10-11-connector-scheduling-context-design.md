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
`shift_templates`, and `staffing_settings`. This design needs no RLS change.
All data tools run with the user JWT, so RLS applies.

## 3. Part 1 — conflict flags in `get_schedule_overview`

### 3.1 New SQL RPC `get_shift_conflicts`

```sql
get_shift_conflicts(p_restaurant_id uuid, p_start timestamptz, p_end timestamptz)
RETURNS TABLE (shift_id uuid, conflict_type text, status text, message text)
LANGUAGE sql STABLE SECURITY INVOKER SET search_path = public
```

- The RPC selects the shifts of the restaurant in the window. It skips
  `status IN ('cancelled','completed')`, as `usePlannerShiftConflicts.ts:125`
  does.
- For each shift, it calls `check_timeoff_conflict` and
  `check_availability_conflict` through `LEFT JOIN LATERAL`. The rules stay in
  one place: the two existing RPCs.
- SECURITY INVOKER: RLS on `shifts` and on the source tables applies to the
  caller.
- The tool calls one RPC for the full window. It does not call one RPC for each
  shift. This prevents an N+1 pattern on the edge function.
- Grant EXECUTE to `authenticated` only. Revoke it from `anon` and `public`.

### 3.2 Result shape

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

### 3.3 Overlap and clopen warnings

The UI computes these rules on the client in `src/lib/shiftValidator.ts`. The
design adds a pure Deno helper `supabase/functions/_shared/shiftWarnings.ts`
with the same constants (`MIN_REST_HOURS = 8`). A unit test runs the same
fixtures through both copies (parity test). The helper skips cancelled shifts.

## 4. Part 2 — new tool `get_scheduling_context`

### 4.1 Contract

- Params: `start_date`, `end_date` (YYYY-MM-DD, restaurant local), maximum 31
  days. Default: the current restaurant week.
- Gate: add the tool to `CAPABILITY_GATED_TOOLS` (view:scheduling OR
  view:payroll), as `get_schedule_overview`.
- Read-only. Not on `MCP_EXCLUDED_TOOLS`.
- One parallel fetch (`Promise.all`) of all sources. Explicit columns, no `*`.

### 4.2 Sections

1. `roster`: active employees. Fields: id, name, position, area,
   employment_type, is_minor, max_weekly_hours (from `computeHourBudget`),
   scheduled_hours, shift_count, missing_availability (true when the employee
   has no recurring row and no exception in the period).
2. `availability`: for each employee and date, the effective local window.
   `source` is `exception`, `recurring`, or `not_set`. An exception overrides
   the recurring row. Overnight windows from the previous day count, as in
   `check_availability_conflict`. Use `availability-tz.ts` for the conversion.
   Include the `reason` or `notes` text.
3. `time_off`: requests that overlap the period. Fields: employee_id, dates,
   status, reason. `blocks_scheduling: true` for `approved` and `pending`
   (`CONFLICTABLE_TIME_OFF`, `usePlannerShiftConflicts.ts:29`). `denied` and
   `cancelled` are not returned.
4. `coverage`: active templates with capacity and days, the open spots for each
   template and date (`computeOpenShiftCount` rule), and the
   `staffing_settings` minimums (min_staff, min_crew).
5. `pending`: shift trades and open-shift claims with status
   `pending_approval`, and time-off requests with status `pending`.
6. `publish_state`: for each week in the period, `published`, `draft`, or
   `partial`, from `shifts.is_published` and `schedule_publications`.
7. `labor` (see 4.3).

### 4.3 Labor items and gates

| Item | Rule source | Gate |
|------|-------------|------|
| `daily_labor_percent` | `computeDailyLaborPercent` and `projectDailySales` (`dailyLaborPercent.ts:45,80`). Projected sales exclude today. `over_target` when `Math.round(percent) > target_labor_pct`. Cap 999. | view:pay_rates AND view:pos_sales |
| `labor_budget` | `calculateLaborBudget` (`useScheduleLaborBudget.ts:27`). Fixed entry: monthly/100/30×7. Percent entry: avgDailySales×pct×7, else dailyBreakEven×pct×7. Tiers: <80 ok, ≤100 warning, else over. | view:pay_rates (plus view:pos_sales for a percent entry) |
| `staffing_suggestions` | `recommendForSlots` (`hourlyStaffing.ts:75`) with `get_hourly_sales_pattern` over `lookback_weeks`. | view:pos_sales |

- The server has no `view:pos_sales` check now. Add
  `hasPosSalesCapability(restaurantId, supabase)` next to
  `hasPayRatesCapability` (`tools-registry.ts:1148`), with the same
  `callCapabilityRpc` call and the same fail-closed log.
- When a gate fails, the item is `{ "hidden": true, "reason": "..." }`, in the
  same form as `payHidden()`. The tool never returns a masked $0 as a real
  value.
- The Deno side cannot import `src/`. The design ports
  `computeDailyLaborPercent`, `projectDailySales`, and `calculateLaborBudget` to
  `supabase/functions/_shared/laborTargets.ts`. A parity test runs the same
  fixtures through the `src/` and the Deno copies, as the
  `hourlyStaffing.ts` port does.
- The break-even inputs come from a helper that is extracted from
  `executeGetBreakEvenProgress` (L3254–3300). Both callers use the helper, so
  the numbers stay equal.

### 4.4 Size limit

The tool text must stay below `MAX_TOOL_TEXT_CHARS` (40 000). For a 31-day
period with many employees, the `availability` section is the largest. Rules:

- Group availability by employee, then by run of equal days
  (`"2026-10-12..2026-10-16": "09:00-17:00"`).
- Omit `staffing_suggestions` hours with no sales.
- If the text is still too long, return `truncated: true` and the sections in
  a fixed order of priority: roster, time_off, availability, conflicts summary,
  coverage, pending, publish_state, labor. A unit test proves the limit for 40
  employees and 31 days.

## 5. Part 3 — connector text

- `INSTRUCTIONS` (`mcpHandler.ts:92`): add one sentence. "Call
  get_scheduling_context before you propose or change a schedule."
- `MCP_TOOL_TITLES`: add `get_scheduling_context: 'Get scheduling context'`.
- `get_schedule_overview` description: say that each shift has `conflicts`.
- Update `tests/unit/mcpHandler.test.ts` for the new tool and the new text.

## 6. Security

- Every query runs with the user JWT. RLS and the capability RPC apply.
- The new RPC is SECURITY INVOKER and filters by `p_restaurant_id`.
- Staff and kiosk roles cannot use the connector (`connectorRoles.ts`).
- Pay and sales values stay behind the same gates as the UI.
- Third-party text (notes, reasons) is data. The MCP instructions already tell
  Claude to treat tool text as data.

## 7. Tests

| Test | Type |
|------|------|
| `supabase/tests/get_shift_conflicts.sql`: time off approved and pending, denied ignored, exception overrides recurring, overnight window, cancelled shift skipped, other restaurant not visible | pgTAP |
| `tests/unit/shiftWarnings.test.ts`: overlap, clopen < 8 h, parity with `shiftValidator.ts` | Vitest |
| `tests/unit/laborTargets.test.ts`: parity with `dailyLaborPercent.ts` and `calculateLaborBudget` | Vitest |
| `tests/unit/schedulingContext.test.ts`: section builders, gates hidden, size limit | Vitest |
| `tests/unit/mcpHandler.test.ts`: tool title, instructions, gate list | Vitest |
| `tests/e2e/ai-chat.spec.ts`: no UI change. The connector has no browser surface. E2E exception: the pgTAP and unit tests cover the change. | Exception |

## 8. Out of scope

- `generate-schedule` does not read `time_off_requests`
  (`supabase/functions/generate-schedule/index.ts:134–200`). This is a separate
  gap. A follow-up task tracks it.
- Write tools for schedules. The connector stays read-only for scheduling.
- The consecutive-day and weekly-cap rules of
  `_shared/schedule-validator.ts`. The Scheduling page does not show them, so
  they are not in "what the UI shows".
