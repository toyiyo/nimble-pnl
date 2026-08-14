# AI financial tools: move every financial sum into SQL

- **Date:** 2026-08-13
- **Author:** Jose M Delgado (with Claude)
- **Status:** Draft for review
- **Feature area:** AI chat financial tools (`supabase/functions/ai-execute-tool/index.ts`)
- **Scope:** Replace every raw-row fetch plus JavaScript sum in the AI tool
  executor with a SQL aggregate. About 32 sites across 12 tools. Add 8 aggregate
  RPCs and reuse 1. Keep each displayed number correct, and unify the numbers on
  the app P&L definitions.

This document uses STE-aligned Simplified Technical English. Code identifiers,
SQL, and file paths stay exact.

---

## 1. Problem

The AI chat tools report wrong financial numbers. A tool fetches raw rows from a
large table, then sums the rows in JavaScript with `.reduce()`. PostgREST caps
every response at 1000 rows (`max_rows = 1000` in `supabase/config.toml`) and
returns success, not an error. So every JavaScript sum truncates once the
filtered set is larger than 1000 rows.

### 1.1 Validated impact (July 2026, one restaurant)

- **Revenue.** 13,049 sale rows. The bot said `$5,693.62`. The correct net sales
  figure is `$72,090.74`.
- **COGS.** 14,311 usage rows. The bot said `$197.50`. The correct figure is
  `$2,619.29`.
- **Sign error.** The bot reported a loss. July was profitable.

### 1.2 Second defect — the tools disagree

The tools do not share one revenue definition. The income-statement revenue
fetch has no filters at all
([`index.ts:935`](supabase/functions/ai-execute-tool/index.ts:935)). It counts
refunds, split-sale duplicates, tax, and tips. The sales-summary fetch has both
guards
([`index.ts:1238`](supabase/functions/ai-execute-tool/index.ts:1238)). So two
tools return two different revenue numbers for the same period. This
inconsistency is a second root cause of the wrong answers.

### 1.3 Latent boundary defect — COGS end day

The income-statement COGS fetch filters `created_at` with a bare date string
([`index.ts:945`](supabase/functions/ai-execute-tool/index.ts:945)). The column
is a `timestamptz`. A bare date string coerces to `00:00:00`. So the fetch drops
almost all of the last day. The KPIs food-cost fetch already appends
`'T23:59:59.999Z'`
([`index.ts:222`](supabase/functions/ai-execute-tool/index.ts:222)). So the
tools also disagree on the end boundary.

---

## 2. Goals and non-goals

### 2.1 Goals

1. Remove the 1000-row cap from every financial sum. SQL sums every row
   server-side.
2. Unify the numbers on the app P&L definitions. Every tool applies the same
   filters for the same metric.
3. Keep the edge-function CPU cost low. Push the aggregate into SQL, per the
   CLAUDE.md rule for large data.
4. Fix the COGS end-day boundary. Include the full end day.
5. Prove each cluster against production before the PR.

### 2.2 Non-goals

- Do not change the break-even variable-cost math or the margin-of-safety unit
  ([`index.ts:2622`](supabase/functions/ai-execute-tool/index.ts:2622)). This is
  a later PR (fix 2).
- Do not relabel the operating-costs output as a budget
  ([`index.ts:2565`](supabase/functions/ai-execute-tool/index.ts:2565)). This is
  a later PR (fix 3).
- Do not change the AI chat UI, the tool registry schema, or the model prompts.
- Do not change the categorization write logic. Only clamp its input id count.

---

## 3. Audit inventory

Two parallel audits mapped the file. Every site fetches raw rows, then sums in
JavaScript. The table groups the sites by the data they aggregate.

### 3.1 Cap-vulnerable sites by cluster

| Cluster | Table | Site (tool → metric) | Select `file:line` | Sum `file:line` | Guards today |
|---|---|---|---|---|---|
| 1 | `unified_sales` | KPIs → revenue + adjustments | [206](supabase/functions/ai-execute-tool/index.ts:206), [214](supabase/functions/ai-execute-tool/index.ts:214) | `_shared/periodMetrics.ts` | adj only |
| 1 | `unified_sales` | income_statement → revenue | [935](supabase/functions/ai-execute-tool/index.ts:935) | [940](supabase/functions/ai-execute-tool/index.ts:940) | none |
| 1 | `unified_sales` | sales_summary → current total | [1238](supabase/functions/ai-execute-tool/index.ts:1238) | [1249](supabase/functions/ai-execute-tool/index.ts:1249) | adj + split |
| 1 | `unified_sales` | sales_summary → previous total | [1284](supabase/functions/ai-execute-tool/index.ts:1284) | [1292](supabase/functions/ai-execute-tool/index.ts:1292) | adj + split |
| 1 | `unified_sales` | generate_report monthly_pnl → revenue | [1674](supabase/functions/ai-execute-tool/index.ts:1674) | [1679](supabase/functions/ai-execute-tool/index.ts:1679) | none |
| 1 | `unified_sales` | operating_costs → break-even revenue | [2614](supabase/functions/ai-execute-tool/index.ts:2614) | [2622](supabase/functions/ai-execute-tool/index.ts:2622) | adj + split |
| 2 | `unified_sales` | generate_report → sales_by_category | [1750](supabase/functions/ai-execute-tool/index.ts:1750) | [1762](supabase/functions/ai-execute-tool/index.ts:1762) | none |
| 2 | `unified_sales` | sales_summary → top items | [1238](supabase/functions/ai-execute-tool/index.ts:1238) | [1256](supabase/functions/ai-execute-tool/index.ts:1256) | adj + split |
| 3 | `inventory_transactions` | KPIs → food cost | [222](supabase/functions/ai-execute-tool/index.ts:222) | `_shared/periodMetrics.ts` | usage |
| 3 | `inventory_transactions` | income_statement → COGS | [945](supabase/functions/ai-execute-tool/index.ts:945) | [951](supabase/functions/ai-execute-tool/index.ts:951) | usage |
| 3 | `inventory_transactions` | generate_report monthly_pnl → COGS | [1684](supabase/functions/ai-execute-tool/index.ts:1684) | [1690](supabase/functions/ai-execute-tool/index.ts:1690) | usage |
| 3 | `inventory_transactions` | monthly_trends → food cost by month | [2698](supabase/functions/ai-execute-tool/index.ts:2698) | [2708](supabase/functions/ai-execute-tool/index.ts:2708) | usage |
| 4 | `journal_entry_lines` | income_statement → OpEx | [964](supabase/functions/ai-execute-tool/index.ts:964) | [973](supabase/functions/ai-execute-tool/index.ts:973) | expense accts |
| 5 | `products` | KPIs → inventory value | [299](supabase/functions/ai-execute-tool/index.ts:299) | [306](supabase/functions/ai-execute-tool/index.ts:306) | restaurant |
| 5 | `products` | inventory_status → value + counts | [376](supabase/functions/ai-execute-tool/index.ts:376) | [408](supabase/functions/ai-execute-tool/index.ts:408) | restaurant |
| 5 | `products` | income_statement balance_sheet → inventory | [1018](supabase/functions/ai-execute-tool/index.ts:1018) | [1021](supabase/functions/ai-execute-tool/index.ts:1021) | restaurant |
| 5 | `products` | generate_report balance_sheet → inventory | [1809](supabase/functions/ai-execute-tool/index.ts:1809) | [1812](supabase/functions/ai-execute-tool/index.ts:1812) | restaurant |
| 6 | `bank_transactions` | financial_intelligence cash_flow | [503](supabase/functions/ai-execute-tool/index.ts:503) | [516](supabase/functions/ai-execute-tool/index.ts:516) | date |
| 6 | `bank_transactions` | financial_intelligence revenue_health | [560](supabase/functions/ai-execute-tool/index.ts:560) | [577](supabase/functions/ai-execute-tool/index.ts:577) | date, amount>0 |
| 6 | `bank_transactions` | financial_intelligence spending | [613](supabase/functions/ai-execute-tool/index.ts:613) | [633](supabase/functions/ai-execute-tool/index.ts:633) | date, amount<0 |
| 6 | `bank_transactions` | financial_intelligence liquidity | [698](supabase/functions/ai-execute-tool/index.ts:698) | [709](supabase/functions/ai-execute-tool/index.ts:709) | 30-day, amount<0 |
| 6 | `bank_transactions` | financial_intelligence predictions | [736](supabase/functions/ai-execute-tool/index.ts:736) | [748](supabase/functions/ai-execute-tool/index.ts:748) | 60-day |
| 6 | `bank_transactions` | get_bank_transactions → summary | [840](supabase/functions/ai-execute-tool/index.ts:840) | [884](supabase/functions/ai-execute-tool/index.ts:884) | many, `.limit` unclamped |
| 6 | `bank_transactions` | income_statement cash_flow | [1066](supabase/functions/ai-execute-tool/index.ts:1066) | [1072](supabase/functions/ai-execute-tool/index.ts:1072) | date |
| 6 | `bank_transactions` | generate_report monthly_pnl → expenses | [1695](supabase/functions/ai-execute-tool/index.ts:1695) | [1701](supabase/functions/ai-execute-tool/index.ts:1701) | date, amount<0 |
| 6 | `bank_transactions` | generate_report → cash_flow | [1781](supabase/functions/ai-execute-tool/index.ts:1781) | [1787](supabase/functions/ai-execute-tool/index.ts:1787) | date |
| 6 | `bank_transactions` | expense_health → 6 sums | [2795](supabase/functions/ai-execute-tool/index.ts:2795) | [2819](supabase/functions/ai-execute-tool/index.ts:2819)–[2852](supabase/functions/ai-execute-tool/index.ts:2852) | date, status |

### 3.2 Lower-risk sites (input-bound, not period-bound)

- `executeBatchCategorizeTransactions`
  ([`index.ts:3302`](supabase/functions/ai-execute-tool/index.ts:3302)) and
  `executeBatchCategorizePosSales`
  ([`index.ts:3390`](supabase/functions/ai-execute-tool/index.ts:3390)) fetch by
  `.in('id', ids)`. They truncate only when the caller passes more than 1000
  ids. The fix is a clamp on the id count, not an RPC.

### 3.3 Reviewed, not vulnerable

- `bank_transactions` count in KPIs uses `head:true` with `count:'exact'`
  ([`index.ts:312`](supabase/functions/ai-execute-tool/index.ts:312)). PostgREST
  returns the count server-side. The row cap does not apply.
- `connected_banks` sums
  ([`index.ts:677`](supabase/functions/ai-execute-tool/index.ts:677),
  [`index.ts:1007`](supabase/functions/ai-execute-tool/index.ts:1007)) and the
  trial-balance loop over `chart_of_accounts`
  ([`index.ts:1121`](supabase/functions/ai-execute-tool/index.ts:1121)) run over
  bounded tables. Row counts stay under 1000.
- `executeGetInventoryTransactions` delegates to `fetchInventoryTransactions`
  with `limit: Math.min(limit, 200)`
  ([`index.ts:1365`](supabase/functions/ai-execute-tool/index.ts:1365)). It lists
  rows; it does not sum them.

---

## 4. Approach

### 4.1 Chosen approach — SQL aggregate RPCs (recommended)

Push each sum into SQL. For a breakdown (by category, by month, by day), use
`GROUP BY`. `GROUP BY` collapses millions of rows into a bounded set —
categories, at most 13 months, at most 366 days. Every grouped result is far
under 1000 rows. JavaScript then keeps only the derived math (variance, forecast,
percentage) over the small, complete set.

This approach matches the codebase. CLAUDE.md requires SQL-side aggregation for
large data, because edge functions have a ~10s CPU limit. The repo already uses
purpose-built aggregate RPCs (`get_daily_sales_totals`,
`get_monthly_sales_metrics`, `get_labor_sales_analytics`).

### 4.2 Rejected alternatives

- **Pagination helper.** A helper loops `.range()` until the fetch is empty, then
  the JavaScript sums stay. The per-site change is small. But the helper pulls
  10,000 to 150,000 rows into the edge function for a wide period. This breaks the
  CPU and memory budget. It is the pattern CLAUDE.md forbids for large data.
- **Hybrid.** RPCs for the proven paths plus pagination for the long tail. This
  keeps two patterns. It is harder to test and to maintain.

---

## 5. RPC specifications

Reuse 1 function. Add 8. Every new function follows the `get_daily_sales_totals`
template ([`ai_operator.sql:678`](supabase/migrations/20260214100000_ai_operator.sql:678)):

- `LANGUAGE sql STABLE SECURITY INVOKER` for a scalar or grouped aggregate.
- `SECURITY INVOKER`, not `DEFINER`. RLS stays in force for a client caller. The
  `ai-execute-tool` edge function calls with the service role, which bypasses
  RLS. So the explicit `restaurant_id = p_restaurant_id` filter scopes both
  callers.
- `SUM(COALESCE(col, 0))` for every sum. A SQL `SUM` over an all-NULL group
  returns NULL. `unified_sales.total_price` and other columns are nullable
  (lesson L1752).
- `GRANT EXECUTE ... TO authenticated`, re-issued after `CREATE OR REPLACE`.
- A `COMMENT ON FUNCTION` that states the source, the filters, and the exclusions.

### 5.1 Reuse — `get_monthly_sales_metrics` (revenue, cluster 1)

Signature (existing):
`get_monthly_sales_metrics(p_restaurant_id UUID, p_date_from DATE, p_date_to DATE)`
([`20260501120000_fix_monthly_sales_metrics_revenue_filter.sql:14`](supabase/migrations/20260501120000_fix_monthly_sales_metrics_revenue_filter.sql:14)).

Callers sum `gross_revenue - discounts` across the returned month rows. The
`WHERE sale_date BETWEEN p_date_from AND p_date_to` clause bounds the exact
range. So a partial-month range still sums only the in-range rows. This is the
app P&L net-sales figure. It applies the adjustment guard, the split guard, the
item-type guard, and the liability-account guard.

### 5.2 New — `get_sales_by_category` (cluster 2)

`get_sales_by_category(p_restaurant_id UUID, p_start_date DATE, p_end_date DATE)`
→ `TABLE(category_id UUID, category_name TEXT, revenue NUMERIC, item_count BIGINT)`.

Source `unified_sales`, grouped by category. Same guards as §5.1 (adjustment,
split, item-type). Drives generate_report `sales_by_category`.

### 5.3 New — `get_top_sold_items` (cluster 2)

`get_top_sold_items(p_restaurant_id UUID, p_start_date DATE, p_end_date DATE, p_limit INT DEFAULT 10)`
→ `TABLE(item_name TEXT, revenue NUMERIC, quantity NUMERIC, sale_count BIGINT)`
`ORDER BY revenue DESC LIMIT p_limit`.

Source `unified_sales`, grouped by item name. Same guards as §5.1. Drives the
sales-summary top-sellers block.

### 5.4 New — `get_inventory_usage_by_month` (COGS, cluster 3)

`get_inventory_usage_by_month(p_restaurant_id UUID, p_start_date DATE, p_end_date DATE)`
→ `TABLE(period TEXT, food_cost NUMERIC)`.

Source `inventory_transactions`. Filter `transaction_type = 'usage'`. Sum
`ABS(COALESCE(SUM(total_cost), 0))` per month. `ABS(SUM(...))` matches the
current code and is correct: a reversal row reduces the cost. A scalar caller
sums the month rows. `monthly_trends` reads the month rows directly.

Boundary: filter `created_at >= p_start_date AND created_at < (p_end_date + 1)`.
This includes the full end day. It fixes the defect in §1.3.

### 5.5 New — `get_journal_expense_total` (OpEx, cluster 4)

`get_journal_expense_total(p_restaurant_id UUID, p_start_date DATE, p_end_date DATE)`
→ `NUMERIC`.

Source `journal_entry_lines` joined to `journal_entries` and
`chart_of_accounts`. Filter `chart_of_accounts.restaurant_id = p_restaurant_id`,
`account_type = 'expense'`, and `entry_date` in range. Return
`COALESCE(SUM(debit_amount - credit_amount), 0)`. This replaces the
`expenseAccountIds` round-trip
([`index.ts:957`](supabase/functions/ai-execute-tool/index.ts:957)) with one
call.

### 5.6 New — `get_inventory_valuation` (cluster 5)

`get_inventory_valuation(p_restaurant_id UUID)`
→ `TABLE(total_value NUMERIC, item_count BIGINT, low_stock_count BIGINT)`.

Source `products`. `total_value = COALESCE(SUM(current_stock * cost_per_unit),
0)`. `low_stock_count` counts rows where the stock is at or under the reorder
point. The exact low-stock predicate copies the current code
([`index.ts:427`](supabase/functions/ai-execute-tool/index.ts:427)).

### 5.7 New — `get_bank_transaction_summary` (cluster 6 scalars)

`get_bank_transaction_summary(p_restaurant_id UUID, p_start_date DATE, p_end_date DATE, p_bank_account_id UUID DEFAULT NULL, p_statuses TEXT[] DEFAULT NULL)`
→ `TABLE(inflow NUMERIC, outflow NUMERIC, net NUMERIC, tx_count BIGINT, inflow_count BIGINT, outflow_count BIGINT, avg_inflow NUMERIC, max_inflow NUMERIC)`.

Source `bank_transactions`. `inflow = SUM(amount) FILTER (WHERE amount > 0)`.
`outflow = ABS(SUM(amount) FILTER (WHERE amount < 0))`. The two optional
parameters preserve each caller's current filter. `p_bank_account_id` filters
one account when set. `p_statuses` filters `status = ANY(p_statuses)` when set;
`NULL` applies no status filter. This one function serves cash_flow,
revenue_health, spending totals, liquidity, income_statement cash_flow,
generate_report, and expense_health.

### 5.8 New — `get_bank_spending_by_category` (cluster 6 breakdown)

`get_bank_spending_by_category(p_restaurant_id UUID, p_start_date DATE, p_end_date DATE, p_statuses TEXT[] DEFAULT NULL)`
→ `TABLE(category_id UUID, category_name TEXT, spend NUMERIC, tx_count BIGINT)`.

Source `bank_transactions`, `amount < 0`, grouped by category. Drives the
spending breakdown and the expense_health category sums.

### 5.9 New — `get_bank_transactions_daily` (cluster 6 series)

`get_bank_transactions_daily(p_restaurant_id UUID, p_start_date DATE, p_end_date DATE, p_bank_account_id UUID DEFAULT NULL)`
→ `TABLE(day DATE, inflow NUMERIC, outflow NUMERIC, net NUMERIC)`.

Source `bank_transactions`, grouped by `transaction_date`. The result has at most
one row per day. JavaScript keeps the forecast math (predictions) and the
variance math (cash_flow) over this bounded series.

---

## 6. Rewiring plan

Each site swaps its raw fetch for one RPC call. The derived math stays in
JavaScript, over the complete aggregate.

- **Cluster 1 (revenue).** Call `get_monthly_sales_metrics`. Sum
  `gross_revenue - discounts`. Sites: income_statement, sales_summary
  (current + previous), generate_report monthly_pnl, operating_costs. KPIs routes
  its revenue and adjustment split through the same RPC; the plan confirms the
  field map against `_shared/periodMetrics.ts`.
- **Cluster 2 (sales breakdown).** generate_report calls
  `get_sales_by_category`. sales_summary calls `get_top_sold_items`.
- **Cluster 3 (COGS).** Scalar callers (KPIs, income_statement,
  generate_report) call `get_inventory_usage_by_month` and sum the month rows.
  monthly_trends reads the month rows directly.
- **Cluster 4 (OpEx).** income_statement calls `get_journal_expense_total`.
- **Cluster 5 (inventory value).** KPIs, inventory_status, income_statement
  balance_sheet, and generate_report balance_sheet call
  `get_inventory_valuation`.
- **Cluster 6 (bank).** Scalar sites call `get_bank_transaction_summary` with the
  right `p_statuses` and `p_bank_account_id`. The spending and expense_health
  category sums call `get_bank_spending_by_category`. predictions and cash_flow
  variance call `get_bank_transactions_daily`.
- **Listing endpoints.** `get_bank_transactions` keeps its paginated list. Its
  summary totals move to `get_bank_transaction_summary`. So the totals cover the
  whole period, not one page.
- **Batch tools.** Clamp the id count to 1000 before the `.in('id', ids)` fetch,
  or page the ids. Return a clear message when the input is larger.

---

## 7. Behavioral changes to surface to the owner

1. **Every cluster-1 site adopts one net-sales definition.** All six sites now
   call `get_monthly_sales_metrics` and read `gross_revenue - discounts`. The
   effect differs per site:
   - income_statement
     ([`index.ts:935`](supabase/functions/ai-execute-tool/index.ts:935)) and
     generate_report ([`index.ts:1674`](supabase/functions/ai-execute-tool/index.ts:1674))
     had no guards. Their revenue drops refunds, split duplicates, tax, and
     tips. The number changes the most.
   - sales_summary and operating_costs had the adjustment guard and the split
     guard, but not the liability-account guard. Their revenue drops any sale
     mapped to a liability account (a tax or tip item). The number changes a
     little.
   The new number is the app P&L net sales. This is the intended fix.
2. **The COGS end day is now included** (§1.3, §5.4). The COGS number rises by
   the last day's usage.
3. **The bank status filter stays per-site.** The `p_statuses` parameter keeps
   each caller's current behavior. The design does not unify the status filter,
   because the app does not.

---

## 8. Security and tenancy

- Every new RPC is `SECURITY INVOKER`. RLS stays in force for a client caller.
- Every new RPC filters `restaurant_id = p_restaurant_id`. This scopes the
  service-role caller, which bypasses RLS.
- No RPC gates on `auth.uid()`. The `ai-execute-tool` edge function authorizes
  the user and the restaurant before it dispatches a tool. The
  `get_daily_sales_totals` sibling uses the same model
  ([`ai_operator.sql:684`](supabase/migrations/20260214100000_ai_operator.sql:684)).
- Every RPC grants execute to `authenticated`.

---

## 9. Testing

### 9.1 pgTAP (`supabase/tests/`)

One test file per new RPC. Each file:

1. Sums a small fixture correctly.
2. Returns 0 (not NULL) for an all-NULL-group fixture (lesson L1752).
3. Excludes the rows the filters must exclude — a refund row, a split child, a
   non-usage transaction, a non-expense account.
4. Scopes by `restaurant_id`. A second restaurant's rows never contribute.
5. `get_inventory_usage_by_month`: a usage row on the end day contributes (the
   boundary test, §5.4).
6. Respects the `unified_sales` and `journal_entry_lines` foreign keys in the
   fixture (per the project lessons).

The pgTAP session identity stays clean between tests (lesson L1759).

### 9.2 Unit tests (`tests/unit/`)

- Mock the RPC builder chain, not a bare promise (lesson L1846).
- Test the summing helper for each cluster: it sums the RPC rows, handles an
  empty array, and handles a NULL numeric.
- Test the predictions and variance math over a fixed daily series.

### 9.3 Production validation

Before the PR, run a read-only SELECT against production for the reported
restaurant and month. Compare each cluster's RPC output to the current app P&L
number. Record the before-and-after in the PR body.

---

## 10. Risks and mitigations

- **Big change.** About 32 sites in 2 files, plus 8 migrations and 8 test files.
  Mitigation: the plan sequences the work by cluster. Each cluster is one
  reviewable unit with its own RPC and tests.
- **Number shifts.** The unified definitions change some tool outputs.
  Mitigation: §7 lists each change. §9.3 proves each against production.
- **Column-name reconciliation.** The bank sites use two names for the account
  filter (`bank_account_id` and `connected_bank_id`) and one status filter.
  Mitigation: the plan confirms the real column names against the schema before
  it writes the bank RPCs.
- **Rollback.** Every RPC is additive. If a client change regresses, revert the
  edge-function commit; the RPC can stay.

---

## 11. Open items to pin in the plan

1. Confirm the exact column names against the live schema: the
   `bank_transactions` account-filter column and status values (cluster 6), and
   the `journal_entry_lines` debit and credit columns plus the
   `chart_of_accounts` expense-account link (cluster 4).
2. Confirm the `_shared/periodMetrics.ts` field map, so KPIs keeps its
   breakdown.
3. Confirm the `products` low-stock predicate and column names.
4. Decide the PR shape: one PR, or a short stacked series by cluster. The design
   does not change either way.

---

## 12. Out of scope (follow-ups)

- Break-even variable-cost math and the margin-of-safety unit (fix 2).
- The operating-costs budget label (fix 3).
- The same cap pattern in any non-financial tool path outside this file.
