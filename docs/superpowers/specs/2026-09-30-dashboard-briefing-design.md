# Owner dashboard: today-first briefing (design)

Date: 2026-09-30
Branch: `feature/dashboard-briefing`
Status: Design. STE-aligned.
Concept: https://claude.ai/artifact/XPBB5nVKXnzy6K8wGVm2mH (private canvas)

## 1. Goal

Change the layout of the owner dashboard (`src/pages/Index.tsx`). Do not change
the data. The top of the page must answer three questions in the first screen:

1. How is today going against break-even?
2. What needs my attention now?
3. How is the month going?

The sections below the top keep their current cards. A section rail lets the
owner go to each section directly.

## 2. Non-goals

- No change to hooks, queries, RPCs or calculations. The page keeps every hook
  call at `src/pages/Index.tsx:265` (`useLiquidityMetrics`) and
  `src/pages/Index.tsx:272` (`useBreakEvenAnalysis`), and all others.
- No change to the runway value. The tile keeps `cashRunway` from
  `src/pages/Index.tsx:316`. The alert keeps `dailyAvgSpending` from
  `src/pages/Index.tsx:319`. A separate data PR fixes runway (see section 10).
- No new fonts. No new colors. Use semantic tokens only.
- No redesign of the lower cards (Performance Overview and below) in this PR.

## 3. Evidence

### 3.1 Current page order

The page renders these blocks, in this order:

| Block | Location |
|-------|----------|
| Header: `h1` restaurant name, date, `DataInputDialog`, Banking, Reports, Inventory buttons | `src/pages/Index.tsx:644-697` |
| Skeleton gate | `src/pages/Index.tsx:699-700` |
| `CriticalAlertsBar` | `src/pages/Index.tsx:704` |
| `OwnerSnapshotWidget` | `src/pages/Index.tsx:707-724` |
| `MonthlyBreakEvenStrip` | `src/pages/Index.tsx:727` |
| `SalesVsBreakEvenChart` | `src/pages/Index.tsx:733` |
| Labor cost collapsible (`LaborPnlCard`) | `src/pages/Index.tsx:742-759` |
| `DashboardInsights` | `src/pages/Index.tsx:762` |
| `PeriodSelector` | `src/pages/Index.tsx:765` |
| Performance Overview | `src/pages/Index.tsx:779` |
| Cashflow | `src/pages/Index.tsx:932` |
| Monthly Performance | `src/pages/Index.tsx:952` |
| Revenue Mix | `src/pages/Index.tsx:973` |
| Banking | `src/pages/Index.tsx:1146` |
| Expenses | `src/pages/Index.tsx:1185` |
| Labor efficiency | `src/pages/Index.tsx:1215` |
| Operations Health | `src/pages/Index.tsx:1232` |
| Quick Actions | `src/pages/Index.tsx:1255` |
| `OnboardingDrawer` | `src/pages/Index.tsx:1271` |

### 3.2 Usage (PostHog, last 30 days)

- The dashboard route `/` has 1,488 page views, 125 users and 1,324 sessions.
- Scroll depth comes from `$prev_pageview_max_content_percentage` (376 records).
  - Desktop (160 records): the median depth is 60%. 65 visits stop above
    half of the page. 56 visits reach the bottom.
  - Mobile (215 records): the median depth is 95%. 106 visits reach the bottom.
- There are 4 rage clicks. All are on navigation items.
- There is no autocapture and no section event. We cannot see which lower
  section the owner reads.

Conclusion: on desktop, about 40% of visits do not see the lower half. The
first screen must carry the important numbers. The lower sections stay, and the
rail makes them one click away.

### 3.3 Data that the new top uses (all exists today)

- `breakEvenData.dailyBreakEven`, `todayStatus`, `todayDelta`, `daysAbove`,
  `daysBelow` (`src/pages/Index.tsx:715-721`).
- `breakEvenData.history[]` with `date`, `sales`, `breakEven`, `delta`,
  `status` and `isPartial` (`src/types/operatingCosts.ts:80-89`). The hook
  gets 14 days of history (`src/pages/Index.tsx:272-275`).
- `breakEvenData.monthlyProgress` (`src/types/operatingCosts.ts:105`). Its
  fields are in `src/lib/monthlyBreakEvenProgress.ts:17-33`: `monthLabel`,
  `mtdSales`, `monthlyBreakEven`, `progressPercent`, `expectedPercent`,
  `paceDelta`, `status`, `amountRemaining`, `daysRemaining`, `dailyNeeded`,
  `dailyActual`, `projectedMonthly`, `projectedDelta`.
- `todaysData.netRevenue`, `foodCost`, `laborCost` and `todayProfitMargin`
  (`src/pages/Index.tsx:708-713`).
- `availableCash` (`src/pages/Index.tsx:301`) and `cashRunway`
  (`src/pages/Index.tsx:316`).
- `criticalAlerts` (`src/pages/Index.tsx:357`). Each alert has `id`, `type`,
  `severity`, `title`, `description` and an optional `action` with `label` and
  `path` (`src/components/dashboard/CriticalAlertsBar.tsx:4-14`). The ids are
  `cash-runway`, `prime-cost`, `reorder` and `unmapped-pos`
  (`src/pages/Index.tsx:371-413`).

### 3.4 E2E text that must stay

- `tests/e2e/dashboard-basis-labels.spec.ts:10-25` checks the heading
  "Performance Overview", the text "Before other expenses", the heading
  "Cashflow" (exact), "Cash basis", `/= Net \$/`, the level-2 heading
  "Monthly Performance" and "Accrual basis".
- `tests/e2e/labor-cost-alignment.spec.ts:193-225` checks "Performance
  Overview", a button that matches `/this month/i`, the text `/Labor Cost ·/`
  inside a `rounded-xl` ancestor with a `text-[22px]` value, "Pending Payroll",
  the heading "Monthly Performance" and a table row with `/Pending:/`.

This PR does not move or rename any of this text. The rail uses the same
heading text as link labels. Link labels are not headings, so
`getByRole('heading', …)` still finds one match.

## 4. Design

### 4.1 Page structure

Desktop (`lg` and up) uses two columns:

```text
┌──────────────────────────────────────────────┬────────────┐
│ Header (greeting, date, actions)             │            │
├──────────────────────────────────────────────┤  Section   │
│ Today card (break-even headline + 4 values)  │  rail      │
├───────────────────────┬──────────────────────┤  (sticky)  │
│ Needs your attention  │ Month progress       │            │
├───────────────────────┴──────────────────────┤            │
│ Last 14 days grid                            │            │
├──────────────────────────────────────────────┤            │
│ Sales vs break-even chart (kept)             │            │
│ Labor cost, Insights, Period selector (kept) │            │
│ Performance Overview … Quick Actions (kept)  │            │
└──────────────────────────────────────────────┴────────────┘
```

Mobile and tablet use one column. The rail is not shown. A horizontal chip
row under the header gives the same jumps (section 4.7).

The top blocks use one DOM tree for both sizes. Responsive classes change
the layout. The only dual element is the section navigation (rail and chips,
section 4.8). `memory/lessons.md:1295-1297` says that `hidden md:block` and
`md:hidden` trees both stay mounted. Both trees then carry the same accessible
names, and `getByText` or `getByRole` queries find two matches. Section 4.8
gives the rule that prevents this.

### 4.2 Header

- `h1`: the restaurant name stays the `h1` text (`src/pages/Index.tsx:647-649`).
- Above the `h1`, a small line shows the date and the time of the last
  refresh, for example "Wednesday, September 30 · Updated 2:14 PM".
- The actions stay: `DataInputDialog`, Banking, Reports and Inventory
  (`src/pages/Index.tsx:660-694`). On mobile the three navigation buttons move
  into one "More" menu (`DropdownMenu`) with an `aria-label`. `DataInputDialog`
  stays visible.

### 4.3 Today card (new `DashboardTodayCard`)

This card replaces `OwnerSnapshotWidget` at `src/pages/Index.tsx:707`. It takes
the same props (`src/components/dashboard/OwnerSnapshotWidget.tsx:32-42`).

- Headline sentence, visible copy, `text-[22px] font-semibold`:
  - Above: "Today is $1,240 above break-even."
  - Below: "You need $860 more today to break even."
  - At: "Today is at break-even."
  - No target: "Set your operating costs to see break-even." with a link to
    the operating-costs page.
- The headline reads `todayDelta`, `todayStatus` and `dailyBreakEven`. The
  sentence is visible text, not only an `aria-label` (lesson: the number-bearing
  summary sentence must be visible copy).
- A progress bar shows `todaySales / dailyBreakEven`, capped at 100% for the
  bar width. It has `role="progressbar"` with `aria-valuenow`.
- Four values under the headline, in a 2×2 grid on mobile and a 4-column row
  on desktop: Sales today, Profit margin, Food cost, Labor cost. The values use
  the current props.
- Cash and runway move to the KPI strip (4.6). The runway value stays
  `cashRunway`.
- The line "Last 14d: N above · N below" stays
  (`src/components/dashboard/OwnerSnapshotWidget.tsx:237`). The `daysAbove`
  count changes from `text-green-600` to `text-foreground`. The `daysBelow`
  count keeps `text-destructive`.
- Color: status uses semantic classes. Above uses `text-foreground` with a
  positive icon, below uses `text-destructive`. The card removes the direct
  `text-green-600` and `text-orange-500` classes that the old widget uses.

### 4.4 Needs your attention (new `DashboardAttentionList`)

This list replaces `CriticalAlertsBar` at `src/pages/Index.tsx:704`. It reads
the same `criticalAlerts` array. It does not add or remove alerts.

- Title: "Needs your attention" with a count badge.
- Each row: icon, `title`, `description`, and the action as a button with the
  action label. The button navigates to `action.path`, as in
  `src/components/dashboard/CriticalAlertsBar.tsx:57-60`.
- Critical rows show a `bg-destructive` dot. Warning rows show a muted dot.
- Empty state: "Nothing needs your attention." with a check icon. The old bar
  returns `null` when the list is empty
  (`src/components/dashboard/CriticalAlertsBar.tsx:23`). The new list shows the
  empty state so the layout does not jump.
- The list is a `<ul>` with one `<li>` per alert.

### 4.5 Month progress (restyle of `MonthlyBreakEvenStrip`)

`MonthlyBreakEvenStrip` (`src/pages/Index.tsx:727`) keeps its props and logic.
It moves into the right half of the row beside the attention list. Only the
container classes change, so that it fits a half-width column. Its unit test
`MonthlyBreakEvenStrip.test.tsx` must pass without change. The UI review
(Phase 6) checks the strip at half width on a 1280 px and a 1024 px screen.
If the text wraps badly at `lg`, the row stacks and the strip takes the full
width below `xl`.

### 4.6 KPI strip (inside the Today card footer)

A row of small values under the Today card:

| Label | Source |
|-------|--------|
| Cash in bank | `availableCash` (`src/pages/Index.tsx:301`) |
| Runway | `cashRunway` (`src/pages/Index.tsx:316`), formatted by the current `formatRunway` |
| Prime cost | `todaysData.primeCostPercentage`. `todaysData` comes from `usePeriodMetrics` (`src/pages/Index.tsx:165`, `src/pages/Index.tsx:262`). The page reads this field today at `src/pages/Index.tsx:545`. |
| Month to date | `monthlyProgress.mtdSales` |

Each value has a label in `text-[12px] uppercase tracking-wider` and a value in
`text-[17px] font-semibold`. The runway tile keeps its current value. Section
10 describes the fix that comes later.

### 4.7 Last 14 days grid (new `BreakEvenDayGrid`)

- The concept shows a full month grid. The hook fetches 14 days of history
  (`src/pages/Index.tsx:272-275`). A full month grid needs a change to that
  argument, and the argument also feeds `SalesVsBreakEvenChart` and the COGS
  window at `src/pages/Index.tsx:278-283`. That is a data change, so this PR
  shows the 14 days that exist.
- One cell per day from `breakEvenData.history`. The cell shows the day
  number and a fill: above uses `bg-foreground/80`, below uses
  `bg-destructive/60`, at uses `bg-muted-foreground/50`. A partial day
  (`isPartial === true`) uses a dashed border and the text "so far".
  The component checks `isPartial` before `status`, as the type comment
  says (`src/types/operatingCosts.ts:85-88`).
- Each cell is a `<button>` with a tooltip and an `aria-label`, for example
  "Sep 28: $4,210 sales, $620 above break-even".
- A pure helper `buildDayGridCells(history)` maps history rows to cell
  view models. The helper has unit tests.

### 4.8 Section rail (new `DashboardSectionRail`)

- Desktop only (`hidden lg:block`). It is `sticky top-20` in the right column.
- One link per section: Today, Attention, Sales vs break-even, Labor cost,
  Performance Overview, Cashflow, Monthly Performance, Revenue Mix, Banking,
  Expenses, Labor efficiency, Operations Health, Quick Actions.
- Each section wrapper gets an `id` (for example `id="dash-cashflow"`) and
  `scroll-mt-24`, the same pattern as `src/components/ReceiptMappingReview.tsx:728`.
- A click calls `scrollIntoView({ behavior: 'smooth', block: 'start' })`. If
  the target section is a closed collapsible, the click opens it first. The
  page owns the open state (for example `metricsOpen`, `monthlyOpen`), so the
  rail receives an `onNavigate(sectionId)` callback from the page.
- The active link follows the section in view. An `IntersectionObserver`
  inside a small hook `useActiveSection(ids)` sets it. The hook has unit tests
  with a mocked observer. jsdom has no `IntersectionObserver`, and
  `tests/setup.ts` has no polyfill. The hook test stubs it with
  `vi.stubGlobal('IntersectionObserver', …)` in the test file.
- The rail is a `<nav aria-label="Dashboard sections">`. The active link has
  `aria-current="location"`.
- Mobile: a horizontal chip row, `overflow-x-auto`, under the header. It uses
  the same list and the same callback.
- If `prefers-reduced-motion` is set, the scroll uses `behavior: 'auto'`.
- Accessible names: the rail and the chip row both stay mounted. Two
  elements already have the name "Monthly Performance" (the page `h2` and the
  table `CardTitle`, see `tests/e2e/dashboard-basis-labels.spec.ts:20-24`).
  To keep the names unique, each rail link and each chip has an `aria-label`
  "Go to <section>", for example "Go to Monthly Performance". The visible text
  stays the short section name. The E2E specs use `getByRole('heading', …)`
  and `getByText` with exact heading text. Tests for the rail must scope
  queries to `nav[aria-label="Dashboard sections"]`.
- The chip row is a second `<nav aria-label="Dashboard sections (compact)">`
  so that each landmark has a unique name.
- The rail and chips sit at `sticky top-20` and use `scroll-mt-24`. The app
  header is `h-14` and `sticky top-0` (`src/components/AppHeader.tsx:212-214`),
  so neither the rail nor a scroll target goes under the header.

### 4.9 Lower sections

Everything from `SalesVsBreakEvenChart` (`src/pages/Index.tsx:733`) to
`OnboardingDrawer` (`src/pages/Index.tsx:1271`) keeps its markup and text. The
only change is a wrapper `<section id=… className="scroll-mt-24">` around each
block for the rail.

## 5. States

- Loading: the current gate at `src/pages/Index.tsx:699` stays. The
  `DashboardSkeleton` gets a new shape that matches the new top (a card, two
  half cards and a grid row).
- Break-even loading: the Today card shows skeleton lines for the headline
  while `breakEvenLoading` is true. The rest of the card shows the values that
  exist.
- Break-even error: `breakEvenError` (`src/pages/Index.tsx:272`) shows a short
  line "Break-even is not available right now." The four values still show.
- No history: the day grid shows "No sales history for the last 14 days yet."
- No restaurant: the current state at `src/pages/Index.tsx:613-640` stays.

## 6. Accessibility

- One `h1`. New blocks use `h2`: "Today", "Needs your attention",
  "Month progress" and "Last 14 days". The KPI strip is part of the Today
  card and has no heading. Its values use a `<dl>`. The rail links are not
  headings.
- All icon-only controls have `aria-label`.
- The progress bar has `role="progressbar"`, `aria-valuemin`,
  `aria-valuemax` and `aria-valuenow`.
- Day cells are keyboard focusable. The tooltip text is also in the
  `aria-label`.
- Color is never the only signal. Status also shows as text or an icon.

## 7. Analytics (optional, in scope if small)

Add one event so that the next redesign has data:

- `dashboard_section_viewed` with `{ section_id }`. The `useActiveSection`
  hook sends it once per section per page view, when the section is 50% in
  view.
- `dashboard_rail_clicked` with `{ section_id, surface: 'rail' | 'chips' }`.

The events use `posthog.capture`, as in `src/lib/analytics.ts:233`, through `usePostHog` from `posthog-js/react` (`src/contexts/RestaurantContext.tsx:2`). They do not send money values or
restaurant names.

## 8. Tests

| Item | Test |
|------|------|
| `buildDayGridCells` | `tests/unit/breakEvenDayGrid.test.ts` |
| Headline sentence builder `buildBreakEvenHeadline` | `tests/unit/breakEvenHeadline.test.ts` |
| `useActiveSection` | `tests/unit/useActiveSection.test.ts` |
| `DashboardAttentionList` empty and filled | `tests/unit/DashboardAttentionList.test.tsx` |
| Current E2E specs | `dashboard-basis-labels.spec.ts` and `labor-cost-alignment.spec.ts` pass without edit |
| Current unit tests | `MonthlyBreakEvenStrip.test.tsx`, `salesVsBreakEvenChart*.test`, `dashboardMetricCard.caption.test.tsx`, `indexLaborCostSection.test.ts` pass |

## 9. Risks

- The rail adds an `IntersectionObserver` on a long page. The observer
  watches about 13 elements. The cost is low.
- `OwnerSnapshotWidget` has no other users. Only `src/pages/Index.tsx`
  imports it. The plan deletes it after the Today card replaces it.
  `CriticalAlertsBar` gets the same check in the plan.
- The E2E labor spec looks for a `rounded-xl` ancestor. The lower cards keep
  their classes, so the spec does not change.

## 10. Data mistakes found (separate work, not in this PR)

The tile shows 168 days and the alert shows 22 days for the same restaurant.
The two numbers use different math:

- **M1 (approved for a separate data PR).** The tile uses one day of data.
  `useLiquidityMetrics` gets today's range (`src/pages/Index.tsx:265-269`), so
  one day of burn drives the runway. The fix: runway = book cash ÷ (30-day
  posted outflows − inflows) ÷ 30. One hook feeds the tile and the alert. When
  the net burn is 0 or less, show "Cash growing".
- **M2 (needs validation).** The alert counts pending bank rows as spend
  (`src/pages/Index.tsx:319`). Old pending rows and bank holds make the spend
  too high.
- **M3 (needs validation).** The alert adds all pending outflows and ignores
  deposits.
- **M4 (needs validation).** The `criticalAlerts` memo does not list
  `dailyAvgSpending` in its dependencies (`src/pages/Index.tsx:418`).

This PR shows the runway values as they are today.
