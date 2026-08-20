# Cash Flow Insights — Design

Date: 2026-08-19
Branch: `feature/cashflow-insights`
Reference: Mercury Insights page (user screenshot, 2026-08-19).

## Goal

Rebuild the Cash Flow tab of `/financial-intelligence` in the Mercury Insights
style. The user must:

- Filter dates with a range slider and with date pickers.
- Filter by bank account.
- See the money movement in three visual modes: a Sankey flow, a stacked-bar
  timeline by category, and an in-versus-out timeline.
- Read a visible text narrative that explains the numbers.
- See "Money in" and "Money out" breakdown tables with source/category tabs,
  percent-of-total bars, and amounts.

## Current state (cited)

- The route `/financial-intelligence` renders `FinancialIntelligence` inside
  `ProtectedRoute` (src/App.tsx:418).
- The page owns two filter states: `selectedPeriod` and `selectedBankAccount`
  (src/pages/FinancialIntelligence.tsx:16-22). It renders `PeriodSelector`,
  `BankAccountFilter`, and `BankingIntelligenceDashboard`
  (src/pages/FinancialIntelligence.tsx:39-57).
- `PeriodSelector` gives preset periods and a custom `DateRangePicker`
  (src/components/PeriodSelector.tsx:26-33 and
  src/components/PeriodSelector.tsx:100-104). It has no slider.
- `BankAccountFilter` is a `Select` over `connectedBanks` with an "all" option
  (src/components/banking/BankAccountFilter.tsx:39-63).
- `BankingIntelligenceDashboard` shows five tabs. The `cash-flow` tab renders
  `CashFlowTab` with `selectedPeriod` and `selectedBankAccount` only — no
  period setter (src/components/banking/BankingIntelligenceDashboard.tsx:59-61).
- The current `CashFlowTab` shows three metric cards, an area chart, a pie
  chart, and a volatility gauge (src/components/banking/CashFlowTab.tsx:83-251).
  It does not show a Sankey, a category timeline, a narrative, or breakdown
  tables.
- `useCashFlowMetrics` queries `bank_transactions` with a
  `connected_bank_id` filter and `status = 'posted'`
  (src/hooks/useCashFlowMetrics.tsx:33-44). It selects only
  `transaction_date, amount, status` (src/hooks/useCashFlowMetrics.tsx:35).
- `bank_transactions` has the columns this feature needs: `amount`
  (src/integrations/supabase/types.ts:871), `is_transfer`
  (src/integrations/supabase/types.ts:884), `merchant_name`
  (src/integrations/supabase/types.ts:888), `normalized_payee`
  (src/integrations/supabase/types.ts:889), `transaction_date`
  (src/integrations/supabase/types.ts:905), `category_id`
  (src/integrations/supabase/types.ts:872), `description`
  (src/integrations/supabase/types.ts:876).
- The foreign key `bank_transactions_category_id_fkey` points to
  `chart_of_accounts` (src/integrations/supabase/types.ts:996-1001), so a
  PostgREST embed `category:chart_of_accounts(id, name)` is valid.
- Recharts is installed (package.json:121). A Recharts `Sankey` already works
  in this codebase (src/components/dashboard/CashFlowSankeyChart.tsx:3).
- The shadcn `Slider` wraps Radix and renders one thumb
  (src/components/ui/slider.tsx:10-19). A range brush needs two thumbs, so a
  new component must use `SliderPrimitive` directly.
- Chart color tokens `--chart-1`..`--chart-5` exist for light and dark themes
  (src/index.css:58-62 and src/index.css:129-133). `--success` and
  `--destructive` tokens exist (src/index.css:32 and src/index.css:29).
- An E2E pattern for the seed of `connected_banks`, `bank_account_balances`,
  and `bank_transactions` exists
  (tests/e2e/bank-transaction-filtering.spec.ts:36-176). The
  `bank_transactions` insert sits at
  tests/e2e/bank-transaction-filtering.spec.ts:111-176.
- Sibling hooks page long reads with `.range()`
  (src/hooks/useBankTransactions.tsx:286).

## Lessons applied (Phase 0)

- Narrative text must be visible copy, not only `aria-label`/`sr-only`
  (memory/lessons.md, 2026-07-22 "insight text only as aria-label"). The
  narrative panel is the product here. Render it as visible text. Give charts
  an accessible name from the same strings.
- A calendar-day token has two correct serializations; do not use
  `toISOString().split('T')[0]` on a local-midnight `Date`
  (memory/lessons.md, 2026-07-28). Use `format(date, 'yyyy-MM-dd')` from
  `date-fns`, as `useCashFlowMetrics` already does
  (src/hooks/useCashFlowMetrics.tsx:38-39).

## Decisions

The session runs without a human in the loop. The screenshot and the request
text are the approved brief. The decisions below follow from them.

1. **Scope**: change only the Cash Flow tab plus the prop threads it needs.
   The other four tabs stay unchanged.
2. **No DB change**: all aggregation runs on the client from one
   `bank_transactions` query. No migration, no edge function, no RPC.
3. **Slider placement**: the timeline brush renders inside the new Cash Flow
   view, above the headline numbers. It writes the same page-level
   `selectedPeriod` state. `FinancialIntelligence` passes `onPeriodChange`
   down through `BankingIntelligenceDashboard` to `CashFlowTab`.
4. **Charts**: Recharts only. The Sankey mode reuses the Recharts `Sankey`
   element. No new chart library.
5. **Colors**: chart series read `hsl(var(--chart-N))`, `hsl(var(--success))`,
   `hsl(var(--destructive))`. No hardcoded colors in new code.
6. **Narrative**: deterministic client-side rules. No AI call. The insight
   engine is a pure function with unit tests.

## New architecture

```text
src/lib/cashflowInsights.ts          pure aggregation + insight engine
src/hooks/useCashFlowInsights.tsx    React Query fetch + memoized aggregation
src/components/banking/cashflow/
  TimelineBrush.tsx                  two-thumb month-scale range slider
  CashFlowHeadline.tsx               Net cashflow / Money in / Money out
  CashFlowNarrative.tsx              visible insight list
  CashFlowChart.tsx                  three modes: flow | category | in-out
  MoneyBreakdownTable.tsx            Money in / Money out tables
src/components/banking/CashFlowTab.tsx   rewritten composition
```

### Data fetch (`useCashFlowInsights`)

One query per (restaurant, from, to, bankAccount) key:

- Table: `bank_transactions`, filter `restaurant_id`, `status = 'posted'`,
  and `connected_bank_id` when the bank filter is not `'all'` — the same
  filter shape as src/hooks/useCashFlowMetrics.tsx:33-44.
- Select explicit fields only: `transaction_date, amount, is_transfer,
  normalized_payee, merchant_name, description,
  category:chart_of_accounts(id, name)`.
- Date window: from `min(period.from, startOfMonth(subMonths(period.to, 4)))`
  to `period.to`. The wide window feeds the three-month comparison in the
  narrative. The visual aggregates use only rows inside the period.
- **Paging**: PostgREST caps a response at 1000 rows. The query orders by
  `transaction_date` ascending and pages with `.range()` in 1000-row pages,
  the same pattern as src/hooks/useBankTransactions.tsx:286. Hard stop at
  20 pages (20,000 rows); above the stop, the hook sets a `truncated` flag
  and the view shows a notice.
- RLS coupling: the embed on `chart_of_accounts` works because
  `view:transactions` and `view:chart_of_accounts` map to the same role set
  today. If the two capabilities diverge, the embed returns `category: null`
  for the excluded roles without an error. The aggregation folds such rows
  into `Uncategorized`, so the failure stays visible, not silent.
- React Query options: `staleTime: 30000`, `refetchOnWindowFocus: true`
  (CLAUDE.md data-fetch rule).

### Aggregation (`cashflowInsights.ts`, pure)

Input: rows + period + interval. Output:

- `totals`: moneyIn, moneyOut, net (transfers excluded when the cashflow
  filter is `exclude-transfers`).
- `series`: buckets by interval (`day` | `week` | `month`) with per-category
  signed sums, and with `moneyIn`/`moneyOut` sums.
- `topCategories`: the five largest categories by absolute sum; the rest fold
  into `Other`. Rows with `is_transfer = true` fold into `Transfers`.
  Rows with no category fold into `Uncategorized`.
- `sources` / `recipients`: payee = `normalized_payee ?? merchant_name ??
  description`. Top eight by amount, the rest fold into a `Remaining` row.
  Each row carries `pctOfTotal`.
- `categoryBreakdown`: same shape per category, for the Category tab of each
  table.
- `sankey`: nodes and links. Left: top inflow payees + `Transfers in`.
  Middle: `Money in`. Right: `Expenses` split to top outflow payees +
  `Transfers out`.
- `insights`: ordered list of `{ id, title, body }`:
  1. **Subscriptions**: outflow payees with 3+ charges in the trailing 90
     days, a 25–35 day cadence, and under 10% amount variance. Title:
     "N notable transactions". Body: "We noticed N subscriptions you may
     want to review".
  2. **Revenue change**: money in for the period, plus the last full calendar
     month against the mean of the three preceding calendar months. Title:
     "Revenue increased" or "Revenue decreased".
  3. **Top source change**: the payee with the largest inflow in the last
     full calendar month, against that payee's mean over the three preceding
     months. Emit only when the delta is 20% or more.
  All time anchors ("trailing 90 days", "last full calendar month") anchor
  to `period.to`, not to today, so a historical period reads correctly.
  An insight that fails its data threshold does not render. When zero
  insights pass, the panel shows one line: "No notable changes for this
  period."

Interval default: `day` for periods up to 31 days, `week` up to 120 days,
`month` above. The user can override with a Select.

### Components

**TimelineBrush** — a horizontal rail with month tick labels over the domain
`[startOfMonth(subMonths(today, 23)), endOfDay(today)]`, capped at the
earliest transaction when known. Two thumbs (Radix `SliderPrimitive` with a
two-value array). Thumb size is at least `h-6 w-6` (24px) to meet the WCAG
2.5.8 target-size minimum. Step = one day at `sm` and above; step = seven
days below `sm`, where one day maps to under half a pixel. Month tick
labels show every month at `lg` and above, every third month below. On
commit (`onValueCommit`), it calls `onPeriodChange` with `type: 'custom'`.
When the period changes from the presets or the picker, the thumbs follow.
Both thumbs get `aria-label`s ("Start date", "End date").

**CashFlowHeadline** — three figures in one row: Net cashflow (large),
Money in, Money out. Typography per CLAUDE.md scale. Negative net renders
with `text-destructive`.

**CashFlowNarrative** — the insight list, left column on desktop. Each item:
an arrow glyph, a `text-[14px] font-medium` title, a
`text-[13px] text-muted-foreground` body. Amount and payee spans get a
subtle `bg-muted rounded-md px-1` chip look. Below the list, one caption:
"Trends are generated and may include inaccuracies." All of it is visible
text (lesson 2026-07-22).

**CashFlowChart** — right column. Controls:
- Cashflow filter Select: `All cashflow` | `Exclude transfers`.
- Mode control: a shadcn `ToggleGroup` with three items: `Flow` (Sankey),
  `By category` (stacked bars, positive up / negative down), `In vs out`
  (paired bars, out negated below zero).
- Interval Select: Day / Week / Month (hidden in Flow mode).
Bars use `hsl(var(--chart-N))` fills; the in-vs-out mode uses
`--success` / `--destructive`. Tooltip follows the existing token style
(src/components/banking/CashFlowTab.tsx:141-147). Each mode renders inside
`role="img"` with an `aria-label` built from the same aggregate strings.
Under every mode, one visible caption states the period totals in a
sentence; the chart's `aria-describedby` points at it. This gives the
Sankey a fuller description than one label.

**MoneyBreakdownTable** — two cards side by side ("Money in", "Money out").
Each card: total, a two-option underline tab (Source|Category — Recipient|
Category for money out), then rows: name, percent, a thin
percent-of-total track (`bg-muted` track, `bg-primary` fill), right-aligned
amount. Top eight rows plus `Remaining`.

**CashFlowTab (rewrite)** — composition:

```text
[TimelineBrush]
[CashFlowHeadline]
[grid: CashFlowNarrative | CashFlowChart]
[grid: MoneyBreakdownTable in | MoneyBreakdownTable out]
```

Single column below `lg`. The old metric cards, pie chart, and volatility
gauge leave this tab. `BankingIntelligenceDashboard` and
`FinancialIntelligence` gain the `onPeriodChange` prop thread.

State gate: `CashFlowTab` gates the whole composition on the single
`useCashFlowInsights` result. Loading renders `Skeleton` blocks in the
final layout shape. Error renders one retry card. Zero transactions in the
period renders one empty state. Child components receive data only
(CLAUDE.md three-state rule). When the hook reports `truncated`, the tab
shows one notice line above the headline.

## Visual direction (frontend-design)

Refined-minimal, Apple/Notion per CLAUDE.md. The identity of the view is the
Mercury-style composition itself: a quiet full-width brush, one oversized net
figure (`text-[28px] font-semibold tracking-tight`), hairline `border-border/40`
separations, and a calm five-hue categorical palette from the `--chart-*`
tokens. Motion: one staggered fade-in on load (existing `animate-fade-in`
utility, src/components/banking/CashFlowTab.tsx:81); bars animate on mount via
Recharts defaults. No gradients, no decorative chrome.

The net figure uses `text-[28px] font-semibold tracking-tight`. This is a
deliberate exception to the CLAUDE.md typography scale, for the one
headline metric only. All other text stays on the scale.

## Tests

- `tests/unit/cashflowInsights.test.ts` — bucket math, transfer folding,
  payee fallback order, top-N folding, percent math, subscription detection
  (positive + cadence-miss negative), revenue delta vs three-month mean,
  top-source threshold, interval default, zero-row input (empty aggregates,
  zero insights), time anchors at `period.to`.
- `tests/e2e/financial-intelligence-cashflow.spec.ts` — seed a connected
  bank, two accounts, and transactions across four months (pattern:
  tests/e2e/bank-transaction-filtering.spec.ts:36-176). Assert: headline
  totals; narrative text visible; mode switch renders category bars and
  in-out bars; breakdown tab switch (Source → Category); bank-account filter
  changes the totals; the empty state shows for a period with no
  transactions.

## Out of scope

- AI-generated narrative.
- Export button, "Compare to" control, saved data views (Mercury features
  not requested).
- Changes to the other four intelligence tabs.
- `unified_sales` or POS data — this view reads bank data only.

## Decided trade-offs

- The brush and the preset tabs both write `selectedPeriod`; a preset click
  snaps the thumbs. This is one source of truth, no dual state.
- Subscription detection is heuristic (cadence + variance). False negatives
  are acceptable; the threshold favors precision.
- The Sankey mode ignores the interval control; a flow diagram has no time
  axis.
