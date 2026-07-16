# Design: Tips "Distribution" view (replaces broken "History" tab)

**Date:** 2026-07-12
**Branch:** `feature/tips-distribution-view`
**Author:** Claude (with Jose)

## Problem

Two problems, one fix.

1. **The "History" tab is broken.** On `/tips`, the History view renders
   from `splits`, which is bound to `dailySplits` for any non-`overview`
   mode (`Tips.tsx:127`: `viewMode === 'overview' ? periodSplits : dailySplits`).
   `dailySplits = useTipSplits(restaurantId, today, today)` is scoped to
   **today only** (`useTipSplits` filters `gte/lte split_date`). So the
   History tab can only ever surface archived splits whose `split_date`
   is today — the entire point of a "history" (locked periods from prior
   days) is silently filtered out. Result: it shows "No locked periods
   yet" almost always.

2. **We can't see how tips are distributed.** The per-employee allocation
   data (`tip_split_items`: employee, amount, hours, role) and the actual
   disbursements (`tip_payouts`: employee, date, amount) are computed,
   stored, and fed to payroll — but **no screen ever shows a human "who
   got what, and were they paid."** The Overview summary shows only a
   headcount and a period total.

"Locked periods" is an internal state-machine concept
(`draft → approved → archived`) that leaked into the UI. Nobody manages a
restaurant wanting to see "locked periods." They want to answer: *how much
did each person earn this week, is the split fair, and who's still owed?*

## Decision

**Replace the "History" tab with a "Distribution" tab** — a per-employee
breakdown of tips for the selected period, including payout status. This
kills the broken screen and fills the visibility gap in one change.

### Scope (first cut)

- **Read-only.** Surface earnings + payout status from existing data. Do
  NOT add a "mark as paid" mutation here — recording payouts already lives
  in the Overview timeline (`TipPeriodTimeline` → `handleRecordPayout`).
- **Same period navigation as Overview.** The Distribution tab reads the
  currently-selected week (`periodStart`/`periodEnd`) — the same
  Previous/Next navigation the Overview already has. This is what fixes
  the today-only bug: the tab uses `periodSplits`, not `dailySplits`.
- **Finalized allocations only.** Aggregate splits with
  `status ∈ {approved, archived}`. Drafts are work-in-progress (visible in
  Daily Entry / drafts list) and would mislead a "distribution" view.

### Out of scope (fast-follow, not this PR)

- Enhancing the Overview `TipPeriodSummary` with an inline top-earners
  strip. The aggregation util below makes this ~free later, but folding
  it in now widens the diff and the review surface (see lessons on scope
  creep). Ship Distribution first.
- Cross-period / all-time ledger. Period-scoped is the right first cut and
  reuses existing data with zero new queries.
- CSV export of the distribution.

## Data flow

No new queries. Both data sources are **already fetched** in `Tips.tsx`
for the selected period:

- `periodSplits = useTipSplits(restaurantId, periodStartStr, periodEndStr)`
  — includes `items` (per-employee allocations, joined with employee
  name/position).
- `payouts = useTipPayouts(restaurantId, periodStartStr, periodEndStr)`.

### The bug fix

`Tips.tsx:127` changes so the non-daily branch uses period data:

```ts
// before: overview → periodSplits, everything else (incl. history) → dailySplits
const splits = viewMode === 'overview' ? periodSplits : dailySplits;
// after: only Daily Entry uses today-scoped data
const splits = viewMode === 'daily' ? dailySplits : periodSplits;
```

Daily Entry keeps `dailySplits`. Overview keeps `periodSplits`.
Distribution now also gets `periodSplits`.

### Aggregation (pure, testable)

New util `src/utils/tipDistribution.ts`:

```ts
export interface EmployeeDistribution {
  employeeId: string;
  name: string;
  role: string | null;
  hoursWorked: number;      // summed across the period's finalized splits
  earnedCents: number;      // summed tip_split_items.amount
  paidCents: number;        // summed tip_payouts.amount for this employee/period
  unpaidCents: number;      // max(0, earned - paid)
  sharePct: number;         // earnedCents / totalEarnedCents * 100
}

export interface TipDistributionResult {
  employees: EmployeeDistribution[]; // sorted earnedCents desc
  totalEarnedCents: number;
  totalPaidCents: number;
  totalUnpaidCents: number;
}

export function aggregateTipDistribution(
  splits: TipSplitWithItems[],
  payouts: TipPayout[],
): TipDistributionResult;
```

Rules:
- Only splits with `status ∈ {approved, archived}` contribute items.
- Group items by `employee_id`; sum `amount` and `hours_worked` (null → 0).
- Employee display name/role from the item's joined `employee` (fallback
  to "Unknown" / null when the join is missing).
- `paidCents` sums `payouts` by `employee_id` (payouts already period-scoped
  by the hook's date filter), **but only counts a payout whose
  `tip_split_id` is `null` (ad-hoc payment) or references a split in the
  finalized set built above.** A payout linked to a non-finalized split is
  skipped — see the reopen-masking hazard below.
- `unpaidCents = max(0, earnedCents - paidCents)` — clamp so an
  over-payment (manual correction) never renders negative.
- `sharePct` guarded against divide-by-zero (0 when total is 0).
- Deterministic sort: `earnedCents` desc, tie-break by `name` asc.

### Payment status (three-way, not binary) — folds review major #2

`unpaidCents`/`paidCents` are continuous, so the badge is **three-way**,
derived by a pure helper `paymentStatus(d): 'paid' | 'partial' | 'unpaid'`:

- `paid` — `earnedCents > 0 && unpaidCents === 0`.
- `partial` — `paidCents > 0 && unpaidCents > 0` (e.g. $10 of $50 paid).
- `unpaid` — `paidCents === 0 && earnedCents > 0`.

Rendered with distinct semantic tints + **text label + icon** (color is
never the sole signal — a11y): paid = success tint + `Check`, partial =
warning tint + `Clock` + "Partial", unpaid = muted/amber tint + `Clock`.
Partial rows also show `$paid / $earned` so a manager sees what's left.

### Component

New `src/components/tips/TipDistribution.tsx`:

```tsx
interface TipDistributionProps {
  splits: TipSplitWithItems[] | undefined;
  payouts: TipPayout[];
  isLoading: boolean;   // periodSplitsLoading || payoutsLoading
  isError: boolean;     // !!periodSplitsError || !!payoutsError
  onNavigateToOverview: () => void; // for the empty-state CTA
}
```

The aggregation runs inside a `useMemo(() => aggregateTipDistribution(
splits ?? [], payouts), [splits, payouts])` (review minor).

Renders (Apple/Notion tokens per CLAUDE.md — pinned classes so
implementation doesn't drift, mirroring `TipPeriodSummary.tsx`):
- Summary metric row: total distributed, employee count, paid, unpaid.
  Values `text-[22px] font-semibold`; labels
  `text-[12px] font-medium text-muted-foreground uppercase tracking-wider`.
- Per-employee rows rendered as a **semantic list** (`<ul>`/`<li>`), each
  `<li>` carrying an `aria-label` that reads as one coherent sentence
  (e.g. "Maria Santos, Server, earned $812, 19% of pool, paid") so a
  screen reader doesn't announce fragmented spans. Row contents: avatar
  initials, name (`text-[14px] font-medium text-foreground`), role
  (`text-[13px] text-muted-foreground`), a share-of-pool bar, hours,
  earned amount, and the three-way status badge. Matches the approved
  mockup.
- **Share-of-pool bar** (review major #3): the numeric `sharePct` renders
  as visible text next to the bar (e.g. "19.3%"); the bar `<div>` itself
  is `aria-hidden="true"` since the number already conveys the value. Bar
  fill uses a semantic token (`bg-foreground`/`bg-primary`), not a raw
  color. WCAG 1.1.1 satisfied via the text, not the bar.

### Responsive / mobile (review major #4)

Restaurant managers hit this on-shift on a phone, so the row must degrade
at 375px. Strategy: below `sm:` (640px) the row becomes two lines — line 1
is avatar + name + earned amount + status badge; line 2 (indented under
the name) is role · hours · sharePct. The share bar is hidden below `sm:`
(the `sharePct` text remains, so no information is lost). At `sm:` and up,
the single-row grid layout from the mockup applies. No horizontal scroll
at any width.

### Three-state rendering (lesson line 160) — folds review major #1

The view MUST distinguish, in order:
1. `isLoading` → **row-shaped** skeleton (placeholder rows matching the
   final layout, not a single block — avoids the `TipPeriodSummary`
   single-`h-24`-blob anti-pattern).
2. `isError` → error message (do NOT render "$0 / nobody" on error).
3. empty (no finalized allocations in period) → empty state whose CTA is
   an actionable button that calls `onNavigateToOverview()` (keyboard
   operable), not just prose.
4. data → the table.

**Both** data sources feed the loading/error props. `Tips.tsx` already
takes `payouts` from `useTipPayouts`; it will additionally destructure
`isLoading: payoutsLoading, error: payoutsError` there and
`error: periodSplitsError` from the `periodSplits` query (currently only
`isLoading` is taken), then pass the combined booleans:
`isLoading={periodSplitsLoading || payoutsLoading}` and
`isError={!!periodSplitsError || !!payoutsError}`. This closes the
"payout fetch slow/failed → everyone shows Unpaid" gap.

## Tab wiring

- `ViewMode` type: rename the `'history'` member to `'distribution'`.
- Tab label map: `{ overview: 'Overview', daily: 'Daily Entry',
  distribution: 'Distribution' }`.
- Replace the `viewMode === 'history'` block (the broken locked-periods
  card) with `<TipDistribution … />`.
- Default `viewMode` stays `'overview'`.

## Testing

- `tests/unit/tipDistribution.test.ts` — the aggregation util:
  - excludes `draft` splits; includes `approved` + `archived`.
  - sums amounts + hours per employee across multiple days.
  - paid/unpaid math, including the over-payment clamp (unpaid ≥ 0).
  - share percentages sum to ~100 (rounding tolerant); divide-by-zero → 0.
  - empty input → zeroed result, empty array.
  - deterministic sort (earned desc, name tie-break).
  - null `hours_worked` and missing `employee` join handled.
- `paymentStatus(d)` helper: `paid` / `partial` / `unpaid` boundaries,
  including the partial case ($10 of $50) and the earned-but-nothing-paid
  case.
- Component tests optional per CLAUDE.md (util carries the logic).

### Virtualization note

Per-restaurant per-week distribution is typically <30 rows, below
CLAUDE.md's 100-item virtualization threshold, so a plain mapped list is
correct here. If a future multi-outlet pool routinely exceeds ~100 rows,
revisit with `@tanstack/react-virtual` — noted so it isn't silently
forgotten.

## Risks / trade-offs

- **Period-scoped, not all-time.** A manager wanting last month steps back
  with Previous. Accepted: matches Overview's mental model, zero new
  queries, and the today-only bug is what we're actually fixing.
- **Read-only.** No "mark as paid" here yet; that flow stays in the
  timeline. Accepted to keep the first cut tight; can add later.
- **Reusing `periodSplits` reference.** Tips.tsx has a history of
  React-Query-ref bugs (Effect 2 hours overwrite). This change only
  *reads* `periodSplits` in a `useMemo`; it introduces no effects and no
  writes, so it can't reintroduce that class of bug.

## Decided trade-off: reopen-after-payout masking (Codex/Phase-7 finding)

`reopenSplit()` (`useTipSplits.tsx`) reverts an `approved` split to
`draft` (manager corrects an error) but leaves any `tip_payouts` already
recorded against that split's `tip_split_id` in place. If `paidCents`
summed *all* an employee's period payouts blindly, that stale payout would
count toward a *different* still-finalized split for the same employee —
masking a genuinely-unpaid day behind a "Paid" badge. In a payroll-adjacent
view that is a wage-accuracy defect, not a cosmetic one.

**Resolution (chosen over deferring):** `paidCents` only counts payouts
whose `tip_split_id` is `null` or references a split in the finalized set.
A payout tied to a reopened/draft split is excluded, so the finalized
split correctly reads as unpaid. Ad-hoc (`null`-linked) payouts still count
as real money paid. Locked in by regression tests in
`tests/unit/tipDistribution.test.ts` (reopened-split masking + the
finalized/null happy path).
```
