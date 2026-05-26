# Budget — Monthly Break-Even Progress Indicator

**Date:** 2026-05-26
**Author:** Jose (via Claude)
**Status:** Draft → Design Review

## Problem

The Budget page (`/budget`) already shows two break-even visualizations:

1. **`BreakEvenHeroCard`** — daily / monthly / yearly target numbers + today's status.
2. **`SalesVsBreakEvenChart`** — last 14 daily bars colored green/red against the *daily* break-even line.

Both lenses are **per-day**. Owners glancing at the page mid-month can't tell at-a-glance whether they're on track to break even **this month** — which is the question that actually matters for paying rent, payroll, and other fixed obligations.

The user's request:

> "I want something that tells me how I am doing towards meeting the monthly break even point. Think about this from an excellent user perspective, intuitive, without lots of thinking on the user's part. Remember that we have static costs as well as percentage-based ones."

Static costs (rent, insurance, POS) accrue **flat** day after day. Percentage costs (food cost target, labor target, processing) scale **with sales**. The monthly break-even target already encodes both via `monthlyBreakEven = fixedMonthly / contributionMargin`, but no UI surfaces month-to-date progress against it.

## Goals

1. **Single-glance comprehension.** An owner should know "ahead / on pace / behind" in <2 seconds, without doing arithmetic.
2. **Honor the existing math.** Reuse `monthlyBreakEven` from `useBreakEvenAnalysis` — do not reinvent the formula.
3. **Show what's left, not just what's done.** "$23,700 to go in 13 days" beats "63% complete" because it tells the owner what they need to *do*.
4. **Project the landing point.** Linear extrapolation of current daily run rate, so the owner can sanity-check the trajectory.
5. **Work on both surfaces.** Compact widget on main Dashboard (`/`), full card on Budget page (`/budget`).

## Non-goals

- Day-of-week weighted forecasting (Friday/Saturday weighting). Deferred — flagged as a follow-up.
- Tying back to actual bank transactions for true MTD profit/loss. That's a separate "Income Statement" surface.
- Per-cost-line tracking (e.g. "rent is paid, payroll is not"). Out of scope for V1.
- Multi-month / quarter / YTD progress. Same shape, but defer until monthly is in use.

## Existing infrastructure

| Piece | Source | Role |
|---|---|---|
| `monthlyBreakEven` | `BreakEvenData.monthlyBreakEven` | Target revenue for the month |
| `fixedCosts.totalMonthly` | `BreakEvenData.fixedCosts.totalMonthly` | Static dollar costs (rent etc.) |
| `totalVariablePercent` | `BreakEvenData.totalVariablePercent` | Sum of % costs (food, labor, fees) |
| `contributionMargin` | `BreakEvenData.contributionMargin` | `1 - totalVariablePercent` |
| `get_daily_sales_totals` RPC | `useBreakEvenAnalysis` already calls it | Net revenue by day |
| `useBreakEvenAnalysis` | `src/hooks/useBreakEvenAnalysis.tsx` | Fetches last 14 days; we extend to cover MTD |

## Approach

### 1. Extend `useBreakEvenAnalysis` to cover month-to-date

`useBreakEvenAnalysis(restaurantId, historyDays = 14)` already pulls daily sales via `get_daily_sales_totals`. Today it fetches the last 14 days only. We change the start date to `min(today - 13, startOfMonth(today))`, so the same single RPC call always covers **both** the 14-day chart window and the entire current month-to-date. No new RPC, no new query key churn (the cache key already encodes the date range).

The hook will additionally derive and expose:

```ts
monthlyProgress: {
  monthLabel: string;          // "May 2026"
  daysInMonth: number;         // 31
  dayOfMonth: number;          // 26 (today, restaurant-local)
  mtdSales: number;            // sum of net_revenue from day 1 to today
  monthlyBreakEven: number;    // mirror of top-level field
  progressPercent: number;     // mtdSales / monthlyBreakEven * 100
  expectedPercent: number;     // dayOfMonth / daysInMonth * 100
  paceDelta: number;           // progressPercent - expectedPercent
  status: 'ahead' | 'on_pace' | 'behind' | 'no_target';
  amountRemaining: number;     // max(0, monthlyBreakEven - mtdSales)
  daysRemaining: number;       // max(1, daysInMonth - dayOfMonth + 1)
  dailyNeeded: number;         // amountRemaining / daysRemaining (0 if at goal)
  dailyActual: number;         // mtdSales / dayOfMonth (avg daily so far)
  projectedMonthly: number;    // dailyActual * daysInMonth (linear projection)
  projectedDelta: number;      // projectedMonthly - monthlyBreakEven
} | null;
```

Status thresholds (matching the existing `BREAK_EVEN_TOLERANCE = 0.05` constant in `breakEvenCalculator.ts`):

| Condition | Status |
|---|---|
| `monthlyBreakEven` is 0 or Infinity (no target / no margin) | `no_target` |
| `paceDelta > +5pp` | `ahead` |
| `paceDelta < -5pp` | `behind` |
| Otherwise | `on_pace` |

5 percentage points (not 5% of pace) is the symmetric band — matches the daily chart's tolerance and is wide enough to absorb normal weekday/weekend swing.

### 2. New pure-function library + tests

Add `src/lib/monthlyBreakEvenProgress.ts`:

```ts
export interface MonthlyProgressInputs {
  monthlyBreakEven: number;    // dollars
  mtdSales: number;            // dollars
  today: Date;                 // restaurant-local today
}

export function calculateMonthlyProgress(inputs: MonthlyProgressInputs): MonthlyProgress | null;
```

Move all the date / pace / projection math into this pure function so it's testable without React. The hook becomes a thin wrapper that picks the right `today` and feeds the sum.

### 3. New component `MonthlyBreakEvenProgressCard` (Budget page)

`src/components/budget/MonthlyBreakEvenProgressCard.tsx` — full card, inserted on the Budget page **between** `BreakEvenHeroCard` and the cost-structure section. Why there: the hero already gives "today's status"; this card answers the next natural question "OK but how's the month going?"

Layout (Apple/Notion vocabulary per CLAUDE.md):

```
┌────────────────────────────────────────────────────────────────┐
│  Monthly Break-Even Progress                                   │
│  May 2026 · Day 26 of 31                                       │
│                                                                │
│                                                       [Badge]  │
│                                                       Ahead    │
│                                                                │
│  $42,300                                                       │
│  collected of $66,000 needed                                   │
│                                                                │
│  ┌──────────────────────────────────────────────────────┐      │
│  │██████████████████████████████│    pace marker  │     │ 64%  │
│  └──────────────────────────────────────────────────────┘      │
│                                  ▲ Expected today: 84%         │
│                                                                │
│  ┌─────────────────┬────────────────┬─────────────────┐        │
│  │  $23,700        │  5 days        │  $4,740/day     │        │
│  │  still needed   │  remaining     │  to break even  │        │
│  └─────────────────┴────────────────┴─────────────────┘        │
│                                                                │
│  Trending toward $52,100 by month-end — $13,900 below target.  │
│                                                                │
└────────────────────────────────────────────────────────────────┘
```

Visual rules:

- Card uses the same `bg-gradient-to-br` palette as `BreakEvenHeroCard`, tinted by status (green/yellow/red).
- The progress bar is a single solid fill on a muted track; pace marker is a vertical dashed line at `expectedPercent`. If fill is past the marker → ahead; before → behind.
- Status badge mirrors the hero card's `CircleCheck` / `CircleMinus` / `CircleX` icon vocabulary.
- Three-stat row uses the same `text-2xl font-bold tracking-tight` numbers + `text-[11px] text-muted-foreground` labels as the existing summary stats.
- Projection sentence at the bottom uses muted text; goes green when projection ≥ target, red when below.
- Empty / no-target state: friendly message + link to "Add costs" matching the hero card's existing empty state.

States the component must handle (per CLAUDE.md):

| State | What renders |
|---|---|
| `isLoading=true` | Skeleton matching the card shape |
| `data=null` or `status='no_target'` | "Set up fixed and variable costs to see monthly progress" + Target icon |
| `status='ahead'` | Green gradient, "Ahead of pace" badge, green projection text |
| `status='on_pace'` | Yellow gradient, "On pace" badge, neutral projection text |
| `status='behind'` | Red gradient, "Behind pace" badge, red projection text |

### 4. Compact widget on main Dashboard

`src/components/dashboard/MonthlyBreakEvenStrip.tsx` — horizontal strip, fits one row alongside other dashboard widgets. Smaller, denser:

```
┌────────────────────────────────────────────────────────────────────────┐
│ Monthly Break-Even · May 2026                              Ahead       │
│  ████████████████████████████│ pace                                    │
│  $42,300 of $66,000 (64%) · $4,740/day to hit target  →  Budget        │
└────────────────────────────────────────────────────────────────────────┘
```

- Single-line headline with status pill on the right.
- Same progress bar with pace marker, but thinner.
- "→ Budget" link navigates to `/budget` for the full card.
- Sized to slot into the existing Index.tsx layout — likely under the `OwnerSnapshotWidget`/`OperationsHealthCard` row, above `SalesVsBreakEvenChart`. We do **not** add a new section, we add this between two existing ones.

### 5. Tests

Unit tests (Vitest):

- `src/lib/monthlyBreakEvenProgress.test.ts`
  - Day 1 of 31 → `expectedPercent ≈ 3.2`, `dailyNeeded ≈ target / 31`.
  - Mid-month exact pace (day 16, mtd = 16/31 × target) → `status: 'on_pace'`.
  - Ahead by >5pp → `status: 'ahead'`.
  - Behind by >5pp → `status: 'behind'`.
  - `monthlyBreakEven = 0` → `status: 'no_target'`.
  - `monthlyBreakEven = Infinity` (contribution margin ≤ 0) → `status: 'no_target'`.
  - Last day of month → `daysRemaining = 1`, `dailyNeeded = amountRemaining`.
  - Already past target → `amountRemaining = 0`, `dailyNeeded = 0`, status `ahead`.
  - Projection: `dailyActual = mtdSales / dayOfMonth`, `projectedMonthly = dailyActual × daysInMonth`.
  - All branches of the status string + projection-vs-target sentence covered in one fixture (per lesson [2026-05-24]).

Component smoke tests for both cards: load + happy/empty/loading variants. No E2E — the existing budget E2E already covers the page, and we're adding inert visualization.

### 6. Files to add / modify

**Add:**
- `src/lib/monthlyBreakEvenProgress.ts`
- `tests/unit/monthlyBreakEvenProgress.test.ts`
- `src/components/budget/MonthlyBreakEvenProgressCard.tsx`
- `src/components/dashboard/MonthlyBreakEvenStrip.tsx`

**Modify:**
- `src/hooks/useBreakEvenAnalysis.tsx` — extend window to start at `min(today-13, startOfMonth(today))`; expose `monthlyProgress` from `BreakEvenData`.
- `src/types/operatingCosts.ts` — add `monthlyProgress` to `BreakEvenData`.
- `src/lib/breakEvenCalculator.ts` — wire the pure function in.
- `src/pages/BudgetRunRate.tsx` — render `MonthlyBreakEvenProgressCard` between hero and cost structure.
- `src/pages/Index.tsx` — render `MonthlyBreakEvenStrip` above `SalesVsBreakEvenChart`.

## Decided trade-offs

- **Linear pace, not weighted.** Most restaurants vary day-to-day, but Friday/Saturday weighting adds opacity for marginal accuracy gains. Owner can already see the daily bars right below for that nuance.
- **MTD progress against fixed monthly target.** The target itself comes from `monthlyBreakEven` which already encodes contribution margin (so % costs are baked in). We do not separately track "fixed costs paid so far" — that would be a different surface (cash basis P&L).
- **Restaurant-local timezone via `startOfDay(new Date())` in the browser.** Same convention as the rest of the budget page; if we ever introduce per-restaurant TZ, both files change together.
- **5 percentage-point tolerance** for ahead/behind, mirroring `BREAK_EVEN_TOLERANCE`. The user already accepts this band on the daily view.
- **Extend the existing query window instead of adding a second RPC call.** The widest sensible window (start of current month) is at most ~30 days, well within the existing 14-day window during the first half of any month, and only marginally larger in the second half. One cache entry, one network call.

## Open questions

None blocking. Will revisit weighted forecasting and YTD/quarterly progress after this lands.
