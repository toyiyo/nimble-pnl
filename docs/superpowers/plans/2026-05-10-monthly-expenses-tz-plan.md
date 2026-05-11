# Plan — Monthly Performance: TZ-safe expense bucketing & POS collected source-of-truth

**Date:** 2026-05-10
**Spec:** `docs/superpowers/specs/2026-05-10-monthly-expenses-tz-design.md`
**Branch:** `fix/monthly-expenses-tz`
**Estimated PRs:** 1

## Tasks (TDD order)

### 1. Add failing TZ-bucketing test for `useMonthlyExpenses`
- **File:** `tests/unit/useMonthlyExpenses.tz.test.ts` (new)
- **Setup:** `process.env.TZ = 'America/Chicago'` at top of file before imports
- **Approach:** Stub `@/lib/expenseDataFetcher` with `vi.mock`, return fixture
  rows whose `transaction_date` / `issue_date` is `'2026-05-01...'`
- **Assertions:** `result.find(m => m.period === '2026-05')` exists with the
  expected `foodCost` / `laborCost` / `totalExpenses`; no `'2026-04'` row.
- **Expected:** Fails on current code (rows leak into April).

### 2. Fix `useMonthlyExpenses.tsx`
- **File:** `src/hooks/useMonthlyExpenses.tsx`
- **Edits:**
  - Add `import { toUtcDayKey } from '@/services/cogsCalculations';`
  - Replace line 90: `const monthKey = toUtcDayKey(t.transaction_date).slice(0, 7);`
  - Replace line 116: `const monthKey = toUtcDayKey(parentTxn.transaction_date).slice(0, 7);`
  - Replace line 138: `const monthKey = toUtcDayKey(t.issue_date).slice(0, 7);`
- **Verify:** Test from step 1 goes green.

### 3. Add failing source-of-truth test for `monthlyPerformance.ts`
- **File:** `tests/unit/monthlyPerformance.test.ts` (new)
- **Cases:**
  - A: `totalCollectedAtPos = 31596.36` (caller passes deposit truth) →
    expect `posCollectedFromBreakdownCents === 3_159_636`.
  - B: `totalCollectedAtPos = null` → expect legacy `gross+passthrough`.
  - C: `totalCollectedAtPos = 0` → expect `0` (zero is a valid value, not a "missing" sentinel).
- **Expected:** Case A fails on current code.

### 4. Fix `monthlyPerformance.ts:115`
- **File:** `supabase/functions/_shared/monthlyPerformance.ts`
- **Edits:**
  - Change `totalCollectedAtPos` field type to `number | null` in
    `MonthlyPerformanceInput`.
  - Rewrite the `posCollectedFromBreakdownCents` derivation as in spec.
  - Update the JSDoc on `totalCollectedAtPos` to describe the new contract
    ("Prefer the deposit-matching `SUM(unified_sales.total_price)` from
    `get_unified_sales_totals.collected_at_pos`. Pass `null` to fall back to
    the legacy `gross + tax + tips + other_liabilities` formula.").
- **Verify:** Test from step 3 goes green.

### 5. Adapt `MonthlyBreakdownTable.tsx` if needed
- **File:** `src/components/MonthlyBreakdownTable.tsx`
- **Check:** It passes `totalCollectedAtPos: month.total_collected_at_pos`
  directly. If `total_collected_at_pos` is `undefined` for missing months,
  coerce to `null` (since the new contract distinguishes `null` from `0`).
- **Verify:** Grep `total_collected_at_pos` usage; confirm `useMonthlyMetrics`
  sets `total_collected_at_pos: posCollectedCents / 100` and never leaves it
  undefined.

### 6. Verify acceptance test still green
- **File:** `tests/unit/monthlyPerformance.acceptance.test.ts`
- **Action:** Run; April fixture passes `collected_at_pos: 92274.48` which
  equals the legacy formula, so no number should shift. No edit expected.

### 7. Full verification
- `npm run typecheck`
- `npm run lint`
- `npm run test` (full unit suite)
- Smoke: load `/dashboard` for Russo's, eyeball the May card.

### 8. Ship
- Commit with TDD-style message:
  - `fix(dashboard): bucket monthly expenses by UTC day & honor caller-supplied posCollectedAtPos`
- Push, open PR against `main`. CI must be green.

## Risk

Low. Frontend-only path. Pattern mirrors PR #492. Two narrow fixes, each
covered by a new unit test.

## Out of scope

- Performance Overview cards (already correct).
- "Other Expenses" composition (correct number, just unusual timing).
- Edge function callers of `calculateMonthlyPerformance` (none today).
