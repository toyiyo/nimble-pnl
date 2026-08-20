# Cash Flow Insights — Plan

Date: 2026-08-19
Branch: `feature/cashflow-insights`
Design: docs/superpowers/specs/2026-08-19-cashflow-insights-design.md
Approval: the user approved the design mockup on 2026-08-19.

## Rules for every task

- Write the failing test first. Run it. Then write the code. Run it again.
- Use semantic color tokens only. No hex values in components.
- Use `format(date, 'yyyy-MM-dd')` from `date-fns` for every date string.
- Keep the CLAUDE.md typography scale. The one exception is the
  `text-[28px]` net figure.
- Commit after each task with explicit paths. Never use `git add -A`.

## Task 1: aggregation core

Files: `src/lib/cashflowInsights.ts`, `tests/unit/cashflowInsights.test.ts`.

1. Define the types: `CashFlowRow`, `CashFlowPeriod`, `Interval`,
   `CashFlowAggregates`.
2. Test and build `defaultInterval(period)`: `day` up to 31 days, `week` up
   to 120 days, `month` above.
3. Test and build `computeTotals(rows, options)`: moneyIn, moneyOut, net.
   The `excludeTransfers` option drops rows with `is_transfer = true`.
4. Test and build `bucketSeries(rows, period, interval)`: buckets with
   per-category signed sums and moneyIn/moneyOut sums. Only rows inside the
   period count.
5. Test the zero-row input: empty buckets, zero totals.

Verify: `npm run test -- cashflowInsights`.

## Task 2: folding and breakdown

Files: same as Task 1.

1. Test and build the payee fallback: `normalized_payee ?? merchant_name ??
   description`.
2. Test and build `topCategories(rows)`: five largest by absolute sum, the
   rest fold into `Other`. Transfers fold into `Transfers`. Null categories
   fold into `Uncategorized`.
3. Test and build `breakdown(rows, direction, by)`: top eight payees or
   categories, a `Remaining` fold, and `pctOfTotal` per row.

Verify: `npm run test -- cashflowInsights`.

## Task 3: sankey builder

Files: same as Task 1.

1. Test and build `buildSankey(rows)`: left nodes = top inflow payees plus
   `Transfers in`; center node = `Money in`; right nodes = top outflow
   payees plus `Transfers out` and the net remainder.
2. Test the conservation rule: the sum of left links equals the sum of
   right links.

Verify: `npm run test -- cashflowInsights`.

## Task 4: insight engine

Files: same as Task 1.

1. Test and build the subscription rule: 3+ charges to one payee in the 90
   days before `period.to`, a 25–35 day cadence, under 10% amount variance.
2. Test the cadence-miss negative case: irregular charges emit nothing.
3. Test and build the revenue-change rule: the last full calendar month
   before `period.to` against the mean of the three preceding months.
4. Test and build the top-source rule: emit only when the delta is 20% or
   more.
5. Test the zero-insight fallback: the engine returns an empty list and the
   caller shows "No notable changes for this period."
6. Test the anchor rule: a historical `period.to` moves every window.

Verify: `npm run test -- cashflowInsights`.

## Task 5: data hook

Files: `src/hooks/useCashFlowInsights.tsx`.

1. Build the hook. Query key: `['cashflow-insights', restaurantId, from,
   to, bankAccountId]`. Options: `staleTime: 30000`,
   `refetchOnWindowFocus: true`.
2. Filter: `restaurant_id`, `status = 'posted'`, and `connected_bank_id`
   when the bank filter is not `'all'` (same shape as
   src/hooks/useCashFlowMetrics.tsx:33-44).
3. Select explicit fields plus the embed
   `category:chart_of_accounts(id, name)`.
4. Fetch window: `min(period.from, startOfMonth(subMonths(period.to, 4)))`
   to `period.to`.
5. Page with `.range()` in 1000-row pages, ordered by `transaction_date`
   ascending. Stop at 20 pages and set `truncated: true`.
6. Memoize the aggregates and the insights from the row set.

Verify: `npm run typecheck` and `npm run lint`.

## Task 6: TimelineBrush

Files: `src/components/banking/cashflow/TimelineBrush.tsx`.

1. Build the two-thumb slider on `SliderPrimitive` directly. Thumbs are
   `h-6 w-6` (24px). Step: one day at `sm` and above, seven days below.
2. Month ticks: every month at `lg` and above, every third month below.
3. `onValueCommit` calls `onPeriodChange` with `type: 'custom'`.
4. External period changes move the thumbs.
5. `aria-label`s: "Start date", "End date".

Verify: `npm run typecheck`.

## Task 7: headline and narrative

Files: `src/components/banking/cashflow/CashFlowHeadline.tsx`,
`src/components/banking/cashflow/CashFlowNarrative.tsx`.

1. Headline: Net cashflow at `text-[28px] font-semibold tracking-tight`,
   Money in, Money out. Negative net gets `text-destructive`.
2. Narrative: visible insight list per the design. Amount and payee spans
   get the `bg-muted rounded-md px-1` chip look. Caption: "Trends are
   generated and may include inaccuracies."

Verify: `npm run typecheck`.

## Task 8: chart

Files: `src/components/banking/cashflow/CashFlowChart.tsx`.

1. Controls: cashflow Select, mode `ToggleGroup` (Flow | By category |
   In vs out), interval Select (hidden in Flow mode).
2. Flow mode: Recharts `Sankey` from `buildSankey`.
3. Category mode: stacked bars, positive up, negative down,
   `hsl(var(--chart-N))` fills.
4. In-vs-out mode: paired bars with `--success` / `--destructive`.
5. Each mode: `role="img"`, an `aria-label` from the aggregate strings, and
   one visible caption wired with `aria-describedby`.

Verify: `npm run typecheck`.

## Task 9: breakdown tables

Files: `src/components/banking/cashflow/MoneyBreakdownTable.tsx`.

1. Card with total, underline tabs (Source|Category — Recipient|Category
   for money out), and rows: name, percent, percent-of-total track,
   right-aligned amount. Top eight rows plus `Remaining`.

Verify: `npm run typecheck`.

## Task 10: composition and prop thread

Files: `src/components/banking/CashFlowTab.tsx`,
`src/components/banking/BankingIntelligenceDashboard.tsx`,
`src/pages/FinancialIntelligence.tsx`.

1. Rewrite `CashFlowTab`: brush, headline, narrative|chart grid, tables
   grid. Single column below `lg`.
2. Gate the whole composition on the one `useCashFlowInsights` result:
   Skeleton on load, one retry card on error, one empty state on zero
   rows, one notice line when `truncated`.
3. Thread `onPeriodChange` from `FinancialIntelligence` through
   `BankingIntelligenceDashboard` to `CashFlowTab`.
4. Delete the old metric cards, pie chart, and volatility gauge from this
   tab only.

Verify: `npm run typecheck`, `npm run lint`, `npm run test`.

## Task 11: E2E test

Files: `tests/e2e/financial-intelligence-cashflow.spec.ts`.

1. Seed a connected bank, two accounts, and transactions across four
   months (pattern: tests/e2e/bank-transaction-filtering.spec.ts:36-176).
2. Assert: headline totals; visible narrative text; mode switch renders
   category bars and in-out bars; breakdown tab switch; the bank-account
   filter changes the totals; the empty state shows for a period with no
   transactions.
3. Use `page.getByRole()` and `page.getByLabel()` selectors.

Verify: `npm run test:e2e -- financial-intelligence-cashflow`.

## Task 12: full verification

1. Run `npm run typecheck`, `npm run lint`, `npm run test`.
2. Run the E2E spec.
3. Check both themes in the preview: light and dark.

## Out of scope

Same as the design doc: no AI narrative, no export, no compare control, no
change to the other four tabs, no `unified_sales` data.
