# Monthly Performance Calculations — Design

**Date:** 2026-05-01
**Branch:** `fix/monthly-performance-calculations`
**Type:** Bug fix + correctness hardening
**Owner:** Jose Delgado

## Problem

The Monthly Performance card on the dashboard mixes three independent calculation paths and produces values that disagree with the detail breakdown for the same month. Reported by the user for April 2026:

| Field                | Summary card | Detail breakdown | Diff      |
|----------------------|--------------|------------------|-----------|
| Gross Revenue        | $74,453      | $74,458          | -$5       |
| Net Revenue          | $73,014      | $73,019          | -$5       |
| Total Collected POS  | $90,475      | $87,332          | +$3,143   |
| Net Profit           | -$54,735     | (recomputed)     | mislabel  |

"Net Profit" silently includes pending labor while expenses are described as "from Bank Transactions" — owners can't tell whether a number reflects what posted vs what's projected.

## Root causes (verified in code)

### 1. Inconsistent revenue computation

* **Summary** uses `get_monthly_sales_metrics` RPC (`supabase/migrations/20251202100000_aggregate_monthly_metrics.sql`). Its `monthly_revenue` CTE sums **every** row where `adjustment_type IS NULL AND item_type = 'sale'`, regardless of which chart-of-accounts the sale is mapped to.
* **Breakdown** uses `useRevenueBreakdown.tsx` which classifies categorized sales by `account_type`, filters out revenue accounts whose names contain `tax/discount/comp/refund`, and only counts uncategorized sales when `item_type = 'sale'`.

Sales mapped to a liability account (e.g. a "Sales Tax" line item from the POS that was categorized to the sales-tax-payable account) appear in `monthly_revenue` (counted as gross) **and** in `monthly_categorized_liabilities` (counted as `sales_tax`). Result: gross is inflated by those amounts and `total_collected_at_pos = gross + tax + tips + other` double-counts them.

### 2. Mixed actual / projected expense rendering

`MonthlyBreakdownTable.tsx` (lines 219-226):

```ts
const pendingLaborCost = month.pending_labor_cost;            // from useMonthlyMetrics (time punches)
const actualLaborCost  = expenseMonth?.laborCost ?? month.actual_labor_cost; // from useMonthlyExpenses (bank txns)
const laborCost        = pendingLaborCost + actualLaborCost;
const totalExpenses    = expenseMonth ? expenseMonth.totalExpenses + pendingLaborCost : ...;
const otherExpenses    = Math.max(0, totalExpenses - foodCost - laborCost);
```

The "Net Profit" column then renders `netRevenue - totalExpenses` — a hybrid of bank-posted (most expenses) and time-punch-projected (pending labor) values, presented as if it were a single number.

### 3. No POS reconciliation surface

When `useMonthlyMetrics.total_collected_at_pos` and `useRevenueBreakdown.totals.total_collected_at_pos` disagree, the difference is invisible. The user simply sees two different big blue numbers in two places.

## Goals

1. **Single source of truth** for every monthly number that appears on the dashboard.
2. **Decimal-safe arithmetic.** All money math in integer cents, dollars only at the formatter boundary.
3. **Clear actual vs projected separation.** "Actual Net Profit" and "Projected Net Profit (incl. pending labor)" are distinct, labeled values; "Net Profit" without qualifier is forbidden when pending labor is included.
4. **Auditable reconciliation.** When an external POS-reported total is available and disagrees with the breakdown's revenue + pass-through total, surface the delta.
5. **Regression tests** anchored on the April 2026 fixture so the same numbers are computed by summary and breakdown forever.

## Non-goals

- Refactoring `useRevenueBreakdown` or its RPC (it's the source we trust).
- Changing how labor is calculated from time punches (covered by other modules).
- Changing the chart-of-accounts UX or category-mapping rules.

## Design

### A. New shared module: `supabase/functions/_shared/monthlyPerformance.ts`

Pure-function module mirroring the pattern of `_shared/periodMetrics.ts`. No I/O — takes already-fetched per-month data, returns derived metrics in cents.

```ts
export interface MonthlyPerformanceInput {
  /** Revenue numbers from useRevenueBreakdown.totals (dollars). The breakdown
   *  is the canonical source — its filtering rules win. */
  revenue: {
    grossRevenue: number;
    discounts: number;
    netRevenue: number;
    salesTax: number;
    tips: number;
    otherLiabilities: number;
    totalCollectedAtPos: number; // grossRevenue + salesTax + tips + otherLiabilities
  };
  /** Expense aggregates from useMonthlyExpenses for the same month (dollars).
   *  IMPORTANT: these are bank-posted totals only. Pending labor is supplied
   *  separately below and is added downstream into `projectedExpensesCents`. */
  expenses: {
    totalExpenses: number;       // sum of all bank-posted outflows (no pending)
    foodCost: number;            // detected via isFoodCostSubtype
    actualLaborCost: number;     // detected via isLaborSubtype (incl. payroll taxes)
  };
  /** Pending labor from time punches not yet posted as a bank transaction (dollars). */
  pendingLabor: number;
  /** Optional external "POS reported" total (dollars). When provided and ≠ POS-from-breakdown,
   *  the delta is exposed as posReconciliationDelta. */
  posReportedTotal?: number | null;
}

export interface MonthlyPerformanceResult {
  // Revenue (cents)
  grossRevenueCents: number;
  discountsCents: number;
  netRevenueCents: number;

  // Pass-through (cents)
  salesTaxCents: number;
  tipsCents: number;
  otherLiabilitiesCents: number;
  passThroughTotalCents: number;

  // POS (cents)
  posCollectedFromBreakdownCents: number; // grossRevenue + passThroughTotal
  posReportedCents: number | null;
  posReconciliationDeltaCents: number | null; // posReported - posFromBreakdown when both present

  // Costs (cents)
  cogsCents: number;
  actualLaborCents: number;
  pendingLaborCents: number;
  laborIncludingPendingCents: number;
  otherExpensesCents: number;     // max(0, actualExpenses - cogs - actualLabor); floors at 0
  actualExpensesCents: number;    // expenses.totalExpenses
  projectedExpensesCents: number; // actualExpenses + pendingLabor

  // Profit (cents)
  actualNetProfitCents: number;       // netRevenue - actualExpenses
  projectedNetProfitCents: number;    // netRevenue - projectedExpenses
}

export function calculateMonthlyPerformance(input: MonthlyPerformanceInput): MonthlyPerformanceResult;
```

**Money helpers** are colocated as small private functions (`toCents(d) = Math.round(d * 100)`, `add`, `sub`). Caller is responsible for `cents / 100` for display.

### B. RPC fix: `get_monthly_sales_metrics`

New migration `2026XXXXXXXXXX_fix_monthly_sales_metrics_revenue_filter.sql` that **replaces** the `monthly_revenue` CTE so it excludes sales whose `chart_of_accounts.account_type` is `liability`. The classification now matches the breakdown:

```sql
WITH monthly_revenue AS (
  SELECT
    TO_CHAR(us.sale_date, 'YYYY-MM') AS month_period,
    COALESCE(SUM(us.total_price), 0)::DECIMAL AS amount
  FROM unified_sales us
  LEFT JOIN chart_of_accounts coa ON us.category_id = coa.id
  WHERE us.restaurant_id = p_restaurant_id
    AND us.sale_date BETWEEN p_date_from AND p_date_to
    AND us.adjustment_type IS NULL
    AND LOWER(COALESCE(us.item_type, 'sale')) = 'sale'
    -- NEW: exclude liability-categorized sales (they're accounted in the
    -- monthly_categorized_liabilities CTE; counting them in revenue too
    -- caused gross/POS double-counting)
    AND (coa.account_type IS NULL OR coa.account_type = 'revenue')
    AND NOT EXISTS (
      SELECT 1 FROM unified_sales child WHERE child.parent_sale_id = us.id
    )
  GROUP BY TO_CHAR(us.sale_date, 'YYYY-MM')
)
```

The migration is idempotent (`CREATE OR REPLACE FUNCTION`). Tests live in `supabase/tests/get_monthly_sales_metrics.test.sql` (pgTAP) and assert that a fixture mapping a sale to a liability account no longer inflates `gross_revenue`.

### C. Hook updates

**`useMonthlyMetrics.tsx`** — keep as the per-month aggregator (it already produces the per-month rollup we need). The RPC fix above closes the bulk of the discrepancy. We do **not** introduce a second roundtrip per month for the breakdown — `useMonthlyMetrics` already produces `gross_revenue / discounts / net_revenue / sales_tax / tips / other_liabilities` per month, and after the RPC fix those values now equal the breakdown's totals.

We expose the existing `actual_labor_cost` and `pending_labor_cost` unchanged.

**No new fetches.** The reconciliation surface uses existing data.

### D. UI changes in `MonthlyBreakdownTable.tsx`

Replace the per-row inline math with a single call to `calculateMonthlyPerformance(...)` per visible month, using:

- `revenue` ← from the existing `monthlyData[i]` (it'll match breakdown after the RPC fix)
- `expenses` ← from `useMonthlyExpenses`
- `pendingLabor` ← `monthlyData[i].pending_labor_cost`
- `posReportedTotal` ← `monthlyData[i].total_collected_at_pos` only when it's known to come from a different source than revenue+pass-through. After the unify (option A), this is `null` by default and the reconciliation row stays hidden unless explicitly fed an external total.

Column changes:

- **Net Profit** column splits into stacked "Actual" + "Projected (incl. pending)" values. If `pendingLabor === 0`, only one row renders (no projected line) so the visual stays clean.
- **Other Expenses** uses `actualExpenses - cogs - actualLabor` (so it represents only posted bank-transaction expenses outside cogs/labor — no pending-labor mixing).
- **POS Reconciliation** mini-row (inside the expanded detail) only renders when `posReconciliationDeltaCents !== null && posReconciliationDeltaCents !== 0`.

Apple/Notion styling remains: stacked values use the existing Labor pattern (`flex-col items-end gap-0.5 sm:gap-1` + `text-[10px]` secondary line). No direct color tokens; uses `text-primary` for positive profit, `text-destructive` for negative, `text-muted-foreground` / `text-amber-600` for pending labels (matches the existing Labor cell styling already in the file).

### E. Tests

**Unit tests** in `tests/unit/monthlyPerformance.test.ts`:

1. **April 2026 fixture** — a single test that builds the exact input from the task and asserts every field of the result matches:
   - grossRevenueCents = 7445800¢ ($74,458.00)
   - discountsCents = 143900¢ ($1,439.00)
   - netRevenueCents = 7301900¢ ($73,019.00)
   - cogsCents = 2556200¢ ($25,562.00)
   - actualLaborCents = 3295900¢ ($32,959.00)
   - pendingLaborCents = 1652800¢ ($16,528.00)
   - laborIncludingPendingCents = 4948700¢ ($49,487.00)
   - actualExpensesCents = 11122000¢ ($111,220.00)
   - projectedExpensesCents = 12774800¢ ($127,748.00)
   - otherExpensesCents = 5269900¢ ($52,699.00)
   - actualNetProfitCents = -3820100¢ (-$38,201.00)
   - projectedNetProfitCents = -5472900¢ (-$54,729.00)
   (The breakdown's `categorizedRevenue` of $58,359.00 is verified separately by `useRevenueBreakdown` tests; this module receives `grossRevenue` already aggregated.)
2. **Revenue category summation** — gross = sum of categorized + uncategorized.
3. **Discounts deduction** — net = gross - discounts.
4. **COGS pass-through** — `expenses.foodCost` lands as `cogsCents`.
5. **Actual labor pass-through** — `expenses.actualLaborCost` lands as `actualLaborCents` (the input from `useMonthlyExpenses` already includes wage subtypes + payroll taxes via `isLaborSubtype`).
6. **Pending labor handling** — when `pendingLabor === 0`, `projectedNetProfit === actualNetProfit`.
7. **Other expenses isolation** — does NOT include pending labor; equals `actualExpenses - cogs - actualLabor`; floors at 0 when subtraction would go negative due to rounding.
8. **POS reconciliation** — when `posReportedTotal === null`, delta is `null`; when provided and equal, delta is 0; when provided and different, delta is signed.
9. **Decimal safety** — input values like `$0.01` round-trip without floating-point drift (e.g., 100 inputs of $0.01 sum to exactly $1.00, not $1.0000000000000007).
10. **Idempotence** — calling the function twice with the same input returns identical results (no hidden state).

**Regression test** in `tests/unit/monthlyBreakdownTable.test.tsx`:

- Render the component with monthlyData + expenseData fixture; assert the displayed gross-revenue cell matches the breakdown's gross-revenue cell for the same month (single source proof).
- Assert "Projected" label is rendered when pending labor > 0 and is absent when pending labor === 0.

**pgTAP test** in `supabase/tests/get_monthly_sales_metrics.test.sql`:

- Insert a fixture with one revenue-categorized sale ($100) and one liability-categorized sale ($10 sales-tax-payable) in the same month; assert `gross_revenue = 100` (not 110) and `sales_tax = 10`.

## Files to change

| File | Change |
|---|---|
| `supabase/functions/_shared/monthlyPerformance.ts` | **NEW** pure-function module |
| `supabase/migrations/<timestamp>_fix_monthly_sales_metrics_revenue_filter.sql` | **NEW** migration (timestamp generated at create time) replacing `get_monthly_sales_metrics` |
| `supabase/tests/get_monthly_sales_metrics.test.sql` | **NEW** pgTAP test for RPC fix |
| `src/hooks/useMonthlyMetrics.tsx` | re-export the new shared types so consumers stay typed |
| `src/components/MonthlyBreakdownTable.tsx` | replace inline math with `calculateMonthlyPerformance`; split profit column; render reconciliation row when relevant |
| `tests/unit/monthlyPerformance.test.ts` | **NEW** unit tests (April 2026 fixture + edge cases) |
| `tests/unit/monthlyBreakdownTable.test.tsx` | **NEW** regression test for single-source rendering |

## Open questions / known unresolved ambiguity

- **The historic $90,475 vs $87,332 POS difference**: After the RPC fix, the summary's POS total will equal the breakdown's POS total (~$87,332 for April, give or take cent-level rounding). The original $90,475 number includes the double-counted liability-categorized sales; once the RPC stops double-counting, that number disappears. **No external POS-reported total is wired up today**, so the reconciliation row will be hidden by default — it's available for a future feature that ingests a true POS gross-receipts number for cross-check.
- Cent-level deltas vs the user-reported numbers (e.g., `-$54,729` vs displayed `-$54,735`) come from sub-cent source data and are not reconcilable from the totals alone. The fixture asserts the integer-cent results computed from the rounded-dollar inputs the user supplied; live data may show ±$1-$10 from sub-cent rounding in the underlying transactions, which is below user-visible precision.

## Phasing

1. Write tests for the new module (RED).
2. Implement `_shared/monthlyPerformance.ts` (GREEN).
3. Write the RPC fix migration + pgTAP test (RED then GREEN).
4. Wire `MonthlyBreakdownTable.tsx` through the new module; add reconciliation row.
5. Add the regression test for the table.
6. Run full suite, fix any drift in adjacent tests.
