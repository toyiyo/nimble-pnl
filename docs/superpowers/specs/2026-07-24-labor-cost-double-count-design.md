# Design: Fix labor double-count in the shared cost model

**Date:** 2026-07-24
**Branch:** `fix/labor-cost-double-count`
**Status:** Approved (design review folded in)

## Problem

The P&L Intelligence report showed Wetzel's Cold Stone with Labor Cost 65.1% and
Prime Cost 106.7% — impossibly high. Investigation (systematic-debugging) ruled
out a report-vs-dashboard discrepancy: both screens consume the same hooks
(`useRevenueBreakdown` + `useCostsFromSource`) and produce identical numbers for
the same period. The 106.7% is real, and its driver is a **labor double-count**
in the shared cost model.

`src/hooks/useCostsFromSource.tsx` combines two representations of labor and
**sums** them:

```ts
// line 123 (current)
const totalLaborCost = laborCosts.totalCost + transactionLaborCosts.totalCost;
```

- `laborCosts` (`useLaborCostsFromTimeTracking`) — **accrued** labor: wages
  computed from `time_punches` × employee comp configs (hourly + salary +
  per-job contractor), dated to the **day worked**.
- `transactionLaborCosts` (`useLaborCostsFromTransactions`) — **paid** labor:
  `bank_transactions` + `pending_outflows` categorized to
  `account_subtype = 'labor'`, dated to the **pay/transaction date**.

For Wetzel's these largely describe the **same** labor — the payroll run that
leaves the bank settles hours already accrued from punches. Summing them
double-counts: accrued $17,232 + paid $14,366 = $31,597 (65.1%). The accrued
figure alone (~$17,232, ~35%) is the correct period labor cost, putting prime
cost at ~70%.

The same double-count pattern exists in a **third** code path,
`supabase/functions/_shared/monthlyPerformance.ts:131`
(`laborIncludingPendingCents = actualLaborCents + pendingLaborCents`), consumed
by `MonthlyBreakdownTable.tsx`. That module lives under `_shared/` but is
**only imported by the client component** — no edge function calls it — so it is
effectively a client-side pure function and is in scope for this fix.

## Decision: accrued basis, with per-period fallback to paid

Authoritative period labor = **accrued (time punches)**. This matches labor to
the revenue period (accounting matching principle): revenue comes from
`unified_sales` dated to the sale; accrued labor is dated to the day worked;
the two line up. Bank payroll is treated as cash settlement of that accrued
labor, not a second P&L cost.

**Fallback:** if a period's accrued labor total is `0` but paid (bank) labor is
`> 0`, use the paid total for that period. This keeps P&L working for
restaurants that don't run the time-punch system but do record payroll via bank
labor categories.

### Why the fallback is evaluated per-period, not per-day

Bank payroll is dated to the pay date and is lumpy — a payroll run can post on a
low- or no-punch day. A *per-day* fallback would see `pending == 0` on that day,
count the bank payroll, and silently **re-introduce the double-count** for
restaurants that already have punches. A single per-period decision avoids this:
when a restaurant has any accrued labor in the period, all bank labor is ignored
for P&L purposes.

```text
useAccrued   = pendingTotal > 0
totalLabor   = useAccrued ? pendingTotal : actualTotal
dailyLabor[] = useAccrued ? day.pending_labor_cost : day.actual_labor_cost
```

## Architecture / isolation

Extract the cost-combination arithmetic out of the hook into a pure, directly
unit-testable module — **`src/lib/combineCosts.ts`**:

- `resolveLaborBasis(pendingTotal): 'accrued' | 'paid'` — the
  per-period decision. `pendingTotal > 0 → 'accrued'`, else `'paid'`.
- `combineDailyCosts(unifiedDailyCOGS, pendingDaily, actualDaily, basis)` —
  merges COGS + labor by date, using the chosen basis for `labor_cost` and
  `total_cost`. `pending_labor_cost` and `actual_labor_cost` remain populated on
  each row for breakdown display; only `labor_cost` (the field that feeds prime
  cost) respects the basis.

`useCostsFromSource` keeps its three data-fetching hooks and delegates all
arithmetic to these helpers. This isolates the logic that was buggy, makes it
testable without mocking three hooks, and keeps the hook focused on fetching.

`monthlyPerformance.ts` is a Deno-targeted module and cannot import from
`src/lib` without risking edge-function build breakage, so it **inlines the same
one-line basis rule** (`pendingLaborCents > 0 ? pending : actual`) with a comment
cross-referencing `resolveLaborBasis` as the single source of the rule. Both are
covered by tests asserting identical behavior (see Testing).

### Interface change

`CostsFromSourceResult` gains one field:

```ts
laborBasis: 'accrued' | 'paid';
```

`pendingLaborCost` and `actualLaborCost` stay exposed unchanged (breakdown is
still visible). After the fix, `totalLaborCost === pendingLaborCost` when
`laborBasis === 'accrued'`, and `=== actualLaborCost` when `'paid'` — never the
sum. `usePeriodMetrics` re-exports `laborBasis` on `PeriodMetrics` so UI can read
it.

## Blast radius — three screens, made consistent

The core fix lives in the shared hook + new helper; the two labor consumers of
`useCostsFromSource` get corrected numbers automatically. But three UI surfaces
render the pending/actual split and **would read as broken** once the headline
stops equalling `pending + actual`. All three are in scope:

### 1. `src/pages/Index.tsx` (main dashboard) — REQUIRED UI change
- **Line ~793 / 800-801:** the "Labor Cost" stat card headline uses
  `periodData.labor_cost`; its subtitle interpolates
  `Pending ${pending} • Actual ${actual}`. Post-fix the headline equals only one
  of them, so the subtitle reads as "$14,366 vanished."
  **Fix:** the subtitle must name the basis and stop implying the two sum — e.g.
  show only the basis figure, or label the non-basis figure "not counted this
  period." Add a **`laborBasis` badge** ("Accrued · Time Punches" / "Paid ·
  Bank") next to the "Labor Cost" title, per CLAUDE.md badge scale
  (`text-[11px] px-1.5 py-0.5 rounded-md bg-muted`).
- **Lines ~852-871:** "Pending Payroll" / "Actual Payroll" summary cards each
  compute their own percentage of net revenue (not additive, not miscomputed),
  but their placement implies "these make up the labor cost above." Add a
  one-line caption: "Only <basis> labor counts toward the totals above."

### 2. `src/components/DetailedPnLBreakdown.tsx` (P&L Detail) — REQUIRED UI change
- **Lines 251-276:** the "Labor Costs" node's two children compute
  `percentage = child_value / current.labor_cost * 100`. Post-fix (accrued wins),
  the Pending child renders 100% and the Actual child ~83% → **183% under one
  parent**.
  **Fix:** render only the child matching the active `laborBasis`, computing its
  percentage against **net revenue** (not against the parent). Show the
  non-basis figure without a misleading percentage-of-parent, labeled "not
  included in Labor Cost total this period." Update the child label/copy to match
  the badge language.

### 3. Monthly Breakdown path — REQUIRED (separate, four-layer path)
The Monthly table has its own data lineage: `useMonthlyMetrics` →
`MonthlyBreakdownTable` → `calculateMonthlyPerformance` (`monthlyPerformance.ts`).
`useMonthlyMetrics` builds `pending_labor_cost` from time punches and
`actual_labor_cost` from bank labor — the **same overlapping** accrued/paid pair
as the dashboard — then feeds both into `calculateMonthlyPerformance`, which
sums them (`laborIncludingPendingCents = actualLaborCents + pendingLaborCents`,
line 131). The component renders that sum as the "Labor" headline and shows a
"Projected (incl. pending labor)" profit that subtracts pending labor *on top of*
`actualExpenses` (which already contains paid labor) — a double-count in both the
labor figure and the projected-profit figure.

**Fix (minimal, no feature removal — substitute, don't add):**
- `monthlyPerformance.ts`:
  - add `laborBasis: 'accrued' | 'paid'` (`pendingLaborCents > 0 → 'accrued'`),
    applying the same rule as `resolveLaborBasis` (inlined — this module is
    Deno-targeted and cannot import from `src/lib`; a comment cross-references
    the canonical rule).
  - rename `laborIncludingPendingCents` → `laborForPnlCents` = the **basis**
    labor (`accrued ? pendingLaborCents : actualLaborCents`), never the sum.
    Keep `actualLaborCents` and `pendingLaborCents` exposed for the breakdown.
  - keep `actualExpensesCents` and cash-basis `actualNetProfitCents =
    netRevenue − actualExpenses` unchanged (correct, not double-counted).
  - rename `projectedExpensesCents` → `accrualExpensesCents = actualExpensesCents
    − actualLaborCents + laborForPnlCents` (substitutes basis labor for the
    paid labor already in the ledger; equals `actualExpensesCents` exactly under
    the paid basis). Rename `projectedNetProfitCents` → `accrualNetProfitCents =
    netRevenue − accrualExpensesCents`.
- `MonthlyBreakdownTable.tsx`: read `laborForPnlCents`/`accrualNetProfitCents`;
  delete the unused `laborCostPercent = pendingLaborPercent + actualLaborPercent`
  (dead, and it encodes the double-count); mark the counted line with a small
  basis badge; relabel "Projected (incl. pending labor)" → "Accrual basis
  (matches hours worked)" (still gated on `pendingLaborCost > 0`).
- `useMonthlyMetrics.tsx`: the internal `month.labor_cost` also sums accrued +
  paid. It is display-unused (only gates a `=== 0` availability check and does
  not feed the labor/profit render) and the reconciliation effect compares only
  revenue/discounts/food — never labor — so no visible number depends on it
  today. Still, set the emitted `labor_cost` to the basis value (via the shared
  `resolveLaborBasis`, which this `src/` hook *can* import) so no double-counted
  labor total escapes the hook. The `=== 0` guard is unchanged (basis is 0 iff
  both sources are 0).

Without this whole path fixed, Monthly Breakdown would keep the inflated figure
while the other two screens are corrected — a *new* 2-of-3 inconsistency.

### Confirmed unaffected (frontend review)
`LaborPnlCard.tsx` (separate hook chain), `PnLIntelligenceReport.tsx` (only
charts `labor_cost_percentage` — no split UI), `CashFlowSankeyChart.tsx` (single
`laborCost`), `ScheduleMetricsRibbon.tsx`, `DataInputDialog.tsx` (unrelated
domains). No changes needed.

`usePnLAnalyticsFromSource` reduces `dailyCosts[].labor_cost` and `.total_cost`
for its period totals; making those daily fields respect the basis keeps the
daily sum equal to the period total, so the report matches the dashboard.

## Decided trade-offs (accepted limitations)

- **Timezone bucketing (inherited, documented — not fixed here).** The accrued
  side buckets `punch_time` to a "day worked" using the **browser's** local
  timezone, not the restaurant's (`formatDateUTC` in `laborCalculations.ts` is
  misnamed — it uses local `getFullYear/Month/Date`). Near a period boundary a
  late-night punch can land on the wrong side, making `pendingTotal` read `0`
  for a period that truly has accrued labor and silently flipping the basis to
  `paid`. This is **pre-existing** behavior spanning payroll/scheduling/dashboard
  (same class the repo fixed for scheduling in #647). Not introduced or worsened
  by this fix. **Follow-up:** bucket by restaurant-local timezone consistently
  across payroll/scheduling/dashboard. Tracked as a separate task, not this PR.
- **Mixed-mode and transition-period restaurants.** A restaurant with *some*
  staff on punches but most paid via bank uses the accrued basis and drops bank
  labor (undercount). The same applies more fully to a restaurant that **starts
  using punches mid-period**: any punch coverage sets `pendingTotal > 0` and
  drops bank labor for the whole period, including pre-adoption days with no
  punch coverage. Strictly-positive accrued triggers the accrued basis; there is
  intentionally **no "negligible" threshold**, to keep the decision
  deterministic. Accepted; a threshold and/or telemetry can be a later follow-up.
- **Employer taxes / benefits / payroll-service fees** that appear only in bank
  labor (never in punches) are excluded under the accrued basis. Accepted:
  matching-principle labor % is the goal; a fully-loaded cost view is out of
  scope.

## Testing (TDD)

Unit tests against the pure helpers in `src/lib/combineCosts.ts`:

1. **Failing-first (reproduces the double-count):** given non-zero pending and
   non-zero actual, `totalLabor` equals `pending` — **not** `pending + actual`.
2. **Fallback:** pending total `0`, actual `> 0` → `totalLabor === actual`,
   `laborBasis === 'paid'`.
3. **Daily consistency:** `sum(dailyCosts[].labor_cost) === totalLaborCost`
   under both bases.
4. **Basis resolution:** `resolveLaborBasis` returns `'accrued'` for
   `pendingTotal > 0`, `'paid'` for `0`.
5. **COGS untouched:** food cost totals and daily `food_cost` are unchanged by
   the labor basis.

Unit tests against `monthlyPerformance.ts` (updating the existing
`tests/unit/monthlyPerformance.test.ts`, whose current assertions pin the
double-count and must be rewritten):

6. `laborForPnlCents` equals `pendingLaborCents` when pending > 0 and
   `actualLaborCents` when pending == 0 — never the sum. `laborBasis` reports the
   matching value. Mirrors tests 1-2 to prove the inlined rule matches
   `resolveLaborBasis`.
7. `accrualExpensesCents === actualExpensesCents` exactly under the paid basis
   (pending == 0); under the accrued basis it equals `actualExpensesCents −
   actualLaborCents + pendingLaborCents`. `accrualNetProfitCents === actualNetProfitCents`
   when pending == 0. `otherExpensesCents` stays invariant under `pendingLabor`
   (unchanged from today) and never breaches its zero floor.
8. Update the April-2026 regression fixture assertions to the basis values
   (`laborForPnlCents === 1_652_800` accrued, `accrualNetProfitCents`
   recomputed) so the fixture pins corrected numbers, not the double-count.

Unit test against `useMonthlyMetrics` labor emission:

9. For a month with both punch (accrued) and bank (paid) labor, the emitted
   `labor_cost` equals the basis (accrued) value, not the sum; `=== 0` only when
   both sources are zero.

Component behavior is verified in Phase 5 (UI review) against the three screens;
`laborBasis` badge presence is assertable via role/text if a component test is
added.
