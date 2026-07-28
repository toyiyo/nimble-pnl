# Recipes page load performance — design

**Date:** 2026-07-27
**Branch:** `perf/recipes-page-load`
**Target:** `/recipes` interactive in **≤ 500ms**

## 1. Problem (measured, not assumed)

`/recipes` is slow even for tenants with a handful of recipes.

### Measurements against production (`ncdujvdgqtaunuyigflp`)

| Fact | Value | How measured |
|---|---|---|
| Largest tenant recipe count | 133 (Hyde Social Club) | `select count(*) from recipes where is_active` |
| Total ingredient rows for that tenant | **229** | join `recipe_ingredients` |
| Sales rows for that tenant | 584 | `unified_sales` count |
| Per-recipe sales query execution | **2.451 ms** | `EXPLAIN (ANALYZE, BUFFERS)` |
| PostgREST round-trip latency, warm | **60–90 ms** | 10× `curl -w time_total` |

The database is **not** the bottleneck. The dataset is tiny. The page is bound entirely by the *number of HTTP round trips*.

### Root cause — a triple N+1 in `useRecipes.fetchRecipes`

`src/hooks/useRecipes.tsx:107-132` runs a `Promise.all` over every recipe. Inside, **per recipe, sequentially**:

1. `calculateRecipeCost()` — `recipe_ingredients`→`products` join (`:391`)
2. `UPDATE recipes` write-back when the cost drifted (`:118`)
3. `calculateRecipeProfitability()` — `unified_sales` query (`:485`)

| Tenant | Recipes | HTTP requests | Serialized latency floor |
|---|---|---|---|
| Test | 3 | ~10 | ~400 ms |
| Taco Capital | 20 | ~56 | ~1.5 s |
| Hyde Social Club | 133 | **~400** | multiple seconds |

~400 requests to render 229 ingredient rows.

**Why it is slow even with 3 recipes:** the waterfall is 4 levels deep (recipes → cost → write → profitability). That is ~350–400ms of purely serialized network before first paint — over budget at three recipes, before counting `useProducts` (`select('*')`) and `useUnifiedSales` (500 rows + two `chart_of_accounts` joins, fetched only to populate the suggestions banner).

### Aggravating factors (all confirmed)

- **Write amplification → realtime stampede.** `pg_stat_user_tables` shows **5,748 updates on 588 live rows (9.8×)**; 307 of 484 active recipes were updated after creation. Each write-back fires the `recipes` realtime subscription (`:536`), which calls `fetchRecipes` again, undebounced. A load correcting N costs queues N full refetches.
- **No React Query.** Raw `useState`/`useEffect`; no caching, and any `user` object identity change re-runs the whole cascade. Violates the CLAUDE.md data-fetching rule.
- **7 `console.log` calls in the hot path**, several per-ingredient (`:412-472`), shipping to production.

### Pre-existing correctness bug found during diagnosis

`calculateRecipeProfitability` selects sales rows with **no `.limit()`**, so PostgREST silently caps at 1000. Four live Cold Stone recipes exceed that:

| Recipe | Sales rows | True avg | Displayed (capped) |
|---|---|---|---|
| CYO ice cream - like it | 1716 | $5.49 | $5.49 |
| signature ice cream - love it | 1399 | $7.49 | $7.49 |
| signature ice cream - like it | 1159 | $6.49 | $6.49 |
| CYO ice cream - love it | 1077 | $6.49 | $6.49 |

Error is currently **$0.00 only because those items have uniform pricing** — any 1000-row sample yields the same mean. The moment a price varies (promo, price change, size variant), margins drift silently. This design fixes it.

## 2. Decisions taken

### Cost math stays in TypeScript

Originally considered moving to a SQL RPC, on the premise that `calculate_recipe_cost` existed and CLAUDE.md called SQL authoritative. **Verification disproved the premise:** the function was deliberately dropped in `20251010164523_cc311241-01fd-4ca6-99c5-2afaa393d48a.sql` —

> Drop the unused calculate_recipe_cost function — This function is not being used anywhere in the application. Recipe costs are calculated on the frontend instead.

| | TS `enhancedUnitConversion.ts` | Dropped SQL function |
|---|---|---|
| Size | 655 lines | 189 lines |
| Approach | general conversion engine | 18 hardcoded unit-pair `IF/ELSIF` branches |
| Tests | 4 suites | none |
| Status | live, authoritative in practice | deleted 2025-10-10 |

CLAUDE.md's "SQL function is authoritative" refers to the **inventory deduction** path (`*_inventory_*.sql`), not recipe-cost display.

**Decision:** keep the TS engine untouched. The 400 requests are caused by *where queries are issued*, not by *which language does the math*. Bulk-fetching yields the identical win with zero risk of a displayed cost changing. Approved by the user after this evidence was presented.

### Write-back is replaced, not deleted

`recipes.estimated_cost` is read by `useRecipeIntelligence`, `useInventoryMetrics`, `RecipeProfitabilityChart`, `MapPOSItemDialog`, and `RecipeCreateFromExistingDialog`. `RecipeDialog.tsx:273` persists it on recipe save.

The page-load write-back exists to heal drift when a **product's `cost_per_unit` changes** — recipe save does not cover that. So it is replaced with a single batched heal, not removed outright (see §3.5).

## 3. Design

Five bounded requests replace ~400. **Explicit queries over nested embeds**, per `memory/lessons.md:141` ("no FK, no embed… prefer two explicit queries with `.in('id', ids)`; the wire cost of one extra round-trip is negligible"). This also keeps every query independently paginatable — the 1000-row cap is a recurring source of bugs in this codebase and must be handled explicitly at every step, never left to the default.

FKs verified present via `pg_constraint`: `recipe_ingredients.recipe_id → recipes.id`, `recipe_ingredients.product_id → products.id`.

### 3.1 Q1 — recipes

`.eq(restaurant_id).eq(is_active,true).order('name')`, explicit column list (no `select('*')`).
**Cap handling:** paginate with `.range()` until a short page. Bounded today at 133; must not silently truncate at scale.

### 3.2 Q2 — prep shadow links

`prep_recipes.recipe_id` for the restaurant. Unchanged semantics (fail-closed on error, per the existing shadow-recipe guard). Paginated.

### 3.3 Q3 — recipe ingredients

`.in('recipe_id', recipeIds)` — **chunk `recipeIds` at 200 per request** and paginate each, so neither the URL length nor the 1000-row cap can truncate. Replaces N per-recipe queries.

### 3.4 Q4 — products

`.in('id', productIds)` for only the products actually referenced, explicit columns (`id, name, cost_per_unit, uom_purchase, size_value, size_unit, package_qty`). Same chunking + pagination rule.

### 3.5 Q5 — sales stats RPC

New `get_recipe_sales_stats(p_restaurant_id uuid)` returning `(item_name text, avg_sale_price numeric)`:

```sql
select us.item_name,
       sum(us.total_price) / nullif(sum(us.quantity), 0)
from unified_sales us
join recipes r
  on r.restaurant_id = us.restaurant_id
 and r.pos_item_name = us.item_name
 and r.is_active
where us.restaurant_id = p_restaurant_id
  and us.unit_price is not null
group by us.item_name;
```

Rationale:
- **Aggregation, not cost math** — `sum(total_price)/sum(quantity)` is exactly what the TS does today (`:497-499`). No unit conversion, no drift risk against the TS engine.
- **Fixes the 1000-row truncation** — aggregation happens server-side over all rows.
- **Bounded output** — the join to `recipes` means at most one row per mapped recipe (≤133 today), so the RPC result itself cannot hit the cap. Still paginated defensively.
- Avoids the alternative of fetching raw sales rows client-side, which would be far worse: Russo's alone has 10,857 "Sales Tax" rows.

`SECURITY INVOKER` so RLS on `unified_sales` and `recipes` still applies; tenant-scoped by `p_restaurant_id`. pgTAP test asserts a caller from another restaurant gets zero rows.

### 3.6 Cost + profitability computed in memory

Group ingredients by `recipe_id`, look up products from a `Map`, call the existing `calculateInventoryImpact` unchanged. Join `avg_sale_price` from Q5 and derive margin/profit with the existing formulas.

### 3.7 Batched cost heal (replaces the per-recipe write-back)

After computing, diff against stored `estimated_cost`. If any drifted, issue **one** `upsert` for just those rows (typically zero after the first converged load) instead of N updates. Guard the realtime subscription against the echo of our own write so the heal cannot retrigger a fetch.

### 3.8 React Query

Wrap in `useQuery` with `staleTime: 30000`, `enabled: !!restaurantId && !!user` (house style, `lessons.md:155`). Consumers must distinguish `isError` from empty (`lessons.md:160`). Fixes the `user`-identity refetch churn.

### 3.9 Index

```sql
create index concurrently if not exists idx_unified_sales_restaurant_item_name
  on unified_sales (restaurant_id, item_name);
```
Today the planner does a `BitmapAnd` of two separate indexes. Minor next to the round-trip fix, but it is what the RPC's `group by` wants.

### 3.10 Remove the 7 hot-path `console.log` calls

## 4. Expected result

| | Before | After |
|---|---|---|
| Requests (133 recipes) | ~400 | **5** |
| Requests (3 recipes) | ~10 | **5** |
| Waterfall depth | 4 | **2** (Q1+Q2 parallel → Q3+Q4+Q5 parallel) |
| Writes per load | up to N | 0 (converged) |
| Sales average accuracy | truncated at 1000 rows | exact |

At 60–90ms/round trip, 2 levels ≈ **120–180ms** of network — inside the 500ms budget with headroom.

## 5. Risks

| Risk | Mitigation |
|---|---|
| **1000-row cap anywhere** | Every query explicitly paginated or provably bounded; §3.1–3.5 each state their handling. Verified in tests with a >1000-row fixture. |
| `.in()` URL length with many ids | Chunk at 200 ids/request. |
| Displayed costs change | TS engine untouched; test asserts parity against current stored values for real fixtures. |
| Removing write-back staleness | Replaced by batched heal (§3.7), not deleted. |
| Realtime echo loop | Heal writes guarded against self-triggered refetch. |
| RLS regression via RPC | `SECURITY INVOKER` + pgTAP cross-tenant isolation test. |

## 6. Test plan

- **Unit:** cost/profitability parity vs current implementation on real fixtures; ingredient→recipe grouping; chunking correctness; **>1000-row pagination** for each paginated query.
- **pgTAP:** `get_recipe_sales_stats` correctness incl. a >1000-row item; cross-tenant isolation returns zero rows.
- **E2E:** `/recipes` renders costs and margins for a seeded tenant; asserts request count stays bounded as recipe count grows (the regression guard for this N+1).
