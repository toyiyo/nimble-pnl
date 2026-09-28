# Daily labor cost % in schedule day headers — design

Date: 2026-09-28
Branch: `claude/daily-labor-cost-percentage-4kyjka`

## Goal

Show the labor cost as a percent of projected sales for each day. Show it at
the top of each day column in the day-based schedule views. When a manager
adds a shift, the percent for that day changes at once.

## Formula

```
daily labor % = scheduled labor cost for the day / projected sales for the day × 100
```

- **Scheduled labor cost** comes from the real shifts on the schedule.
  `useScheduledLaborCosts` returns `dailyCosts[]` with one row per day
  (`src/hooks/useScheduledLaborCosts.tsx:29-50`). The shared calculator
  buckets each shift by restaurant business day
  (`supabase/functions/_shared/labor/laborCalculations.ts:407`). It also
  spreads salary and contractor cost across scheduled days.
- **Projected sales** come from the same source the planner uses for the
  hourly percent. `useWeekStaffingSuggestions` reads
  `staffing_settings.lookback_weeks` (`src/hooks/useWeekStaffingSuggestions.ts:104-128`)
  and returns `daySuggestions` per day
  (`src/hooks/useWeekStaffingSuggestions.ts:270-284`). Each day has
  `totalProjectedSales` (`src/hooks/useStaffingSuggestions.ts:56`). The
  Planner "Plan" view already shows this value as the day's projected sales
  (`src/components/scheduling/ShiftPlanner/StaffingDayColumn.tsx:50,64`).
- **Target** is `staffing_settings.target_labor_pct`
  (`src/types/scheduling.ts:278`, default 22 at
  `src/hooks/useStaffingSettings.ts:14`).

The hourly planner percent uses recommended staff × average wage
(`src/lib/staffingCalculator.ts:136-167`). The new daily percent uses the real
scheduled shifts. This is the purpose of the feature: "as we add people to the
schedule, I can see what my percentage of labor cost is".

## Views that get the percent

| View | Day header location | Data in scope |
|------|---------------------|---------------|
| Schedule tab grid | `src/pages/Scheduling.tsx:1293-1317` renders `ScheduleDayHeaderContent` (`src/pages/SchedulingDayHeaderContent.tsx:27`) | `shifts` (:335), `weekDayKeys` (:348), `useScheduledLaborCosts` result (:412) |
| Planner "Plan" view (shift templates grid) | `src/components/scheduling/ShiftPlanner/TemplateGrid.tsx:142-163` | `weekDays: string[]`, no shifts. Parent `ShiftPlannerTab` has `shifts`, `weekStart`, `weekEnd` (`ShiftPlannerTab.tsx:154-175`) |
| Planner "Timeline" view | day selector buttons, `src/components/scheduling/ShiftTimeline/ShiftTimelineTab.tsx:914-932` | parent `ShiftPlannerTab` mounts it at `ShiftPlannerTab.tsx:861` |

"Templates" is not a separate page. The shift templates show only as rows of
`TemplateGrid` in the Planner "Plan" view (`ShiftPlannerTab.tsx:960`).

The mobile week pills (`src/components/scheduling/WeekScheduleMobile.tsx:45-66`)
are out of scope. They are too narrow for a second line.

## Architecture

1. **Pure util** `src/lib/dailyLaborPercent.ts`:
   `computeDailyLaborPercent({ weekDays, dailyCosts, projectedSalesByDay, targetLaborPct })`
   returns `Map<string, DailyLaborPercent>`:
   ```ts
   interface DailyLaborPercent {
     laborCost: number;          // dollars
     projectedSales: number;     // dollars
     percent: number | null;     // null when projectedSales <= 0
     overTarget: boolean;        // percent > targetLaborPct
   }
   ```
2. **Hook** `src/hooks/useDailyLaborPercent.ts`:
   `useDailyLaborPercent(restaurantId, weekDays: string[], dailyCosts)`.
   It calls `useWeekStaffingSuggestions(restaurantId, weekDays, null)` and
   builds `projectedSalesByDay` from `daySuggestions`. It returns
   `{ byDay, isLoading, hasSalesData }`. The caller passes `dailyCosts`, so the
   Schedule page reuses its existing `useScheduledLaborCosts` call.
3. **Component** `src/components/scheduling/DailyLaborPercentBadge.tsx`.
   It shows `Labor 24%`. A tooltip shows the scheduled cost, the projected
   sales, the target, and the lookback weeks. States:
   - loading → a small `Skeleton`;
   - no projected sales → `Labor —` with tooltip "No sales history for this weekday";
   - percent over target → `text-destructive`;
   - else → `text-muted-foreground`.
   The trigger is a `<span tabIndex={0}>` with an `aria-label` that has the
   full sentence, so keyboard and screen reader users get the numbers.
4. **Wiring**
   - `Scheduling.tsx`: take `dailyCosts` from the existing
     `useScheduledLaborCosts` call. Call `useDailyLaborPercent`. Pass the day's
     value to `ScheduleDayHeaderContent` through a new optional prop
     `laborPercent`.
   - `ShiftPlannerTab.tsx`: call `useScheduledLaborCosts(shifts, weekStart, weekEnd, restaurantId)`
     and `useDailyLaborPercent`. Pass `laborPercentByDay` to `TemplateGrid` and
     to `ShiftTimelineTab` as new optional props.

## Query cost

`useWeekStaffingSuggestions` keys the sales query on
`['hourly-sales-all', restaurantId, lookback_weeks, tz]`
(`src/hooks/useWeekStaffingSuggestions.ts:134`). The Planner already runs this
query in `StaffingOverlay` (`StaffingOverlay.tsx:48`) and `ShiftTimelineTab`
(`ShiftTimelineTab.tsx:380`). React Query shares the cache entry, so the Planner
gets no new network request. The Schedule tab gets one new cached query set
(sales and punches) with `staleTime: 60000`.

## Decided trade-offs

- Salary and contractor cost are part of the daily cost, because
  `calculateScheduledLaborCost` spreads them per scheduled day. This matches
  the week labor total in `ScheduleMetricsRibbon`.
- The percent rounds to a whole number to fit narrow columns.
- No new DB object, RPC, or migration.

## Tests

- `tests/unit/dailyLaborPercent.test.ts`: formula, zero sales → `null`,
  missing cost row → 0, over-target flag, rounding is left to the UI.
- `tests/unit/useDailyLaborPercent.test.ts`: hook maps `daySuggestions` to
  projected sales (mock `useWeekStaffingSuggestions`).
- `tests/unit/dailyLaborPercentBadge.test.tsx`: the three states and the
  aria-label.
- Extend `tests/unit/scheduleDayHeaderContent.test.tsx` and
  `tests/unit/TemplateGrid.test.tsx` for the new optional props.
- E2E: extend a scheduling spec to check that a day header shows `Labor`
  text. The local Supabase stack is needed for this.
