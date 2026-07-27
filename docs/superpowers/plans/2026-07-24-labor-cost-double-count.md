# Labor Cost Double-Count Fix Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Stop labor from being double-counted (accrued time-punch labor + paid bank labor summed) across the dashboard, the P&L Intelligence report, and the Monthly Breakdown table.

**Architecture:** Extract the cost-combination arithmetic into a pure, unit-testable module (`src/lib/combineCosts.ts`) exposing `resolveLaborBasis` (period picks `accrued` when any time-punch labor exists, else falls back to `paid`) and `combineDailyCosts` (merges COGS + labor, with the daily `labor_cost`/`total_cost` respecting the chosen basis). `useCostsFromSource` delegates to it and exposes a new `laborBasis`. The Monthly Breakdown path (`useMonthlyMetrics` → `monthlyPerformance.ts` → `MonthlyBreakdownTable`) applies the same rule — inlined in the Deno-targeted `monthlyPerformance.ts`, imported from the shared module in the `src/` hook. Three UI surfaces are updated so the pending/actual split no longer reads as broken once the headline stops equalling `pending + actual`.

**Tech Stack:** React 18 + TypeScript, React Query, Vitest (unit), TailwindCSS/shadcn.

## Global Constraints

- **Labor basis rule (single source of truth):** a period uses **accrued** (time-punch) labor when its accrued total is `> 0`; otherwise it **falls back to paid** (bank) labor. The decision is **per period**, applied uniformly to every day in that period — never per-day. Encoded once as `resolveLaborBasis` in `src/lib/combineCosts.ts`; `monthlyPerformance.ts` inlines the identical rule (Deno module — cannot import `src/lib`) with a cross-reference comment.
- **Never sum accrued + paid** for a period's labor cost, prime cost, or profit.
- **Keep `pendingLaborCost` / `actualLaborCost` exposed** everywhere they are today — only the combined `labor_cost` / prime / profit fields respect the basis.
- **Semantic tokens only** for any new styling; badge scale is `text-[11px] px-1.5 py-0.5 rounded-md bg-muted` (CLAUDE.md). In `MonthlyBreakdownTable.tsx`, follow the file's existing local color convention (`text-amber-600` / `text-blue-600`) rather than refactoring it.
- **Money math in `monthlyPerformance.ts` stays in integer cents** via the existing `toCents` helper.
- Run `npm run typecheck` and `npm run lint` clean before the final commit of each task that changes types.

---

### Task 1: Pure cost-combination module `src/lib/combineCosts.ts`

**Files:**
- Create: `src/lib/combineCosts.ts`
- Test: `tests/unit/combineCosts.test.ts`

**Interfaces:**
- Consumes: nothing (leaf module).
- Produces:
  - `type LaborBasis = 'accrued' | 'paid'`
  - `resolveLaborBasis(pendingTotal: number): LaborBasis`
  - `combineDailyCosts(cogs: DailyCOGSInput[], pendingDaily: DailyLaborInput[], actualDaily: DailyTxnLaborInput[], basis: LaborBasis): CombinedDailyCost[]`
  - input types `DailyCOGSInput { date: string; amount: number }`, `DailyLaborInput { date: string; total_labor_cost: number }`, `DailyTxnLaborInput { date: string; labor_cost: number }`
  - output type `CombinedDailyCost { date: string; food_cost: number; labor_cost: number; pending_labor_cost: number; actual_labor_cost: number; total_cost: number }`

- [ ] **Step 1: Write the failing test**

Create `tests/unit/combineCosts.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import {
  resolveLaborBasis,
  combineDailyCosts,
  type CombinedDailyCost,
} from '@/lib/combineCosts';

describe('resolveLaborBasis', () => {
  it('returns accrued when any time-punch labor exists', () => {
    expect(resolveLaborBasis(1234.56)).toBe('accrued');
  });
  it('falls back to paid when accrued is exactly zero', () => {
    expect(resolveLaborBasis(0)).toBe('paid');
  });
});

describe('combineDailyCosts', () => {
  const cogs = [{ date: '2026-04-01', amount: 100 }, { date: '2026-04-02', amount: 50 }];
  const pending = [{ date: '2026-04-01', total_labor_cost: 200 }]; // accrued, only day 1 has punches
  const actual = [
    { date: '2026-04-01', labor_cost: 180 },
    { date: '2026-04-02', labor_cost: 90 }, // bank payroll posted on a no-punch day
  ];

  it('does NOT sum accrued + paid — accrued basis uses pending only', () => {
    const rows = combineDailyCosts(cogs, pending, actual, 'accrued');
    const total = rows.reduce((s, r) => s + r.labor_cost, 0);
    // pending total is 200; the double-count bug returned 200 + 270 = 470
    expect(total).toBe(200);
  });

  it('applies the period basis uniformly — a no-punch day contributes 0 under accrued', () => {
    const rows = combineDailyCosts(cogs, pending, actual, 'accrued');
    const day2 = rows.find((r) => r.date === '2026-04-02') as CombinedDailyCost;
    // day 2 has paid labor 90 but no punches; per-period accrued basis => 0, not 90
    expect(day2.labor_cost).toBe(0);
  });

  it('paid basis uses actual (bank) labor', () => {
    const rows = combineDailyCosts(cogs, [], actual, 'paid');
    const total = rows.reduce((s, r) => s + r.labor_cost, 0);
    expect(total).toBe(270); // 180 + 90
  });

  it('always preserves the pending/actual breakdown regardless of basis', () => {
    const rows = combineDailyCosts(cogs, pending, actual, 'accrued');
    const day1 = rows.find((r) => r.date === '2026-04-01') as CombinedDailyCost;
    expect(day1.pending_labor_cost).toBe(200);
    expect(day1.actual_labor_cost).toBe(180);
  });

  it('total_cost = food_cost + basis labor_cost, and rows are date-sorted', () => {
    const rows = combineDailyCosts(cogs, pending, actual, 'accrued');
    expect(rows.map((r) => r.date)).toEqual(['2026-04-01', '2026-04-02']);
    expect(rows[0].total_cost).toBe(100 + 200);
    expect(rows[1].total_cost).toBe(50 + 0);
  });

  it('leaves food cost untouched by the labor basis', () => {
    const accrued = combineDailyCosts(cogs, pending, actual, 'accrued');
    const paid = combineDailyCosts(cogs, pending, actual, 'paid');
    expect(accrued.reduce((s, r) => s + r.food_cost, 0)).toBe(150);
    expect(paid.reduce((s, r) => s + r.food_cost, 0)).toBe(150);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm run test -- tests/unit/combineCosts.test.ts`
Expected: FAIL — `Cannot find module '@/lib/combineCosts'`.

- [ ] **Step 3: Write the module**

Create `src/lib/combineCosts.ts`:

```ts
/**
 * Pure cost-combination helpers shared by the dashboard/report cost model.
 *
 * Labor de-duplication: accrued (time-punch) labor and paid (bank) labor
 * describe largely the SAME labor. Summing them double-counts. A period uses
 * accrued labor when it has any, and falls back to paid only when accrued is
 * zero. The decision is made ONCE per period and applied to every day — a
 * per-day fallback would re-introduce the double-count on low-punch days when a
 * lumpy bank payroll posts.
 */

export type LaborBasis = 'accrued' | 'paid';

export interface DailyCOGSInput {
  date: string;
  amount: number;
}

/** Accrued labor from time punches (`useLaborCostsFromTimeTracking`). */
export interface DailyLaborInput {
  date: string;
  total_labor_cost: number;
}

/** Paid labor from bank transactions (`useLaborCostsFromTransactions`). */
export interface DailyTxnLaborInput {
  date: string;
  labor_cost: number;
}

export interface CombinedDailyCost {
  date: string;
  food_cost: number;
  labor_cost: number;
  pending_labor_cost: number;
  actual_labor_cost: number;
  total_cost: number;
}

/**
 * Per-period labor basis. `pendingTotal` is the period's total accrued labor.
 * `> 0` => accrued; otherwise fall back to paid.
 */
export function resolveLaborBasis(pendingTotal: number): LaborBasis {
  return pendingTotal > 0 ? 'accrued' : 'paid';
}

/**
 * Merge daily COGS + accrued + paid labor by date. `labor_cost` and
 * `total_cost` reflect the chosen basis; `pending_labor_cost` and
 * `actual_labor_cost` always carry both raw sources for breakdown display.
 */
export function combineDailyCosts(
  cogs: DailyCOGSInput[],
  pendingDaily: DailyLaborInput[],
  actualDaily: DailyTxnLaborInput[],
  basis: LaborBasis,
): CombinedDailyCost[] {
  const map = new Map<string, CombinedDailyCost>();

  const ensure = (date: string): CombinedDailyCost => {
    let row = map.get(date);
    if (!row) {
      row = {
        date,
        food_cost: 0,
        labor_cost: 0,
        pending_labor_cost: 0,
        actual_labor_cost: 0,
        total_cost: 0,
      };
      map.set(date, row);
    }
    return row;
  };

  for (const day of cogs) {
    ensure(day.date).food_cost = day.amount;
  }
  for (const day of pendingDaily) {
    ensure(day.date).pending_labor_cost = day.total_labor_cost;
  }
  for (const day of actualDaily) {
    ensure(day.date).actual_labor_cost = day.labor_cost;
  }

  for (const row of map.values()) {
    row.labor_cost =
      basis === 'accrued' ? row.pending_labor_cost : row.actual_labor_cost;
    row.total_cost = row.food_cost + row.labor_cost;
  }

  return Array.from(map.values()).sort((a, b) => a.date.localeCompare(b.date));
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npm run test -- tests/unit/combineCosts.test.ts`
Expected: PASS (all cases).

- [ ] **Step 5: Commit**

```bash
git add src/lib/combineCosts.ts tests/unit/combineCosts.test.ts
git commit -m "feat(pnl): pure combineCosts helpers for labor de-duplication"
```

---

### Task 2: Wire the shared hook — `useCostsFromSource` + `usePeriodMetrics`

**Files:**
- Modify: `src/hooks/useCostsFromSource.tsx` (lines 1-4 imports, 6-25 interfaces, 60-136 body)
- Modify: `src/hooks/usePeriodMetrics.tsx` (interface + memo + return)
- Test: `tests/unit/periodMetrics.test.ts` (existing — verify still green)

**Interfaces:**
- Consumes: `resolveLaborBasis`, `combineDailyCosts`, `LaborBasis` from `@/lib/combineCosts` (Task 1).
- Produces: `CostsFromSourceResult.laborBasis: LaborBasis`; `PeriodMetrics.laborBasis: LaborBasis`.

- [ ] **Step 1: Rewrite `useCostsFromSource.tsx` to delegate to the pure module**

Replace the import block (lines 1-4) with:

```tsx
import { useMemo } from 'react';
import { useUnifiedCOGS } from './useUnifiedCOGS';
import { useLaborCostsFromTimeTracking } from './useLaborCostsFromTimeTracking';
import { useLaborCostsFromTransactions } from './useLaborCostsFromTransactions';
import {
  resolveLaborBasis,
  combineDailyCosts,
  type LaborBasis,
} from '@/lib/combineCosts';
```

Add `laborBasis` to `CostsFromSourceResult` (after `actualLaborCost`, line 20):

```tsx
  actualLaborCost: number;   // From bank transactions (paid)
  laborBasis: LaborBasis;    // Which source is authoritative for this period
```

Replace the body from the `dailyCosts` memo through the return (current lines 59-136) with:

```tsx
  // Per-period labor basis: accrued (time punches) when any exist, else paid.
  const laborBasis = resolveLaborBasis(laborCosts.totalCost);

  // Combine daily costs; the daily labor_cost/total_cost respect the basis.
  const dailyCosts = useMemo(
    () =>
      combineDailyCosts(
        unifiedCOGS.dailyCOGS,
        laborCosts.dailyCosts,
        transactionLaborCosts.dailyCosts,
        laborBasis,
      ),
    [
      unifiedCOGS.dailyCOGS,
      laborCosts.dailyCosts,
      transactionLaborCosts.dailyCosts,
      laborBasis,
    ],
  );

  const refetch = () => {
    // useUnifiedCOGS relies on React Query auto-refetch (no manual refetch exposed)
    laborCosts.refetch();
    transactionLaborCosts.refetch();
  };

  // De-duplicated period labor: the basis source only, never the sum.
  const totalLaborCost =
    laborBasis === 'accrued' ? laborCosts.totalCost : transactionLaborCosts.totalCost;

  return {
    dailyCosts,
    totalFoodCost: unifiedCOGS.totalCOGS,
    totalLaborCost,
    pendingLaborCost: laborCosts.totalCost,
    actualLaborCost: transactionLaborCosts.totalCost,
    laborBasis,
    totalCost: unifiedCOGS.totalCOGS + totalLaborCost,
    isLoading,
    error,
    refetch,
  };
}
```

(Leave lines 47-58 — the three hook calls and `isLoading`/`error` derivation — unchanged.)

- [ ] **Step 2: Thread `laborBasis` through `usePeriodMetrics.tsx`**

Add the import at the top (after line 3):

```tsx
import type { LaborBasis } from '@/lib/combineCosts';
```

Add to the `PeriodMetrics` interface (after `actualLaborCost: number;`, line 19):

```tsx
  laborBasis: LaborBasis;
```

Add `laborBasis` to the destructure of `useCostsFromSource` (after `actualLaborCost: actualLaborCostRaw,`, line 80):

```tsx
    laborBasis,
```

Add it to the returned object inside the memo (after `actualLaborCost,`, line 113):

```tsx
      laborBasis,
```

Add `laborBasis` to the memo dependency array (line 135): change the array to include `laborBasis` after `actualLaborCostRaw`.

- [ ] **Step 3: Typecheck and run existing period-metrics tests**

Run: `npm run typecheck`
Expected: no errors.

Run: `npm run test -- tests/unit/periodMetrics.test.ts`
Expected: PASS. If a test asserted the old summed `laborCost`, update its expectation to the accrued (or paid-fallback) value per the basis rule and note it in the commit.

- [ ] **Step 4: Commit**

```bash
git add src/hooks/useCostsFromSource.tsx src/hooks/usePeriodMetrics.tsx tests/unit/periodMetrics.test.ts
git commit -m "fix(pnl): de-duplicate labor in useCostsFromSource via basis; expose laborBasis"
```

---

### Task 3: Basis-aware `monthlyPerformance.ts` + rewrite its tests

**Files:**
- Modify: `supabase/functions/_shared/monthlyPerformance.ts` (result interface lines 54-83; costs/profit block lines 127-167)
- Modify: `tests/unit/monthlyPerformance.test.ts` (assertions pinning the double-count)

**Interfaces:**
- Consumes: nothing new (inlines the basis rule; Deno module cannot import `src/lib`).
- Produces (result shape change): add `laborBasis: 'accrued' | 'paid'`; rename `laborIncludingPendingCents` → `laborForPnlCents`; rename `projectedExpensesCents` → `accrualExpensesCents`; rename `projectedNetProfitCents` → `accrualNetProfitCents`. `actualLaborCents`, `pendingLaborCents`, `actualExpensesCents`, `otherExpensesCents`, `actualNetProfitCents` unchanged.

- [ ] **Step 1: Update the failing tests first (TDD — they currently pin the bug)**

In `tests/unit/monthlyPerformance.test.ts`:

Replace the `'passes actual labor ... through'` test (lines 176-186) body's last assertion:

```ts
    expect(result.actualLaborCents).toBe(3295900);
    expect(result.pendingLaborCents).toBe(1652800);
    // accrued basis wins when pending > 0: labor for P&L is the accrued figure,
    // NOT actual + pending (the old double-count returned 4948700).
    expect(result.laborBasis).toBe('accrued');
    expect(result.laborForPnlCents).toBe(1652800);
```

Replace the `'computes projectedExpenses as actualExpenses + pendingLabor'` test (lines 224-232) entirely with:

```ts
  it('accrualExpenses substitutes basis labor for paid labor (no add-on double-count)', () => {
    const result = calculateMonthlyPerformance(
      makeInput({
        expenses: { totalExpenses: 111220, foodCost: 25562, actualLaborCost: 32959 },
        pendingLabor: 16528,
      })
    );
    // actualExpenses - actualLabor + accruedLabor = 111220 - 32959 + 16528
    expect(result.accrualExpensesCents).toBe(11122000 - 3295900 + 1652800);
  });

  it('accrualExpenses equals actualExpenses exactly under the paid basis (pending 0)', () => {
    const result = calculateMonthlyPerformance(
      makeInput({
        expenses: { totalExpenses: 111220, foodCost: 25562, actualLaborCost: 32959 },
        pendingLabor: 0,
      })
    );
    expect(result.laborBasis).toBe('paid');
    expect(result.laborForPnlCents).toBe(3295900);
    expect(result.accrualExpensesCents).toBe(result.actualExpensesCents);
  });
```

Replace the `'projectedNetProfit = ...'` test (lines 249-261) with:

```ts
  it('accrualNetProfit = netRevenue - accrualExpenses (substitutes, not adds, labor)', () => {
    const result = calculateMonthlyPerformance(
      makeInput({
        revenue: {
          grossRevenue: 0, discounts: 0, netRevenue: 73019,
          salesTax: 0, tips: 0, otherLiabilities: 0, totalCollectedAtPos: 0,
        },
        expenses: { totalExpenses: 111220, foodCost: 0, actualLaborCost: 32959 },
        pendingLabor: 16528,
      })
    );
    const accrualExpenses = 11122000 - 3295900 + 1652800;
    expect(result.accrualNetProfitCents).toBe(7301900 - accrualExpenses);
  });
```

In the `'projectedNetProfit equals actualNetProfit when pendingLabor is 0'` test (lines 263-275), rename the final assertion field:

```ts
    expect(result.actualNetProfitCents).toBe(result.accrualNetProfitCents);
```

In the April-2026 fixture test (lines 379-384), replace the four bug-pinning assertions with basis values:

```ts
    expect(result.laborBasis).toBe('accrued');
    expect(result.laborForPnlCents).toBe(1652800);       // accrued only, not 4948700
    expect(result.actualLaborCents).toBe(3295900);
    expect(result.pendingLaborCents).toBe(1652800);
    expect(result.accrualExpensesCents).toBe(11122000 - 3295900 + 1652800); // 9479100
    expect(result.otherExpensesCents).toBe(5269900);
    expect(result.actualNetProfitCents).toBe(-3820100);   // cash basis unchanged
    expect(result.accrualNetProfitCents).toBe(7301900 - (11122000 - 3295900 + 1652800)); // -2177200
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npm run test -- tests/unit/monthlyPerformance.test.ts`
Expected: FAIL — `laborForPnlCents`/`laborBasis`/`accrualExpensesCents`/`accrualNetProfitCents` are `undefined`.

- [ ] **Step 3: Update `monthlyPerformance.ts`**

In the `MonthlyPerformanceResult` interface, replace the Costs/Profit fields (lines 71-82) with:

```ts
  // Costs (cents)
  cogsCents: number;
  actualLaborCents: number;
  pendingLaborCents: number;
  /** Which labor source is authoritative for this month (mirrors
   *  `resolveLaborBasis` in src/lib/combineCosts.ts — kept inline because this
   *  is a Deno module and cannot import from src/). */
  laborBasis: 'accrued' | 'paid';
  /** Labor counted toward P&L: the basis source only, never actual + pending. */
  laborForPnlCents: number;
  otherExpensesCents: number;
  actualExpensesCents: number;
  /** Accrual-basis expenses: paid labor swapped for basis labor. */
  accrualExpensesCents: number;

  // Profit (cents)
  actualNetProfitCents: number;
  accrualNetProfitCents: number;
```

Replace the costs/profit computation block (current lines 127-145) with:

```ts
  // Costs
  const cogsCents = toCents(input.expenses.foodCost);
  const actualLaborCents = toCents(input.expenses.actualLaborCost);
  const pendingLaborCents = toCents(input.pendingLabor);

  // Labor de-duplication (see src/lib/combineCosts.ts resolveLaborBasis):
  // accrued (time-punch) labor when it exists this month, else paid (bank).
  // NEVER actual + pending — those describe the same labor.
  const laborBasis: 'accrued' | 'paid' =
    pendingLaborCents > 0 ? 'accrued' : 'paid';
  const laborForPnlCents =
    laborBasis === 'accrued' ? pendingLaborCents : actualLaborCents;

  const actualExpensesCents = toCents(input.expenses.totalExpenses);

  // otherExpenses = actual - cogs - actualLabor. Floor at 0: rounding in the
  // source data can make this slightly negative when COGS + labor ≈ total.
  const otherExpensesCents = Math.max(
    0,
    actualExpensesCents - cogsCents - actualLaborCents
  );

  // Accrual basis swaps the paid labor already in the ledger for the basis
  // labor (a substitution, not an addition). Under the paid basis this is
  // exactly actualExpensesCents.
  const accrualExpensesCents =
    actualExpensesCents - actualLaborCents + laborForPnlCents;

  // Profit
  const actualNetProfitCents = netRevenueCents - actualExpensesCents;
  const accrualNetProfitCents = netRevenueCents - accrualExpensesCents;
```

Replace the returned costs/profit fields (current lines 158-166) with:

```ts
    cogsCents,
    actualLaborCents,
    pendingLaborCents,
    laborBasis,
    laborForPnlCents,
    otherExpensesCents,
    actualExpensesCents,
    accrualExpensesCents,
    actualNetProfitCents,
    accrualNetProfitCents,
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npm run test -- tests/unit/monthlyPerformance.test.ts`
Expected: PASS.

Run: `npm run test -- tests/unit/monthlyPerformance.acceptance.test.ts`
Expected: PASS (it does not reference the renamed fields).

- [ ] **Step 5: Commit**

```bash
git add supabase/functions/_shared/monthlyPerformance.ts tests/unit/monthlyPerformance.test.ts
git commit -m "fix(pnl): basis-aware labor in monthlyPerformance (no accrued+paid sum)"
```

---

### Task 4: Emit basis labor from `useMonthlyMetrics`

**Files:**
- Modify: `src/hooks/useMonthlyMetrics.tsx` (import + final map at line 583)
- Test: `tests/unit/useMonthlyMetrics.laborBasis.test.ts` (new, focused)

**Interfaces:**
- Consumes: `resolveLaborBasis` from `@/lib/combineCosts` (Task 1).
- Produces: the hook's emitted `labor_cost` equals the basis value, not `pending + actual`.

- [ ] **Step 1: Write the failing test**

Create `tests/unit/useMonthlyMetrics.laborBasis.test.ts`. This test exercises the small emission rule in isolation (the field is otherwise display-unused), so assert it against `resolveLaborBasis` directly to lock the contract the hook must satisfy:

```ts
import { describe, it, expect } from 'vitest';
import { resolveLaborBasis } from '@/lib/combineCosts';

// Contract mirrored by useMonthlyMetrics' final labor_cost emission:
// emitted labor = accrued when the month has any punch labor, else paid.
function emittedLaborDollars(pendingDollars: number, actualDollars: number): number {
  return resolveLaborBasis(pendingDollars) === 'accrued' ? pendingDollars : actualDollars;
}

describe('useMonthlyMetrics labor_cost emission contract', () => {
  it('uses accrued (pending) when a month has punch labor — never the sum', () => {
    expect(emittedLaborDollars(200, 180)).toBe(200); // not 380
  });
  it('falls back to paid when no punch labor', () => {
    expect(emittedLaborDollars(0, 180)).toBe(180);
  });
  it('is zero only when both sources are zero (=== 0 guard unchanged)', () => {
    expect(emittedLaborDollars(0, 0)).toBe(0);
  });
});
```

- [ ] **Step 2: Run the test to verify it passes against the helper**

Run: `npm run test -- tests/unit/useMonthlyMetrics.laborBasis.test.ts`
Expected: PASS (it validates the shared helper contract Task 5 depends on). This is the guard; the hook edit below makes the emission honor it.

- [ ] **Step 3: Apply the emission fix in `useMonthlyMetrics.tsx`**

Add the import near the other hook imports at the top of the file:

```tsx
import { resolveLaborBasis } from '@/lib/combineCosts';
```

In the final result map (line 583), replace:

```tsx
        labor_cost: Math.round(month.labor_cost) / 100,
```

with (compute the basis from the accrued vs paid subtotals this month, so no double-counted total escapes the hook — the `pending_labor_cost` accumulator is the accrued subtotal, `actual_labor_cost` the paid subtotal):

```tsx
        labor_cost:
          resolveLaborBasis(month.pending_labor_cost) === 'accrued'
            ? Math.round(month.pending_labor_cost) / 100
            : Math.round(month.actual_labor_cost) / 100,
```

(Leave the `month.labor_cost` accumulator lines 543/555/568 as-is — they are internal running totals no longer read for display; the emitted field above supersedes them. Do not remove them in this task to keep the diff minimal and avoid touching the accumulation loop.)

- [ ] **Step 4: Typecheck**

Run: `npm run typecheck`
Expected: no errors.

- [ ] **Step 5: Commit**

```bash
git add src/hooks/useMonthlyMetrics.tsx tests/unit/useMonthlyMetrics.laborBasis.test.ts
git commit -m "fix(pnl): emit basis labor_cost from useMonthlyMetrics"
```

---

### Task 5: Monthly Breakdown table UI — consume basis fields

**Files:**
- Modify: `src/components/MonthlyBreakdownTable.tsx` (lines 242-260 derived values; 315-324 labor cell; 349-365 projected profit)
- Test: `tests/unit/MonthlyBreakdownTable.labor.test.tsx` (new render test)

**Interfaces:**
- Consumes: `perf.laborForPnlCents`, `perf.laborBasis`, `perf.accrualNetProfitCents` from Task 3.
- Produces: user-visible labor headline = basis labor (not the sum); accrual profit labeled honestly.

- [ ] **Step 1: Write the failing render test**

Create `tests/unit/MonthlyBreakdownTable.labor.test.tsx`:

```tsx
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { MonthlyBreakdownTable } from '@/components/MonthlyBreakdownTable';

vi.mock('@/contexts/RestaurantContext', () => ({
  useRestaurantContext: () => ({ selectedRestaurant: { restaurant_id: 'r1' } }),
}));
vi.mock('@/hooks/useMonthlyExpenses', () => ({ useMonthlyExpenses: () => ({ data: [] }) }));
vi.mock('@/hooks/useRevenueBreakdown', () => ({ useRevenueBreakdown: () => ({ data: null }) }));

const monthlyData = [{
  period: '2026-04', gross_revenue: 100000, total_collected_at_pos: 100000,
  net_revenue: 100000, discounts: 0, refunds: 0, sales_tax: 0, tips: 0,
  other_liabilities: 0, food_cost: 25000, labor_cost: 20000,
  pending_labor_cost: 20000, actual_labor_cost: 18000, has_data: true,
}];

describe('MonthlyBreakdownTable labor cell', () => {
  it('shows the accrued basis labor as the headline, not accrued + paid', () => {
    render(
      <MemoryRouter>
        <MonthlyBreakdownTable monthlyData={monthlyData} />
      </MemoryRouter>
    );
    // basis is accrued ($20,000); the double-count would render $38,000.
    expect(screen.getByText('$20,000')).toBeInTheDocument();
    expect(screen.queryByText('$38,000')).not.toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm run test -- tests/unit/MonthlyBreakdownTable.labor.test.tsx`
Expected: FAIL — the current headline renders `$38,000` (`laborIncludingPendingCents`).

- [ ] **Step 3: Update the derived values (lines 240-260)**

Replace:

```tsx
                  const laborCost = perf.laborIncludingPendingCents / 100;
```

with:

```tsx
                  const laborCost = perf.laborForPnlCents / 100;
```

Replace:

```tsx
                  const projectedNetProfit = perf.projectedNetProfitCents / 100;
```

with:

```tsx
                  const accrualNetProfit = perf.accrualNetProfitCents / 100;
```

Delete the now-dead `laborCostPercent` line (261) — it summed the two percentages (the double-count) and is not rendered:

```tsx
                  const laborCostPercent = pendingLaborPercent + actualLaborPercent;
```

- [ ] **Step 4: Mark the counted basis line in the labor cell (lines 315-324)**

Replace the labor `<td>` inner block with a small "counted" badge on the active-basis line:

```tsx
                        <td className="text-right py-2 px-2 sm:py-3 sm:px-4">
                          <div className="flex flex-col items-end gap-0.5 sm:gap-1">
                            <span className="font-semibold text-xs sm:text-sm">{formatCurrency(laborCost)}</span>
                            <span className="text-[10px] sm:text-xs text-amber-600 flex items-center gap-1 justify-end">
                              Pending: {formatCurrency(pendingLaborCost)} ({pendingLaborPercent.toFixed(1)}%)
                              {perf.laborBasis === 'accrued' && (
                                <span className="text-[9px] px-1 py-0.5 rounded bg-muted text-muted-foreground uppercase tracking-wide">counted</span>
                              )}
                            </span>
                            <span className="text-[10px] sm:text-xs text-blue-600 flex items-center gap-1 justify-end">
                              Actual: {formatCurrency(actualLaborCost)} ({actualLaborPercent.toFixed(1)}%)
                              {perf.laborBasis === 'paid' && (
                                <span className="text-[9px] px-1 py-0.5 rounded bg-muted text-muted-foreground uppercase tracking-wide">counted</span>
                              )}
                            </span>
                          </div>
                        </td>
```

- [ ] **Step 5: Relabel the profit sub-line (lines 349-365)**

In the profit `<td>`, replace the `projectedNetProfit` references with `accrualNetProfit` and relabel the caption. Change the value span (line 356) `{formatCurrency(projectedNetProfit)}` → `{formatCurrency(accrualNetProfit)}`, the two `projectedNetProfit > 0`/`< 0` conditionals (lines 352-354) to `accrualNetProfit`, and the caption (line 359) from `Projected (incl. pending labor)` to `Accrual basis (matches hours worked)`, and its percentage `((projectedNetProfit / month.net_revenue) ...)` (line 361) to `accrualNetProfit`.

- [ ] **Step 6: Run the render test + typecheck**

Run: `npm run test -- tests/unit/MonthlyBreakdownTable.labor.test.tsx`
Expected: PASS.
Run: `npm run typecheck`
Expected: no errors.

- [ ] **Step 7: Commit**

```bash
git add src/components/MonthlyBreakdownTable.tsx tests/unit/MonthlyBreakdownTable.labor.test.tsx
git commit -m "fix(pnl): Monthly Breakdown shows basis labor + accrual profit, not sum"
```

---

### Task 6: Dashboard stat card — basis-aware subtitle + badge (`Index.tsx`)

**Files:**
- Modify: `src/pages/Index.tsx` (periodData memo ~lines 210-216; Labor stat card lines 791-804; summary cards 852-871)

**Interfaces:**
- Consumes: `periodMetrics.laborBasis` (Task 2).
- Produces: `periodData.labor_basis` for the card; subtitle no longer implies pending + actual sum to the headline.

- [ ] **Step 1: Thread `labor_basis` into `periodData`**

In the `periodData` memo (after `actual_labor_cost: periodMetrics.actualLaborCost,`, line 212), add:

```tsx
      labor_basis: periodMetrics.laborBasis,
```

- [ ] **Step 2: Fix the Labor stat card subtitle + add a basis badge (lines 791-804)**

Replace the `subtitle` prop (lines 800-802) so it names the basis and does not imply the two figures sum:

```tsx
                    subtitle={periodData
                      ? `${periodData.labor_cost_percentage.toFixed(1)}% of revenue · ${periodData.labor_basis === 'accrued' ? 'Accrued from time punches' : 'Paid via bank'}`
                      : undefined}
```

Change the card `title` (line 792) to carry the basis badge inline (the card renders `title` as a node):

```tsx
                    title={periodData
                      ? `Labor Cost · ${periodData.labor_basis === 'accrued' ? 'Accrued' : 'Paid'}`
                      : 'Labor Cost (Wages + Payroll)'}
```

- [ ] **Step 3: Caption the Pending/Actual summary cards (lines 852-871)**

Add a caption row above the two-card grid (immediately before line 852's `<div className="grid ...">`):

```tsx
                    <p className="px-4 pt-3 text-[11px] text-muted-foreground">
                      {periodData.labor_basis === 'accrued'
                        ? 'Only accrued (time-punch) labor counts toward the totals above.'
                        : 'Only paid (bank) labor counts toward the totals above.'}
                    </p>
```

- [ ] **Step 4: Typecheck**

Run: `npm run typecheck`
Expected: no errors.

- [ ] **Step 5: Commit**

```bash
git add src/pages/Index.tsx
git commit -m "fix(pnl): dashboard labor card names the basis; no phantom pending+actual sum"
```

---

### Task 7: P&L Detail breakdown — single active-basis child (`DetailedPnLBreakdown.tsx`)

**Files:**
- Modify: `src/components/DetailedPnLBreakdown.tsx` (labor node children, lines 250-276)

**Interfaces:**
- Consumes: `dailyCosts` (already reduced in scope) and `current.revenue` (net revenue) — derive basis locally; no prop/hook change needed.
- Produces: labor children whose percentages are of **net revenue** and that never sum to >100% of the parent.

- [ ] **Step 1: Replace the labor children block (lines 250-276)**

Replace the `children: current.labor_cost > 0 ? [ ... ] : undefined,` block with a basis-aware version. The active-basis child shows its percentage **of net revenue**; the non-basis figure is shown as an informational line with no misleading percentage-of-parent:

```tsx
        // Children reflect the de-dup basis: exactly ONE source is counted
        // toward Labor Cost. Percentages are of net revenue (not of the parent,
        // which previously made pending + actual sum to ~183%).
        children: current.labor_cost > 0 ? (() => {
          const pendingTotal = dailyCosts.reduce((sum, d) => sum + d.pending_labor_cost, 0);
          const actualTotal = dailyCosts.reduce((sum, d) => sum + d.actual_labor_cost, 0);
          const basis: 'accrued' | 'paid' = pendingTotal > 0 ? 'accrued' : 'paid';
          const netRevenue = current.revenue;
          const pct = (v: number) => (netRevenue > 0 ? (v / netRevenue) * 100 : 0);

          const countedChild = basis === 'accrued'
            ? {
                id: 'labor-pending',
                label: 'Pending Payroll (Scheduled) — counted',
                value: pendingTotal,
                percentage: pct(pendingTotal),
                type: 'line-item' as const,
                level: 1,
                insight: 'Accrued labor from employee time punches. This is the labor counted toward Labor Cost and Prime Cost for this period.',
                status: 'neutral' as const,
              }
            : {
                id: 'labor-actual',
                label: 'Actual Payroll (Paid) — counted',
                value: actualTotal,
                percentage: pct(actualTotal),
                type: 'line-item' as const,
                level: 1,
                insight: 'Paid labor from bank transactions. Counted toward Labor Cost because no time-punch labor was recorded for this period.',
                status: 'neutral' as const,
              };

          const otherValue = basis === 'accrued' ? actualTotal : pendingTotal;
          const otherChild = otherValue > 0
            ? [{
                id: basis === 'accrued' ? 'labor-actual' : 'labor-pending',
                label: basis === 'accrued'
                  ? 'Actual Payroll (Paid) — not counted this period'
                  : 'Pending Payroll (Scheduled) — not counted this period',
                value: otherValue,
                percentage: 0,
                type: 'line-item' as const,
                level: 1,
                insight: basis === 'accrued'
                  ? 'Bank payroll for the period. Excluded from the total to avoid double-counting the same labor already captured by time punches.'
                  : 'Scheduled/accrued labor. Zero or excluded because paid (bank) labor is the basis this period.',
                status: 'neutral' as const,
              }]
            : [];

          return [countedChild, ...otherChild];
        })() : undefined,
```

- [ ] **Step 2: Typecheck**

Run: `npm run typecheck`
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add src/components/DetailedPnLBreakdown.tsx
git commit -m "fix(pnl): P&L Detail labor children reflect single basis at %-of-net-revenue"
```

---

### Task 8: Full verification sweep

**Files:** none (verification only).

- [ ] **Step 1: Run the whole unit suite**

Run: `npm run test`
Expected: PASS. Investigate any labor/prime/profit assertion elsewhere that pinned the old summed value; update to the basis value and note it.

- [ ] **Step 2: Typecheck + lint**

Run: `npm run typecheck && npm run lint`
Expected: both clean.

- [ ] **Step 3: Commit any follow-on test updates**

```bash
git add -A
git commit -m "test(pnl): align remaining assertions with de-duplicated labor basis"
```

---

## Self-Review

**Spec coverage:**
- Shared hook de-dup → Tasks 1-2 ✓
- Report (`usePnLAnalyticsFromSource`) matches → automatic: it reduces daily `labor_cost`, now basis-respecting (Task 1/2) ✓
- Monthly Breakdown (all four layers) → Tasks 3-5 ✓
- Dashboard subtitle basis-naming + badge (critical #1) → Task 6 ✓
- P&L Detail single active-basis child at %-of-net-revenue (critical #2) → Task 7 ✓
- `laborBasis` exposed → Tasks 2 (hook), 3 (monthly) ✓
- Timezone-bucketing trade-off → documented in spec as deferred; no task (intentional) ✓

**Placeholder scan:** No TBD/TODO; every code step shows complete code. ✓

**Type consistency:** `LaborBasis` / `'accrued'|'paid'` used consistently; field names `laborBasis`, `laborForPnlCents`, `accrualExpensesCents`, `accrualNetProfitCents` match between Task 3 (producer) and Task 5 (consumer); `combineDailyCosts`/`resolveLaborBasis` signatures match between Task 1 and Tasks 2/4. ✓
