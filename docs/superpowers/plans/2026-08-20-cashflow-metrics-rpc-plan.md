# Plan: Cash flow metrics RPC

Design: `docs/superpowers/specs/2026-08-20-cashflow-metrics-rpc-design.md`
Branch: `feature/cashflow-metrics-rpc`
Worktree: `.claude/worktrees/cashflow-metrics-rpc`

Follow the design for every contract detail. This plan gives the build
order. Each step ends with a green gate before the next step starts.

## Step 1: SQL migration + pgTAP (TDD)

1. Write `supabase/tests/get_cash_flow_metrics.test.sql` first. Use the
   10 cases from the design's test plan. Impersonate with
   `set_config('request.jwt.claims', '{"sub":"<uuid>","role":"authenticated"}', true)`.
   Seed `user_restaurants` rows with roles `staff` and
   `collaborator_accountant` for the role-boundary cases.
2. Write `supabase/migrations/20260820120000_get_cash_flow_metrics.sql`.
   Contract: see design section 1. Gate:
   `user_has_capability(p_restaurant_id, 'view:transactions')`.
   Grants: `GRANT EXECUTE ... TO authenticated`; `REVOKE ALL ... FROM
   PUBLIC, anon`.
3. Run `npm run db:reset`, then `npm run test:db`. All cases green.
4. Run one `EXPLAIN` on the aggregate query against the local database.
   Check that the plan uses `idx_bank_transactions_restaurant_date`.

## Step 2: Types entry

1. Add `get_cash_flow_metrics` to `Database['public']['Functions']` in
   `src/integrations/supabase/types.ts`, next to
   `get_labor_sales_analytics` (line ~11308). Args:
   `{ p_restaurant_id: string; p_start_date: string; p_end_date: string;
   p_bank_account_id?: string }`. Returns: `Json`.
2. Run `npm run typecheck`.

## Step 3: Derive module (TDD)

1. Write `tests/unit/cashFlowMetrics.test.ts` first. Cases from the
   design: 7-day slice, volatility over present days only, trend
   zero-fill, trailing percentage with the zero guard, day-count
   divisor, empty series.
2. Write `src/lib/cashFlowMetrics.ts` with `deriveCashFlowMetrics`.
   Day keys: RPC strings directly; `toDateOnlyString()` from
   `src/lib/dateOnly.ts` for `Date` values. No `toISOString()` slices,
   no `format(instant, 'yyyy-MM-dd')` (lint rule `restaurant-clock`).
3. Run `npm run test -- cashFlowMetrics`.

## Step 4: Pagination helper (TDD)

1. Write the `fetchAllPages` cases into a unit test file first:
   multi-page assembly, `truncated` at `MAX_PAGES`, error propagation.
2. Write `src/lib/paginatedBankQuery.ts`. Move `PAGE_SIZE` and
   `MAX_PAGES` there from `useCashFlowInsights`.
3. Run the unit tests.

## Step 5: Rewire useCashFlowMetrics

1. Change `src/hooks/useCashFlowMetrics.tsx` to call
   `supabase.rpc('get_cash_flow_metrics', ...)` and
   `deriveCashFlowMetrics`. Convert `'all'` to `null` for
   `p_bank_account_id`. Keep the query key, `staleTime`, and the
   `enabled` guard.
2. Change `src/components/banking/FinancialPulseHero.tsx`: read
   `error` from the hook; show "Cannot load cash flow data" as a muted
   line in place of the metric grid on error.
3. Add the hook wiring unit tests (mocked `rpc` success + rejection).
4. Run `npm run typecheck`, `npm run lint`, `npm run test`.

## Step 6: Convert the four scan hooks

For each hook, keep the filters and the aggregation unchanged.

1. `src/hooks/useCashFlowInsights.tsx`: replace the local loop with
   `fetchAllPages`. No behavior change.
2. `src/hooks/useRevenueHealth.tsx`: page the scan; add
   `.order('transaction_date').order('id')`; end bound
   `T23:59:59.999Z`; return `truncated`.
3. `src/hooks/useExpenseHealth.tsx`: same, and this hook has no
   `.order()` today. Change the mock builder in
   `tests/unit/useExpenseHealth.test.tsx` to accept `.order()`.
4. `src/hooks/useLiquidityMetrics.tsx` (lines 73-88 scan): same
   conversion.
5. `src/hooks/usePredictableExpenses.tsx`: page the scan; end bound
   `` `${toDateOnlyString(today)}T23:59:59.999Z` ``.
6. Run `npm run typecheck`, `npm run lint`, `npm run test`.

## Step 7: E2E

1. Extend `tests/e2e/financial-intelligence-cashflow.spec.ts`. Seed
   rows that include one transfer and one final-day transaction.
   Assert: the hero net value equals the Cash Flow section net value.
2. Run the spec locally against the local Supabase stack.

## Step 8: Ship

Run the dev-build-and-ship workflow phases: UI review, code-simplify,
reviewers, gates, PR, CI watch, comment triage, retrospective.

## Risks

- The pgTAP role cases need correct seed rows in `user_restaurants`;
  copy the seed pattern from
  `supabase/tests/user_has_capability_areas_test.sql`.
- The hero values change on purpose (transfers out, final day in, UTC
  buckets). The E2E equality assertion is the guard, not a
  value-snapshot test.
- `usePredictableExpenses` uses `new Date()` inside the query function;
  keep that behavior, only change the bound format.
