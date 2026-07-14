# Plan: Tips Overview top-earners strip

**Design:** docs/superpowers/specs/2026-07-13-tips-overview-top-earners-design.md
**Branch:** `feature/tips-overview-top-earners`

TDD (RED → GREEN → REFACTOR → COMMIT) per task.

## Task 1 — `TipTopEarners` component + tests

**Files:** `src/components/tips/TipTopEarners.tsx` +
`tests/unit/TipTopEarners.test.tsx`

- Props: `{ splits?: TipSplitWithItems[]; onViewAll?: () => void }`.
- `useMemo(() => aggregateTipDistribution(splits ?? [], []), [splits])`;
  take `employees.slice(0, 3)` + `totalEarnedCents` for the share bar.
- Heading "Top earners" + caption "Finalized allocations only" + a
  `Button variant="ghost"` "View all" (aria-label "View all earners in
  Distribution") rendered only when `onViewAll` is set.
- `<ul aria-label="Top earners">`; each `<li>` = avatar initials, name,
  role (`role ?? 'No role'`), share bar (`aria-hidden`) + `sharePct` text,
  earned amount; one-sentence per-row `aria-label`.
- Responsive: hide bar + condensed second line `<sm`, single row `sm:+`.
- Empty (no finalized employees) → muted "No approved allocations yet".
- Semantic tokens only; pinned type scale per design.
- **Tests (RED first):** top-3 descending order (4th excluded); `sharePct`
  visible as text; draft-only allocations excluded; empty state copy +
  no list; `onViewAll` fires on click; affordance absent without callback.

**Deps:** reuses merged `aggregateTipDistribution` (in main via #608).

## Task 2 — Wire into `TipPeriodSummary`

**File:** `src/components/tips/TipPeriodSummary.tsx`

- Add optional prop `onViewDistribution?: () => void`.
- Render `<TipTopEarners splits={splits} onViewAll={onViewDistribution} />`
  in `CardContent`, after the stats grid, before the missing-days alert.
- Bump the loading skeleton `h-24` → `h-40`.

**Deps:** Task 1.

## Task 3 — Pass the callback from Tips.tsx

**File:** `src/pages/Tips.tsx`

- In the Overview block, pass
  `onViewDistribution={() => setViewMode('distribution')}` to
  `<TipPeriodSummary … />`.

**Deps:** Task 2.

## Non-goals

- No payment status in the strip (Distribution tab owns that).
- No `payouts` threading (`aggregateTipDistribution` called with `[]`).
- No configurable N / URL deep-linking.
