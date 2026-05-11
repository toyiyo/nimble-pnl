# Design — Monthly Performance: TZ-safe expense bucketing & POS collected source-of-truth

**Date:** 2026-05-10
**Owner:** @jdelgado2002
**Status:** Draft → for plan approval
**Related:** PR #492 (`2026-05-01-monthly-performance-source-of-truth`)

---

## Problem

PR #492 aligned the May 2026 numbers across Performance Overview, Monthly
Performance, and POS Sales for *most* code paths. Two paths it missed are still
producing wrong numbers for Russo's Pizzeria (TZ `America/Chicago`), visible
today (2026-05-10) on the dashboard:

| Card                       | Reported       | Correct        | Delta       |
|----------------------------|----------------|----------------|-------------|
| Monthly Performance COGS   | **$3,787**     | $4,003.73      | −$216.75    |
| Monthly Performance Labor  | **$10,745**    | $11,136        | −$391       |
| Monthly Performance "Collected at POS" | **$32,950.80** | $31,596.36 | +$1,354.44 |

The first two come from one bug; the third comes from a different bug.

---

## Bug #1 — `useMonthlyExpenses.tsx` buckets by host-local day

`useMonthlyExpenses` produces the per-month aggregates that
`MonthlyBreakdownTable.tsx` displays in the Monthly Performance row
(`foodCost`, `laborCost`, `totalExpenses`).

Three call sites still use the pre-PR-#492 pattern:

```ts
// Line 90 — bank txns
const monthKey = format(new Date(t.transaction_date), 'yyyy-MM');
// Line 116 — split parent
const monthKey = format(new Date(parentTxn.transaction_date), 'yyyy-MM');
// Line 138 — pending outflows
const monthKey = format(new Date(t.issue_date), 'yyyy-MM');
```

`format(new Date(<utc-ts>), 'yyyy-MM')` parses the UTC timestamp, then
re-renders it in the **host process** timezone. On Russo's browser in Chicago
a `transaction_date = '2026-05-01T00:00:00+00:00'` row becomes
`2026-04-30` → bucketed into April. That's exactly the May 1 COGS row
($189.05 + $27.70 = $216.75) and the May 1 labor rows ($335.36 + $55.65 ≈ $391)
that today's dashboard is missing from May.

`pending_outflows.issue_date` is a `DATE` column — already a `yyyy-MM-dd`
string. `new Date('2026-05-01')` ⇒ 00:00 UTC → in Chicago that renders as
`2026-04-30` too. Same bug, different table.

### Fix

Replace each call site with `toUtcDayKey(raw).slice(0, 7)` — the canonical UTC
month key, mirroring the `useMonthlyMetrics.tsx` fix from PR #492:

```ts
import { toUtcDayKey } from '@/services/cogsCalculations';

const monthKey = toUtcDayKey(t.transaction_date).slice(0, 7);
```

`toUtcDayKey` is the existing pure helper (`raw => raw.slice(0, 10)`) tested by
`tests/unit/cogsCalculations.tz.test.ts`. `slice(0, 7)` truncates the same UTC
date string to `'yyyy-MM'`.

---

## Bug #2 — `monthlyPerformance.ts` discards `totalCollectedAtPos`

The shared `calculateMonthlyPerformance` function intentionally re-derives
"POS collected" from `gross + tax + tips + other_liabilities`:

```ts
// supabase/functions/_shared/monthlyPerformance.ts:115
const posCollectedFromBreakdownCents = grossRevenueCents + passThroughTotalCents;
```

That formula was the right answer for April 2026 (no void/discount offsets
in `unified_sales`), but is wrong for May 2026.

PR #492 introduced `get_unified_sales_totals.collected_at_pos` =
`SUM(unified_sales.total_price)`. This includes Toast's negative void/discount
offset rows that the deposit also includes — matching the POS Sales page. For
Russo May 2026:

- legacy formula → **$32,950.80**
- `unified_sales.SUM(total_price)` → **$31,596.36** ← POS deposit truth

`useMonthlyMetrics.fetchMonthRevenueTotals` already reads
`collected_at_pos` and stores it on `month.total_collected_at_pos`.
`MonthlyBreakdownTable.tsx` passes it through as
`input.revenue.totalCollectedAtPos`. The shared module silently throws it
away — re-derives, displays the wrong number.

### Fix

Have `calculateMonthlyPerformance` prefer the caller-supplied
`totalCollectedAtPos` when it is provided, falling back to the legacy
breakdown formula only when the caller passes `null`/`undefined`:

```ts
const posCollectedFromBreakdownCents =
  input.revenue.totalCollectedAtPos != null
    ? toCents(input.revenue.totalCollectedAtPos)
    : grossRevenueCents + passThroughTotalCents; // legacy fallback
```

This keeps the variable name (and `posCollectedFromBreakdownCents` field) so
no caller renames are needed, and preserves the legacy formula for any caller
that hasn't migrated to `get_unified_sales_totals` yet.

The header comment on the `totalCollectedAtPos` input field is updated to
reflect the new contract.

---

## Non-goals

- Recomputing "Other Expenses" — the reported $23,274 is mathematically
  correct (rent $12,250 + uncategorized $7,706 + other = $23,274). It is
  inflated only because of timing (early-month rent + uncategorized items),
  not a calculation bug.
- Touching `usePeriodMetrics` / `useCostsFromSource` — those already use UTC
  day keys post PR #492, and the Performance Overview numbers match
  ground truth.

---

## Test strategy

| Test file                                          | New / Updated | Purpose                                                                                                                                                                                          |
|----------------------------------------------------|---------------|--------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------|
| `tests/unit/useMonthlyExpenses.tz.test.ts`         | New           | Pin `process.env.TZ='America/Chicago'`. Mock `fetchExpenseData` to return a bank txn at `'2026-05-01T00:00:00+00:00'`, a pending_outflow with `issue_date='2026-05-01'`, and a split. Assert each row buckets to `'2026-05'`, not `'2026-04'`. |
| `tests/unit/monthlyPerformance.test.ts`            | New           | Unit-test `calculateMonthlyPerformance` directly. Case A: caller passes `totalCollectedAtPos: 31596.36` → `posCollectedFromBreakdownCents = 3_159_636`. Case B: caller passes `totalCollectedAtPos: null` → falls back to legacy `gross+passthrough` formula. |
| `tests/unit/monthlyPerformance.acceptance.test.ts` | Updated       | The Russo April fixture currently passes `collected_at_pos: 92274.48` which equals the legacy formula, so no number changes. Verify the test still passes; no edit needed unless behavior shifts.   |

TDD order:
1. Write `useMonthlyExpenses.tz.test.ts` — fails (existing buggy code).
2. Fix `useMonthlyExpenses.tsx` — test goes green.
3. Write `monthlyPerformance.test.ts` — Case A fails (existing buggy code).
4. Fix `monthlyPerformance.ts` — Case A goes green.
5. Run full suite — `monthlyPerformance.acceptance.test.ts` (April fixture) still green.

---

## Risk / blast radius

- **Server-side callers of `calculateMonthlyPerformance`:** None today. The
  module is only consumed by `MonthlyBreakdownTable.tsx`. Future server-side
  callers can opt in by passing `totalCollectedAtPos`, or pass `null` for the
  legacy formula.
- **Edge functions:** This file is in `supabase/functions/_shared/`. No edge
  function consumes it today (verified via grep). Change is frontend-only at
  runtime.
- **TZ regression risk:** All three replacement sites use the same UTC-first
  pattern as the PR #492 fixes — no new TZ paths introduced.

---

## Rollout

Single PR, no migrations, no feature flag. Production verification via the
Monthly Performance card immediately after deploy.
