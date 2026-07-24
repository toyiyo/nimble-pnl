# Design: Fix labor double-count in the shared cost model

**Date:** 2026-07-24
**Branch:** `fix/labor-cost-double-count`
**Status:** Approved

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

```
useAccrued   = pendingTotal > 0
totalLabor   = useAccrued ? pendingTotal : actualTotal
dailyLabor[] = useAccrued ? day.pending_labor_cost : day.actual_labor_cost
```

## Architecture / isolation

Extract the cost-combination arithmetic out of the hook into a pure, directly
unit-testable module — **`src/lib/combineCosts.ts`**:

- `resolveLaborBasis(pendingTotal, actualTotal): 'accrued' | 'paid'` — the
  per-period decision. `pendingTotal > 0 → 'accrued'`, else `'paid'`.
- `combineDailyCosts(unifiedDailyCOGS, pendingDaily, actualDaily, basis)` —
  merges COGS + labor by date, using the chosen basis for `labor_cost` and
  `total_cost`. `pending_labor_cost` and `actual_labor_cost` remain populated on
  each row for breakdown display; only `labor_cost` (the field that feeds prime
  cost) respects the basis.

`useCostsFromSource` keeps its three data-fetching hooks and delegates all
arithmetic to these helpers. This isolates the logic that was buggy, makes it
testable without mocking three hooks, and keeps the hook focused on fetching.

### Interface change

`CostsFromSourceResult` gains one field:

```ts
laborBasis: 'accrued' | 'paid';
```

`pendingLaborCost` and `actualLaborCost` stay exposed unchanged (breakdown is
still visible). After the fix, `totalLaborCost === pendingLaborCost` when
`laborBasis === 'accrued'`, and `=== actualLaborCost` when `'paid'` — never the
sum.

## Blast radius

The fix lives entirely in the shared hook + new helper, so **both** consumers
get consistent numbers automatically:

- `usePeriodMetrics` (main dashboard) — reads `totalLaborCost`.
- `usePnLAnalyticsFromSource` (P&L Intelligence report) — reduces
  `dailyCosts[].labor_cost` over days; making the daily field respect the basis
  keeps the daily sum equal to the period total, so the report matches the
  dashboard.

No DB migration, no edge function, no RLS change. UI review: check any component
that renders labor as "pending + actual = total" — after the fix the total is
the basis figure, not the sum. Surface `laborBasis` if a badge helps honesty.

## Decided trade-offs

- **Mixed-mode restaurants** (some staff on punches, most paid via bank) use the
  accrued basis and drop bank labor — this can undercount. Strictly-positive
  accrued triggers the accrued basis; there is intentionally **no "negligible"
  threshold**, to keep the decision deterministic. Accepted as a limitation of
  the user-chosen accrued basis; a threshold can be a later follow-up if needed.
- **Employer taxes / benefits / payroll-service fees** that appear only in bank
  labor (never in punches) are excluded under the accrued basis. Accepted:
  matching-principle labor % is the goal; a fully-loaded cost view is out of
  scope for this fix.

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
5. **COGS untouched:** food cost totals and daily food_cost are unchanged by the
   labor basis.
