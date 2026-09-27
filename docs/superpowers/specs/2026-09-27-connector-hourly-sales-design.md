# Design: hourly sales in the MCP connector (`get_hourly_sales`)

Status: approved in brainstorm on 2026-09-27. STE-aligned.

## 1. Problem

Bug #7. The EasyShiftHQ connector (Claude, ChatGPT) returns only daily sales
totals. The model cannot answer "split sales before and after 4:30", so it
cannot schedule against sales by hour.

The Shift Timeline has hourly sales, but only in the browser. The connector
cannot call browser code. A second copy of the rules in the edge function
would drift from the timeline.

## 2. Current behaviour (with citations)

### 2.1 The timeline query

- `useWeekStaffingSuggestions` reads `sale_date, sale_time, sold_at,
  total_price` from `unified_sales` (src/hooks/useWeekStaffingSuggestions.ts:149-151).
- Filters: `restaurant_id`, `item_type = 'sale'`, `parent_sale_id IS NULL`
  (src/hooks/useWeekStaffingSuggestions.ts:152-156). No filter on
  `adjustment_type`.
- Window: `sale_date` from today − `lookback_weeks` × 7 days to today. Both
  bounds are restaurant-local business days (src/hooks/useWeekStaffingSuggestions.ts:116-128, :157-158).
- The time zone is `safeTz(selectedRestaurant?.restaurant?.timezone)`
  (src/hooks/useWeekStaffingSuggestions.ts:73). The column is
  `restaurants.timezone`, default `'America/Chicago'`
  (supabase/migrations/20251001022351_2147ffdb-edc4-4d22-8812-8120871aaf6f.sql:3).
- The query reads at most 20 pages of 1000 rows
  (src/hooks/useWeekStaffingSuggestions.ts:144-166). A restaurant with more
  than 20,000 sale lines in the window gets a cut-off result. The cut-off
  drops the most recent days first, because rows sort by `sale_date` (:159).
- The query key is `['hourly-sales-all', restaurantId, lookback_weeks, tz]`,
  `staleTime: 60000` (src/hooks/useWeekStaffingSuggestions.ts:134, :169-172).

### 2.2 The aggregation rules (`aggregateHourlySales`)

- The hook groups rows by the weekday of `sale_date`
  (src/hooks/useWeekStaffingSuggestions.ts:233-242; `dayStringToDow` at
  src/lib/staffingApply.ts:52-54). Then it calls `aggregateHourlySales` once
  for each weekday (src/hooks/useWeekStaffingSuggestions.ts:249-252).
- Hour of a row: the local hour of `sold_at` in the restaurant time zone. If
  `sold_at` is null, the hour of `sale_time`. If both are null, the row is
  skipped (src/hooks/useHourlySalesPattern.ts:80-88).
- It sums `total_price` for each (hour, `sale_date`)
  (src/hooks/useHourlySalesPattern.ts:90-92).
- The average for an hour is the sum of the day totals divided by the number
  of dates that have a row in that hour. It is not divided by the number of
  weeks (src/hooks/useHourlySalesPattern.ts:97-105). `sampleCount` is that
  number of dates. The value is rounded to 2 decimals.
- Fallback: when no row in the weekday gives an hour, it averages the day
  totals over the dates. It divides the average by 13 and writes it to hours
  9 to 21. `sampleCount` is the number of dates. `hasHourlyBreakdown` is
  false (src/hooks/useHourlySalesPattern.ts:17-18, :110-125).
- If some rows have an hour and other rows do not, the rows without an hour
  are skipped (src/hooks/useHourlySalesPattern.ts:85-86, :96).

### 2.3 Actual SPLH

- `computeActualSplh` sums `total_price` of all the rows, then divides by
  the worked hours from time punches (src/hooks/useWeekStaffingSuggestions.ts:52-65, :227-230).
  It needs only the total, not the rows.

### 2.4 Recommended staff

- `buildHourlyRecommendations`: `demand = avgSales > 0 && targetSplh > 0 ?
  Math.ceil(avgSales / targetSplh) : 0`, `recommendedStaff = Math.max(demand,
  minStaff)` (src/lib/staffingCalculator.ts:136-167).
- `computeMinStaffFromCrew` returns the sum of `min_crew` values if the sum
  is > 0, else `min_staff` (src/lib/staffingCalculator.ts:116-122).
- The settings are in `staffing_settings`, one row for each restaurant:
  `target_splh` default 60, `min_staff` default 1, `lookback_weeks` default 4
  (supabase/migrations/20260306000000_create_staffing_settings.sql:4-15).
  `min_crew` is JSONB (supabase/migrations/20260307140000_add_min_crew_to_staffing_settings.sql:5).
  The client merges the stored row over the same defaults
  (src/hooks/useStaffingSettings.ts:11-23, :65-68).
- Demand is hourly only. The timeline samples scheduled staff every 15
  minutes (`STEP_MIN = 15`, src/lib/timelineModel.ts:61), then rolls the
  samples up to hours to compare with demand (src/lib/coverageSummary.ts:4,
  :80-90). No code gives a recommendation for a slot shorter than one hour.

### 2.5 The connector

- Tool list: `getTools` in supabase/functions/_shared/tools-registry.ts:24-28.
  `get_schedule_overview` is at :280-309.
- `CAPABILITY_GATED_TOOLS = ['get_labor_costs', 'get_schedule_overview']`
  (supabase/functions/_shared/tools-registry.ts:1020). These tools need
  `view:scheduling` or `view:payroll`. `hasSchedulingOrPayrollCapability`
  calls `user_has_capability` and denies on an RPC error (:1062-1093).
- The dispatcher is supabase/functions/ai-execute-tool/index.ts. It checks
  membership (:3591-3600), then the capability gate with a 403 and
  `required_capability` (:3614-3630), then required arguments (:3641-3659).
  It resolves the restaurant time zone (:3663-3664) and sends the call to a
  handler in a `switch` (:3710, :3726-3728).
- `MAX_TOOL_TEXT_CHARS = 40_000`. `capText` cuts longer text and adds a
  marker (supabase/functions/_shared/mcpHandler.ts:40-41, :270-273).
  `MCP_TOOL_TITLES` is at :57-82.
- The model tool list for in-app chat comes from `getTools(…, {
  hasSchedulingOrPayroll })` (supabase/functions/ai-chat-stream/index.ts:534).
  The labor prompt text is at :537-542.
- `list_categories` shows the pattern for a new tool: commits 4dcf104f
  (registry, dispatcher, registry test), e9e9226f (`MCP_TOOL_TITLES`, test),
  4aae883d (docs/CLAUDE_INTEGRATION.md, chat prompt), ced3eac8 (size cap and
  in-band `INVALID_ARGUMENTS`).

## 3. Decisions (from the brainstorm)

1. One SQL RPC holds the rules. The connector and the Shift Timeline both
   call it. This change is in the same PR.
2. `view = 'weekday'` (default) gives the weekday average, the same as the
   timeline. `view = 'by_date'` gives actual dates.
3. `interval_minutes` is 15, 30, or 60. The default is 60.
4. For a 15-minute or 30-minute slot, recommended staff is the value of the
   hour that contains the slot. This is the number the timeline shows.
5. `by_date` accepts at most 31 days. The default is the last 7 days.
6. Gate the tool like `get_schedule_overview`: `view:scheduling` or
   `view:payroll`.

## 4. Design

### 4.1 SQL RPC `get_hourly_sales_pattern`

New migration `supabase/migrations/20260927120000_get_hourly_sales_pattern.sql`.

```sql
public.get_hourly_sales_pattern(
  p_restaurant_id    uuid,
  p_start_date       date,
  p_end_date         date,
  p_interval_minutes integer DEFAULT 60,
  p_view             text    DEFAULT 'weekday'
) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY INVOKER
SET search_path = public, pg_temp
```

Guards, in this order:

1. The caller must have a `user_restaurants` row for `p_restaurant_id` with
   `user_id = auth.uid()`. Else `RAISE EXCEPTION 'Access denied to restaurant'`.
   The function is SECURITY INVOKER, so RLS on `unified_sales` also applies.
2. `p_interval_minutes IN (15, 30, 60)`. Else `RAISE EXCEPTION` with
   `ERRCODE = '22023'`.
3. `p_view IN ('weekday', 'by_date')`. Else `22023`.
4. `p_start_date` and `p_end_date` are not null, and `p_end_date >=
   p_start_date`, and the span is at most 366 days. Else `22023`.

Time zone: read `restaurants.timezone`. If it is null or not in
`pg_timezone_names`, use `'America/Chicago'`. This matches `safeTz`.
Reassign the variable in the guard (lesson on the `pg_timezone_names`
guard). `pg_timezone_names` is in `pg_catalog`. Postgres always searches
`pg_catalog`, so the pinned `search_path` does not hide it. Write this in a
migration comment, so that a later change to `search_path` keeps the guard.

Rounding: use `round(v::numeric, 2)`. The RPC becomes the only source of
the hourly numbers, so no JS rounding must match it. A negative half value
(for example −0.005) rounds away from zero in Postgres. A pgTAP case pins
this.

Rows: `unified_sales` where `restaurant_id = p_restaurant_id`, `item_type =
'sale'`, `parent_sale_id IS NULL`, `sale_date BETWEEN p_start_date AND
p_end_date`. `sale_date` is a DATE column, so a DATE bound is correct here.
The index `idx_unified_sales_restaurant_keyset (restaurant_id, sale_date,
created_at, id)` serves this filter with its first two columns
(supabase/migrations/20260720120001_bulk_deduction_keyset_batching.sql:159-160).
The same migration deletes the older `idx_unified_sales_restaurant_date`
(:158). Do not cite the older index.

Minute of day for a row:

- `sold_at` not null: `EXTRACT(HOUR FROM sold_at AT TIME ZONE tz) * 60 +
  EXTRACT(MINUTE FROM sold_at AT TIME ZONE tz)`.
- Else `sale_time` not null: the same from `sale_time`.
- Else null (no slot).

Slot start: `floor(minute_of_day / p_interval_minutes) * p_interval_minutes`.
At 60 minutes this gives the same hour as §2.2.

`total_price` null counts as 0 (the same as `Number(null)` in JS).

**`weekday` view.** For each weekday of `sale_date` (0 = Sunday, the same
as `Date.getDay()`):

- If one or more rows in the weekday have a slot: sum `total_price` for each
  (slot, `sale_date`). Average each slot over the dates that have a row in
  that slot. Round to 2 decimals. `sample_count` is that number of dates.
  Rows without a slot are skipped. `has_hourly_breakdown = true`.
- Else (fallback): average the day totals over the dates. Divide by the
  number of slots from 09:00 to 22:00 (13, 26, or 52). Round to 2 decimals.
  Write that value to every slot in [09:00, 22:00). `sample_count` is the
  number of dates. `has_hourly_breakdown = false`.
- A weekday with no rows is not in the output.

**`by_date` view.** For each `sale_date` that has rows:

- Sum `total_price` for each slot. `sample_count` is 1.
- `day_total` is the sum of all the rows of the date, also the rows without
  a slot.
- If no row of the date has a slot, `slots` is empty and
  `has_hourly_breakdown = false`. The view does not invent a spread for an
  actual date.

Output:

```json
{
  "time_zone": "America/Chicago",
  "view": "weekday",
  "interval_minutes": 60,
  "start_date": "2026-08-30",
  "end_date": "2026-09-27",
  "total_sales": 123456.78,
  "days": [
    {
      "day_of_week": 1,
      "date": null,
      "sample_days": 4,
      "day_total": null,
      "has_hourly_breakdown": true,
      "slots": [{ "start_minute": 990, "sales": 412.5, "sample_count": 4 }]
    }
  ]
}
```

- `total_sales` is the sum of `total_price` of all the rows in the window.
  The timeline uses it for `computeActualSplh`.
- `sample_days` is the number of dates with rows for that weekday.
- `days` sorts by `day_of_week` (weekday) or `date` (by_date). `slots` sorts
  by `start_minute`.
- `GRANT EXECUTE … TO authenticated`. `REVOKE … FROM anon, public`.
  `service_role` and `postgres` do not need a grant. The edge function calls
  the RPC with the user JWT, not with the service role
  (supabase/functions/ai-execute-tool/index.ts:3578-3583).

### 4.2 Shift Timeline change

In `useWeekStaffingSuggestions`:

- Replace the paged `unified_sales` query with one call to
  `supabase.rpc('get_hourly_sales_pattern', { p_restaurant_id, p_start_date:
  startStr, p_end_date: endStr, p_interval_minutes: 60, p_view: 'weekday' })`.
- Keep the query key `['hourly-sales-all', restaurantId, lookback_weeks, tz]`,
  `staleTime: 60000`, `refetchOnWindowFocus: true`, `refetchOnMount: true`,
  and `enabled: !!restaurantId`.
- Map each `days[i]` to `HourlySalesData[]` (`hour = start_minute / 60`,
  `avgSales = sales`, `sampleCount = sample_count`) and its
  `has_hourly_breakdown`. Then call `computeStaffingSuggestions` as today.
  The formula `start_minute / 60` is correct only at 60 minutes. Write this
  in a code comment.
- A weekday in `weekDays` that is not in `days[]` maps to `{ data: [],
  hasHourlyBreakdown: false }`. This is the result of
  `aggregateHourlySales([])` today (src/hooks/useHourlySalesPattern.ts:74).
  Never send `undefined` to `computeStaffingSuggestions`.
- Change `computeActualSplh` to take `totalSales: number` in place of the
  sales rows.
- `hasSalesData` becomes `days.length > 0`.
- The return shape of the hook does not change. `ShiftTimelineTab` and
  `StaffingOverlay` do not change.

Clean-up after the switch:

- `aggregateHourlySales` and the `useHourlySalesPattern` hook have no
  production caller. No component calls `useHourlySalesPattern(`. Delete
  the file `src/hooks/useHourlySalesPattern.ts`. Move its test cases
  (sold_at, DST, fallback) to pgTAP.
- Keep `FALLBACK_OPEN_HOUR` / `FALLBACK_CLOSE_HOUR` in
  src/lib/splhAnalytics.ts:48-57. Change the comments at
  src/lib/splhAnalytics.ts:52 and :187 and src/lib/salesTrends.ts:600 to
  point at the RPC, because they name the deleted file.
- Test files to change or delete:
  - Delete tests/unit/useHourlySalesPattern.test.ts. Its cases move to
    pgTAP 77.
  - tests/unit/useWeekStaffingSuggestions.pagination.test.ts checks the
    20-page cap that this change deletes. Replace it with one test: the hook
    calls `supabase.rpc('get_hourly_sales_pattern', …)` one time, and it
    does not call `supabase.from('unified_sales')`.
  - tests/unit/useWeekStaffingSuggestions.tz.test.ts mocks `.from()`
    (:37-68). Change it to mock `.rpc()`. Assert that `p_start_date` and
    `p_end_date` are the restaurant business days for the given `tz`.
  - tests/unit/StaffingOverlay.tz.test.tsx spies on `aggregateHourlySales`
    (:12-24). The client does not bucket by hour after the change. Replace
    the spy with an assertion on the RPC date arguments for the restaurant
    `tz`.
  - tests/unit/useWeekStaffingSuggestions.actualSplh.test.ts calls
    `computeActualSplh(sales, punches)`. Change every call to
    `computeActualSplh(totalSales, punches)`.
  - Check the other tests that mock the hook or the `'hourly-sales-all'`
    key (for example tests/unit/shiftTimelineTab.test.tsx,
    tests/unit/StaffingOverlay.wiring.test.tsx). Change a test only when it
    mocks the sales query itself.
- Delete the entry for the deleted file in
  tests/unit/highVolumeQueryGuard.test.ts:48.

### 4.3 Connector tool `get_hourly_sales`

Registry entry (read-only tool):

| Parameter | Type | Default | Notes |
|---|---|---|---|
| `view` | enum `weekday`, `by_date` | `weekday` | |
| `interval_minutes` | enum 15, 30, 60 | 60 | |
| `lookback_weeks` | integer 1–12 | `staffing_settings.lookback_weeks`, else 4 | `weekday` only |
| `start_date` | date | today − 6 | `by_date` only |
| `end_date` | date | today (restaurant-local) | `by_date` only |
| `day_of_week` | integer 0–6 | all | optional filter |

- Add `get_hourly_sales` to `CAPABILITY_GATED_TOOLS`. Do not add it to
  `canUseTool`, the same as `get_schedule_overview`.
- Add `MCP_TOOL_TITLES.get_hourly_sales = 'Get hourly sales'`.

Handler `executeGetHourlySales` in ai-execute-tool:

1. Check the arguments. A bad enum, a bad date, `end_date < start_date`, or a
   `by_date` span above the limit returns in-band `INVALID_ARGUMENTS`, the
   same as `list_categories` (ced3eac8).
2. `weekday` window: `end = restaurant-local today`, `start = end −
   lookback_weeks × 7`. This is the timeline window.
3. Read `staffing_settings` (`target_splh`, `min_staff`, `min_crew`,
   `lookback_weeks`) and merge over the same defaults as
   src/hooks/useStaffingSettings.ts:11-23.
4. Call the RPC. For `sub-hour` intervals, also call it with 60 minutes to
   get the hourly sales for the recommendation (decision 4). The 60-minute
   call is the same query at a different slot size.
5. Recommended staff for an hour: new helper
   `supabase/functions/_shared/hourlyStaffing.ts` with
   `recommendStaffForHour(sales, targetSplh, minStaff)` and
   `minStaffFromCrew(minCrew, minStaff)`. A unit test runs the helper and
   `buildHourlyRecommendations` / `computeMinStaffFromCrew` from
   src/lib/staffingCalculator.ts on the same inputs and expects equal
   results. This test stops drift.
6. Output text in compact column form, to stay under the 40k cap:

```json
{
  "restaurant_time_zone": "America/Chicago",
  "view": "weekday",
  "interval_minutes": 30,
  "window": { "start_date": "2026-08-30", "end_date": "2026-09-27", "lookback_weeks": 4 },
  "settings": { "target_splh": 60, "min_staff": 2 },
  "columns": ["start", "sales", "samples", "recommended_staff"],
  "days": [
    { "day": "Mon", "sample_days": 4, "hourly": true,
      "rows": [["16:00", 300.25, 4, 5], ["16:30", 280.0, 4, 5]] }
  ],
  "notes": ["Sales are averages over the dates that had a sale in each slot."]
}
```

- `by_date` rows use `"date": "YYYY-MM-DD"` and `day_total` in place of
  `sample_days`.
- `start` is local `HH:MM`.
- `notes` states the averaging rule and marks a fallback day ("no hourly
  data; the day total is spread evenly from 09:00 to 22:00").

Size limit. The 31-day `by_date` limit holds for 60 minutes. For smaller
slots, the limit gets smaller so that the text always fits under 40,000
characters: 31 days at 60 minutes, 15 days at 30 minutes, 7 days at 15
minutes. A larger span returns `INVALID_ARGUMENTS` with the limit in the
message. Byte budget: a worst-case row `["23:45",99999.99,99,999],` has 32
characters. At 15 minutes, 7 days × 96 rows × 32 = 21,504 characters. At
30 minutes, 15 × 48 × 32 = 23,040. At 60 minutes, 31 × 24 × 32 = 23,808. The
day headers and notes add less than 4,000. Write this budget in a comment
at the limit constants. A unit test builds the worst case (every slot of every day filled,
largest values) and checks `length <= 40_000`.

### 4.4 Docs and prompts

- docs/CLAUDE_INTEGRATION.md: add `get_hourly_sales` to the row with
  `get_labor_costs`, `get_schedule_overview` (read, needs `view:scheduling`
  or `view:payroll`), with one note on the views.
- ai-chat-stream prompt (supabase/functions/ai-chat-stream/index.ts:537-542):
  one line. "Use `get_hourly_sales` for sales by time of day. Use
  `interval_minutes` 30 or 15 for a split such as before and after 4:30."
- `INSTRUCTIONS` in mcpHandler.ts: one sentence with the same hint.

## 5. Tests

- pgTAP `supabase/tests/77_get_hourly_sales_pattern.test.sql`:
  - The access guard: a user without a `user_restaurants` row gets `Access
    denied to restaurant`. Set `request.jwt.claims` for the allowed caller
    (lesson 2026-07-22).
  - Bad interval, bad view, reversed dates, span above 366 days → `22023`.
  - `sold_at` hour in the restaurant zone, not UTC. Use a zone with a large
    offset and a sale near midnight UTC, so the UTC hour gives a different
    weekday slot.
  - `sale_time` fallback when `sold_at` is null.
  - The average divides by the dates with sales in the slot, not by weeks.
  - `parent_sale_id` child rows are skipped.
  - `item_type <> 'sale'` rows are skipped.
  - The 30-minute slot splits 16:20 and 16:40 into 16:00 and 16:30.
  - The 9–22 fallback at 60 and 30 minutes.
  - `by_date` gives actual sums, `day_total` includes rows without a slot,
    and no fallback spread.
  - `total_sales` equals the sum of the window.
  - A DST case: a sale at local 01:30 on a fall-back date in
    `America/Chicago`.
  - `restaurants.timezone` has a value that is not in `pg_timezone_names`.
    The RPC uses `'America/Chicago'` and returns it in `time_zone`.
  - A slot average of a negative half value rounds with `round(numeric, 2)`.
- Vitest:
  - `hourlyStaffing` parity with `staffingCalculator`.
  - `executeGetHourlySales`: arguments, defaults, sub-hour recommendation
    from the containing hour, by_date limits, the 40k worst case.
  - tools-registry: `get_hourly_sales` is gated and read-only.
  - mcpHandler: title and `readOnlyHint`.
  - `useWeekStaffingSuggestions`: maps the RPC result, `actualSplh` from
    `total_sales`, pin `process.env.TZ` (lesson 2026-08-19).
- E2E: extend the test at tests/e2e/staffing-suggestions.spec.ts:69
  ("seeded sales produce shift blocks…"). The test seeds `unified_sales`
  rows. After the change, those rows go through the RPC. Add two
  assertions: the `rpc/get_hourly_sales_pattern` response has status 200,
  and the first suggested block starts at the first seeded sales hour. This
  checks the seam between the RPC and the timeline.

## 6. Out of scope

- src/lib/splhAnalytics.ts:187 has a third copy of the hour rule for the
  SPLH heatmap. It does not use `aggregateHourlySales`. It stays as is.
- The split-sale rule of `get_daily_sales_totals` (NOT EXISTS child,
  supabase/migrations/20260214100000_ai_operator.sql:695) differs from the
  timeline rule (`parent_sale_id IS NULL`). Both count a split sale one
  time. The new RPC keeps the timeline rule, because the goal is a match
  with the timeline.

## 7. Decided trade-offs

- Time zone source. The client computes the date window with
  `safeTz(selectedRestaurant.restaurant.timezone)`
  (src/hooks/useWeekStaffingSuggestions.ts:73). The RPC buckets slots with
  `restaurants.timezone` from the database. Both values come from the same
  column. They differ only when a user changes the zone and the client
  context is not yet refreshed. The window then moves by one day at most for
  one query. The next refetch fixes it. We accept this risk. The RPC returns
  `time_zone`, so a later change can compare the two values.

## 8. Risks

- The timeline switch changes a live screen. The E2E test and the hook tests
  cover the seam. The hook return shape does not change.
- Two RPC calls for a sub-hour view. Each call reads the same index range.
  The cost is small compared with the edge function limits.
