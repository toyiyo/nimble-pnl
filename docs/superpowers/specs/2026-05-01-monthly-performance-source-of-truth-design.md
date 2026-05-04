# Monthly Performance — Single Source of Truth

**Date:** 2026-05-01
**Branch:** `fix/monthly-perf-source-of-truth`
**Worktree:** `.claude/worktrees/labor-parity-tips`
**Builds on:** PR #484 (display arithmetic fix in `MonthlyBreakdownTable.tsx`)

## Goal

Eliminate drift between the Monthly Performance summary cards, the Revenue Breakdown panel, the Payroll page, and the Bank Transactions page. Restaurant owners cross-validate by running POS reports, payroll reports, and bank-transaction filters against the dashboard and expect identical numbers. **Drift between sources is the bug.**

After this change, every monthly performance number visible on the dashboard is derived from one shared service. Summary cards and the detail breakdown panel are guaranteed equal by construction. Labor matches the Payroll page. Expenses match a Bank Transactions filter on `account_type='expense'`.

## Non-goals

- Re-categorizing historical sales rows. The dashboard reflects whatever categorization exists in `chart_of_accounts` today.
- Changing how `unified_sales` is ingested from POS systems.
- Backfilling or recomputing closed months. Calculations are read-only and run on demand.

## Validation reference (Russo's Pizzeria, April 2026)

Production data captured 2026-05-01 via Supabase Cloud MCP. Restaurant ID `adbd9392-928a-4a46-80d7-f7e453aa1956`.

| Source | Value |
|---|---|
| `get_monthly_sales_metrics.gross_revenue` | $75,917.82 |
| `get_revenue_by_account` raw sum (cat + uncat) | $75,922.82 |
| Categorized only (food $52,219.60 + alcohol $3,115.00 + bev $3,024.00) | $58,358.60 |
| Uncategorized | $17,564.22 |
| `get_pass_through_totals.discount` | -$1,477.40 |
| `get_pass_through_totals.tax` | $5,974.88 |
| `get_pass_through_totals.tip` | $10,381.78 |
| `get_pass_through_totals.void` (leaks into otherLiabilities today) | -$3,286.25 |
| `time_punches` (clock_in / clock_out events) | 142 / 159 |
| `tip_split_items` via `tip_splits` (April) | 0 rows |
| `daily_labor_allocations` (April) | 0 rows |

The user's prior "expected ranges" (categorizedRevenue=58,359; grossRevenue=74,458; netRevenue=73,019) align with categorized + part of uncategorized. The locked fixture for the acceptance test will be whatever the canonical formula yields against this data.

## Identified bugs

1. **`get_pass_through_totals` returns `'void'`** — `useRevenueBreakdown.tsx:147-149` silently buckets unknown adjustment types into `adjustmentOtherC`. For Russo's April this subtracts $3,286.25 from POS Collected on the breakdown panel.
2. **`get_revenue_by_account` includes one mis-typed discount row** — `item_type='discount'`, `adjustment_type=NULL`, `total_price=+5.00`, categorized to `alcohol_sales`. Adds $5 of false revenue.
3. **`calculateActualLaborCost` has no `tipsOwed` parameter** — Monthly Performance understates labor for any restaurant with tip splits. Latent for Russo's (zero tip_splits in April); active for Toast restaurants in production.
4. **Calendar-month clip at `useMonthlyMetrics:601-602`** — when an ISO week straddles a month boundary, OT bands are computed on a partial week, drifting from Payroll's view.
5. **COGS reimplemented inline** — `useMonthlyMetrics:333-381,571-587` duplicates `useUnifiedCOGS` logic. Risk of silent drift.
6. **Net Profit recomputation in display layer** — fixed in #484 but the table still does its own arithmetic. Single source must own the math.

## Architecture

### Module layout

```
src/services/monthlyPerformance/
├── index.ts          # computeMonthlyPerformance orchestrator
├── revenue.ts        # computeRevenueTotals
├── labor.ts          # computeLaborTotals (OT-D)
├── cogs.ts           # extracted pure function from useUnifiedCOGS
└── expenses.ts       # computeExpenseTotals
```

Both `useMonthlyMetrics` and `useRevenueBreakdown` become thin wrappers around `computeMonthlyPerformance`. The hook layer remains the React-Query integration boundary; the service layer is pure (no React, no React Query) so it can be tested with vitest fixtures.

```
                ┌─────────────────────────────────────┐
                │     monthlyPerformance/index.ts     │
                │      computeMonthlyPerformance      │
                └────┬─────┬───────┬──────────┬───────┘
                     │     │       │          │
                ┌────▼┐ ┌──▼──┐ ┌──▼──┐ ┌─────▼──────┐
                │ rev │ │labor│ │cogs │ │  expenses  │
                └──┬──┘ └──┬──┘ └──┬──┘ └─────┬──────┘
                   │       │      │           │
        ┌──────────▼───┐ ┌─▼────┐ │           │
        │useRevenue    │ │useMnt│ │           │
        │Breakdown     │ │hlyMet│ │           │
        └──────────────┘ └──────┘ │           │
                                  ▼           ▼
                          useUnifiedCOGS  bank txn
                                          queries
```

### Canonical formulas

All arithmetic is integer cents. Conversion to dollars happens once at the service boundary. Use the pattern from the 2026-05-01 lesson for negative values:
```ts
const toC = (n: number) => Math.sign(n) * Math.round(Math.abs(n) * 100);
```

```
categorizedRevenue   = Σ get_revenue_by_account rows where is_categorized=TRUE
                       AND account_type='revenue'
uncategorizedRevenue = Σ get_revenue_by_account rows where is_categorized=FALSE

grossRevenue         = categorizedRevenue + uncategorizedRevenue

discounts            = |get_pass_through_totals.discount|
netRevenue           = grossRevenue − discounts            // NO refunds

salesTax             = get_pass_through_totals.tax
tips                 = get_pass_through_totals.tip
otherLiabilities     = get_pass_through_totals.service_charge
                     + get_pass_through_totals.fee
                     + Σ categorized liability accounts where subtype NOT IN
                       ('sales_tax','tips','payroll_liabilities')
totalCollectedAtPOS  = grossRevenue + salesTax + tips + otherLiabilities

cogs                 = calculateUnifiedCOGS(restaurantId, from, to, settings)

actualLabor          = OT-D wages + tipsOwed              // see Labor section
pendingLabor         = OT-D scheduled minus actualLabor    // see Labor section

otherExpenses        = Σ bank_transactions where chart_of_accounts.account_type='expense'
                       AND account_subtype NOT IN ('cost_of_goods_sold','labor')
                       (everything categorized as an expense that isn't
                       already counted as COGS or labor)
actualExpenses       = cogs + actualLabor + otherExpenses

actualNetProfit                       = netRevenue − actualExpenses
projectedNetProfitIncludingPendingLabor = netRevenue − (actualExpenses + pendingLabor)
```

### Divergences from current production

| | Current | New | Why |
|---|---|---|---|
| Net revenue | gross − discounts − refunds | gross − discounts | Refunds are ~$0 in practice; explicit per spec |
| POS Collected (breakdown) | includes void as negative otherLiabilities | excludes void entirely | Voids cancel sales upstream; not a liability |
| Gross (breakdown) | includes one $5 discount-typed row | excludes by `item_type='sale'` filter | Mis-typed row should not inflate revenue |

## Database migrations

Two migrations tighten existing RPC filters. Both are strictly safer than current behavior — they exclude rows that consumers were silently coercing into wrong buckets.

### Migration A — `get_pass_through_totals` (limits to known types)

```sql
CREATE OR REPLACE FUNCTION public.get_pass_through_totals(
  p_restaurant_id uuid,
  p_date_from date,
  p_date_to date
)
RETURNS TABLE(
  adjustment_type text,
  total_amount numeric,
  transaction_count bigint
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
BEGIN
  RETURN QUERY
  SELECT
    us.adjustment_type::TEXT,
    COALESCE(SUM(us.total_price), 0)::DECIMAL AS total_amount,
    COUNT(*)::BIGINT AS transaction_count
  FROM unified_sales us
  WHERE us.restaurant_id = p_restaurant_id
    AND us.sale_date >= p_date_from
    AND us.sale_date <= p_date_to
    AND us.adjustment_type IN ('tax','tip','service_charge','discount','fee')
  GROUP BY us.adjustment_type;
END;
$function$;
```

Closes the ~$3,286 POS Collected gap on the breakdown panel for Russo's April.

### Migration B — `get_revenue_by_account` (limits to sale rows)

Add `AND us.item_type = 'sale'` to the existing filter so the function returns only true sales. The `+$5` mis-typed discount row drops out of `alcohol_sales`. Closes the $5 gross gap.

Both migrations land with pgTAP tests asserting:
- pre-fix sums (current behavior) for a synthetic dataset that includes a void row and a mis-typed discount row
- post-fix sums match the canonical formulas

## Labor — tipsOwed and OT-D

### tipsOwed source

```sql
SELECT tsi.employee_id, SUM(tsi.amount) AS amount_cents
FROM tip_split_items tsi
JOIN tip_splits ts ON ts.id = tsi.tip_split_id
WHERE ts.restaurant_id = $1
  AND ts.split_date >= $2
  AND ts.split_date <= $3
GROUP BY tsi.employee_id;
```

`restaurant_id` and `split_date` live on the parent `tip_splits` (verified from the schema in the prior session). `tsi.amount` is integer cents. Returned as a Map<employee_id, cents>.

### OT-D algorithm (Hybrid)

```
Input: timepunches[], employees[], dateFrom, dateTo (calendar month edges)

1. Bucket all punches in [dateFrom, dateTo + ε(week-buffer)] by ISO week
   (startOfWeek using WEEK_STARTS_ON from payrollCalculations).
2. For each (employee, ISO week):
   - Run payrollCalculations.calculateEmployeePay over the full ISO week
     to compute regular hours, OT hours, double-time, daily/weekly OT.
   - This is the SAME function the Payroll page uses → identical OT semantics.
3. The function returns dailyCosts: { date, total_cost }[].
4. For each daily cost row:
   - If date.month === current iteration month → add to that month's actualLabor.
   - If date.month !== current month → that day's cost belongs to the
     adjacent month; skip in this pass (it's picked up when iterating
     that month).
5. tipsOwed: per-employee, attributed to ts.split_date's calendar month.
6. actualLabor (month) = Σ dailyCost (month) + Σ tipsOwed (month)
```

Edge cases handled by tests:
- ISO week Mon Apr 27 – Sun May 3: April gets 27-30, May gets 1-3, OT premium computed on the full 7-day week.
- Salaried employees: no OT, prorated by days-in-month.
- Contractor: no OT, daily_rate sums.
- Single shift crossing midnight: punch_time-based attribution to the day the shift ends (matches existing `calculateEmployeeDailyCostForDate`).

### pendingLabor

For the in-progress month: pendingLabor = (OT-D total over `[scheduledShifts where date > today]`) using the same OT-D algorithm. Past months: pendingLabor = 0.

## Test plan

### vitest unit tests
- `tests/unit/monthlyPerformance/revenue.test.ts` — fixture per RPC return shape (no DB), confirms formula correctness, void exclusion, +$5 row exclusion.
- `tests/unit/monthlyPerformance/labor.test.ts` — OT-D edge cases (week straddling month, tipsOwed attribution by `split_date`, salaried, contractor, midnight crossing).
- `tests/unit/monthlyPerformance/cogs.test.ts` — inventory / financials / combined methods, parity with `useUnifiedCOGS`.
- `tests/unit/monthlyPerformance/expenses.test.ts` — derived `otherExpenses` vs synthetic bank txns.
- `tests/unit/monthlyPerformance/index.test.ts` — Russo's April 2026 acceptance fixture (locked numbers from production).
- `tests/unit/MonthlyBreakdownTable.test.tsx` — keep #484's pinned tests, update to consume the new fields.

### pgTAP database tests
- `supabase/tests/get_pass_through_totals.sql` — synthetic dataset with one void row, asserts post-fix excludes it.
- `supabase/tests/get_revenue_by_account.sql` — synthetic dataset with one `item_type='discount'` mis-typed row, asserts post-fix excludes it.

### Acceptance test
The Russo's April fixture in `index.test.ts` runs the full canonical formula against a snapshotted dataset and asserts each number to the cent. After the canonical formula is implemented, the locked fixture is whatever it yields. If that materially diverges from the user's expected ranges, the discrepancy is documented in the test file and reviewed before merge.

## Out of scope (explicit)

- Reconciliation UI surfacing source-data ambiguity (e.g. "this $X is from uncategorized sales, click to categorize"). Tracked as a follow-up.
- Service-charge handling beyond pass-through. Restaurants with categorized service-charge accounts will have those folded into `otherLiabilities`; that's correct but unverified across all customer data.
- Refund handling. Today refunds are tracked separately on the breakdown panel; we drop them from the formula to match the spec. If refunds become non-trivial we'll re-introduce them.

## Risks

- **Behavioral change for restaurants we haven't tested against Russo's.** Mitigation: run the new service against the top 10 restaurants by April revenue and diff against current dashboard before merge.
- **OT-D could shift labor numbers backward in time** for any month that ended with an open ISO week. Mitigation: documented divergence in the test file; user education in the PR description.
- **Migrations to RPCs are seen by all features that consume them.** Mitigation: the only callers are the two hooks we control; pgTAP tests pin behavior.

## Sequence

1. RPC migrations + pgTAP tests
2. Pure functions: revenue → labor → cogs → expenses → orchestrator
3. Refactor `useMonthlyMetrics` and `useRevenueBreakdown` to consume the service
4. Update `MonthlyBreakdownTable` consumers to read `actualNetProfit`/`projectedNetProfitIncludingPendingLabor` directly
5. Lock acceptance fixture
6. Local CodeRabbit, verify, ship
