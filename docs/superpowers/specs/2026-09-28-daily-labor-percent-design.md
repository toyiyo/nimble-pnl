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
  buckets each hourly shift by restaurant business day
  (`supabase/functions/_shared/labor/laborCalculations.ts:407`).
  `distributeFixedCosts` spreads salary and contractor cost evenly across
  all days of the range (`laborCalculations.ts:283-297`), so a day with no
  shifts still carries its share of salary cost.
- **Cancelled shifts** do not count. The page filters them out before the
  cost calculation. The week labor total and the per-employee costs in
  `ScheduleMetricsRibbon` use the same filtered list, so the page agrees
  with itself.
- **Projected sales** use the same data and the same lookback setting as the
  planner. The query is `lookbackSalesQueryOptions` (extracted from
  `useWeekStaffingSuggestions`, same key `['hourly-sales-all', restaurantId,
  lookback_weeks, tz]`), and it reads `staffing_settings.lookback_weeks`.
  `projectDailySales` computes, for each weekday, the average of the daily
  sales totals of the same weekday in the lookback. Dates with no sales and
  today (partial sales) do not count.
- **Target** is `staffing_settings.target_labor_pct`
  (`src/types/scheduling.ts:278`, default 22 at
  `src/hooks/useStaffingSettings.ts:14`).
- The header shows a whole number. The "over target" flag compares the whole
  number with the target, so "22%" is never red at a 22% target. Values
  above 999 show as `>999%`.

### Why not the planner's day total

The Plan view header shows `totalProjectedSales`, the sum of hourly averages
(`src/hooks/useStaffingSuggestions.ts:56`). `aggregateHourlySales` divides
each hour by the number of dates with a sale in that hour
(`src/hooks/useHourlySalesPattern.ts:98-100`). A sparse late hour therefore
adds its full value, not its share, and the day total is too high. A too-high
denominator gives a too-low labor %, so the daily percent uses the average of
daily totals instead. The hourly chart keeps its own model.

## Who sees it

The badge shows only when the viewer has `view:pay_rates` and
`view:pos_sales`. Without `view:pay_rates`, `employees_secure` masks coworker
wages, so the percent would be too low. Without the two capabilities, the
page does not run the sales query for the badge.

## Views that get the percent

| View | Day header location |
|------|---------------------|
| Schedule tab grid | `ScheduleDayHeaderContent` gets a generic `footer` slot |
| Planner "Plan" view (shift templates grid) | `TemplateGrid` gets a `renderDayFooter(day)` slot |
| Planner "Timeline" view | `ShiftTimelineTab` gets a `renderDayFooter(day, selected)` slot in each day button |

"Templates" is not a separate page. The shift templates show only as rows of
`TemplateGrid` in the Planner "Plan" view.

The mobile week pills (`src/components/scheduling/WeekScheduleMobile.tsx`)
are out of scope. They are too narrow for a second line.

## Architecture

1. **Pure functions** in `src/lib/dailyLaborPercent.ts`:
   `computeDailyLaborPercent`, `projectDailySales`,
   `formatDailyLaborPercent`, `describeDailyLaborPercent`.
2. **Hook** `useDailyLaborPercent(restaurantId, weekDays, { dailyCosts, costsLoading, enabled })`
   returns a memoized `DailyLaborPercentView`:
   `{ byDay, isLoading, hasError, targetLaborPct, lookbackWeeks }`.
   It reads only the staffing settings and the shared sales query. It does
   not run the planner's staffing pipeline or its time punch query.
3. **Component** `DailyLaborPercentBadge` (`labor`, `day`, `dayLabel`,
   `variant`, `inverse`). States: loading (a `<span>` skeleton, valid inside
   a button), error ("could not load projected sales"), no sales ("—"),
   over target (`text-destructive`), else `text-muted-foreground`. The
   `tooltip` variant is a focusable `<span>` with a full `aria-label`. The
   `plain` variant is text only, for use inside a button.
4. **Wiring:** `Scheduling.tsx` computes the view one time and passes it to
   `ShiftPlannerTab` as the `dailyLaborPercent` prop. Both views show the
   same week (`useSharedWeek`). In selection mode, the header button's
   `aria-label` includes the percent sentence, because the label replaces
   the button text.

## Decided trade-offs

- **Red, not amber.** The planner's hourly bars use amber. The badge uses
  `text-destructive`, because red keeps its contrast on both the plain
  header and the inverse (`bg-foreground`) selected-day button.
- **Error text.** On a failed sales query the badge shows "—" and the
  label says "could not load projected sales". It does not claim that there
  is no sales history.
- **No new RPC.** A server-side weekday average returns 7 rows, not up to
  20,000. The client query already exists and React Query shares it, so this
  change keeps it. A server RPC is a possible follow-up.
- **Row cap.** The sales query stops at 20 pages of 1,000 rows
  (`LOOKBACK_SALES_ROW_CAP`). This limit is not new. When a result reaches
  the cap, its last date is partial, so `projectDailySales` does not count it.
- **Past weeks.** Projected sales always come from the N weeks before today,
  also for a past week. The badge is a planning aid, not a report of actual
  sales.
- **Midnight.** The query key has no date. A page that stays open past
  midnight can count yesterday's partial rows until the next refetch
  (window focus or mount). This case is rare and the error is small.
- **Follow-up, not in this change.** `loadScheduledLaborCost` (MCP and AI
  labor tools) does not filter cancelled shifts either
  (`supabase/functions/_shared/labor/scheduledLaborCost.ts`). Fix it in a
  separate change, because it changes the tool outputs.

## Tests

- `tests/unit/dailyLaborPercent.test.ts`: formula, rounding and the target,
  projection by weekday, excluded today, text and aria sentence.
- `tests/unit/useDailyLaborPercent.test.tsx`: shared query, loading, error,
  disabled, and a stable return object.
- `tests/unit/dailyLaborPercentBadge.test.tsx`: all states and variants.
- `tests/unit/scheduling-trades-gate.test.tsx`: the capability gate and the
  cancelled-shift filter on the page.
- Footer slots: `scheduleDayHeaderContent`, `TemplateGrid`,
  `shiftTimelineTab`, and the two `shiftPlannerTab.*Wiring` tests.
