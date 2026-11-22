# Sales comparison to the prior period — plan

Design: `docs/superpowers/specs/2026-11-21-sales-period-comparison-design.md`
Branch: `feature/sales-period-comparison`
Worktree: `.claude/worktrees/sales-period-comparison`

Read the design before each task. The design is the source of truth for names, rules, and styles.
Use TDD for each task: write the failing test, run it, write the code, run it again.
Commit after each task. Stage explicit paths only. Never use `git add -A`.
Start every Bash command with `cd <worktree absolute path> &&`.
Write all comments and commit messages in Simplified Technical English.

## Task 1: the `comparisonRange` helper

Files: `src/lib/comparisonRange.ts` (new), `tests/unit/comparisonRange.test.ts` (new)

Tests first (design section 3):
- Week: 2026-11-16 → 2026-11-21 gives 2026-11-09 → 2026-11-14, `kind: 'week'`, `offsetDays: 7`.
- Week: a full Monday to Sunday week shifts 7 days.
- Month: 2026-03-01 → 2026-03-31 gives 2026-02-01 → 2026-02-28. Leap year: 2028-03-01 → 2028-03-31 gives 2028-02-01 → 2028-02-29.
- Month: 2026-11-01 → 2026-11-21 gives 2026-10-01 → 2026-10-21.
- Month across a year: 2026-01-01 → 2026-01-15 gives 2025-12-01 → 2025-12-15.
- Quarter: 2026-10-01 → 2026-11-21 gives 2026-07-01 → 2026-08-21, `kind: 'quarter'`.
- Quarter hint: 2026-10-01 → 2026-10-31 with `'quarter'` gives 2026-07-01 → 2026-07-31.
- No hint: 2026-10-01 → 2026-10-31 gives 2026-09-01 → 2026-09-30.
- Shift: 1 day (2026-11-21, a Saturday) gives 2026-11-14.
- Shift: 30 days back 35. 90 days back 91. The prior start has the same weekday.
- `'shift'` hint on 2026-11-01 → 2026-11-21 gives a 21-day shift, not the month rule.
- `'shift'` hint on a Monday-start week still shifts by whole weeks (7).
- Invalid: `''`, `'2026-02-31'`, `'2026-13-01'`, start after end → `null`.
- `describeComparison` and `comparisonLabel` for each kind, and "1 week earlier" vs "5 weeks earlier", and "same day, last week" for 1-day shift.

Code: pure `YYYY-MM-DD` math with `Date.UTC` and `getUTC*`. No date-fns. No local-time API.

## Task 2: `computeKpiDelta` and `attachPriorSeries`

Files: `src/lib/salesTrends.ts`, `tests/unit/salesTrends.test.ts` (add to it if it exists, else a new `tests/unit/salesTrendsComparison.test.ts`)

Tests first (design sections 5.2 and 5.6):
- `computeKpiDelta(110, 100)` → change 10, percent 10.
- `computeKpiDelta(90, 100)` → change -10, percent -10.
- `computeKpiDelta(5, 0)` → percent `null`. `computeKpiDelta(0, 0)` → percent `null`, change 0.
- `attachPriorSeries(daily, priorDaily)` pairs by index, adds `prior` (the prior row `total`) and `priorDate`.
- A shorter prior series leaves the extra current rows with no `prior` key (`'prior' in row` is false).
- An undefined prior series returns the rows unchanged.

Code: export `KpiDelta`, `computeKpiDelta`, `DailySeriesRowWithPrior`, `attachPriorSeries`.

## Task 3: dashboard fix

Files: `src/pages/Index.tsx`, plus a small pure adapter in `src/lib/comparisonRange.ts`
(`periodComparison(period: { type; from: Date; to: Date })` → `{ from: Date; to: Date; label: string } | null`),
with tests in `tests/unit/comparisonRange.test.ts`.

Tests first:
- `week` period Mon Nov 16 → Sat Nov 21 (local dates) gives Mon Nov 9 00:00 → Sat Nov 14 23:59:59.999 local, label "vs same days, last week".
- `today` gives the same weekday last week, label "vs same day, last week".
- `last30` that starts on the 1st uses the shift rule.
- `quarter` Oct 1 → Oct 31 gives Jul 1 → Jul 31.

Code:
- Map the period type to a hint (design section 3).
- Convert with `toDateOnlyString` (`src/lib/dateOnly`). Parse back to local start of day and end of day.
- In `Index.tsx:261-270`, replace the old window math with `useMemo(() => periodComparison(selectedPeriod), [selectedPeriod])`.
  Pass the dates to `usePeriodMetrics`. Keep the hook call unconditional (rules of hooks).
- Replace the "vs previous period" labels at lines ~871, 897, 911, 932 with the computed label. Fall back to "vs previous period".
- Delete the `differenceInDays` import if it has no other use.
- Run `npm run typecheck`.

## Task 4: Sales Trends panel — data, switch, caption

Files: `src/components/pos-sales/SalesTrendsPanel.tsx`

Code (design sections 5.1, 5.3, 5.4, 5.7):
- `compareOn` state, default `true`. `comparison` memo from `getComparisonRange(startDate, endDate)`.
- Second `useSalesTrends` call, `enabled: expanded && compareOn && comparison !== null`.
- Filter the prior rows with `filterByPos` and `effectivePosFilter`. Compute `priorKpis` and `priorDaily`.
- `deltas` memo with `computeKpiDelta` for netSales, orders, avgOrder. `undefined` when off or on error.
- Switch and `Label` in the header (imports listed in the design), `min-h-[44px] sm:min-h-0`, header uses `flex-wrap gap-2`.
- Caption under the header, one time only. Error caption with `AlertCircle` and `role="status"`.
- Pass `deltas`, `deltasLoading` to `TrendKpiRow`. Pass `daily` rows from `attachPriorSeries` and a `showPrior` flag to `SalesByDayChart`.

## Task 5: KPI delta line

Files: `src/components/pos-sales/TrendKpiRow.tsx`

Code (design section 5.5): optional `deltas` and `deltasLoading` props; `KpiTile` delta line with icons,
`text-success-strong` / destructive token, "No prior sales", `sr-only` text, `min-h-[16px]`, and a `Skeleton` while loading.
Orders show a count change. Busiest day and Peak hour get no delta. Keep `memo`.

## Task 6: Sales by day prior series

Files: `src/components/pos-sales/SalesByDayChart.tsx`

Code (design section 5.6): `ComposedChart`; prior `Bar` for ≤14 days, dashed `Line` above 14 days;
`prior` chart config with a dashed legend `icon`; tooltip `formatter` for the `prior` row with the prior date;
`aria-label` with both totals. No change when no row has `prior`.

## Task 7: E2E

Files: `tests/e2e/pos-sales-period-comparison.spec.ts` (new)

Follow the design section 6. Use helpers from `'../helpers/e2e-supabase'`, `generateTestUser()`, and role/label selectors.
If a `unified_sales` seed is not practical, write no spec and record the exception for the PR body.

## Task 8: checks

Run `npm run typecheck`, `npm run lint`, and `npm run test`. Fix all failures that this branch causes.
