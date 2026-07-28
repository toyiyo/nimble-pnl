# Recipes page load performance — design

**Date:** 2026-07-27
**Branch:** `perf/recipes-page-load`
**Target:** `/recipes` interactive in **≤ 500ms**
**Status:** revised after Phase 2.5 design review (Supabase + Frontend)

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

**Why it is slow even with 3 recipes:** the waterfall is 4 levels deep. That is ~350–400ms of purely serialized network before first paint — over budget at three recipes.

### Aggravating factors (all confirmed)

- **Write amplification → realtime stampede.** `pg_stat_user_tables`: **5,748 updates on 588 live rows (9.8×)**; 307 of 484 active recipes updated after creation. Each write-back fires the `recipes` realtime subscription (`:536`) → `fetchRecipes` again, undebounced.
- **No React Query.** Raw `useState`/`useEffect`; any `user` identity change re-runs the cascade. Violates the CLAUDE.md data-fetching rule.
- **7 `console.log` calls in the hot path** (`:412-472`), shipping to production.
- **A second, redundant recipes fetch.** `useUnifiedSales` (mounted at `Recipes.tsx:46` purely for the suggestions banner) runs its own `['recipes-for-mapping']` query *and* pulls 500 sales rows with two `chart_of_accounts` joins.

### Pre-existing correctness bug found during diagnosis

`calculateRecipeProfitability` selects sales rows with **no `.limit()`** → PostgREST silently caps at 1000. Four live Cold Stone recipes exceed it (1716, 1399, 1159, 1077 rows). Error is currently **$0.00 only because those items have uniform pricing** — any 1000-row sample yields the same mean. The moment a price varies, margins drift silently. This design fixes it.

## 2. Decisions taken

### Cost math stays in TypeScript

Moving to a SQL RPC was considered and rejected on evidence. The premise — that `calculate_recipe_cost` existed and CLAUDE.md deemed SQL authoritative — is false: the function was deliberately dropped in `20251010164523_...sql`:

> Drop the unused calculate_recipe_cost function — This function is not being used anywhere in the application. Recipe costs are calculated on the frontend instead.

| | TS `enhancedUnitConversion.ts` | Dropped SQL function |
|---|---|---|
| Size | 655 lines | 189 lines |
| Approach | general conversion engine | 18 hardcoded unit-pair `IF/ELSIF` branches |
| Tests | 4 suites | none |
| Status | live, authoritative | deleted 2025-10-10 |

CLAUDE.md's "SQL function is authoritative" refers to the **inventory deduction** path (`*_inventory_*.sql`), not recipe-cost display. The bottleneck is *where queries are issued*, not *which language does the math*.

### Write-back is replaced, not deleted

`recipes.estimated_cost` is read by `useRecipeIntelligence`, `useInventoryMetrics`, `RecipeProfitabilityChart`, `MapPOSItemDialog`, `RecipeCreateFromExistingDialog`. `RecipeDialog.tsx:273` persists on save. The page-load write-back exists to heal drift when a **product's `cost_per_unit` changes** — save does not cover that. So it is replaced by a batched heal (§3.7), not removed.

## 3. Design

Five bounded requests replace ~400. **Explicit queries over nested embeds**, per `memory/lessons.md:141`. Every query independently paginatable — the 1000-row cap is a recurring source of bugs here and is handled explicitly at every step, never left to the default.

FKs verified via `pg_constraint`: `recipe_ingredients.recipe_id → recipes.id`, `recipe_ingredients.product_id → products.id`.

### 3.1 Q1 — recipes
Explicit column list (no `select('*')`), `.eq(restaurant_id).eq(is_active,true)`.
**Cap:** paginate with `.range()` until short page. **Order by `('name')` then `('id')`** — a tiebreaker is required or equal names can split unstably across pages under concurrent writes.

### 3.2 Q2 — prep shadow links
`prep_recipes.recipe_id` for the restaurant. Unchanged fail-closed semantics. Paginated.

### 3.3 Q3 — recipe ingredients
`.in('recipe_id', recipeIds)`, **chunked at 200 ids/request**, each chunk paginated. Replaces N per-recipe queries.

### 3.4 Q4 — products
**Fetch all products for the restaurant** (`.eq('restaurant_id')`, explicit columns: `id, name, cost_per_unit, uom_purchase, size_value, size_unit, package_qty`), paginated.

> Review fix: an earlier draft fetched `.in('id', productIds)`, but `productIds` only exists after Q3 returns — that made Q4 *depend* on Q3 and the claimed 2-level waterfall was wrong (really 3). Fetching by `restaurant_id` needs only `restaurantId`, restoring genuine parallelism, and matches the pattern `useProducts` already uses.

### 3.5 Q5 — sales stats RPC

New `get_recipe_sales_stats(p_restaurant_id uuid)` → `(item_name text, avg_sale_price numeric)`:

```sql
create or replace function public.get_recipe_sales_stats(p_restaurant_id uuid)
returns table (item_name text, avg_sale_price numeric)
language sql
stable
security invoker
set search_path = public
as $$
  select us.item_name,
         sum(us.total_price) / nullif(sum(coalesce(nullif(us.quantity, 0), 1)), 0)
  from unified_sales us
  join recipes r
    on r.restaurant_id = us.restaurant_id
   and r.pos_item_name = us.item_name
   and r.is_active
  where us.restaurant_id = p_restaurant_id
    and us.unit_price is not null
  group by us.item_name;
$$;
```

**`coalesce(nullif(quantity,0), 1)` is load-bearing.** The TS it replaces does `sum + (sale.quantity || 1)` (`:498`) — every row with NULL or `0` quantity counts as `1`. A bare `sum(quantity)` would skip NULLs and let zeros contribute 0, shrinking the denominator, **inflating `avg_sale_price` and every downstream margin**; for an item where all rows have null quantity the recipe would lose profitability data entirely. This is exactly the silent-drift class this work exists to eliminate.

Other properties:
- **Aggregation, not cost math** — no unit conversion, no drift risk against the TS engine.
- **Fixes the 1000-row truncation** — aggregation is server-side over all rows.
- **Output provably bounded** — the inner join to active `recipes` on `(restaurant_id, pos_item_name)` bounds the result to the count of distinct mapped `pos_item_name` values (≤133 today), so the PostgREST cap cannot bite. Still paginated defensively.
- `stable` + `set search_path = public` + `security invoker` — matches every comparable RPC in this repo and satisfies Supabase's mutable-search-path advisor. RLS on `unified_sales`/`recipes` enforces tenant isolation regardless of the `p_restaurant_id` passed.

### 3.6 Cost + profitability computed in memory
Group ingredients by `recipe_id`; look up products from a `Map`; call existing `calculateInventoryImpact` unchanged. Join `avg_sale_price` from Q5, derive margin/profit with existing formulas.

### 3.7 Batched cost heal + realtime, specified concretely

**Heal:** compare computed vs stored cost **rounded to currency precision** (`Math.abs(a - b) >= 0.005`), never bare `!==`. `calculateInventoryImpact` is JS float math; a bare inequality can report drift forever (`12.340000000000002` vs `12.34`), re-issuing the upsert on *every* load and reintroducing the write→realtime→refetch stampede at reduced scale. Rounded comparison is what makes "0 writes once converged" true.

Only drifted rows go into **one** `upsert`. Heal writes are subject to the existing `edit:recipes` capability RLS gate — view-only roles (`collaborator_accountant`, `staff`) silently no-op, matching today's behavior (`:118-121` doesn't check its error either). Tests assert the no-op surfaces no error.

**Realtime → cache, not a fetch function.** The subscription calls `queryClient.invalidateQueries({ queryKey: ['recipes', restaurantId] })`, not an imperative fetch (which cannot work once the data lives in the query cache). **Echo guard:** the heal records the row ids it is about to write in a ref; realtime events whose payload ids are all in that set are ignored and the set cleared. This is the specified mechanism — not left to be invented during TDD.

### 3.8 React Query — including an explicit mutation strategy

`useQuery` with `queryKey: ['recipes', restaurantId]`, `staleTime: 30000`, `enabled: !!restaurantId && !!user` (house style, `lessons.md:155`).

**`useRecipes` is mounted at six independent points** — `Recipes.tsx:45`, `POSSales.tsx:145`, `MapPOSItemDialog.tsx:36`, `RecipeDialog.tsx:73`, `POSSaleDialog.tsx:85`, `DeleteRecipeDialog.tsx:22` (this design originally said four; the extra two were found while implementing) — and all four mutations (`createRecipe`, `updateRecipe`, `deleteRecipe`, `updateRecipeIngredients`) currently write via local `setRecipes(prev => ...)` (`:175-386`). Once data comes from `useQuery`, those `setRecipes` calls have nothing to write to, and a naive swap silently breaks create/edit/delete — the page's primary CTA.

**Required:** all four call sites share the same `queryKey`; every mutation becomes a `useMutation` whose `onSuccess` calls `queryClient.invalidateQueries({ queryKey: ['recipes', restaurantId] })`. No local `setRecipes`. The hook keeps its existing public function signatures so callers don't change.

**Error state:** `RecipeTable` gains an explicit `isError` branch. Today a fetch failure and zero recipes render identically (`Recipes.tsx:580-633` has only loading + empty), which CLAUDE.md's three-states rule forbids and `lessons.md:160` calls out specifically.

### 3.9 Index — its own migration file
```sql
create index concurrently if not exists idx_unified_sales_restaurant_item_name
  on unified_sales (restaurant_id, item_name)
  where unit_price is not null;
```
Partial, matching the RPC's predicate, excluding noise rows (Russo's has 10,857 "Sales Tax" rows). **Ships in a dedicated migration file containing only this statement** — `CONCURRENTLY` cannot run in a transaction block, and repo precedent (5 prior migrations) is strictly one such statement per file.

**As built: the `where unit_price is not null` predicate was dropped.** §3.11's `get_unmapped_sale_item_names` keys on the same `(restaurant_id, item_name)` pair but has no `unit_price` filter, so a partial index is unusable to it. Partiality bought the stats RPC only a smaller index — it reads `total_price` and `quantity` from the heap regardless, so it was never index-only — and one shared index costs less on write than two overlapping ones.

### 3.10 Render-path fixes (cheap, same critical path)
- **Memoize `filteredRecipes`** (`Recipes.tsx:155`) — it is a fresh array every render, which defeats the `useMemo`s at `:160` and `:164` that depend on it.
- **Conditionally render mobile vs desktop** instead of `block md:hidden` / `hidden md:block` (`:639`, `:712`). Tailwind hides via CSS only, so both trees mount — 133 recipes render ~266 row components.
- **`Map` lookup in `validateRecipeConversions`** (`recipeConversionValidation.ts:30`) instead of O(ingredients × products) `.find()`.
- **Remove the 7 hot-path `console.log` calls.**

### 3.11 Suggestions banner — stop the redundant fetch
Replace `useUnifiedSales(restaurantId)` on this page with a lightweight query for distinct unmapped item names. Removes a 500-row + two-join fetch *and* a duplicate `['recipes-for-mapping']` recipes query from the critical path. Contained to `Recipes.tsx`; `useUnifiedSales` itself is untouched so POSSales is unaffected.

**As built:** a `SECURITY INVOKER` RPC, `get_unmapped_sale_item_names(p_restaurant_id, p_limit default 200)`, behind `useUnmappedSaleItems`. Fetching every `unified_sales.item_name` to diff client-side is unbounded, so the diff moves server-side. The RPC mirrors the TS it replaces exactly — `lower()` on both sides with **no** trimming (`recipeMapping.ts:68-91`), no `is_active` filter on recipes, `parent_sale_id IS NULL` — so the banner's contents don't shift in a perf change. `p_limit` keeps the response far below the PostgREST 1000-row cap; the banner shows five names and a count, and that count was already an approximation off a single 500-row sales page.

### 3.12 List virtualization

`RecipeTable` plain-`.map()`s over every recipe (`Recipes.tsx:640`, `:730`). At the top tenant's 133 recipes this crosses CLAUDE.md's 100+ virtualization threshold, so it is **in scope for this PR**.

Follow the documented repo pattern (`@tanstack/react-virtual` ^3.13.18, already a dependency; 8 existing implementations incl. `VirtualizedProductGrid.tsx`, `BankTransactionList.tsx`, `POSSales.tsx`):

- `useVirtualizer` with `getScrollElement`, `estimateSize`, `overscan: 10`.
- **Key by `recipes[virtualRow.index].id`, never the index.**
- `data-index={virtualRow.index}` + `ref={virtualizer.measureElement}` for dynamic row heights.
- Extract a `MemoizedRecipeRow` via `React.memo` with a custom comparator: **no hooks inside**, all data passed as props, callbacks stabilized with `useCallback` in the parent, display values (formatted currency, dates, validation result) pre-computed with `useMemo`.
- The existing single-dialog-at-list-level pattern (`Recipes.tsx:464-494`) is already correct and stays.

Interaction with §3.10's conditional mobile/desktop render: only the active tree mounts, and that tree is the one virtualized. The desktop table needs a bounded-height vertical scroll parent; keep the existing `overflow-x-auto` for horizontal scroll.

## 4. Decided trade-offs (deferred, with rationale)

- **`useProducts` React Query conversion + `select('*')`** — real violations on this critical path, but the hook carries auth-retry/session-refresh logic (`:89-171`) that a naive conversion would drop. Own risk profile; separate change.
- **Dropping the now-redundant `idx_unified_sales_item_name`** — follow-up; not this PR's job.

## 5. Expected result

| | Before | After |
|---|---|---|
| Requests (133 recipes) | ~400 | **5** |
| Requests (3 recipes) | ~10 | **5** |
| Waterfall depth | 4 | **2** (Q1+Q2+Q4+Q5 parallel → Q3) |
| Writes per load | up to N | 0 (converged) |
| Row components mounted | ~266 | **~15 (viewport + overscan)** |
| Sales average accuracy | truncated at 1000 rows | exact |

At 60–90ms/round trip, 2 levels ≈ **120–180ms** of network — inside the 500ms budget with headroom.

## 6. Risks

| Risk | Mitigation |
|---|---|
| **1000-row cap anywhere** | Every query explicitly paginated or provably bounded; §3.1–3.5 state handling individually. Tested with a >1000-row fixture. |
| Mutations break under React Query | §3.8 mandates `useMutation` + `invalidateQueries`, shared key across all 4 mount points; E2E covers create/edit/delete. |
| Heal never converges → stampede | Currency-rounded drift comparison (§3.7). Test asserts second load issues zero writes. |
| Realtime echo loop | Explicit id-set guard (§3.7). |
| Displayed costs change | TS engine untouched; parity test against current stored values. |
| `avg_sale_price` drift vs TS | `coalesce(nullif(quantity,0),1)` mirrors `quantity || 1`; pgTAP fixture with null/zero-quantity rows. |
| `.in()` URL length | Chunk at 200 ids. |
| RLS regression via RPC | `security invoker` + pgTAP cross-tenant isolation test. |
| `CONCURRENTLY` migration fails | Dedicated migration file, single statement. |

## 7. Test plan

- **Unit:** cost/profitability parity vs current implementation on real fixtures; null/zero-quantity averaging parity; ingredient→recipe grouping; `.in()` chunking; **>1000-row pagination for every paginated query**; heal drift comparison converges (second load = zero writes); realtime echo guard suppresses self-writes.
- **pgTAP:** `get_recipe_sales_stats` correctness incl. a >1000-row item and null/zero-quantity rows; cross-tenant isolation returns zero rows.
- **E2E:** `/recipes` renders costs and margins for a seeded tenant; create/edit/delete round-trip through the query cache; error state renders distinctly from empty; request count stays bounded as recipe count grows (the regression guard for this N+1).
