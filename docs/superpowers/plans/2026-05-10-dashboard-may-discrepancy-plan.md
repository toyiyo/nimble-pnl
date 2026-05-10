# Plan — Dashboard May 2026 cross-view consistency (Russo's Pizzeria)

**Branch:** `worktree-dashboard-may-discrepancy`
**Author:** Claude (Opus 4.7) on behalf of Jose
**Date:** 2026-05-10

## Context

For Russo's (timezone `America/Chicago`) on the May 2026 view, four UI surfaces show divergent numbers for the same month:

| Surface | Collected at POS | COGS | Actual labor |
|---|---|---|---|
| Performance Overview (`usePeriodMetrics`) | n/a | **$4,004** ✓ | **$9,422** ✓ |
| Monthly Performance row (`useMonthlyMetrics`) | **$32,951** ✗ | **$3,787** ✗ | **$9,031** ✗ |
| POS Sales page (`useUnifiedSalesTotals`) | **$31,596.36** ✓ | n/a | n/a |
| Cashflow viz (`useCashFlowMetrics`) | n/a | n/a | n/a |

Production (queried via Supabase MCP) confirms the source-of-truth:

- `SUM(unified_sales.total_price)` for May 2026 = **$31,596.36**
- Bank-financial COGS for May 2026 = **$4,003.73** (10 bank rows on May 1 alone, $216.75 of which is COGS — exactly the $217 missing from Monthly Perf)
- Gross revenue (positive item rows) = **$26,903.04**, Net = **$26,278.00**

User decision (already collected): **"Collected at POS" should match the deposit** — i.e. `SUM(unified_sales.total_price)` over the period, including void / discount offsets. This is what `get_unified_sales_totals` already returns and what the POS Sales page already shows.

## Three root causes

### 1. Timezone bucketing in shared COGS aggregator
`src/services/cogsCalculations.ts:105` and `:116` build the daily date key with:
```typescript
const date = format(new Date(txn.transaction_date), 'yyyy-MM-dd');
```
`bank_transactions.transaction_date` is `TIMESTAMPTZ` and rows arrive as ISO strings like `'2026-05-01T00:00:00+00:00'`. `new Date(...)` creates a UTC instant; `format()` then renders in the host timezone. For Russo's Chicago user this turns `2026-05-01 00:00 UTC` into `'2026-04-30'`, shoving the May 1 COGS row ($216.75) into April's bucket. The `parentDateMap` build in `useCOGSFromFinancials.tsx:99` and `useMonthlyMetrics.tsx:275` has the same shape.

### 2. Timezone bucketing in `useMonthlyMetrics` labor
`src/hooks/useMonthlyMetrics.tsx:136-154` defines `normalizeToLocalDate` which calls `new Date(rawDate)` then `getFullYear/Month/Date()`. Same shift on the same TIMESTAMPTZ data. Result: rows that occurred on a UTC business date land in the prior local month if their UTC midnight falls before local midnight. `useLaborCostsFromTransactions.tsx:91` (used by Performance Overview) deliberately keeps the raw string as the date key — so it doesn't have the bug. Monthly Perf does.

### 3. "Collected at POS" formula divergence
`useMonthlyMetrics.fetchMonthRevenueTotals` (lines 100-101) and `useRevenueBreakdown` (lines 349 / 716) compute:
```text
collected_at_pos = gross + tax + tips + service_charge + fee
```
That excludes the discount/void offset rows that actually reduce the deposit. `get_unified_sales_totals` returns `SUM(total_price)`, which is the deposit. For May Russo's, the difference is exactly `−$625.04 (discounts) − $729.40 (voids) = −$1,354.44 → $32,950.80 vs $31,596.36`.

## Goal

Make the same period (e.g. May 1–31 2026) produce identical values for `collected_at_pos`, `cogs`, and `actual_labor` across `usePeriodMetrics`, `useMonthlyMetrics`, `useRevenueBreakdown`, and `useUnifiedSalesTotals`. Pin Russo's May 2026 production numbers in tests.

Out of scope: cashflow visualization (uses bank-only inflow/outflow, a different metric). The user listed it for cross-reference, not numeric equivalence.

## Acceptance criteria

For the May 1–31 2026 window on Russo's:

| Metric | Expected | Tolerance |
|---|---|---|
| `useMonthlyMetrics[May].total_collected_at_pos` | **$31,596.36** | ±$0.01 |
| `useRevenueBreakdown.totals.total_collected_at_pos` | **$31,596.36** | ±$0.01 |
| `useUnifiedSalesTotals.collectedAtPOS` (POS Sales page) | **$31,596.36** | unchanged |
| `useMonthlyMetrics[May].food_cost` | **$4,003.73** | ±$0.01 |
| `useMonthlyMetrics[May].actual_labor_cost` | matches `useLaborCostsFromTransactions.totalCost` | ±$0.01 |
| `useMonthlyMetrics[April].food_cost` | does **not** include the May 1 $216.75 row | ±$0.01 |

Plus existing breakdown values (gross $26,903.04, discounts $625.04, net $26,278.00) remain unchanged.

Lint, typecheck, and the existing test suites must remain green.

## Approach

### Phase A — TZ fix (low-risk, surgical)

1. **`src/services/cogsCalculations.ts`** — replace both `format(new Date(txn.transaction_date), 'yyyy-MM-dd')` and `format(new Date(parent.transaction_date), 'yyyy-MM-dd')` with the raw 10-char prefix:
   ```typescript
   const date = txn.transaction_date.slice(0, 10);
   ```
   Add a small guard so non-string inputs (already a `yyyy-MM-dd` DATE string from `pending_outflows.issue_date`) pass through unchanged. Drop the unused `format` / `date-fns` imports if any become unused.

2. **`src/hooks/useCOGSFromFinancials.tsx:99`** — replace the `parentDateMap` build with `parent.transaction_date.slice(0, 10)`.

3. **`src/hooks/useMonthlyMetrics.tsx`**:
   - In the financial-COGS section (line 275), build `parentDateMap` with `.slice(0, 10)` instead of `format(new Date(...), 'yyyy-MM-dd')`.
   - In the bank/pending labor sections (lines 513-538), replace `normalizeToLocalDate(...)` with a direct `monthKey = txn.transaction_date.slice(0, 7)` (and `txn.issue_date.slice(0, 7)` for pending). Delete `normalizeToLocalDate` entirely if it has no other callers.

Why slice and not the host TZ? `transaction_date` for bank rows is a banking business-date stored at `00:00:00 UTC` by Plaid/Stripe FC. The user reads "May 1" off their bank statement and expects "May 1" on the dashboard. The UTC date is the canonical bucket. `useLaborCostsFromTransactions` and `useUnifiedCOGS` already do this implicitly by keeping the raw string.

### Phase B — Standardize "Collected at POS"

1. **`fetchMonthRevenueTotals` (`src/hooks/useMonthlyMetrics.tsx:54-112`)**: add a third parallel call to `get_unified_sales_totals(p_restaurant_id, p_start_date, p_end_date, p_search_term=null)` and overwrite `posCollectedCents` with `toC(result.collected_at_pos)`. Keep the other RPC results for gross/discounts/tax/tips/other (those values are correct and used by the breakdown column).

2. **`useRevenueBreakdown.tsx`** — update both the RPC-path (line 349) and the fallback path (line 716) `totalCollectedAtPOS` calculation:
   - Best path: also call `get_unified_sales_totals` and use its `collected_at_pos` value as `total_collected_at_pos` in the returned `totals` object.
   - Fallback path: mirror the RPC formula — `SUM(unified_sales.total_price) over the period` directly when fetching from the table.

3. Document the contract at the top of both hooks: "`total_collected_at_pos` is the deposit-matching SUM over `unified_sales.total_price` for the period; it intentionally includes void and discount offset rows."

### Phase C — Tests pinning the production numbers

Three new unit tests under `tests/unit/` (Vitest):

1. **`cogsCalculations.tz.test.ts`** — given a fixture with `transaction_date='2026-05-01T00:00:00+00:00'` and amount $-216.75, force the host TZ to `America/Chicago`, expect `aggregateFinancialCOGSByDate(...).get('2026-05-01') === 216.75` (red before the fix; green after).

2. **`useMonthlyMetrics.collected.test.ts`** (or extension to existing) — mock the three RPCs to return the production values for Russo's May, assert `total_collected_at_pos === 31596.36`, `food_cost === 4003.73`, `net_revenue === 26278.00`.

3. **`useRevenueBreakdown.collected.test.ts`** — mock the same RPCs, assert `totals.total_collected_at_pos === 31596.36`.

If `process.env.TZ` doesn't propagate cleanly in Vitest, fall back to a `vi.setSystemTime` + `Intl.DateTimeFormat` resolved-options check, or use `@vitest/utils` to mock `Date#getTimezoneOffset`. We can also set `TZ=America/Chicago` in the npm test command for these specific tests via a separate Vitest project.

### Phase D — Verify in browser

After tests are green, start `npm run dev` and load the dashboard while logged in as a Russo's user. With "This Month" period selected (today is 2026-05-10, so range = May 1 → today):

- Performance Overview: COGS card should remain $4,004; labor card should remain $9,422 (unchanged — those were already correct).
- Monthly Performance row for May: COGS column should change from $3,787 → $4,004; Labor "Actual" should move toward $9,422; "Collected at POS" should change from $32,951 → $31,596.
- POS Sales page filtered to May: Collected $31,596.36 unchanged.

If the user's session can't easily filter the POS Sales page to a full May window inside the dev server (date pickers may default to today), record the test as a Vitest acceptance instead and call out in the PR description that visual verification was done against the existing data.

## File-level change list

| File | Change |
|---|---|
| `src/services/cogsCalculations.ts` | `slice(0,10)` instead of `format(new Date(...), 'yyyy-MM-dd')`; remove unused `format` import |
| `src/hooks/useCOGSFromFinancials.tsx` | Same fix in `parentDateMap` build |
| `src/hooks/useMonthlyMetrics.tsx` | Same fix in `parentDateMap`; remove `normalizeToLocalDate`; replace labor txn bucketing with `.slice(0,7)`; add `get_unified_sales_totals` call to `fetchMonthRevenueTotals` and overwrite `posCollectedCents` |
| `src/hooks/useRevenueBreakdown.tsx` | Use `get_unified_sales_totals.collected_at_pos` for `total_collected_at_pos` (both RPC + fallback paths) |
| `tests/unit/cogsCalculations.tz.test.ts` | NEW — pin TZ bucketing |
| `tests/unit/useMonthlyMetrics.collected.test.ts` | NEW — pin Russo's May numbers |
| `tests/unit/useRevenueBreakdown.collected.test.ts` | NEW — pin Russo's May numbers |

No DB migrations. No edge function changes. RPCs are already in place.

## Risks & rollback

- **Risk**: `get_unified_sales_totals` does not currently expose category/account-level breakdown — but we only need its `collected_at_pos` field. Other fields stay sourced from `get_revenue_by_account` + `get_pass_through_totals`. Low risk.
- **Risk**: A restaurant in a UTC+ timezone with bank rows at 00:00 UTC could see *different* (potentially still wrong) bucketing. Mitigated because slice always uses the UTC date, which is also what Plaid sends. We're standardizing on UTC date as the canonical bucket and documenting this.
- **Risk**: Removing `normalizeToLocalDate` could affect other callers. Verified — it's defined inline inside `useMonthlyMetrics.queryFn` so no external callers.
- **Rollback**: Revert the merge commit. No data is mutated; this is presentation-layer only.

## Out of scope

- Cashflow viz consistency (uses bank-only flows, separate metric).
- April retroactive correction (the bug was *moving* a row's bucket; once fixed, April will lose the misattributed $216.75 — that's the desired behavior, not a separate fix).
- Tip-credit and OT-D labor logic (already validated by PR #485 series).
- Schema changes to `bank_transactions.transaction_date` (would require a separate migration; out of scope for this fix).

## Build sequence

1. Phase C tests first (red-first TDD).
2. Phase A TZ fixes → tests for COGS/labor go green.
3. Phase B Collected-at-POS standardization → tests for collected go green.
4. Phase D verify in browser; spot-check April loses the $217.
5. Run `npm run typecheck`, `npm run lint`, `npm run test`.
6. code-simplifier agent on diff.
7. feature-dev:code-reviewer agent on diff.
8. PR + CI loop.
