# AI financial tools: move every financial sum into SQL

- **Date:** 2026-08-13
- **Author:** Jose M Delgado (with Claude)
- **Status:** Draft for review
- **Feature area:** AI chat financial tools (`supabase/functions/ai-execute-tool/index.ts`)
- **Scope:** Replace every raw-row fetch plus JavaScript sum in the AI tool
  executor with a SQL aggregate. About 32 sites across 12 tools. Add 9 aggregate
  RPCs. Modify 1 shared RPC (`get_monthly_sales_metrics`). Add 1 index. Keep each
  displayed number correct, and unify the numbers on the app P&L definitions.

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
([`index.ts:945`](supabase/functions/ai-execute-tool/index.ts:945)). The
generate_report COGS fetch does the same
([`index.ts:1686`](supabase/functions/ai-execute-tool/index.ts:1686)). The column
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

> **Scope change (2026-08-14).** The owner folded fix 2 and fix 3 into this PR
> after the July diagnosis proved the three defects compound. See §13. The first
> two bullets below no longer apply; §13.2 and §13.3 replace them.

- ~~Do not change the break-even variable-cost math or the margin-of-safety
  unit.~~ **In scope now (fix 2, §13.2).**
- ~~Do not relabel the operating-costs output as a budget.~~ **In scope now
  (fix 3, §13.3).**
- Do not change the AI chat UI or the tool registry parameter schemas. Tool
  *descriptions* and the chat system prompt DO change (fix 3, §13.3).
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

Add 9 functions. Modify 1 (§5.1). Every new function follows the
`get_daily_sales_totals` template
([`ai_operator.sql:678`](supabase/migrations/20260214100000_ai_operator.sql:678)):

- `LANGUAGE sql STABLE SECURITY INVOKER` for a scalar or grouped aggregate.
- `SECURITY INVOKER`, not `DEFINER`. The execution model requires it. The
  `ai-execute-tool` edge function builds its client with `SUPABASE_ANON_KEY` and
  the caller's forwarded `Authorization` header
  ([`index.ts:3652-3656`](supabase/functions/ai-execute-tool/index.ts:3652)). So
  every query runs under the caller's JWT, and RLS is active. Under `INVOKER`,
  RLS on the source table scopes the caller to the caller's own restaurants.
  The explicit `restaurant_id = p_restaurant_id` filter then selects the one
  restaurant the tool asked for. The edge function also verifies membership
  before it dispatches a tool
  ([`index.ts:3671-3676`](supabase/functions/ai-execute-tool/index.ts:3671)).
- The row cap is an HTTP-layer PostgREST limit, not an RLS limit. RLS does not
  cap rows. So a `SUM` under RLS sees the complete set. Each source table
  (`unified_sales`, `inventory_transactions`, `journal_entry_lines`, `products`,
  `bank_transactions`) is restaurant-scoped in RLS, not capability-scoped. So any
  restaurant member reads all of the restaurant's rows, and the aggregate is
  complete.
- Pin `SET search_path TO 'public'` on every function, new and modified.
  `INVOKER` does not require the pin for privilege, but the Supabase
  `function_search_path_mutable` advisor flags any unpinned function, and the pin
  fixes name resolution to `public`. The `get_daily_sales_totals` template omits
  the pin because it predates the advisor guidance; the new functions add it. The
  modified `get_monthly_sales_metrics` already pins it
  ([`...revenue_filter.sql:29`](supabase/migrations/20260501120000_fix_monthly_sales_metrics_revenue_filter.sql:29));
  the `INVOKER` conversion keeps it.
- `COALESCE(SUM(col), 0)` for every sum. A SQL `SUM` over an all-NULL or empty
  group returns NULL; this wraps the NULL to 0. It matches the
  `get_daily_sales_totals` template and lesson L1752. `unified_sales.total_price`
  and other columns are nullable.
- `GRANT EXECUTE ... TO authenticated`, re-issued after `CREATE OR REPLACE`.
- A `COMMENT ON FUNCTION` that states the source, the filters, and the exclusions.

### 5.1 Modify — `get_monthly_sales_metrics` (revenue, cluster 1)

Signature (existing):
`get_monthly_sales_metrics(p_restaurant_id UUID, p_date_from DATE, p_date_to DATE)`
([`20260501120000_fix_monthly_sales_metrics_revenue_filter.sql:14`](supabase/migrations/20260501120000_fix_monthly_sales_metrics_revenue_filter.sql:14)).

This function already aggregates net sales. It applies the adjustment guard, the
split guard, the item-type guard, and the liability-account guard. Callers sum
its rows across the returned months. The
`WHERE sale_date BETWEEN p_date_from AND p_date_to` clause bounds the exact
range. So a partial-month range still sums only the in-range rows.

This design makes it the single revenue source for every cluster-1 site. Two
changes are required first. Both land in one new migration (`CREATE OR REPLACE`).

**Change A — close a cross-tenant read hole (security).** The function is
`SECURITY DEFINER` with no `auth.uid()` check, and it grants execute to
`authenticated`
([`...revenue_filter.sql:27-30,128`](supabase/migrations/20260501120000_fix_monthly_sales_metrics_revenue_filter.sql:27)).
Because the edge function runs under the caller's JWT (not the service role, see
§5 conventions) and `DEFINER` bypasses RLS, any authenticated user can call
`/rest/v1/rpc/get_monthly_sales_metrics` directly with another restaurant's UUID
and read that restaurant's revenue, tax, tips, and discounts. This hole exists
today. This design routes more sites through the function, so it must close the
hole. **Fix:** convert the function to `SECURITY INVOKER`, so RLS on
`unified_sales` and `chart_of_accounts` scopes the caller. A pgTAP test proves a
non-member caller reads zero rows for a foreign restaurant.

**Change B — add a `refunds` column (correctness).** The KPIs breakdown defines
net sales as `gross_revenue - discounts - refunds`
([`periodMetrics.ts:193`](supabase/functions/_shared/periodMetrics.ts:193)), and
it fills `refunds` from `item_type = 'refund'` rows. This function has no
`refunds` column. So a plain reuse would drop the refund term and overstate KPIs
revenue. **Fix:** add a `refunds` column (`COALESCE(SUM(ABS(total_price)), 0)`
over refund rows). Define the unified net sales as
`gross_revenue - discounts - refunds`. Update the sole other caller,
`monthly_trends` ([`index.ts:2685`](supabase/functions/ai-execute-tool/index.ts:2685)),
to subtract `refunds` too, so it stays unified.

**Caller check.** The only callers are the `monthly_trends` tool and this
design's new cluster-1 sites (verified by grep). The existing pgTAP suite
(`supabase/tests/36_monthly_sales_metrics_revenue_filter.sql`) still applies and
extends with the tenancy and refund tests.

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

Source `inventory_transactions`. Filter `transaction_type = 'usage'`. Compute
`ABS(COALESCE(SUM(total_cost), 0))` per month. `ABS(SUM(...))` is correct: a
reversal row (opposite sign) reduces the cost. A scalar caller sums the month
rows. `monthly_trends` reads the month rows directly.

Note: three of the four current COGS sites already apply `Math.abs()` after the
sum (income_statement, generate_report, KPIs), so this matches them.
`monthly_trends` today applies `Math.abs()` per row
([`index.ts:2707-2711`](supabase/functions/ai-execute-tool/index.ts:2707)), which
is `SUM(ABS(...))`. So this unifies `monthly_trends` onto `ABS(SUM(...))`. Its
food-cost-by-month number changes for any month that has both a usage row and a
reversal row. §7 surfaces this.

Boundary: filter `created_at >= (p_start_date AT TIME ZONE 'UTC')
AND created_at < ((p_end_date + 1) AT TIME ZONE 'UTC')`. This form is explicit
UTC. It does not depend on the session `TimeZone` setting. It matches the
existing explicit-UTC pattern (`endDateStr + 'T23:59:59.999Z'`). It includes the
full end day. It fixes the defect in §1.3.

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
0)`. `low_stock_count` counts rows where `current_stock <= COALESCE(par_level_min,
0)`. This copies the current predicate exactly
([`index.ts:404-406`](supabase/functions/ai-execute-tool/index.ts:404)). The
threshold column is `par_level_min`, not `reorder_point`. The current code
selects `reorder_point` but does not use it for the threshold.

### 5.7 New — `get_bank_transaction_summary` (cluster 6 scalars)

`get_bank_transaction_summary(p_restaurant_id UUID, p_start_date DATE, p_end_date DATE, p_bank_account_id UUID DEFAULT NULL, p_statuses TEXT[] DEFAULT NULL)`
→ `TABLE(inflow NUMERIC, outflow NUMERIC, net NUMERIC, tx_count BIGINT, inflow_count BIGINT, outflow_count BIGINT, avg_inflow NUMERIC, max_inflow NUMERIC)`.

Source `bank_transactions`. `inflow = SUM(amount) FILTER (WHERE amount > 0)`.
`outflow = ABS(SUM(amount) FILTER (WHERE amount < 0))`. The two optional
parameters preserve each caller's current filter. `p_bank_account_id` filters the
`connected_bank_id` column when set (confirmed at
[`index.ts:2809`](supabase/functions/ai-execute-tool/index.ts:2809)). `p_statuses`
filters `status = ANY(p_statuses)` when set; `NULL` applies no status filter. This
one function serves cash_flow, revenue_health, spending totals, liquidity,
income_statement cash_flow, generate_report, and the get_bank_transactions
summary. The expense_health tool uses a dedicated RPC (§5.10), because its six
sums need per-metric rules a plain summary cannot express.

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

### 5.10 New — `get_expense_health_metrics` (cluster 6, expense_health)

`get_expense_health_metrics(p_restaurant_id UUID, p_start_date DATE, p_end_date DATE, p_fee_patterns TEXT[], p_bank_account_id UUID DEFAULT NULL)`
→ `TABLE(revenue NUMERIC, food_cost NUMERIC, labor_cost NUMERIC, processing_fees NUMERIC, total_outflows NUMERIC, uncategorized_spend NUMERIC)`.

The `executeGetExpenseHealth` tool fetches once and derives six sums
([`index.ts:2818-2853`](supabase/functions/ai-execute-tool/index.ts:2818)). Each
sum has its own rule, so a plain summary RPC cannot serve it. This RPC computes
all six with `FILTER` clauses over `bank_transactions` left-joined to
`chart_of_accounts` on `category_id`. It filters `status IN ('posted', 'pending')`
and, when set, `connected_bank_id = p_bank_account_id`.

- `revenue`: `SUM(amount) FILTER (WHERE amount > 0)`.
- `food_cost`: outflow where the account subtype is `cost_of_goods_sold`, or the
  account name matches `food`/`inventory`.
- `labor_cost`: outflow where the account subtype is `payroll`, or the account
  name matches `payroll`/`labor`.
- `processing_fees`: outflow where `LOWER(description || ' ' || merchant_name)`
  matches any pattern in `p_fee_patterns`. The `processingFeePatterns` list stays
  in TypeScript and passes in as the parameter, so TypeScript remains the source
  of the list.
- `total_outflows`: `ABS(SUM(amount) FILTER (WHERE amount < 0))`.
- `uncategorized_spend`: outflow where `category_id IS NULL AND is_split = false`.

JavaScript keeps the percentage math (`foodCostPercentage`, and so on) over these
six values.

### 5.11 New index — `bank_transactions(restaurant_id, transaction_date)`

Today the 1000-row cap accidentally bounds every bank scan. The new bank RPCs
remove that cap and aggregate the full date range server-side. `bank_transactions`
has no composite index that leads on `restaurant_id` and covers a date range.
The existing indexes are `(restaurant_id, status)`, a single-column
`transaction_date` index, a `category_id` index, and
`(connected_bank_id, transaction_date DESC)`
([`20260723130000_connected_banks_reauth_columns.sql:53`](supabase/migrations/20260723130000_connected_banks_reauth_columns.sql:53)).
The last one leads on `connected_bank_id`, so it does not serve a
restaurant-scoped date-range scan. So add:
`CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_bank_transactions_restaurant_date ON bank_transactions(restaurant_id, transaction_date);`.
This follows the `CONCURRENTLY` precedent already in the repo
(`20260804090200_idx_bank_transactions_rule_candidates_v2.sql`). `CONCURRENTLY`
cannot run inside a transaction, so this migration must not wrap in `BEGIN`.

---

## 6. Rewiring plan

Each site swaps its raw fetch for one RPC call. The derived math stays in
JavaScript, over the complete aggregate.

- **Cluster 1 (revenue).** Call `get_monthly_sales_metrics` (modified, §5.1). Sum
  `gross_revenue - discounts - refunds`. Sites: income_statement, sales_summary
  (current + previous), generate_report monthly_pnl, operating_costs revenue
  ([`index.ts:2622`](supabase/functions/ai-execute-tool/index.ts:2622) only, not
  the break-even formula below it). KPIs replaces the
  `calculateRevenueBreakdown` raw fetch with the same RPC; its net revenue stays
  `gross - discounts - refunds`. §7 lists the small definition shift KPIs takes on
  from the RPC's account-type classification.
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
  right `p_statuses` and `p_bank_account_id`. The spending breakdown calls
  `get_bank_spending_by_category`. predictions and cash_flow variance call
  `get_bank_transactions_daily`. expense_health calls `get_expense_health_metrics`
  (§5.10), one call for all six sums.
- **monthly_trends.** It reads two modified sources. Its net revenue now
  subtracts `refunds` (§5.1). Its food cost by month now uses `ABS(SUM(...))`
  (§5.4). §7 surfaces both.
- **Listing endpoints.** `get_bank_transactions` keeps its paginated list. Its
  summary totals move to `get_bank_transaction_summary`. So the totals cover the
  whole period, not one page.
- **Batch tools.** Clamp the id count to 1000 before the `.in('id', ids)` fetch,
  or page the ids. Return a clear message when the input is larger.

---

## 7. Behavioral changes to surface to the owner

1. **Every cluster-1 site adopts one net-sales definition.** All six sites now
   call `get_monthly_sales_metrics` and read `gross_revenue - discounts -
   refunds`. The effect differs per site:
   - income_statement
     ([`index.ts:935`](supabase/functions/ai-execute-tool/index.ts:935)) and
     generate_report ([`index.ts:1674`](supabase/functions/ai-execute-tool/index.ts:1674))
     had no guards. Their revenue drops split duplicates, tax, and tips. The
     number changes the most.
   - sales_summary and operating_costs had the adjustment guard and the split
     guard, but not the liability-account guard. Their revenue drops any sale
     mapped to a liability account (a tax or tip item). The number changes a
     little.
   The new number is the app P&L net sales. This is the intended fix.
2. **KPIs revenue takes on the RPC classification.** KPIs used
   `calculateRevenueBreakdown`, which classifies tax and tip accounts with the
   keyword rules in `tipClassification.ts`. The RPC classifies by the
   chart-of-accounts `account_type`. So the KPIs tax and tip split can shift for
   an account where the two rules disagree. The KPIs net revenue (`gross -
   discounts - refunds`) stays the same by construction, because net does not
   depend on the tax and tip split.
3. **monthly_trends net revenue now subtracts refunds** (§5.1). Today it reads
   `gross - discounts`. A restaurant with refunds sees its trend revenue drop by
   the refund total. This aligns it with the P&L.
4. **monthly_trends food cost by month changes** (§5.4). It moves from
   `SUM(ABS(x))` to `ABS(SUM(x))`. A month with both a usage row and a reversal
   row changes. `ABS(SUM(x))` is the correct treatment: a reversal reduces the
   cost.
5. **The COGS end day is now included** (§1.3, §5.4). The COGS number rises by
   the last day's usage.
6. **The bank status filter stays per-site.** The `p_statuses` parameter keeps
   each caller's current behavior. The design does not unify the status filter,
   because the app does not.
7. **An account-scoped bank question stops failing.** Six bank sites filter a
   `bank_account_id` column that does not exist on `bank_transactions` (the real
   column is `connected_bank_id`, §11). The filter is conditional on an optional
   argument, so it fires only when the owner scopes a question to one bank
   account. Today that path errors. The new RPCs filter `connected_bank_id`, so
   the account-scoped question returns the correct number.

---

## 8. Security and tenancy

**Execution model.** The `ai-execute-tool` edge function builds its Supabase
client with `SUPABASE_ANON_KEY` and the caller's forwarded `Authorization` header
([`index.ts:3652-3656`](supabase/functions/ai-execute-tool/index.ts:3652)). So
every RPC runs under the caller's JWT, not the service role. RLS stays active.
This is the correct model to design against.

- **Every new RPC is `SECURITY INVOKER`.** RLS on each source table scopes the
  caller to the caller's own restaurants. The explicit
  `restaurant_id = p_restaurant_id` filter then selects the one restaurant the
  tool asked for. A caller cannot read a restaurant that RLS hides, because
  `INVOKER` gives the function the caller's privileges.
- **The modified `get_monthly_sales_metrics` becomes `SECURITY INVOKER`** (§5.1,
  Change A). Today it is `SECURITY DEFINER` with no `auth.uid()` gate and a grant
  to `authenticated`. So today any authenticated user can call it directly with a
  foreign restaurant UUID and read that restaurant's revenue. The conversion to
  `INVOKER` closes that hole. This design must close it, because it routes more
  sites through the function.
- **No RPC gates on `auth.uid()`.** RLS is the tenancy control, not an in-function
  check. The edge function also verifies restaurant membership before it dispatches
  a tool ([`index.ts:3671-3676`](supabase/functions/ai-execute-tool/index.ts:3671)).
  The `get_daily_sales_totals` sibling uses the same pattern — `INVOKER`, no
  `auth.uid()` gate, grant to `authenticated`
  ([`ai_operator.sql:684`](supabase/migrations/20260214100000_ai_operator.sql:684)).
- **The aggregate is complete under RLS.** The row cap is an HTTP-layer PostgREST
  limit, not an RLS limit. Each source table (`unified_sales`,
  `inventory_transactions`, `journal_entry_lines`, `products`, `bank_transactions`)
  is restaurant-scoped in RLS, not capability-scoped. So any restaurant member
  reads all of the restaurant's rows, and a `SUM` under RLS sees the complete set.
- **Every RPC grants execute to `authenticated`.** So each RPC is reachable at
  `/rest/v1/rpc/<name>`. `INVOKER` plus RLS makes that reach safe: a direct call
  with a foreign restaurant UUID returns zero rows.

---

## 9. Testing

### 9.1 pgTAP (`supabase/tests/`)

One test file per new RPC, plus new cases in the existing
`get_monthly_sales_metrics` suite. Each file:

1. Sums a small fixture correctly.
2. Returns 0 (not NULL) for an all-NULL-group fixture (lesson L1752).
3. Excludes the rows the filters must exclude — a refund row, a split child, a
   non-usage transaction, a non-expense account.
4. **Filter scope.** The function receives one `restaurant_id`. A second
   restaurant's rows never contribute to the result.
5. **RLS tenancy.** Set the session to a non-member `authenticated` user
   (`set role`, `request.jwt.claims`). The `SECURITY INVOKER` function then
   returns zero rows for a foreign `restaurant_id`. This proves RLS scopes the
   caller, not the `p_restaurant_id` filter alone. It is the test that fails
   today for `get_monthly_sales_metrics` (the `DEFINER` hole, §5.1 Change A).
6. `get_inventory_usage_by_month`: a usage row on the end day contributes (the
   boundary test, §5.4).
7. Respects the `unified_sales` and `journal_entry_lines` foreign keys in the
   fixture (per the project lessons).

Function-specific cases:

- **`get_monthly_sales_metrics` (modified).** A refund row lands in the new
  `refunds` column. Net sales equals `gross_revenue - discounts - refunds`. The
  RLS tenancy test (item 5) is the new guard for the security fix.
- **`get_expense_health_metrics`.** The six sums split correctly: revenue (amount
  > 0), food cost, labor cost, processing fees, total outflows, and uncategorized
  spend. A caller-supplied `p_fee_patterns` value matches a fee row by description
  or merchant name. An uncategorized row (`category_id IS NULL` and not split)
  lands only in uncategorized spend.

The pgTAP session identity stays clean between tests (lesson L1759). The RLS
tenancy test (item 5) resets `role` and `request.jwt.claims` after it runs.

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

- **Big change.** About 32 sites in 2 files. Add 9 RPCs, modify 1 shared RPC,
  add 1 index, and add about 10 pgTAP files. Mitigation: the plan sequences the
  work by cluster. Each cluster is one reviewable unit with its own RPC and tests.
- **Number shifts.** The unified definitions change some tool outputs.
  Mitigation: §7 lists each change. §9.3 proves each against production.
- **A shared function changes.** `get_monthly_sales_metrics` moves to
  `SECURITY INVOKER` and gains a `refunds` column. Its one other caller is
  `monthly_trends` (verified). Mitigation: update `monthly_trends` in the same PR
  (§5.1). The new pgTAP tenancy and refund tests guard the change.
- **Migration safety.** The index migration uses `CREATE INDEX CONCURRENTLY`,
  which cannot run inside a transaction (§5.11). Mitigation: the plan puts the
  index in its own migration with no `BEGIN` wrapper.
- **Rollback.** Every new RPC is additive. The `get_monthly_sales_metrics` change
  is a `CREATE OR REPLACE`, so a revert restores the prior body. If a client
  change regresses, revert the edge-function commit; the RPCs can stay.

---

## 11. Open items to pin in the plan

### 11.1 Resolved during design

1. **Bank account-filter column.** The real column is `connected_bank_id`
   ([`...5da7500b...sql:111`](supabase/migrations/20251018183326_5da7500b-3a17-4a58-af24-d2175258f871.sql:111)).
   `bank_transactions` has no `bank_account_id` column. Six sites filter
   `bank_account_id` (lines 509, 567, 626, 704, 741, 858), so an account-scoped
   bank query errors today. The new RPCs filter `connected_bank_id`, which fixes
   the latent bug (§7 item 7).
2. **Cluster-4 journal columns.** The columns are `debit_amount` and
   `credit_amount`; the parent date is `journal_entries.entry_date`; the expense
   link is `chart_of_accounts.account_type = 'expense'` scoped by `restaurant_id`
   ([`...5da7500b...sql:179`](supabase/migrations/20251018183326_5da7500b-3a17-4a58-af24-d2175258f871.sql:179),
   [`index.ts:955-971`](supabase/functions/ai-execute-tool/index.ts:955)). §5.5 matches.
3. **Products low-stock predicate.** It is `current_stock <= COALESCE(par_level_min,
   0)` (§5.6, confirmed at [`index.ts:404-406`](supabase/functions/ai-execute-tool/index.ts:404)).
4. **KPIs field map.** KPIs reroutes through `get_monthly_sales_metrics` plus the
   new `refunds` column. Net stays `gross_revenue - discounts - refunds`. The tax
   and tip split can shift (§7 item 2). The `processingFeePatterns` list stays in
   TypeScript and passes as the `p_fee_patterns` parameter (§5.10).
5. **Shared-function caller count.** `get_monthly_sales_metrics` has one other
   caller, `monthly_trends` (verified by grep). The plan updates it in the same PR.

### 11.2 Still open

1. **Bank status values per site.** Confirm the exact `transaction_status_enum`
   values each bank caller filters today, so `p_statuses` reproduces per-site
   behavior (low risk; the default `NULL` applies no status filter).
2. ~~**PR shape.**~~ **Resolved (2026-08-14).** One PR. The
   `get_monthly_sales_metrics` `INVOKER` conversion (§5.1 Change A) shipped
   first as its own security PR
   ([#743](https://github.com/toyiyo/nimble-pnl/pull/743), migration
   `20260814120000_secure_monthly_sales_metrics_tenancy.sql`). See §13.1.

---

## 12. Out of scope (follow-ups)

- The same cap pattern in any non-financial tool path outside this file.
- The journal data gap: July 2026 holds only 12 expense lines (`$11,271.79`)
  against a `$40,456.15/month` configured budget. The income statement is
  correct code over incomplete books. This is a product problem, not a code
  defect in this PR.

---

## 13. Addendum (2026-08-14) — fold fix 2 and fix 3, post-#743 state

The July 2026 diagnosis (restaurant `7c0c76e3-e770-401b-a2a9-c1edd407efed`)
reproduced every wrong number to the cent. Three defect classes compound in one
answer: the row cap (this design), the variable-cost math (fix 2), and the
budget label plus prompt gaps (fix 3). The owner folded fix 2 and fix 3 into
this PR.

### 13.1 §5.1 Change A shipped — build Change B on top of it

PR #743 merged migration `20260814120000_secure_monthly_sales_metrics_tenancy.sql`.
The live function is now `SECURITY INVOKER` with a `user_restaurants` membership
guard, a `child.restaurant_id = p_restaurant_id` filter in both child-sale
checks, and `EXECUTE` revoked from `PUBLIC` and `anon`. The Change B migration
(the `refunds` column) must reproduce that full body — the guard, the child
filter, the grants — and add the column. pgTAP files
`36_monthly_sales_metrics_revenue_filter.sql` and
`37_monthly_sales_metrics_tenancy.sql` already pin the security properties.
Change B must keep them green. The §9.1 item-5 tenancy test for this function
already exists (`37_`); the new RPCs still need their own.

### 13.2 Fix 2 — operating-costs variable math (now in scope)

The defect: `variableTotal` sums only `monthly_value`
([`index.ts:2607`](supabase/functions/ai-execute-tool/index.ts:2607)).
`monthly_value` is 0 for every `entry_type = 'percentage'` row, so percentage
items (COGS 27%, marketing 3%, processing 2.5%) contribute nothing. July output:
`Variable Costs: $82.00` against an itemized list of `$1,199.52`, and a
break-even of `$40,964.12` from a 1.44% variable ratio.

New math, over the net sales the cluster-1 RPC returns (`netSales`):

- `variableFlatTotal` = Σ `monthly_value / 100` over `cost_type = 'variable'`
  AND `entry_type = 'value'`.
- `variablePercentTotal` = Σ `(percentage_value / 100) * netSales` over
  `cost_type = 'variable'` AND `entry_type = 'percentage'`.
- `variableTotal = variableFlatTotal + variablePercentTotal`. This is the
  displayed "Variable Costs" dollar figure.
- `variableCostPercentage` = Σ `percentage_value` + (`netSales > 0` ?
  `variableFlatTotal / netSales * 100` : 0). Keep the existing fallback: when
  the restaurant has no variable rows at all, use the hardcoded 25.
- `contributionMargin = 100 - variableCostPercentage` and
  `breakEvenRevenue = totalFixedCosts / (contributionMargin / 100)` stay as
  today ([`index.ts:2628-2631`](supabase/functions/ai-execute-tool/index.ts:2628)).
- Each `entry_type = 'percentage'` item in the response gains
  `computed_monthly_amount = (percentage_value / 100) * netSales`, so the model
  does not do its own arithmetic on a stale revenue figure.
- `total_monthly_costs` becomes `fixedTotal + semiVariableTotal +
  variableTotal` with the corrected `variableTotal`.

Semi-variable handling stays as today: folded into `totalFixedCosts` for the
break-even.

### 13.3 Fix 3 — budget labels, units, prompt guidance (now in scope)

Three parts.

**Response labels.** `get_operating_costs` output gains
`"source": "budget_config"` and a `note` string: the costs are the configured
budget, not period actuals; the `period` parameter scopes only the revenue used
for the break-even. Rename `margin_of_safety` to `margin_of_safety_percent` and
add `margin_of_safety_amount = netSales - breakEvenRevenue` (dollars). Apply the
same rename in `get_break_even_progress`
([`index.ts:3156-3166`](supabase/functions/ai-execute-tool/index.ts:3156)). No
typed consumer reads these fields (the model reads the JSON), so the rename is
safe.

**Registry descriptions.** Update the `get_operating_costs` description
([`tools-registry.ts:506-534`](supabase/functions/_shared/tools-registry.ts:506))
to state: budget config, not actuals. State the unit of every percent field.

**Prompt guidance.** Add one financial-tools block to the `ai-chat-stream`
system prompt (the hardcoded string at
[`ai-chat-stream/index.ts:523-661`](supabase/functions/ai-chat-stream/index.ts:523)):

- `get_operating_costs` returns the configured budget. For actual spend, use
  `get_financial_statement` or `get_bank_transactions`.
- Every revenue figure comes from one net-sales definition. When two tools
  disagree, say so and stop; do not invent a reconciliation.
- Fields that end in `_percent` are percentages. Never print them with a `$`.

### 13.4 Validated July 2026 numbers (2026-08-14 re-run)

| Bot said | Mechanism | True value |
|---|---|---|
| Revenue `$3,647.22` | first 1000 of 22,366 rows, no filters | `$72,090.74` net |
| COGS `$197.50` | first 1000 of 14,806 usage rows | `$2,680.51` |
| Break-even revenue input `$5,693.62` | first 1000 of 13,049 filtered rows | `$72,090.74` |
| `Variable Costs: $82.00` | `monthly_value`-only sum | ≈ `$19,546` at true revenue |
| `Margin of Safety -$619.47` | percent field printed as dollars | +43% (above break-even) |
