# Dashboard Aggregates — Design

Date: 2026-08-27
Branch: `fix/dashboard-aggregates`
Status: Approved approach C (phased hybrid). This document covers PR 1.

## Problem

The dashboard shows different results for the same period (Aug 1–27, 2026):

- Performance pills: profit +$20,623.
- Monthly view: loss −$19,583.
- Cashflow (Sankey): loss −$18,388.

Two causes exist. First, row-cap truncation drops data before the client
sums it. Second, each view computes its own formula on its own basis, and
no view labels its basis.

All dollar figures and row counts in this document come from read-only
production queries (`mcp__supabase-prod__execute_sql`) run on
2026-08-27 for the restaurant in the investigation. The investigation
report documents each query and result.

## Root causes (verified)

1. **Tip query truncation.** The tip query at
   `src/hooks/useMonthlyMetrics.tsx:453-458` has no limit and no
   pagination. PostgREST caps the response at 1,000 rows
   (`max_rows = 1000` in `supabase/config.toml`). The query window holds
   1,503 rows. August holds $4,692.54 of tips; most fall in the dropped
   tail.
2. **COGS truncation, twice, differently.** The pills read COGS through
   `useCostsFromSource` → `useUnifiedCOGS`
   (`src/hooks/useUnifiedCOGS.tsx:38-39`) → `useFoodCosts.tsx:48`, which
   sets `.limit(10000)`. The monthly view queries inventory usage itself
   with `.limit(10000)` at `src/hooks/useMonthlyMetrics.tsx:272-387`
   (7 call sites). The wide window holds 31,813 rows. Each view truncates
   a different 10,000-row slice, so pills show COGS 22,411 and monthly
   shows 23,465.
3. **Two labor formulas.** The pills call `calculateActualLaborCost`
   (`src/services/laborCalculations.ts:491`) through
   `src/hooks/useLaborCostsFromTimeTracking.tsx:136`. It counts straight
   time only. The monthly view calls `calculateActualLaborCostForMonth`
   (`src/services/laborCalculations.ts:865`) through
   `src/hooks/useMonthlyMetrics.tsx:551`. It adds weekly overtime,
   double time, and tips owed.
4. **No basis labels.** The pills stop at prime cost. The monthly view is
   a full accrual P&L. The Sankey is a cash view. No view says so.
5. **Sankey links are gross; the header is net.** The income links come
   from `useRevenueBreakdown` category totals
   (`src/components/dashboard/CashFlowSankeyChart.tsx:288-344`, gross
   $61,861). The header shows net revenue ($57,399).
6. **Silent failures.** Query failures in `useMonthlyMetrics` fall into
   `console.warn` catch blocks. The user sees a wrong number, not an
   error.

## Scope: PR 1 (this branch)

### 1. Fix truncation with `fetchAllRows`

Change these query paths to `fetchAllRows`
(`src/utils/fetchAllRows.ts`):

- The tip query in `useMonthlyMetrics.tsx:453-458`.
- The inventory-usage queries in `useMonthlyMetrics.tsx:272-387`.
- `useFoodCosts.tsx:48`.
- The financial COGS queries in `useCOGSFromFinancials.tsx:68-121`.

Delete every `.limit(10000)` in these files. `fetchAllRows` pages with
`.range()` and returns a `capped` flag when it stops at the page cap.

Two rules apply to every converted query:

- **Raise the page cap where the data exceeds it.** `fetchAllRows` stops
  at `DEFAULT_MAX_PAGES = 20` pages (20,000 rows). The wide COGS window
  holds 31,813 rows today. Pass `{ maxPages: 50 }` to every COGS call
  site. Keep the default for the tip query (1,503 rows).
- **Give every query a stable sort with a unique tiebreaker.** Pages
  from `.range()` overlap or skip rows when the sort is not
  deterministic. Follow the existing pattern at
  `src/hooks/useMonthlyMetrics.tsx:408-418`: `.order(<time column>,
  { ascending: true }).order('id')`. The tip query, the inventory-usage
  queries, and all four `useCOGSFromFinancials` queries have no
  `.order()` today. `useFoodCosts.tsx:47` orders by `created_at` only;
  add `.order('id')` as the tiebreaker.

### 2. Surface the `capped` flag

Add one small component, `DataCompletenessWarning`. When any
`fetchAllRows` result in a view reports `capped: true`, the view shows
the warning near the affected figure. Style: the amber alert panel
pattern from CLAUDE.md (`bg-amber-500/10 border-amber-500/20`). The
hooks above expose `capped` in their return values.

### 3. Make failures loud

Delete the `console.warn` catch blocks in `useMonthlyMetrics`. Let the
error reach the React Query error state. The page shows the existing
error UI instead of a wrong number.

### 4. Unify the labor formula

The pills adopt the same wage formula as the monthly view: weekly
overtime bands plus tips owed. Plan of record:

- Extract the week-bucketed wage computation from
  `calculateActualLaborCostForMonth` into a range-safe helper. It must
  bucket punches by `WEEK_STARTS_ON` weeks (`src/lib/dateConfig.ts:8`)
  for any date range, not only a calendar month.
- `useLaborCostsFromTimeTracking` calls the helper and adds tips owed
  from the paginated tip data.
- `useMonthlyMetrics` keeps its current result. Add a unit test that
  proves both paths return the same total for the same input.

The Payroll page formula (`calculateEmployeePay`,
`src/utils/payrollCalculations.ts:441`) stays the single source for
payroll runs. This change reuses it; it does not fork it.

### 5. Label the basis on each view

- Pills: add the caption "Before other expenses" under the profit pill.
- Monthly view: add "Accrual basis" to the section header.
- Sankey: add "Cash basis" to the section header.

Exact copy lands in the plan. All strings go through the existing text
conventions (Title case headers, sentence case captions).

### 6. Reconcile the Sankey income links

Keep the category links gross. Add one reconciliation line under the
header: "Gross $X − discounts and refunds $Y = Net $Z". Mark the link
tooltips "gross". This keeps the layout stable and makes the math
visible. We do not rescale links to net; per-category net data does not
exist in the breakdown payload.

### 7. Guardrail against new cap bugs

Two layers:

- **ESLint**: a `no-restricted-syntax` rule forbids the literal
  `.limit(10000)`. Message: "Use fetchAllRows. A fixed limit truncates
  silently."
- **Unit test** `tests/unit/highVolumeQueryGuard.test.ts`: scan `src/`
  for `.from('<table>')` on the high-volume list (`unified_sales`,
  `inventory_transactions`, `time_punches`, `bank_transactions`,
  `pending_outflows`). Each file that queries one must import
  `fetchAllRows` or appear in an explicit allowlist with a one-line
  reason. A new unlisted file fails CI.

The allowlist starts with the current 33 unprotected files. The list
shrinks over time; it cannot grow silently.

## Out of scope for PR 1

- **PR 2 (follow-up):** new aggregate RPCs `get_inventory_usage_totals`
  and `get_tip_totals`, in the pattern of `get_labor_sales_analytics`
  (SECURITY DEFINER, `SET search_path = public, pg_temp`, in-body
  membership check; see migration
  `supabase/migrations/20260809120000_get_labor_sales_analytics.sql`).
  The dashboard then reads totals, not rows.
- **Separate security PR:** add membership checks to
  `get_pass_through_totals` and `get_revenue_by_account`. Caller
  classification is complete: only browser hooks call them
  (`useRevenueBreakdown.tsx:171,184`, `useMonthlyMetrics.tsx:93,98`),
  so an `auth.uid()` guard breaks no service-role caller.
- **Follow-up task:** the Deno copy of `calculateActualLaborCost`
  (`supabase/functions/_shared/laborCalculations.ts:497`) ignores the
  restaurant timezone. The AI chat tool buckets days in UTC.

## Data flow after PR 1

```text
time_punches ──fetchAllRows──► one wage helper (OT bands) ──► pills AND monthly
unified_sales (tips) ──fetchAllRows──► tips owed ──► pills AND monthly
inventory_transactions ──fetchAllRows──► COGS sum ──► pills AND monthly
unified_sales (revenue) ──RPCs (unchanged)──► all views
```

Every figure that disagrees today reads the same rows and the same
formula after PR 1. The remaining differences are labeled bases, not
bugs.

## Error handling

- `fetchAllRows` throws on a page error. React Query catches it and
  sets the error state. The view renders the error UI.
- `capped: true` is not an error. It renders the completeness warning
  and still shows the partial figure.

## Testing

| Change | Test |
|--------|------|
| Tip pagination | Unit: mock paged responses; assert the full sum and the `capped` flag. |
| COGS pagination | Unit: same pattern for `useFoodCosts` and `useCOGSFromFinancials` paths. |
| Labor unification | Unit: pills helper and monthly formula return equal totals for one fixture. |
| Guardrail | Unit: the scan test fails on a synthetic violation fixture. |
| Basis labels + warning | E2E: dashboard shows the three basis labels; warning appears when a hook reports `capped`. |
