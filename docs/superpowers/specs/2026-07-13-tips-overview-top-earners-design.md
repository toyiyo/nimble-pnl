# Design: Tips Overview "top earners" strip

**Date:** 2026-07-13
**Branch:** `feature/tips-overview-top-earners`
**Follows:** PR #608 (Distribution view) — reuses its aggregation util.

## Problem

The Overview tab's `TipPeriodSummary` shows a total and an employee
*headcount* — but no sense of *who* earned the tips. The full per-employee
breakdown now lives in the Distribution tab (#608), but a manager glancing
at Overview still can't see the top earners without switching tabs. This is
the "at-a-glance distribution" fast-follow deferred from #608.

## Decision

Add a compact **"Top earners"** strip inside the `TipPeriodSummary` card:
the top 3 employees by earned tips for the selected period, each with
avatar initials, name, role, share-of-pool, and earned amount — plus a
"View all in Distribution" affordance. It is the glance; the Distribution
tab remains the full ledger.

### Scope

- **Top 3 only.** Compact strip, not a table.
- **Reuse `aggregateTipDistribution`** (`src/utils/tipDistribution.ts`) — no
  new aggregation, no new query. Call it and take `.employees.slice(0, 3)`.
- **Finalized allocations only** (approved/archived) — this is what the util
  returns. The strip is labelled so the finalized scoping is clear (the
  card's "Total tips" includes drafts, so the two can differ legitimately).
- **No payment status here.** Paid/partial/unpaid stays in the Distribution
  tab. The strip is about *who earned*, not *who's owed* — keeps
  `TipPeriodSummary`'s props from growing and avoids threading `payouts`.
  Aggregation is called with `payouts = []`.

### Out of scope

- Payment status in the strip.
- Configurable N / "show more" (the affordance links to Distribution).

## Component

New `src/components/tips/TipTopEarners.tsx`:

```tsx
interface TipTopEarnersProps {
  splits: TipSplitWithItems[] | undefined;
  onViewAll?: () => void; // navigates to the Distribution tab
}
```

- `useMemo(() => aggregateTipDistribution(splits ?? [], []), [splits])`,
  then `.employees.slice(0, 3)` and `totalEarnedCents` for the share bar.
- Presentational, no data fetching. Rendered inside `TipPeriodSummary`.

### Rendering (Apple/Notion tokens, semantic only)

- Section heading row: `text-[12px] font-medium text-muted-foreground
  uppercase tracking-wider` — "Top earners" on the left; a **"View all"**
  affordance on the right (see below). Directly under the heading, a caption
  `text-[11px] text-muted-foreground` — "Finalized allocations only" — so a
  manager understands why the strip's earners need not sum to the card's
  "Total tips" stat (which includes drafts). (Review major: concrete copy.)
- `<ul aria-label="Top earners">` wrapping three `<li>` rows.
- Each of the 3 rows: avatar initials circle, name (`text-[14px]
  font-medium text-foreground`), role (`text-[13px] text-muted-foreground`),
  a thin share-of-pool bar (`bg-foreground` fill on `bg-muted` track,
  `aria-hidden`) with the numeric `sharePct` as visible text, and the
  earned amount (`text-[14px] font-medium`) right-aligned. Each `<li>`
  carries an `aria-label` reading as one sentence.
- **Role fallback:** `EmployeeDistribution.role` is `string | null`. Mirror
  `TipDistribution.tsx`: use `role ?? 'No role'` for display and build the
  `aria-label` from that fallback so a roleless employee never renders or
  announces `null`.
- **"View all" affordance:** a real shadcn `Button variant="ghost"`
  (CLAUDE.md ghost pattern: `h-9 px-4 rounded-lg text-[13px] font-medium
  text-muted-foreground hover:text-foreground`) with an `aria-label`
  ("View all earners in Distribution"), keyboard-operable. Rendered only
  when `onViewAll` is provided.
- **Responsive (mirror `TipDistribution.tsx`):** at `<sm` (375px) hide the
  share bar and drop role/share to a condensed second line under the name;
  at `sm:+` show the single-row layout. Earned amount + name always visible.
  No horizontal overflow inside the card's grid.
- Share % renders as text (WCAG 1.1.1 — the bar is decorative/aria-hidden).
- Fixed 3-item list — no virtualization.

### States (the parent card owns loading)

`TipPeriodSummary` already returns a skeleton while `isLoading`, so
`TipTopEarners` only renders in the loaded state. Within it:
- **Empty** (no finalized allocations — e.g. all days still draft): render a
  one-line muted note "No approved allocations yet" instead of the list, so
  the section isn't mysteriously absent.
- **Data**: the top-3 list.

`TipTopEarners` does not take `isError` — the parent's `splits` query owns
error surfacing; the Overview already renders `TipPeriodSummary` only in the
non-error path. (Overview's summary has no dedicated error UI today; not
regressing that is out of scope.)

## Wiring

- `TipPeriodSummary` gains an optional `onViewDistribution?: () => void`
  prop, passed straight through to `TipTopEarners.onViewAll`. Optional so
  existing callers/tests are unaffected.
- `src/pages/Tips.tsx` Overview block passes
  `onViewDistribution={() => setViewMode('distribution')}` to
  `TipPeriodSummary` (the `viewMode` setter + `'distribution'` member both
  already exist from #608).
- Placement: a new section inside `TipPeriodSummary`'s `CardContent`, after
  the stats grid and before the "missing days" warning alert.
- **Loading skeleton:** the parent's `<Skeleton className="h-24" />`
  already under-represents the card; bump it (e.g. `h-40`) so the loading
  state better approximates the now-taller card with the earners section.

## Testing

`tests/unit/TipTopEarners.test.tsx`:
- renders the top 3 by `earnedCents` in descending order given >3 finalized
  employees (asserts a 4th, lower earner is NOT shown).
- shows each employee's `sharePct` as visible text.
- excludes draft-only allocations (reuses the util's finalized filter — a
  draft split's employee must not appear).
- empty state: no finalized allocations → "No approved allocations yet",
  no list.
- `onViewAll` fires when the "View all" affordance is clicked; the
  affordance is absent when no callback is provided.

## Risks / trade-offs

- **Finalized-only vs. the card's total-tips (incl. drafts) can differ.**
  Accepted and mitigated by labelling; consistent with Distribution
  semantics.
- **Reuses `aggregateTipDistribution` with empty payouts.** The util's
  paid/unpaid fields are computed but ignored here — cheap, and keeps a
  single source of truth for grouping + share math.
