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
  by the hook's date filter).
- `unpaidCents = max(0, earnedCents - paidCents)` — clamp so an
  over-payment (manual correction) never renders negative.
- `sharePct` guarded against divide-by-zero (0 when total is 0).
- Deterministic sort: `earnedCents` desc, tie-break by `name` asc.

### Component

New `src/components/tips/TipDistribution.tsx`:

```tsx
interface TipDistributionProps {
  splits: TipSplitWithItems[] | undefined;
  payouts: TipPayout[];
  isLoading: boolean;
  isError: boolean;
  periodLabel: string;
}
```

Renders (Apple/Notion tokens per CLAUDE.md):
- Summary metric row: total distributed, employee count, paid, unpaid.
- Per-employee rows: avatar initials, name, role, a share-of-pool bar,
  hours, earned amount, and a Paid/Unpaid badge (green/amber semantic
  tint). Matches the approved mockup.

### Three-state rendering (lesson 2026-xx line 160)

The view MUST distinguish, in order:
1. `isLoading` → skeleton.
2. `isError` → error message (do NOT render "$0 / nobody" on error).
3. empty (no finalized allocations in period) → empty state inviting the
   user to approve/lock tips in Overview.
4. data → the table.

`Tips.tsx` will additionally destructure `error: periodSplitsError` from
the `periodSplits` query (currently only `isLoading` is taken) and pass
`isError={!!periodSplitsError}`.

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
- Component tests optional per CLAUDE.md (util carries the logic).

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
```
