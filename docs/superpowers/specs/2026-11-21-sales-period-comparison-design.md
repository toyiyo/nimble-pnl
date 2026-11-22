# Sales: compare to the prior period — design

Date: 2026-11-21
Branch: `feature/sales-period-comparison`
Status: approved by the user ("Yes, build it")

## 1. Problem

The user can see sales for a period on the dashboard and on POS Sales.
The user cannot see how the period compares to the same period before it.
Example: "this week" must show the change against "last week".

The dashboard already shows "vs previous period" on its metric cards.
That value is wrong for a partial calendar period.
On Saturday, "This week" covers Monday to Saturday (6 days).
The current code compares it to the 6 days before Monday: Tuesday to Sunday of last week.
The correct comparison is Monday to Saturday of last week.

## 2. Scope

In scope:

1. A shared pure helper that gives the prior range for a range.
2. The dashboard fix: use the helper in `src/pages/Index.tsx`.
3. POS Sales → Sales Trends panel:
   - A "Compare to previous period" switch in the panel header.
   - A delta line under the Net sales, Orders, and Avg order KPIs.
   - A caption that names the prior range.
   - Dashed ghost bars for the prior period in "Sales by day".

Out of scope:

- No database change. No new RPC. The prior range uses the same RPC.
- No comparison in "Time of day", "Day of week", or "Top products".
- No "same period last year" option.
- No change to the URL state of POS Sales. The switch state is local React state.

## 3. The comparison rule

The helper works on `YYYY-MM-DD` strings only.
It uses `Date.UTC` math, so the result does not change with the host time zone.
Reason: CI runs in UTC. date-fns `startOfWeek` and `format` use the host zone
(lesson in `memory/lessons.md`). `eachDateInRange` in
`src/lib/salesTrends.ts:209-224` uses the same UTC-safe method.

```ts
// src/lib/comparisonRange.ts
export type ComparisonKind = 'week' | 'month' | 'quarter' | 'shift';
export type ComparisonHint = 'week' | 'month' | 'quarter';

export interface ComparisonRange {
  start: string;      // YYYY-MM-DD
  end: string;        // YYYY-MM-DD
  kind: ComparisonKind;
  offsetDays: number; // days between current start and prior start
}

export function getComparisonRange(
  start: string,
  end: string,
  hint?: ComparisonHint,
): ComparisonRange | null;

export function describeComparison(range: ComparisonRange): string;
```

Rules, in this order:

1. Invalid input (empty string, bad format, rolled-over date, start after end) → `null`.
2. **Week.** Start is a Monday and end is on or before the Sunday of that week →
   prior = start − 7 days, end − 7 days. `kind: 'week'`.
3. **Quarter.** Start is the 1st of Jan, Apr, Jul, or Oct, end is in the same
   quarter, and (`hint === 'quarter'` or end is in a later month than start) →
   prior start = the 1st of the prior quarter.
   Prior end = the same month offset and day as `end`, clamped to the last day of that month.
   Example: 2026-10-01 → 2026-11-21 gives 2026-07-01 → 2026-08-21.
4. **Month.** Start is the 1st of a month and end is in the same month →
   prior = the 1st of the prior month to the same day, clamped to the month end.
   Example: 2026-03-01 → 2026-03-31 gives 2026-02-01 → 2026-02-28.
5. **Shift.** Any other range → move back by the range length, rounded up to whole weeks.
   `offsetDays = ceil(lengthDays / 7) * 7`. The weekdays stay aligned.
   - 1 day ("Today") → the same weekday last week.
   - 30 days → back 35 days.
   - 90 days → back 91 days.

The `hint` comes from the dashboard `Period.type` (`src/components/PeriodSelector.tsx:6`).
POS Sales has only `startDate` and `endDate` strings (`src/pages/POSSales.tsx:182-183`),
so it calls the helper with no hint.
A `hint` of `'week'` or `'month'` does not change the result. The date checks give the same rule.
The `hint` of `'quarter'` is necessary for one case: on Oct 1 to Oct 31 the
"This quarter" preset must compare to Jul 1 to Jul 31, not Sep 1 to Sep 30.

`describeComparison` returns the caption suffix:
`week` → "same days, last week"; `month` → "same days, last month";
`quarter` → "same days, last quarter"; `shift` → "N weeks earlier" ("1 week earlier" when N = 1).

Tests: `tests/unit/comparisonRange.test.ts`. Cover each rule, the clamps
(Mar 31 → Feb 28, Feb 29 in a leap year), a year boundary (Jan 1-15 → Dec 1-15),
the quarter hint, invalid input, and `describeComparison`.

## 4. Dashboard fix

File: `src/pages/Index.tsx:261-270`.

Current code:

```ts
const periodLength = differenceInDays(selectedPeriod.to, selectedPeriod.from) + 1;
const prevTo = new Date(selectedPeriod.from); prevTo.setDate(prevTo.getDate() - 1);
const prevFrom = new Date(prevTo); prevFrom.setDate(prevFrom.getDate() - periodLength + 1);
const { data: previousPeriodMetrics } = usePeriodMetrics(restaurantId, prevFrom, prevTo);
```

New code:

1. Convert `selectedPeriod.from` and `selectedPeriod.to` with `toDateOnlyString` (`src/lib/dateOnly`).
2. Call `getComparisonRange(from, to, hintFor(selectedPeriod.type))` in a `useMemo`.
   `hintFor` maps `week`/`month`/`quarter` to the hint. Other types give `undefined`.
3. Parse the result back to local `Date` values (start of day, end of day).
   Pass them to `usePeriodMetrics`.

The metric cards keep the label "vs previous period" (`src/pages/Index.tsx:871`, 897, 911, 932).
No other dashboard change. `previousPeriodData` (lines 273-282) and the
food-cost insights (lines 537-548) take the new range with no other change.

Behavior change for users: "Today" now compares to the same weekday last week, not yesterday.
"Last 30 days" compares to a 30-day window 35 days back.
This is intentional. Restaurant sales change much by weekday.

If `differenceInDays` has no other use in `Index.tsx`, remove the import.

## 5. POS Sales → Sales Trends panel

### 5.1 Data

File: `src/components/pos-sales/SalesTrendsPanel.tsx`.

- Add state `const [compareOn, setCompareOn] = useState(true)`.
  Default on: the user asked for this view, and the cost is one extra RPC call.
- `const comparison = useMemo(() => getComparisonRange(startDate, endDate), [startDate, endDate])`.
- A second call to `useSalesTrends` (`src/hooks/useSalesTrends.ts:31-58`) with
  `comparison.start`, `comparison.end`, the same `timeZone`, and
  `enabled: expanded && compareOn && comparison !== null`.
  The query key includes the dates, so the prior range has its own cache entry
  with the same 60-second `staleTime` (`src/hooks/useSalesTrends.ts:55`).
- Apply the same `effectivePosFilter` (`SalesTrendsPanel.tsx:79-80`) to the prior rows
  with `filterByPos` (`src/lib/salesTrends.ts:178-187`).
- Compute `priorKpis` with `computeKpis` (`src/lib/salesTrends.ts:440`).

### 5.2 Delta math

New pure function in `src/lib/salesTrends.ts`:

```ts
export interface KpiDelta {
  current: number;
  prior: number;
  change: number;          // current - prior
  percent: number | null;  // null when prior is 0
}
export function computeKpiDelta(current: number, prior: number): KpiDelta;
```

`percent` is `null` when `prior` is 0. The UI then shows "New" and no percent.
Tests go in the existing `tests/unit/salesTrends.test.ts`, or a new file if none exists.

### 5.3 Header switch

In the header row (`SalesTrendsPanel.tsx:108-125`), next to `PosFilterControl`:

```tsx
<div className="flex items-center gap-2">
  <Switch id={compareId} checked={compareOn} onCheckedChange={setCompareOn}
          className="data-[state=checked]:bg-foreground" />
  <Label htmlFor={compareId} className="text-[13px] text-muted-foreground">
    Compare to previous period
  </Label>
</div>
```

`compareId` comes from `useId`, which the file already imports.
Show the switch only when the panel is expanded and `comparison !== null`.

### 5.4 Caption

Under the header, when `compareOn` and the prior data is loaded:

`vs Mon, Nov 9 – Sat, Nov 14 · same days, last week`

Class: `text-[13px] text-muted-foreground`.
Format the dates with a UTC-safe formatter. If `formatShortDate`
(`src/components/pos-sales/salesTrendsFormat.ts:9`) is not UTC-safe for a
`YYYY-MM-DD` string, add one in `comparisonRange.ts` and test it.

### 5.5 KPI deltas

File: `src/components/pos-sales/TrendKpiRow.tsx`.

- New optional prop `deltas?: { netSales?: KpiDelta; orders?: KpiDelta; avgOrder?: KpiDelta }`.
- `KpiTile` (lines 24-31) gets an optional `delta` prop.
  It renders a third line under the value:
  - Up: `ArrowUpRight` icon, `text-success`, text "+12.4% · +$1,240".
  - Down: `ArrowDownRight` icon, `text-destructive`, text "−8.1% · −$640".
  - Flat (|percent| < 0.05): `Minus` icon, `text-muted-foreground`, text "0.0%".
  - `percent === null`: text "New", `text-muted-foreground`.
  - Class: `text-[12px] font-medium tabular-nums flex items-center gap-1 mt-1`.
  - Icons get `aria-hidden="true"`. The line gets an `sr-only` prefix
    "Up 12.4 percent versus previous period" (or "Down"), so the meaning does not depend on color.
- Orders show the count change ("+14"), not dollars.
- Busiest day and Peak hour get no delta.
- While the prior query loads, the delta line shows a `Skeleton` with `h-3 w-16`.
  The KPI value does not wait for the prior data.
- If the prior query fails, show no deltas and show the caption
  "Could not load the previous period." in `text-[13px] text-muted-foreground`.
  The current-period panel stays usable.
- Keep the component `memo`. Pass `deltas` from a `useMemo` in the panel.

### 5.6 Sales by day ghost bars

File: `src/components/pos-sales/SalesByDayChart.tsx`.

- New optional prop `priorTotals?: number[]`.
  The panel builds it with `buildDailySeries(priorRows, posSystems, comparisonRange)`
  (`src/lib/salesTrends.ts:226`) and maps each row to `total`.
- Alignment is by index. Day *i* of the current range pairs with day *i* of the prior range.
  The comparison rule keeps the weekdays aligned for week and shift ranges.
  For month and quarter ranges the pair is "same day number", which is the standard calendar view.
- If the prior range is shorter (month clamp), the missing items are `undefined` and draw no bar.
- The panel adds `prior` to each `daily` row: `{ ...row, prior: priorTotals[i] }`.
- Add one more `<Bar dataKey="prior">` before the stacked POS bars, with no `stackId`:
  `fill="transparent"`, `stroke="hsl(var(--muted-foreground))"`,
  `strokeDasharray="3 3"`, `strokeOpacity={0.6}`, `radius={[2, 2, 0, 0]}`.
  The prior bar sits beside the current stacked bar in the same day slot.
  Set `barGap={2}` on the `BarChart`.
- With more than one POS, the prior bar is one total. It does not split by POS.
- Add `prior: { label: 'Previous period', color: 'hsl(var(--muted-foreground))' }`
  to the chart config, so the tooltip and the legend name it.
- The tooltip shows the prior date for the day. The panel adds `priorDate` to each row,
  and the tooltip label formatter shows "Prev: Mon, Nov 9".
- Update the `aria-label` on the `role="img"` wrapper (line 27):
  "Sales by day, with the previous period as dashed bars".
- When `priorTotals` is `undefined` (switch off, loading, or error), the chart is the same as today.

### 5.7 States

| State | Current period | Prior period |
|-------|----------------|--------------|
| Current loading | Existing skeleton (lines 129-142) | Not shown |
| Current error | Existing error (lines 144-149) | Not shown |
| Current empty | Existing empty state (lines 151-153) | Not shown |
| Prior loading | Normal | Delta skeletons; no ghost bars; no caption |
| Prior error | Normal | No deltas; error caption |
| Prior empty | Normal | Deltas show "New"; ghost bars at 0 are not drawn |
| Switch off | Normal | No query (`enabled: false`); nothing shown |

### 5.8 Mobile

The KPI grid is `grid-cols-2 sm:grid-cols-5`. The delta line is short ("+12.4% · +$1,240"),
so it fits in a 2-column tile at 375 px. If it does not fit, hide the dollar part below `sm`.
The header wraps with `flex-wrap gap-2`, so the switch moves under the title on a phone.

## 6. Tests

Unit (Vitest, `tests/unit`):

- `comparisonRange.test.ts`: all rules in section 3. Run with `TZ=America/Chicago` and `TZ=UTC` mentally:
  the code uses no local-time API, so the result is the same.
- `computeKpiDelta`: up, down, flat, prior 0, both 0.
- A test for the dashboard range adapter (Period → hint → Date pair), if it is a separate function.

E2E (Playwright): one spec `tests/e2e/pos-sales-period-comparison.spec.ts`.

- Seed `unified_sales` rows for this week and for last week for a test restaurant.
- Open POS Sales with a Monday-to-today range.
- Check that the "Compare to previous period" switch is on.
- Check that the Net sales tile shows a delta with the seeded change.
- Turn the switch off. Check that the delta line is gone.

If the seed for `unified_sales` in E2E is not practical, record the exception
in the PR body and rely on the unit tests and a manual check.

## 7. Risks

- **One more RPC call per panel view.** It runs only when the panel is expanded and the switch is on.
  The RPC is the same one the panel already calls.
- **Dashboard numbers change.** The "vs previous period" percentages change for
  partial weeks, partial months, and "Today". This is the intended fix.
  Mention it in the PR body.
- **Time zone.** The helper uses string math only. The dashboard conversion uses
  local date parts, the same as `toDateOnlyString`.
