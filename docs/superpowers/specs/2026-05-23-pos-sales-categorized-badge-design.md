# POS Sales — stale "Uncategorized" badge fix

- **Triage signal:** `sig:539980c1fe88` (single survey response, anonymized in `~/.nimble-pnl/feedback-log.jsonl`)
- **Route:** `/pos-sales`
- **Reporter intent (paraphrased):** "the page shows my sales as not categorized, but every sale for today is already categorized"
- **Branch:** `fix/pos-sales-categorized-badge`

## Problem

On `/pos-sales`, the "Uncategorized" and "Pending review" counts shown in two places
(the AI-categorization card badges at `src/pages/POSSales.tsx:902-910`, and the
"Status" pill counts at `src/pages/POSSales.tsx:1030-1031`) are derived from the
client-side `sales` array — the page set loaded by `useUnifiedSales`:

```tsx
// src/pages/POSSales.tsx:323-327
const uncategorizedSalesCount = useMemo(() => {
  return sales.filter(sale =>
    !sale.is_categorized && !sale.suggested_category_id
  ).length;
}, [sales]);

// src/pages/POSSales.tsx:316-320
const suggestedSales = useMemo(() => {
  return sales.filter(sale =>
    sale.suggested_category_id && !sale.is_categorized
  );
}, [sales]);
```

`sales` comes from `useUnifiedSales`, which paginates `unified_sales` rows at
`PAGE_SIZE = 500` (`src/hooks/useUnifiedSales.tsx:11`). A restaurant with a busy
30-day window (the default `startDate`) can easily exceed one page; only what has
been loaded so far feeds the badge.

Two distinct user-visible failure modes follow:

1. **Server-truth divergence (the reported bug).** Dashboard metrics like
   `totalSales` already come from the server-side RPC `get_unified_sales_totals`
   via `useUnifiedSalesTotals` (`src/hooks/useUnifiedSalesTotals.tsx`). The badge
   counts do not — they're a client-side filter over a *paged* subset. After a
   bulk categorization mutation invalidates `['unified-sales']`, the first page
   refetch returns the most recent 500 rows; older paged-out uncategorized rows
   are no longer present, but newer paged-in rows might still be flagged.
   The badge can show a non-zero count while the user looks at a fully
   categorized "today" — exactly the report.

2. **Filter-scope mismatch.** The user's mental model is "this badge counts
   uncategorized items in what I'm looking at right now". The page already
   exposes a `categorizationFilter` segmented control with values `all`,
   `uncategorized`, `pending-review`, `categorized` — and the badge in that
   control reads from the same global `uncategorizedSalesCount`
   (`src/pages/POSSales.tsx:1030`). So the count next to "Uncategorized" in the
   pill stays positive even when the user has filtered to "Categorized" and
   visibly sees zero uncategorized rows in the list.

Both failure modes share the same root cause: the badge is sourced from
pagination-truncated client state instead of the same server-side aggregation
that already backs every other dashboard metric on this page.

## Why a minimal client-side patch isn't enough

A tempting one-line fix is to swap `sales` → `filteredSales` (or
`dateFilteredSales`) in lines 316-320 and 323-327. That solves failure mode (2)
for users whose entire active range fits in one page, but it does not solve
failure mode (1) at all — it would still under-count once the dataset paginates,
and worse, the count would *drift downward* as users load more pages. Pulling
the value from the same server-aggregation source that drives `totalSales` is
both correct and cheap (we already call the RPC on every filter change).

## Fix

### Server side — extend `get_unified_sales_totals`

Add two columns to the RPC return: `uncategorized_count` and
`pending_review_count`. Both honour the same filters the RPC already applies
(`p_restaurant_id`, `p_start_date`, `p_end_date`, `p_search_term`,
`parent_sale_id IS NULL`).

Definitions match the existing client-side filters so the visible counts don't
change semantics, only their source-of-truth:

- `uncategorized_count`:
  `COUNT(*) FILTER (WHERE is_categorized IS NOT TRUE AND suggested_category_id IS NULL)`
- `pending_review_count`:
  `COUNT(*) FILTER (WHERE is_categorized IS NOT TRUE AND suggested_category_id IS NOT NULL)`

`is_categorized IS NOT TRUE` is intentional — the column is nullable in older
rows; `!sale.is_categorized` in JS evaluates `null` as falsy, so the SQL
predicate must match that to keep counts identical.

Implementation: new migration
`supabase/migrations/<ts>_unified_sales_totals_categorization_counts.sql` that
issues `CREATE OR REPLACE FUNCTION get_unified_sales_totals(...)` with the
extended return signature. (RPCs in this family are already `SECURITY DEFINER`
with `auth.uid()` access guards — keep the existing guard verbatim.)

### Client side — surface and consume the new fields

1. `src/hooks/useUnifiedSalesTotals.tsx`:
   - Extend `SalesTotals` with `uncategorizedCount: number` and
     `pendingReviewCount: number`.
   - Map them from `result.uncategorized_count` / `result.pending_review_count`
     in the `queryFn`.
   - Add safe defaults (`0`) in both the early-return shape and the fallback
     `data ??` shape returned to callers.

2. `src/pages/POSSales.tsx`:
   - Delete the `uncategorizedSalesCount` `useMemo`. The `suggestedSales` *list*
     stays — it's used elsewhere to enumerate pending-review sales — but its
     `.length` is **no longer** the source of truth for the count badge.
   - Read `uncategorizedSalesCount = serverTotals.uncategorizedCount` and
     `pendingReviewCount = serverTotals.pendingReviewCount`.
   - Update the four reads:
     - Button disabled gate (line 885): see "Loading state" below.
     - AI card "uncategorized" badge value (line 903).
     - AI card "pending review" badge **value AND visibility** — visibility
       must move to `pendingReviewCount > 0`, not `suggestedSales.length > 0`
       (line 905). Otherwise a paginated dataset can hide the badge even when
       the server says there are pending rows.
     - Segmented control counts (lines 1030-1031).
   - **Loading state for the button gate.** `useUnifiedSalesTotals` returns
     `0` for the new fields while `isLoading` is true (it falls through the
     `data ??` default). Without a fix, the "AI Categorize Sales" button gates
     to `disabled` on first paint, which the user reads as broken. Use the
     hook's existing `isLoading` flag:
     `disabled = isCategorizingPending || (!totalsLoading && uncategorizedCount === 0)`.
     During the load window the button stays enabled; clicking it before the
     count is known is harmless (the edge function no-ops on zero).
   - **Minor visual polish (cheap to add at the same time).** Wrap each badge
     count number in a span with `tabular-nums` so the pill width does not
     reflow when the server-async value lands (preventing a 375px-viewport
     reflow of the filter row). Add `aria-label="N uncategorized sales"` /
     `aria-label="N pending review"` on the count `<span>`s in the segmented
     control so screen readers announce a coherent label-value pair.

### Cache invalidation

`useCategorizePosSale` (`src/hooks/useCategorizePosSale.tsx:70-77`) currently
invalidates `['unified-sales']`, `['unified-sales', restaurantId]`,
`['income-statement']`, `['chart-of-accounts']`. It does **not** invalidate
`['unified-sales-totals', ...]`. Same for `useCategorizePosSales` (bulk AI) and
`useBulkPosSaleActions`. Add `queryClient.invalidateQueries({ queryKey: ['unified-sales-totals'] })`
to all three on-success branches so the totals (including the new badge counts)
refresh after any categorization mutation. Without this, the very bug we're
fixing reappears in a different shape: server returns truth, but React Query
holds the stale value.

## Test plan

### pgTAP — RPC contract

New `supabase/tests/37_get_unified_sales_totals_categorization_counts.sql`
(prefix `37_` chosen to avoid a collision with the existing
`36_monthly_sales_metrics_revenue_filter.sql`).
**Fixture isolation:** the existing `35_get_unified_sales_totals.sql` hard-codes
a restaurant UUID ending in `...0099`. The new file must use a distinct
restaurant UUID (e.g. ending in `...0098`) so the two test files can run in any
order without interfering. The existing `35_…` file's `SELECT plan(8)` and its
positional column assertions do NOT need to change — adding columns to the
`RETURNS TABLE` of an SQL function is a backwards-compatible signature change
(the existing test asserts the columns it knows about by name, not the total
column count).

- `SELECT plan(N)` with at least:
  - `uncategorized_count` returns 0 on empty fixture
  - `uncategorized_count` counts rows with `is_categorized = false AND suggested_category_id IS NULL`
  - `uncategorized_count` also counts rows with `is_categorized IS NULL` (legacy)
  - `pending_review_count` counts rows with `is_categorized = false AND suggested_category_id IS NOT NULL`
  - Both honour `p_start_date` / `p_end_date`
  - Both exclude `parent_sale_id IS NOT NULL` (child splits)
  - Access denied raises for non-member user

### Unit — hook surface

`tests/unit/useUnifiedSalesTotals.test.ts`:

- Mocks `supabase.rpc` to return `{ uncategorized_count: 3, pending_review_count: 1, ... }`
- Asserts hook exposes `uncategorizedCount: 3`, `pendingReviewCount: 1`
- Asserts defaults to `0` when restaurant is `null` (no fetch)

### Source-text — POSSales.tsx wiring

(See lessons 2026-05-16 — rendering POSSales requires mocking 30+ hooks. Use
`fs.readFileSync` + regex.) `tests/unit/posSalesCategorizationBadgeSource.test.ts`:

- Positive: `serverTotals.uncategorizedCount` appears in the file
- Positive: `serverTotals.pendingReviewCount` appears in the file
- Positive: the AI-card pending-review badge visibility check uses
  `pendingReviewCount > 0`, not `suggestedSales.length > 0`
- Positive: the AI button `disabled` predicate references `totalsLoading` /
  `isLoading` from `useUnifiedSalesTotals`, so it doesn't gate on a load-state
  zero
- Negative: `sales.filter(sale => !sale.is_categorized && !sale.suggested_category_id)` does NOT appear (prevents regression to client-side count)
- Negative: the AI-card badge visibility line does NOT mention `suggestedSales.length`

### Manual smoke (dev server)

- Open `/pos-sales` against a restaurant whose default 30-day window crosses
  pagination (>500 sales). Confirm badge matches a manual `select count(*)` on
  `unified_sales` with the same filters.
- Categorize one row via the inline dropdown → badge decreases by 1 (server
  refetch via the new `unified-sales-totals` invalidation).
- Run bulk AI categorize → badges drop to 0 once edge function returns.

## Out of scope

- The `unmappedCount` calculation (`src/pages/POSSales.tsx:587-592`) is also
  client-paginated, but it depends on recipe-mapping state that isn't on the
  RPC; surveys did not flag it. Leaving it alone.
- The `groupedSales` aggregation also operates on paginated data; same survey
  rationale. Leaving alone.
- The Tabs default-on-mount auto-sync (`syncAllSystems` in
  `useEffect[selectedRestaurant?.restaurant_id]`) is unrelated — it doesn't
  touch the badge path.

## Validation update (post-design)

After committing this design, I went back to verify the hypothesis against
production signal:

- **PostHog survey session replay** for `sig:539980c1fe88`: replay URL
  redacted from this committed doc — internal PostHog session ID is recorded
  alongside the row in `~/.nimble-pnl/feedback-log.jsonl` (sanitized lookup
  only). Replay covers the survey-submit moment.
- **Faro browser events** confirmed **49 successful `categorize_pos_sale` RPC
  calls (HTTP 204, 18:00:08–18:02:27 UTC)** plus **1 AI-suggest call (HTTP 200,
  ~14s, 18:01:48 UTC)** for the reporter's session. Zero bulk-categorize
  endpoint calls. The reporter manually applied AI suggestions one-by-one
  through `useCategorizePosSale` → `categorize_pos_sale` RPC, then submitted
  the survey while still seeing a non-zero badge.
- **`restaurant_id` in the local triage log is a `LIMIT 1` artifact.** The
  reporter is associated with multiple restaurants in `user_restaurants`; the
  triage skill's `LIMIT 1` lookup captured one deterministically. The
  reporter's *active* restaurant at survey time is a different `restaurant_id`
  (re-derived from session events; concrete UUID intentionally not committed
  to this doc), not the one written to the JSONL row.
- **The pagination hypothesis is confirmed on the active restaurant.** That
  restaurant has **~7,800 sales/day** in the default 30-day window — well past
  `PAGE_SIZE = 500` from `src/hooks/useUnifiedSales.tsx:11`. The `sales` array
  on first paint contains only the first page; the client-side
  `uncategorizedSalesCount` filter (`POSSales.tsx:323-327`) can therefore stay
  non-zero even when the visible page is fully categorized — which matches the
  reporter's account: "ya estan categorizadas todas al dia de hoy".
- **React Query scoping is clean.** Both `useUnifiedSales` and
  `useUnifiedSalesTotals` include `restaurantId` in the query key, so
  switching restaurants forces a fresh fetch. No cross-tenant pollution.
- **Follow-up issue (out of scope here):** the /triage-feedback skill should
  drop or annotate the `LIMIT 1` `user_restaurants` lookup for owners with
  multiple restaurants. Tracking separately.

Conclusion: the fix described below is correct as-written. The migration +
hook + page wiring stays exactly as planned. Phase 3 plan does not need
restructuring.

## Acceptance criteria

- [ ] On `/pos-sales` with a paginated 30-day dataset, the "Uncategorized" and
      "Pending review" badge counts match `SELECT COUNT(*) ...` on
      `unified_sales` for the same filters.
- [ ] After categorizing a single sale, both badges decrement on the next
      tick without requiring a manual reload.
- [ ] After AI bulk categorize, both badges read 0 (or the actual remaining
      count from the server) without manual reload.
- [ ] pgTAP migration test passes.
- [ ] Unit + source-text tests pass.
- [ ] `npm run typecheck && npm run lint && npm run test && npm run build`
      pass locally.

---
sig:539980c1fe88
