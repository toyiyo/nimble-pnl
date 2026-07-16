# Plan: Tips "Distribution" view

**Design:** docs/superpowers/specs/2026-07-12-tips-distribution-view-design.md
**Branch:** `feature/tips-distribution-view`

Tasks are ordered by dependency; each is 2–5 min, TDD (RED → GREEN →
REFACTOR → COMMIT).

## Task 1 — Aggregation util (pure, tested)

**File:** `src/utils/tipDistribution.ts` + `tests/unit/tipDistribution.test.ts`

- Export `EmployeeDistribution`, `TipDistributionResult` interfaces.
- Export `aggregateTipDistribution(splits, payouts): TipDistributionResult`:
  - include only `status ∈ {approved, archived}` splits.
  - group items by `employee_id`; sum `amount`, `hours_worked` (null→0).
  - name/role from item's joined `employee` (fallback "Unknown"/null).
  - `paidCents` = sum of `payouts` by `employee_id`.
  - `unpaidCents = max(0, earnedCents - paidCents)`.
  - `sharePct` = earned / totalEarned * 100 (0 when total 0).
  - sort earned desc, tie-break name asc.
- Export `paymentStatus(d): 'paid' | 'partial' | 'unpaid'`.
- **Tests (RED first):** exclude drafts; multi-day sum; paid/partial/unpaid
  boundaries; over-payment clamp (unpaid ≥ 0); divide-by-zero → 0; empty
  input → zeroed; sort determinism; null hours + missing employee join.

**Deps:** none. Depends on types from `useTipSplits`/`useTipPayouts`.

## Task 2 — `TipDistribution` component

**File:** `src/components/tips/TipDistribution.tsx`

- Props per design (`splits`, `payouts`, `isLoading`, `isError`,
  `onNavigateToOverview`).
- `useMemo` over `aggregateTipDistribution(splits ?? [], payouts)`.
- Three states in order: row-shaped skeleton (isLoading) → error (isError)
  → empty (CTA button → `onNavigateToOverview`) → data.
- Summary metric row (total distributed, employees, paid, unpaid).
- Semantic `<ul>`/`<li>` rows with per-row `aria-label`; avatar initials,
  name, role, share bar (`aria-hidden`) + `sharePct` text, hours, earned,
  three-way status badge (tint + icon + label — color not sole signal).
- Responsive: two-line stack below `sm:`, single-row grid at `sm:+`; bar
  hidden below `sm:`. No horizontal scroll.
- Apple/Notion pinned classes per CLAUDE.md; semantic tokens only.

**Deps:** Task 1.

## Task 3 — Wire the tab into Tips.tsx

**File:** `src/pages/Tips.tsx`

- `ViewMode`: rename `'history'` → `'distribution'`.
- Fix the bug at the `splits` binding:
  `const splits = viewMode === 'daily' ? dailySplits : periodSplits;`
- Destructure `error: periodSplitsError` from the `periodSplits` query and
  `isLoading: payoutsLoading, error: payoutsError` from `useTipPayouts`.
- Tab label map → `{ overview, daily, distribution: 'Distribution' }`.
- Replace the `viewMode === 'history'` locked-periods card block with
  `<TipDistribution splits={periodSplits} payouts={payouts}
  isLoading={periodSplitsLoading || payoutsLoading}
  isError={!!periodSplitsError || !!payoutsError}
  onNavigateToOverview={() => setViewMode('overview')} />`.
- Remove now-dead imports (`Lock` if unused, `format` usage in old block).

**Deps:** Task 2.

## Task 4 — Verify no stale references

- Grep for `'history'`, `Tip History`, `Locked periods` — ensure no
  dangling references (e.g. E2E specs, other components).
- Check `tests/e2e/*tip*` for a History-tab assertion that must update.

**Deps:** Task 3.

## Non-goals (explicit)

- No Overview top-earners strip (fast-follow).
- No "mark as paid" mutation here.
- No CSV export, no all-time ledger.
