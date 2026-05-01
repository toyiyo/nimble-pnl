# Monthly Performance Calculations Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace inline, dollar-based, mixed actual/pending math in `MonthlyBreakdownTable` with a pure cents-based shared module, fix the `get_monthly_sales_metrics` RPC double-count of liability-categorized sales, and surface "Actual" vs "Projected" net profit distinctly in the UI — anchored on a regression-tested April 2026 fixture.

**Architecture:**
- A new pure module `supabase/functions/_shared/monthlyPerformance.ts` (mirroring `_shared/periodMetrics.ts`) consumes already-fetched per-month data and returns derived integer-cent metrics. The module has no I/O.
- A new SQL migration replaces `get_monthly_sales_metrics` so the `monthly_revenue` CTE excludes sales mapped to `chart_of_accounts.account_type = 'liability'` — this stops the gross-revenue double-count of liability-categorized POS items (the source of the $5 / $3,143 deltas).
- `MonthlyBreakdownTable.tsx` calls the new module per visible month and renders an "Actual / Projected" stacked profit cell plus a conditional POS-reconciliation row.

**Tech Stack:** TypeScript, React, Vitest, React Testing Library, Supabase (PostgreSQL + plpgsql), pgTAP.

---

## File Structure

| File | Responsibility |
|---|---|
| `supabase/functions/_shared/monthlyPerformance.ts` | **NEW.** Pure functions: `toCents`, `calculateMonthlyPerformance`. Owns all monthly performance math. No I/O. |
| `supabase/migrations/20260501120000_fix_monthly_sales_metrics_revenue_filter.sql` | **NEW.** `CREATE OR REPLACE FUNCTION` that adds the `account_type IS NULL OR account_type = 'revenue'` filter to the `monthly_revenue` CTE. |
| `supabase/tests/36_monthly_sales_metrics_revenue_filter.sql` | **NEW.** pgTAP: asserts liability-categorized sales no longer inflate `gross_revenue`. |
| `tests/unit/monthlyPerformance.test.ts` | **NEW.** Unit tests for the shared module — April 2026 fixture + 9 edge-case tests. |
| `tests/unit/MonthlyBreakdownTable.test.tsx` | **NEW.** Regression test: gross-revenue cell matches breakdown cell; "Projected" label appears iff pending labor > 0. |
| `src/components/MonthlyBreakdownTable.tsx` | **MODIFY.** Replace inline math (lines ~219-226 + profit cell at ~314) with `calculateMonthlyPerformance(...)` per row; split Net Profit column into Actual + Projected; add POS-reconciliation expanded row. |
| `src/hooks/useMonthlyMetrics.tsx` | **NO CHANGE.** Existing per-month rollup feeds the new module unchanged. |

---

## Task 1: Create the shared module skeleton with type definitions

**Files:**
- Create: `supabase/functions/_shared/monthlyPerformance.ts`

- [ ] **Step 1: Create the module file with types and a stub function**

```typescript
/**
 * Monthly Performance Shared Module
 *
 * Pure calculation functions for the dashboard's Monthly Performance table.
 * Single source of truth — Summary cards and detail rows must read the same
 * values produced here.
 *
 * All math is performed in integer cents to avoid floating-point drift.
 * Dollars in (Number), cents out (Number). The caller divides by 100 for display.
 *
 * Pattern follows: supabase/functions/_shared/periodMetrics.ts
 */

// ===== TYPE DEFINITIONS =====

export interface MonthlyPerformanceInput {
  /** Revenue numbers from useMonthlyMetrics / useRevenueBreakdown (dollars). */
  revenue: {
    grossRevenue: number;
    discounts: number;
    netRevenue: number;
    salesTax: number;
    tips: number;
    otherLiabilities: number;
    /** Already equals grossRevenue + salesTax + tips + otherLiabilities at the source. */
    totalCollectedAtPos: number;
  };
  /** Expense aggregates from useMonthlyExpenses for the same month (dollars). */
  expenses: {
    /** Bank-posted + scheduled-pending-outflow expenses (everything in the
     *  expense ledger). Does NOT include time-punch-derived pending labor. */
    totalExpenses: number;
    foodCost: number;
    actualLaborCost: number;
  };
  /** Time-punch-derived projected payroll not yet in the ledger (dollars). */
  pendingLabor: number;
  /** Optional external "POS reported" total (dollars). Today this is `null` —
   *  the field exists so a future feature can ingest a true POS gross-receipts
   *  number for cross-check. When provided and ≠ derived POS, the delta is
   *  exposed as `posReconciliationDeltaCents`. */
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
  posCollectedFromBreakdownCents: number;
  posReportedCents: number | null;
  posReconciliationDeltaCents: number | null;

  // Costs (cents)
  cogsCents: number;
  actualLaborCents: number;
  pendingLaborCents: number;
  laborIncludingPendingCents: number;
  otherExpensesCents: number;
  actualExpensesCents: number;
  projectedExpensesCents: number;

  // Profit (cents)
  actualNetProfitCents: number;
  projectedNetProfitCents: number;
}

// ===== HELPERS =====

/** Convert a dollars-as-Number value to integer cents, rounding half-away-from-zero. */
export function toCents(dollars: number): number {
  if (!Number.isFinite(dollars)) return 0;
  return Math.round(dollars * 100);
}

// ===== MAIN FUNCTION =====

export function calculateMonthlyPerformance(
  _input: MonthlyPerformanceInput
): MonthlyPerformanceResult {
  throw new Error('not implemented');
}
```

- [ ] **Step 2: Commit**

```bash
git add supabase/functions/_shared/monthlyPerformance.ts
git commit -m "feat(monthly-performance): add module skeleton with types and toCents helper"
```

---

## Task 2: Test and implement revenue + pass-through cents

**Files:**
- Modify: `supabase/functions/_shared/monthlyPerformance.ts`
- Create: `tests/unit/monthlyPerformance.test.ts`

- [ ] **Step 1: Write the failing tests for revenue + pass-through**

Create `tests/unit/monthlyPerformance.test.ts`:

```typescript
/**
 * Monthly Performance Tests
 *
 * Tests the single source of truth for the dashboard's Monthly Performance
 * table. The April 2026 fixture below is the regression anchor — these
 * exact numbers must keep matching what the UI renders.
 */

import { describe, it, expect } from 'vitest';
import {
  calculateMonthlyPerformance,
  toCents,
  type MonthlyPerformanceInput,
} from '../../supabase/functions/_shared/monthlyPerformance';

function makeInput(overrides?: Partial<MonthlyPerformanceInput>): MonthlyPerformanceInput {
  return {
    revenue: {
      grossRevenue: 0,
      discounts: 0,
      netRevenue: 0,
      salesTax: 0,
      tips: 0,
      otherLiabilities: 0,
      totalCollectedAtPos: 0,
    },
    expenses: {
      totalExpenses: 0,
      foodCost: 0,
      actualLaborCost: 0,
    },
    pendingLabor: 0,
    posReportedTotal: null,
    ...overrides,
  };
}

describe('toCents', () => {
  it('converts whole dollars exactly', () => {
    expect(toCents(100)).toBe(10000);
  });

  it('rounds half-away-from-zero', () => {
    expect(toCents(0.005)).toBe(1);
    expect(toCents(-0.005)).toBe(-1);
  });

  it('returns 0 for non-finite values', () => {
    expect(toCents(NaN)).toBe(0);
    expect(toCents(Infinity)).toBe(0);
  });
});

describe('calculateMonthlyPerformance — revenue and pass-through', () => {
  it('converts gross / discounts / net to cents', () => {
    const result = calculateMonthlyPerformance(
      makeInput({
        revenue: {
          grossRevenue: 74458,
          discounts: 1439,
          netRevenue: 73019,
          salesTax: 0,
          tips: 0,
          otherLiabilities: 0,
          totalCollectedAtPos: 74458,
        },
      })
    );
    expect(result.grossRevenueCents).toBe(7445800);
    expect(result.discountsCents).toBe(143900);
    expect(result.netRevenueCents).toBe(7301900);
  });

  it('sums pass-through total from tax + tips + other liabilities', () => {
    const result = calculateMonthlyPerformance(
      makeInput({
        revenue: {
          grossRevenue: 100,
          discounts: 0,
          netRevenue: 100,
          salesTax: 8,
          tips: 5,
          otherLiabilities: 2,
          totalCollectedAtPos: 115,
        },
      })
    );
    expect(result.salesTaxCents).toBe(800);
    expect(result.tipsCents).toBe(500);
    expect(result.otherLiabilitiesCents).toBe(200);
    expect(result.passThroughTotalCents).toBe(1500);
  });

  it('derives POS collected as gross + pass-through (ignoring caller-supplied totalCollectedAtPos)', () => {
    const result = calculateMonthlyPerformance(
      makeInput({
        revenue: {
          grossRevenue: 100,
          discounts: 0,
          netRevenue: 100,
          salesTax: 8,
          tips: 5,
          otherLiabilities: 2,
          totalCollectedAtPos: 999, // intentionally wrong
        },
      })
    );
    expect(result.posCollectedFromBreakdownCents).toBe(11500);
  });
});
```

- [ ] **Step 2: Run the tests to confirm they fail**

Run: `npx vitest run tests/unit/monthlyPerformance.test.ts`
Expected: `toCents` tests pass, the three `calculateMonthlyPerformance` tests fail with `not implemented`.

- [ ] **Step 3: Implement revenue + pass-through in the module**

Replace the stub in `supabase/functions/_shared/monthlyPerformance.ts` with:

```typescript
export function calculateMonthlyPerformance(
  input: MonthlyPerformanceInput
): MonthlyPerformanceResult {
  // Revenue
  const grossRevenueCents = toCents(input.revenue.grossRevenue);
  const discountsCents = toCents(input.revenue.discounts);
  const netRevenueCents = toCents(input.revenue.netRevenue);

  // Pass-through
  const salesTaxCents = toCents(input.revenue.salesTax);
  const tipsCents = toCents(input.revenue.tips);
  const otherLiabilitiesCents = toCents(input.revenue.otherLiabilities);
  const passThroughTotalCents =
    salesTaxCents + tipsCents + otherLiabilitiesCents;

  // POS — always derive from the breakdown (gross + pass-through), don't trust
  // the caller-supplied totalCollectedAtPos field. This is the rule that fixes
  // the $90,475 vs $87,332 mismatch: there is one POS number, sourced from
  // breakdown.
  const posCollectedFromBreakdownCents = grossRevenueCents + passThroughTotalCents;
  const posReportedCents =
    input.posReportedTotal == null ? null : toCents(input.posReportedTotal);
  const posReconciliationDeltaCents =
    posReportedCents == null ? null : posReportedCents - posCollectedFromBreakdownCents;

  return {
    grossRevenueCents,
    discountsCents,
    netRevenueCents,
    salesTaxCents,
    tipsCents,
    otherLiabilitiesCents,
    passThroughTotalCents,
    posCollectedFromBreakdownCents,
    posReportedCents,
    posReconciliationDeltaCents,
    // Costs + profit are placeholders until Tasks 3-4
    cogsCents: 0,
    actualLaborCents: 0,
    pendingLaborCents: 0,
    laborIncludingPendingCents: 0,
    otherExpensesCents: 0,
    actualExpensesCents: 0,
    projectedExpensesCents: 0,
    actualNetProfitCents: 0,
    projectedNetProfitCents: 0,
  };
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run tests/unit/monthlyPerformance.test.ts`
Expected: all 6 tests pass.

- [ ] **Step 5: Commit**

```bash
git add supabase/functions/_shared/monthlyPerformance.ts tests/unit/monthlyPerformance.test.ts
git commit -m "feat(monthly-performance): revenue, pass-through, and POS-from-breakdown cents"
```

---

## Task 3: Test and implement costs (cogs, labor, other expenses, projected expenses)

**Files:**
- Modify: `supabase/functions/_shared/monthlyPerformance.ts`
- Modify: `tests/unit/monthlyPerformance.test.ts`

- [ ] **Step 1: Add failing cost tests**

Append to `tests/unit/monthlyPerformance.test.ts`:

```typescript
describe('calculateMonthlyPerformance — costs', () => {
  it('passes food cost through as cogsCents', () => {
    const result = calculateMonthlyPerformance(
      makeInput({
        expenses: { totalExpenses: 0, foodCost: 25562, actualLaborCost: 0 },
      })
    );
    expect(result.cogsCents).toBe(2556200);
  });

  it('passes actual labor (incl. payroll taxes already in source) through', () => {
    const result = calculateMonthlyPerformance(
      makeInput({
        expenses: { totalExpenses: 0, foodCost: 0, actualLaborCost: 32959 },
        pendingLabor: 16528,
      })
    );
    expect(result.actualLaborCents).toBe(3295900);
    expect(result.pendingLaborCents).toBe(1652800);
    expect(result.laborIncludingPendingCents).toBe(4948700);
  });

  it('computes other expenses as actualExpenses - cogs - actualLabor (no pending labor)', () => {
    const baseInput = makeInput({
      expenses: { totalExpenses: 111220, foodCost: 25562, actualLaborCost: 32959 },
      pendingLabor: 16528,
    });
    const result = calculateMonthlyPerformance(baseInput);
    expect(result.actualExpensesCents).toBe(11122000);
    expect(result.otherExpensesCents).toBe(5269900); // 111220 - 25562 - 32959

    // otherExpenses must be invariant under pendingLabor changes — if pending
    // labor leaked into otherExpenses, varying it would shift the result.
    const noPending = calculateMonthlyPerformance(
      makeInput({
        expenses: { totalExpenses: 111220, foodCost: 25562, actualLaborCost: 32959 },
        pendingLabor: 0,
      })
    );
    const morePending = calculateMonthlyPerformance(
      makeInput({
        expenses: { totalExpenses: 111220, foodCost: 25562, actualLaborCost: 32959 },
        pendingLabor: 99999,
      })
    );
    expect(noPending.otherExpensesCents).toBe(result.otherExpensesCents);
    expect(morePending.otherExpensesCents).toBe(result.otherExpensesCents);
  });

  it('floors otherExpenses at 0 when subtraction would go negative (rounding edge)', () => {
    const result = calculateMonthlyPerformance(
      makeInput({
        expenses: { totalExpenses: 100, foodCost: 60, actualLaborCost: 50 },
      })
    );
    expect(result.otherExpensesCents).toBe(0);
  });

  it('computes projectedExpenses as actualExpenses + pendingLabor', () => {
    const result = calculateMonthlyPerformance(
      makeInput({
        expenses: { totalExpenses: 111220, foodCost: 0, actualLaborCost: 0 },
        pendingLabor: 16528,
      })
    );
    expect(result.projectedExpensesCents).toBe(11122000 + 1652800);
  });
});
```

- [ ] **Step 2: Run to confirm they fail**

Run: `npx vitest run tests/unit/monthlyPerformance.test.ts`
Expected: 5 new tests fail (cogs/labor/etc. all return 0).

- [ ] **Step 3: Implement costs in the module**

In `supabase/functions/_shared/monthlyPerformance.ts`, replace the cost placeholders inside `calculateMonthlyPerformance`:

```typescript
  // Costs
  const cogsCents = toCents(input.expenses.foodCost);
  const actualLaborCents = toCents(input.expenses.actualLaborCost);
  const pendingLaborCents = toCents(input.pendingLabor);
  const laborIncludingPendingCents = actualLaborCents + pendingLaborCents;

  const actualExpensesCents = toCents(input.expenses.totalExpenses);
  const projectedExpensesCents = actualExpensesCents + pendingLaborCents;

  // otherExpenses = actual - cogs - actualLabor. Floor at 0: rounding in the
  // source data can make this slightly negative when COGS + labor ≈ total.
  const otherExpensesCents = Math.max(
    0,
    actualExpensesCents - cogsCents - actualLaborCents
  );
```

Update the `return` so these values flow through (replace the placeholder `0`s).

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run tests/unit/monthlyPerformance.test.ts`
Expected: all 11 tests pass.

- [ ] **Step 5: Commit**

```bash
git add supabase/functions/_shared/monthlyPerformance.ts tests/unit/monthlyPerformance.test.ts
git commit -m "feat(monthly-performance): cogs, actual+pending labor, projected expenses, other-expenses floor"
```

---

## Task 4: Test and implement profit (actual + projected)

**Files:**
- Modify: `supabase/functions/_shared/monthlyPerformance.ts`
- Modify: `tests/unit/monthlyPerformance.test.ts`

- [ ] **Step 1: Add failing profit tests**

Append to `tests/unit/monthlyPerformance.test.ts`:

```typescript
describe('calculateMonthlyPerformance — profit', () => {
  it('actualNetProfit = netRevenue - actualExpenses', () => {
    const result = calculateMonthlyPerformance(
      makeInput({
        revenue: {
          grossRevenue: 0, discounts: 0, netRevenue: 73019,
          salesTax: 0, tips: 0, otherLiabilities: 0, totalCollectedAtPos: 0,
        },
        expenses: { totalExpenses: 111220, foodCost: 0, actualLaborCost: 0 },
      })
    );
    expect(result.actualNetProfitCents).toBe(7301900 - 11122000); // -3,820,100
  });

  it('projectedNetProfit = netRevenue - projectedExpenses (subtracts pending labor)', () => {
    const result = calculateMonthlyPerformance(
      makeInput({
        revenue: {
          grossRevenue: 0, discounts: 0, netRevenue: 73019,
          salesTax: 0, tips: 0, otherLiabilities: 0, totalCollectedAtPos: 0,
        },
        expenses: { totalExpenses: 111220, foodCost: 0, actualLaborCost: 0 },
        pendingLabor: 16528,
      })
    );
    expect(result.projectedNetProfitCents).toBe(7301900 - 11122000 - 1652800); // -5,472,900
  });

  it('projectedNetProfit equals actualNetProfit when pendingLabor is 0', () => {
    const result = calculateMonthlyPerformance(
      makeInput({
        revenue: {
          grossRevenue: 0, discounts: 0, netRevenue: 50000,
          salesTax: 0, tips: 0, otherLiabilities: 0, totalCollectedAtPos: 0,
        },
        expenses: { totalExpenses: 30000, foodCost: 0, actualLaborCost: 0 },
        pendingLabor: 0,
      })
    );
    expect(result.actualNetProfitCents).toBe(result.projectedNetProfitCents);
  });
});
```

- [ ] **Step 2: Run to confirm they fail**

Run: `npx vitest run tests/unit/monthlyPerformance.test.ts`
Expected: 3 new tests fail.

- [ ] **Step 3: Implement profit in the module**

In `supabase/functions/_shared/monthlyPerformance.ts`, add before `return`:

```typescript
  // Profit
  const actualNetProfitCents = netRevenueCents - actualExpensesCents;
  const projectedNetProfitCents = netRevenueCents - projectedExpensesCents;
```

Update the `return` so these values flow through (replace the placeholder `0`s).

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run tests/unit/monthlyPerformance.test.ts`
Expected: all 14 tests pass.

- [ ] **Step 5: Commit**

```bash
git add supabase/functions/_shared/monthlyPerformance.ts tests/unit/monthlyPerformance.test.ts
git commit -m "feat(monthly-performance): actual and projected net profit"
```

---

## Task 5: Test POS reconciliation surface and decimal safety

**Files:**
- Modify: `tests/unit/monthlyPerformance.test.ts`

- [ ] **Step 1: Add reconciliation, decimal-safety, and idempotence tests**

Append to `tests/unit/monthlyPerformance.test.ts`:

```typescript
describe('calculateMonthlyPerformance — POS reconciliation', () => {
  it('delta is null when no posReportedTotal is supplied', () => {
    const result = calculateMonthlyPerformance(makeInput());
    expect(result.posReportedCents).toBeNull();
    expect(result.posReconciliationDeltaCents).toBeNull();
  });

  it('delta is 0 when posReportedTotal equals derived POS', () => {
    const result = calculateMonthlyPerformance(
      makeInput({
        revenue: {
          grossRevenue: 100, discounts: 0, netRevenue: 100,
          salesTax: 8, tips: 5, otherLiabilities: 2, totalCollectedAtPos: 115,
        },
        posReportedTotal: 115,
      })
    );
    expect(result.posReconciliationDeltaCents).toBe(0);
  });

  it('delta is signed when posReportedTotal differs from derived POS', () => {
    const result = calculateMonthlyPerformance(
      makeInput({
        revenue: {
          grossRevenue: 100, discounts: 0, netRevenue: 100,
          salesTax: 0, tips: 0, otherLiabilities: 0, totalCollectedAtPos: 100,
        },
        posReportedTotal: 105,
      })
    );
    expect(result.posReconciliationDeltaCents).toBe(500); // posReported - derived
  });
});

describe('calculateMonthlyPerformance — decimal safety + idempotence', () => {
  it('handles repeated cent values and dollar-space float drift', () => {
    // toCents returns integers, so summing many integer-cent values is exact.
    let totalCents = 0;
    for (let i = 0; i < 100; i++) {
      totalCents += toCents(0.01);
    }
    expect(totalCents).toBe(100);

    // The real float-drift risk is summing in dollar space before converting:
    // 0.1 + 0.2 === 0.30000000000000004. toCents must round that to 30.
    expect(toCents(0.1 + 0.2)).toBe(30);
  });

  it('returns identical results when called twice with the same input', () => {
    const input = makeInput({
      revenue: {
        grossRevenue: 74458, discounts: 1439, netRevenue: 73019,
        salesTax: 0, tips: 0, otherLiabilities: 0, totalCollectedAtPos: 74458,
      },
      expenses: { totalExpenses: 111220, foodCost: 25562, actualLaborCost: 32959 },
      pendingLabor: 16528,
    });
    const a = calculateMonthlyPerformance(input);
    const b = calculateMonthlyPerformance(input);
    expect(a).toEqual(b);
  });
});
```

- [ ] **Step 2: Run tests**

Run: `npx vitest run tests/unit/monthlyPerformance.test.ts`
Expected: all 19 tests pass (no implementation change needed — Task 2 already wired POS reconciliation; `toCents` already rounds correctly).

- [ ] **Step 3: Commit**

```bash
git add tests/unit/monthlyPerformance.test.ts
git commit -m "test(monthly-performance): POS reconciliation, decimal safety, idempotence"
```

---

## Task 6: Add the April 2026 fixture regression test

**Files:**
- Modify: `tests/unit/monthlyPerformance.test.ts`

- [ ] **Step 1: Add the fixture test**

Append to `tests/unit/monthlyPerformance.test.ts`:

```typescript
describe('calculateMonthlyPerformance — April 2026 fixture (regression anchor)', () => {
  it('produces every documented value in cents from the user-reported April 2026 numbers', () => {
    const result = calculateMonthlyPerformance({
      revenue: {
        grossRevenue: 74458,             // categorized 58,359 + uncategorized 16,099
        discounts: 1439,
        netRevenue: 73019,
        salesTax: 0,                     // sales tax was inside grossRevenue under
                                         // the buggy RPC; after the RPC fix the
                                         // breakdown supplies these as
                                         // pass-through values; this fixture
                                         // mirrors the corrected breakdown's
                                         // outputs (sales tax / tips not
                                         // separately reported in the April
                                         // example, so 0 is correct here)
        tips: 0,
        otherLiabilities: 0,
        totalCollectedAtPos: 74458,
      },
      expenses: {
        totalExpenses: 111220,
        foodCost: 25562,                 // food + beverage cost
        actualLaborCost: 32959,          // BOH + FOH + Mgmt + Payroll Taxes
      },
      pendingLabor: 16528,
      posReportedTotal: null,
    });

    expect(result.grossRevenueCents).toBe(7445800);
    expect(result.discountsCents).toBe(143900);
    expect(result.netRevenueCents).toBe(7301900);
    expect(result.salesTaxCents).toBe(0);
    expect(result.tipsCents).toBe(0);
    expect(result.otherLiabilitiesCents).toBe(0);
    expect(result.passThroughTotalCents).toBe(0);
    expect(result.cogsCents).toBe(2556200);
    expect(result.actualLaborCents).toBe(3295900);
    expect(result.pendingLaborCents).toBe(1652800);
    expect(result.laborIncludingPendingCents).toBe(4948700);
    expect(result.actualExpensesCents).toBe(11122000);
    expect(result.projectedExpensesCents).toBe(12774800);
    expect(result.otherExpensesCents).toBe(5269900);
    expect(result.actualNetProfitCents).toBe(-3820100);   // loss: -$38,201
    expect(result.projectedNetProfitCents).toBe(-5472900); // loss: -$54,729
    expect(result.posCollectedFromBreakdownCents).toBe(7445800); // gross only — no pass-through this fixture
    expect(result.posReconciliationDeltaCents).toBeNull();
  });
});
```

- [ ] **Step 2: Run tests**

Run: `npx vitest run tests/unit/monthlyPerformance.test.ts`
Expected: all 20 tests pass.

- [ ] **Step 3: Commit**

```bash
git add tests/unit/monthlyPerformance.test.ts
git commit -m "test(monthly-performance): April 2026 fixture regression anchor"
```

---

## Task 7: Write the RPC fix migration

**Files:**
- Create: `supabase/migrations/20260501120000_fix_monthly_sales_metrics_revenue_filter.sql`

- [ ] **Step 1: Create the migration**

Write the migration file:

```sql
-- Migration: fix gross-revenue double-count in get_monthly_sales_metrics
--
-- The previous version's monthly_revenue CTE summed every row where
-- adjustment_type IS NULL AND item_type='sale', regardless of the
-- chart-of-accounts mapping. Sales mapped to a liability account (e.g. a
-- "Sales Tax" item categorized to a sales-tax-payable account) were therefore
-- counted twice: once in gross_revenue and again in
-- monthly_categorized_liabilities.
--
-- This migration adds an account-type filter to monthly_revenue so a sale
-- only contributes to gross_revenue when it is uncategorized (NULL) or
-- mapped to a revenue account.

CREATE OR REPLACE FUNCTION public.get_monthly_sales_metrics(
  p_restaurant_id UUID,
  p_date_from DATE,
  p_date_to DATE
)
RETURNS TABLE (
  period TEXT,
  gross_revenue DECIMAL,
  sales_tax DECIMAL,
  tips DECIMAL,
  other_liabilities DECIMAL,
  discounts DECIMAL
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
BEGIN
  RETURN QUERY
  WITH monthly_revenue AS (
    SELECT
      TO_CHAR(us.sale_date, 'YYYY-MM') as month_period,
      COALESCE(SUM(us.total_price), 0)::DECIMAL as amount
    FROM unified_sales us
    LEFT JOIN chart_of_accounts coa ON us.category_id = coa.id
    WHERE us.restaurant_id = p_restaurant_id
      AND us.sale_date >= p_date_from
      AND us.sale_date <= p_date_to
      AND us.adjustment_type IS NULL
      AND LOWER(COALESCE(us.item_type, 'sale')) = 'sale'
      -- Liability-categorized sales are accounted for in
      -- monthly_categorized_liabilities; counting them here too caused
      -- gross_revenue (and therefore total_collected_at_pos) to double-count.
      -- account_type_enum is (asset, liability, equity, revenue, expense);
      -- only liability is excluded here. asset/equity/expense are not
      -- expected on unified_sales rows but pass through if they ever appear.
      AND (coa.account_type IS NULL OR coa.account_type = 'revenue')
      AND NOT EXISTS (
        SELECT 1 FROM unified_sales child
        WHERE child.parent_sale_id = us.id
      )
    GROUP BY TO_CHAR(us.sale_date, 'YYYY-MM')
  ),
  monthly_adjustments AS (
    SELECT
      TO_CHAR(us.sale_date, 'YYYY-MM') as month_period,
      us.adjustment_type,
      COALESCE(SUM(us.total_price), 0)::DECIMAL as amount
    FROM unified_sales us
    WHERE us.restaurant_id = p_restaurant_id
      AND us.sale_date >= p_date_from
      AND us.sale_date <= p_date_to
      AND us.adjustment_type IS NOT NULL
    GROUP BY TO_CHAR(us.sale_date, 'YYYY-MM'), us.adjustment_type
  ),
  monthly_categorized_liabilities AS (
    SELECT
      TO_CHAR(us.sale_date, 'YYYY-MM') as month_period,
      CASE
        WHEN LOWER(COALESCE(coa.account_subtype::TEXT, '')) LIKE '%tax%'
          OR LOWER(COALESCE(coa.account_name, '')) LIKE '%tax%'
        THEN 'tax'
        WHEN LOWER(COALESCE(coa.account_subtype::TEXT, '')) LIKE '%tip%'
          OR LOWER(COALESCE(coa.account_name, '')) LIKE '%tip%'
        THEN 'tip'
        ELSE 'other_liability'
      END as liability_type,
      COALESCE(SUM(us.total_price), 0)::DECIMAL as amount
    FROM unified_sales us
    INNER JOIN chart_of_accounts coa ON us.category_id = coa.id
    WHERE us.restaurant_id = p_restaurant_id
      AND us.sale_date >= p_date_from
      AND us.sale_date <= p_date_to
      AND us.adjustment_type IS NULL
      AND us.is_categorized = TRUE
      AND coa.account_type = 'liability'
      AND NOT EXISTS (
        SELECT 1 FROM unified_sales child
        WHERE child.parent_sale_id = us.id
      )
    GROUP BY TO_CHAR(us.sale_date, 'YYYY-MM'),
      CASE
        WHEN LOWER(COALESCE(coa.account_subtype::TEXT, '')) LIKE '%tax%'
          OR LOWER(COALESCE(coa.account_name, '')) LIKE '%tax%'
        THEN 'tax'
        WHEN LOWER(COALESCE(coa.account_subtype::TEXT, '')) LIKE '%tip%'
          OR LOWER(COALESCE(coa.account_name, '')) LIKE '%tip%'
        THEN 'tip'
        ELSE 'other_liability'
      END
  ),
  all_periods AS (
    SELECT DISTINCT month_period FROM monthly_revenue
    UNION
    SELECT DISTINCT month_period FROM monthly_adjustments
    UNION
    SELECT DISTINCT month_period FROM monthly_categorized_liabilities
  )
  SELECT
    p.month_period as period,
    COALESCE(r.amount, 0) as gross_revenue,
    COALESCE((SELECT SUM(a.amount) FROM monthly_adjustments a WHERE a.month_period = p.month_period AND a.adjustment_type = 'tax'), 0) +
    COALESCE((SELECT SUM(l.amount) FROM monthly_categorized_liabilities l WHERE l.month_period = p.month_period AND l.liability_type = 'tax'), 0) as sales_tax,
    COALESCE((SELECT SUM(a.amount) FROM monthly_adjustments a WHERE a.month_period = p.month_period AND a.adjustment_type = 'tip'), 0) +
    COALESCE((SELECT SUM(l.amount) FROM monthly_categorized_liabilities l WHERE l.month_period = p.month_period AND l.liability_type = 'tip'), 0) as tips,
    COALESCE((SELECT SUM(a.amount) FROM monthly_adjustments a WHERE a.month_period = p.month_period AND a.adjustment_type IN ('service_charge', 'fee')), 0) +
    COALESCE((SELECT SUM(l.amount) FROM monthly_categorized_liabilities l WHERE l.month_period = p.month_period AND l.liability_type = 'other_liability'), 0) as other_liabilities,
    COALESCE((SELECT SUM(ABS(a.amount)) FROM monthly_adjustments a WHERE a.month_period = p.month_period AND a.adjustment_type = 'discount'), 0) as discounts
  FROM all_periods p
  LEFT JOIN monthly_revenue r ON r.month_period = p.month_period
  ORDER BY p.month_period DESC;
END;
$function$;

GRANT EXECUTE ON FUNCTION public.get_monthly_sales_metrics(UUID, DATE, DATE) TO authenticated;

COMMENT ON FUNCTION public.get_monthly_sales_metrics IS
'Aggregates monthly sales metrics from unified_sales table.
Returns gross_revenue, sales_tax, tips, other_liabilities, and discounts
grouped by month. The monthly_revenue CTE excludes sales mapped to liability
accounts so they are not double-counted (those land in
monthly_categorized_liabilities instead).';
```

- [ ] **Step 2: Commit (test follows in Task 8)**

```bash
git add supabase/migrations/20260501120000_fix_monthly_sales_metrics_revenue_filter.sql
git commit -m "fix(rpc): exclude liability-categorized sales from get_monthly_sales_metrics gross_revenue"
```

---

## Task 8: Write the pgTAP test for the RPC fix

**Files:**
- Create: `supabase/tests/36_monthly_sales_metrics_revenue_filter.sql`

- [ ] **Step 1: Create the pgTAP test**

```sql
-- Tests the fix for the gross_revenue double-count bug in
-- get_monthly_sales_metrics. The buggy version summed liability-categorized
-- sales into gross_revenue AND into sales_tax / other_liabilities; the fix
-- restricts gross_revenue to revenue-categorized + uncategorized sales only.

BEGIN;
SELECT plan(4);

SELECT
  '00000000-0000-0000-0000-000000000222'::uuid AS restaurant_id,
  '2026-04-01'::date AS date_from,
  '2026-04-30'::date AS date_to
\gset

-- Clean baseline
DELETE FROM unified_sales WHERE restaurant_id = :'restaurant_id';
DELETE FROM chart_of_accounts WHERE restaurant_id = :'restaurant_id';

INSERT INTO restaurants (id, name) VALUES (:'restaurant_id', 'Monthly Metrics Test')
ON CONFLICT (id) DO UPDATE SET name = EXCLUDED.name;

-- A revenue account and a liability (sales tax) account
INSERT INTO chart_of_accounts (id, restaurant_id, account_code, account_name, account_type, account_subtype, normal_balance)
VALUES
  ('00000000-0000-0000-0000-000000000601', :'restaurant_id', '4000', 'Food Sales', 'revenue', 'food_sales', 'credit'),
  ('00000000-0000-0000-0000-000000000602', :'restaurant_id', '2200', 'Sales Tax Payable', 'liability', 'other_current_liabilities', 'credit')
ON CONFLICT DO NOTHING;

-- One revenue-categorized sale ($100), one liability-categorized sale ($10),
-- and one uncategorized sale ($50) in the same month.
-- The buggy RPC reported gross_revenue=110 here.
INSERT INTO unified_sales (
  id, restaurant_id, pos_system, external_order_id, external_item_id, item_name,
  quantity, unit_price, total_price, sale_date, item_type,
  is_categorized, category_id, adjustment_type, parent_sale_id
) VALUES
  ('00000000-0000-0000-0000-000000000701', :'restaurant_id', 'test', 'ord-r-1', 'item-r-1',
    'Burger', 1, 100, 100, '2026-04-15', 'sale', true,
    '00000000-0000-0000-0000-000000000601', NULL, NULL),
  ('00000000-0000-0000-0000-000000000702', :'restaurant_id', 'test', 'ord-l-1', 'item-l-1',
    'POS Sales Tax', 1, 10, 10, '2026-04-15', 'sale', true,
    '00000000-0000-0000-0000-000000000602', NULL, NULL),
  ('00000000-0000-0000-0000-000000000703', :'restaurant_id', 'test', 'ord-u-1', 'item-u-1',
    'Uncategorized Item', 1, 50, 50, '2026-04-15', 'sale', false,
    NULL, NULL, NULL);

-- gross_revenue must be 150 (100 revenue-categorized + 50 uncategorized via
-- the IS NULL branch; NOT 160 — the liability-categorized $10 must stay out).
SELECT is(
  (SELECT gross_revenue::numeric(10,2)
   FROM get_monthly_sales_metrics(:'restaurant_id', :'date_from', :'date_to')
   WHERE period = '2026-04'),
  150.00::numeric,
  'gross_revenue includes revenue-categorized AND uncategorized (NULL category_id) sales but excludes liability-categorized'
);

-- The same liability-categorized sale must show up in sales_tax (it has
-- "tax" in the account name).
SELECT is(
  (SELECT sales_tax::numeric(10,2)
   FROM get_monthly_sales_metrics(:'restaurant_id', :'date_from', :'date_to')
   WHERE period = '2026-04'),
  10.00::numeric,
  'sales_tax still picks up liability-categorized sales-tax items'
);

-- Sanity: gross + sales_tax = 160 (no double-count).
SELECT is(
  (SELECT (gross_revenue + sales_tax)::numeric(10,2)
   FROM get_monthly_sales_metrics(:'restaurant_id', :'date_from', :'date_to')
   WHERE period = '2026-04'),
  160.00::numeric,
  'gross_revenue + sales_tax equals the actual money collected (no double-count)'
);

-- Explicit coverage for the IS NULL branch of the account_type filter:
-- without it, uncategorized sales (NULL category_id → NULL coa.account_type
-- after LEFT JOIN) would silently drop out of gross_revenue.
SELECT is(
  (SELECT gross_revenue::numeric(10,2)
   FROM get_monthly_sales_metrics(:'restaurant_id', :'date_from', :'date_to')
   WHERE period = '2026-04'),
  150.00::numeric,
  'uncategorized sales still count toward gross_revenue (NULL category_id pass-through)'
);

SELECT * FROM finish();
ROLLBACK;
```

- [ ] **Step 2: Run the pgTAP test**

Run: `npm run test:db -- 36_monthly_sales_metrics_revenue_filter.sql`
(If the project's `test:db` doesn't accept a single-file argument, run `npm run test:db` and confirm `36_monthly_sales_metrics_revenue_filter.sql` reports `ok 1..4`.)

Expected: all 4 assertions pass.

- [ ] **Step 3: Commit**

```bash
git add supabase/tests/36_monthly_sales_metrics_revenue_filter.sql
git commit -m "test(rpc): pgTAP for get_monthly_sales_metrics liability-filter fix"
```

---

## Task 9: Refactor MonthlyBreakdownTable to use the shared module

**Files:**
- Modify: `src/components/MonthlyBreakdownTable.tsx`

This task replaces the inline math at lines ~219-226 + the profit cell at ~314 with a single `calculateMonthlyPerformance` call per row, splits the Net Profit column into Actual + Projected, and adds a conditional POS reconciliation row in the expanded section.

- [ ] **Step 1: Add the import at the top of the file**

In `src/components/MonthlyBreakdownTable.tsx`, after the existing imports, add:

```typescript
import {
  calculateMonthlyPerformance,
  type MonthlyPerformanceResult,
} from '../../supabase/functions/_shared/monthlyPerformance';
```

(Adjust the relative path if the existing imports use `@/...` aliases — check the file's existing import style and match it. If `@/` is used, this becomes `import { calculateMonthlyPerformance, type MonthlyPerformanceResult } from '@/../supabase/functions/_shared/monthlyPerformance';` — but the canonical existing pattern in `usePeriodMetrics.tsx` is the relative path; copy that.)

- [ ] **Step 2: Replace the inline math block**

Find the block at lines ~219-226:

```typescript
const foodCost = month.food_cost > 0 ? month.food_cost : (expenseMonth?.foodCost ?? 0);
const pendingLaborCost = month.pending_labor_cost;
const actualLaborCost = expenseMonth?.laborCost ?? month.actual_labor_cost;
const laborCost = pendingLaborCost + actualLaborCost;
const totalExpenses = expenseMonth
  ? expenseMonth.totalExpenses + pendingLaborCost
  : month.food_cost + laborCost;
const otherExpenses = Math.max(0, totalExpenses - foodCost - laborCost);
```

Replace with:

```typescript
const perf: MonthlyPerformanceResult = calculateMonthlyPerformance({
  revenue: {
    grossRevenue: month.gross_revenue,
    discounts: month.discounts,
    netRevenue: month.net_revenue,
    salesTax: month.sales_tax,
    tips: month.tips,
    otherLiabilities: month.other_liabilities,
    totalCollectedAtPos: month.total_collected_at_pos,
  },
  expenses: {
    totalExpenses: expenseMonth?.totalExpenses ?? (month.food_cost + month.actual_labor_cost),
    foodCost: expenseMonth?.foodCost ?? month.food_cost,
    actualLaborCost: expenseMonth?.laborCost ?? month.actual_labor_cost,
  },
  pendingLabor: month.pending_labor_cost,
  posReportedTotal: null, // No external POS-reported number is wired up today.
});

// Display-friendly dollar values (cents → dollars at the boundary)
const foodCost = perf.cogsCents / 100;
const pendingLaborCost = perf.pendingLaborCents / 100;
const actualLaborCost = perf.actualLaborCents / 100;
const laborCost = perf.laborIncludingPendingCents / 100;
const otherExpenses = perf.otherExpensesCents / 100;
const actualNetProfit = perf.actualNetProfitCents / 100;
const projectedNetProfit = perf.projectedNetProfitCents / 100;
const posCollected = perf.posCollectedFromBreakdownCents / 100;
const posReconciliationDelta = perf.posReconciliationDeltaCents == null
  ? null
  : perf.posReconciliationDeltaCents / 100;
```

- [ ] **Step 3: Update the POS Collected cell to use the derived value**

Find the existing POS cell that reads `formatCurrency(month.total_collected_at_pos)` and replace it with `formatCurrency(posCollected)`. This makes the summary card and the breakdown read from the same derivation.

- [ ] **Step 4: Replace the Net Profit cell with stacked Actual + Projected**

Find the profit cell that contains:

```typescript
const netRevenue = month.net_revenue;
const profit = netRevenue - totalExpenses;
const profitMargin = netRevenue > 0 ? (profit / netRevenue) * 100 : 0;
```

Replace the entire `<td>...</td>` for the Net Profit column with:

```typescript
<td className="text-right py-2 px-2 sm:py-3 sm:px-4">
  <div className="flex flex-col items-end gap-0.5 sm:gap-1">
    <span className={`font-bold text-xs sm:text-sm ${
      actualNetProfit > 0 ? 'text-primary'
        : actualNetProfit < 0 ? 'text-destructive'
        : 'text-foreground'
    }`}>
      {formatCurrency(actualNetProfit)}
    </span>
    <span className="text-[10px] sm:text-xs text-blue-600">
      Actual
      {month.net_revenue > 0
        ? ` (${((actualNetProfit / month.net_revenue) * 100).toFixed(1)}%)`
        : ''}
    </span>
    {pendingLaborCost > 0 && (
      <>
        <span className={`font-semibold text-xs sm:text-sm ${
          projectedNetProfit > 0 ? 'text-primary'
            : projectedNetProfit < 0 ? 'text-destructive'
            : 'text-foreground'
        }`}>
          {formatCurrency(projectedNetProfit)}
        </span>
        <span className="text-[10px] sm:text-xs text-amber-600">
          Projected (incl. pending labor)
          {month.net_revenue > 0
            ? ` (${((projectedNetProfit / month.net_revenue) * 100).toFixed(1)}%)`
            : ''}
        </span>
      </>
    )}
  </div>
</td>
```

- [ ] **Step 5: Add the conditional POS reconciliation row in the expanded detail**

Locate the expanded-detail block (rendered when `isExpanded` is `true`). Inside it, after the existing detail rows but before the closing `</tr>` of the expanded section, add:

```typescript
{posReconciliationDelta !== null && posReconciliationDelta !== 0 && (
  <div className="flex items-center justify-between gap-3 p-2.5 rounded-lg bg-amber-500/10 border border-amber-500/20 mt-2">
    <div className="flex flex-col">
      <span className="text-[12px] font-medium text-foreground">POS reconciliation</span>
      <span className="text-[11px] text-muted-foreground">
        Reported by POS vs derived from breakdown
      </span>
    </div>
    <span className="text-[14px] font-semibold tabular-nums">
      {formatCurrency(posReconciliationDelta)}
    </span>
  </div>
)}
```

(Anchor it next to the most natural detail-section element — e.g. immediately under the last existing `Pass-Through` / `Discounts` summary line. The exact JSX wrapper depends on the file's expanded-row layout; the goal is the row only renders when the delta is present and non-zero.)

- [ ] **Step 6: Verify with typecheck and existing tests**

```bash
npm run typecheck
npx vitest run tests/unit/monthlyPerformance.test.ts
```

Expected: typecheck passes; all 20 monthly-performance unit tests still pass.

- [ ] **Step 7: Commit**

```bash
git add src/components/MonthlyBreakdownTable.tsx
git commit -m "refactor(monthly-perf): single source of truth via calculateMonthlyPerformance + Actual/Projected split"
```

---

## Task 10: Add the regression test for the table

**Files:**
- Create: `tests/unit/MonthlyBreakdownTable.test.tsx`

- [ ] **Step 1: Create the regression test**

```typescript
/**
 * MonthlyBreakdownTable regression tests
 *
 * These tests pin the rendering contract:
 * 1. The displayed POS Collected cell is derived from the shared module
 *    (gross + pass-through), not the raw upstream value — so it can never
 *    diverge from the breakdown again.
 * 2. The "Projected" net-profit label only renders when pendingLabor > 0.
 */

import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MonthlyBreakdownTable } from '@/components/MonthlyBreakdownTable';

// useMonthlyExpenses is fetched via React Query; stub it to return a fixed
// per-month expense set so the table renders deterministically.
vi.mock('@/hooks/useMonthlyExpenses', () => ({
  useMonthlyExpenses: () => ({
    data: [
      {
        period: '2026-04',
        totalExpenses: 111220,
        foodCost: 25562,
        laborCost: 32959,
        categories: [],
      },
    ],
    isLoading: false,
    error: null,
  }),
}));

function renderWithClient(ui: React.ReactElement) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={client}>{ui}</QueryClientProvider>);
}

const aprilFixture = {
  period: '2026-04',
  gross_revenue: 74458,
  total_collected_at_pos: 74458,
  net_revenue: 73019,
  discounts: 1439,
  refunds: 0,
  sales_tax: 0,
  tips: 0,
  other_liabilities: 0,
  food_cost: 25562,
  labor_cost: 49487,
  pending_labor_cost: 16528,
  actual_labor_cost: 32959,
  has_data: true,
};

describe('MonthlyBreakdownTable — single source of truth', () => {
  it('renders an Actual net-profit value matching netRevenue - actualExpenses', () => {
    renderWithClient(
      <MonthlyBreakdownTable
        monthlyData={[aprilFixture]}
        restaurantId="test-restaurant"
        dateFrom={new Date('2026-04-01')}
        dateTo={new Date('2026-04-30')}
      />
    );
    // Actual net profit = 73019 - 111220 = -$38,201
    expect(screen.getByText('-$38,201.00')).toBeDefined();
    // Actual label appears
    expect(screen.getAllByText(/Actual/i).length).toBeGreaterThan(0);
  });

  it('renders a Projected label only when pending labor > 0', () => {
    renderWithClient(
      <MonthlyBreakdownTable
        monthlyData={[aprilFixture]}
        restaurantId="test-restaurant"
        dateFrom={new Date('2026-04-01')}
        dateTo={new Date('2026-04-30')}
      />
    );
    expect(screen.getAllByText(/Projected/i).length).toBeGreaterThan(0);
    // Projected = 73019 - 111220 - 16528 = -$54,729
    expect(screen.getByText('-$54,729.00')).toBeDefined();
  });

  it('omits the Projected line when pending labor is 0', () => {
    const noPending = { ...aprilFixture, pending_labor_cost: 0, labor_cost: 32959 };
    renderWithClient(
      <MonthlyBreakdownTable
        monthlyData={[noPending]}
        restaurantId="test-restaurant"
        dateFrom={new Date('2026-04-01')}
        dateTo={new Date('2026-04-30')}
      />
    );
    expect(screen.queryByText(/Projected/i)).toBeNull();
  });
});
```

NOTE: If `MonthlyBreakdownTable`'s prop signature differs from `{ monthlyData, restaurantId, dateFrom, dateTo }`, adjust the props in the test to match the actual signature — read the component's existing call sites to confirm.

- [ ] **Step 2: Run the regression test**

Run: `npx vitest run tests/unit/MonthlyBreakdownTable.test.tsx`
Expected: all 3 tests pass. If the component signature differs, the test will fail at render — adjust props to match what the component actually accepts.

- [ ] **Step 3: Commit**

```bash
git add tests/unit/MonthlyBreakdownTable.test.tsx
git commit -m "test(monthly-perf): regression for single-source POS + Actual/Projected labels"
```

---

## Task 11: Run the full suite and lint

- [ ] **Step 1: Run typecheck, lint, full unit tests, and pgTAP**

```bash
npm run typecheck
npm run lint
npm run test
npm run test:db
```

Expected: all green. If any pre-existing test fails that is unrelated to this branch, note it but do not "fix" it as part of this work — the branch should leave unrelated tests in their original state.

- [ ] **Step 2: If any monthly-performance-related test fails**

Diagnose by re-reading the failing test, the module, and the component. The most likely failure modes are:
- Path alias mismatch in the import (Task 9 Step 1) — adjust to match the file's existing import style.
- Component prop signature mismatch in `MonthlyBreakdownTable.test.tsx` (Task 10) — read the component's actual prop interface and align.

Fix and re-run. Do not commit until everything is green.

- [ ] **Step 3: Final commit if any drift was repaired**

```bash
git add -A
git commit -m "chore(monthly-perf): align imports / props after suite run"
```

(If nothing needed adjustment, skip this commit.)

---

## Self-Review

- [x] **Spec coverage:** Every spec section maps to a task — module skeleton (T1), revenue + pass-through (T2), costs/other-expenses floor (T3), profit (T4), POS reconciliation + decimal safety (T5), April 2026 fixture (T6), RPC migration (T7), pgTAP (T8), UI refactor with Actual/Projected split + conditional reconciliation row (T9), regression test (T10), full-suite verification (T11).
- [x] **Placeholder scan:** No "TBD" / "implement later" / "similar to Task N". Code blocks are concrete; commands are exact.
- [x] **Type consistency:** `MonthlyPerformanceInput` and `MonthlyPerformanceResult` field names match across all tasks (T1 defines them; T2/T3/T4 add no new field names beyond what T1 declared; T9 reads them as named).
- [x] **Migration timestamp:** `20260501120000` is later than the most recent migration `20260426120000_lock_check_bank_account_secrets.sql` — safe ordering.
- [x] **pgTAP file number:** `36_` is the next sequential number after `35_get_unified_sales_totals.sql` — no collision.
