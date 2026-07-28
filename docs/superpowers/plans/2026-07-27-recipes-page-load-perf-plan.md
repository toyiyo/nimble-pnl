# Recipes page load performance — plan

**Design:** `docs/superpowers/specs/2026-07-27-recipes-page-load-perf-design.md`
**Branch:** `perf/recipes-page-load`

Each task is RED → GREEN → REFACTOR → COMMIT. Dependencies noted.

## Group A — Database (independent, can run first)

### A1. pgTAP + migration: `get_recipe_sales_stats` RPC
- **RED:** `supabase/tests/get_recipe_sales_stats.sql` — asserts (a) avg = `sum(total_price)/sum(coalesce(nullif(quantity,0),1))`, (b) a row with `quantity = NULL` counts as 1 in the denominator, (c) a row with `quantity = 0` counts as 1, (d) an item with >1000 sales rows averages over **all** rows (the truncation bug), (e) only `is_active` recipes' `pos_item_name`s appear, (f) a caller from another restaurant gets zero rows.
- **GREEN:** migration creating the function exactly as in design §3.5 — `language sql`, `stable`, `security invoker`, `set search_path = public`.
- Depends on: nothing.

### A2. Migration: partial composite index
- Dedicated migration file containing **only** `create index concurrently if not exists idx_unified_sales_restaurant_item_name on unified_sales (restaurant_id, item_name) where unit_price is not null;`
- Verify no other statement is in the file (repo precedent: CONCURRENTLY cannot run in a transaction block).
- Depends on: nothing.

## Group B — Fetch primitives (independent)

### B1. Paginated fetch helper
- **RED:** unit test proving a query returning >1000 rows is fully retrieved (not truncated at the PostgREST cap), and that a short page terminates the loop.
- **GREEN:** `fetchAllPages(queryBuilder)` using `.range()`.
- Depends on: nothing.

### B2. Chunked `.in()` helper
- **RED:** unit test — 450 ids produce 3 requests of ≤200; results concatenate in order; empty input issues zero requests.
- **GREEN:** `fetchInChunks(ids, fn, 200)`, composed with B1 per chunk.
- Depends on: nothing.

## Group C — Hook rewrite (sequential; depends on A1, B1, B2)

### C1. Bulk fetch + in-memory computation
- **RED:** unit test asserting `fetchRecipes` issues **5 requests regardless of recipe count** (3 vs 133 fixtures) — this is the N+1 regression guard. Plus a parity test: computed `estimated_cost` and `profit_margin` match the current implementation's output for real fixtures.
- **GREEN:** replace the `Promise.all` N+1 with Q1–Q5 (design §3.1–3.5), group ingredients by `recipe_id`, `Map` product lookup, call `calculateInventoryImpact` unchanged, join Q5 for `avg_sale_price`.
- Ordering: Q1+Q2+Q4+Q5 in one `Promise.all`; Q3 after Q1 (needs recipe ids). Two levels.
- Also: delete the 7 hot-path `console.log` calls.

### C2. Batched cost heal
- **RED:** test that a drift of `< 0.005` issues **zero** writes; a real drift issues exactly **one** upsert containing only drifted rows; a second load after a heal issues zero writes (convergence).
- **GREEN:** rounded comparison per design §3.7, single `upsert`.

### C3. Realtime → cache invalidation + echo guard
- **RED:** test that a realtime event whose ids are all in the pending-heal set is **ignored**; an event with other ids triggers `invalidateQueries`.
- **GREEN:** subscription calls `queryClient.invalidateQueries({ queryKey: ['recipes', restaurantId] })`; heal records written ids in a ref, guard clears the set after matching.

### C4. React Query conversion + mutations
- **RED:** tests that `createRecipe`/`updateRecipe`/`deleteRecipe`/`updateRecipeIngredients` each invalidate `['recipes', restaurantId]` and that the hook's public signatures are unchanged (all 4 mount points keep compiling).
- **GREEN:** `useQuery` (`staleTime: 30000`, `enabled: !!restaurantId && !!user`); all four mutations → `useMutation` + `invalidateQueries`; remove every local `setRecipes`.
- **Verify all 4 mount points:** `Recipes.tsx:44`, `RecipeDialog.tsx:73` (×2), `MapPOSItemDialog.tsx:36`.

## Group D — Page render (depends on C4 for `isError`)

### D1. Error state
- **RED:** test that `isError` renders an error state distinct from the empty state.
- **GREEN:** add the `isError` branch to `RecipeTable` (currently only loading + empty at `Recipes.tsx:580-633`).

### D2. Render-path fixes
- Memoize `filteredRecipes` (`Recipes.tsx:155`) — currently defeats the `useMemo`s at `:160`/`:164`.
- Conditionally render mobile vs desktop instead of `block md:hidden`/`hidden md:block` (`:639`, `:712`) so only one tree mounts.
- **RED:** unit test for the `Map`-based lookup in `validateRecipeConversions`; **GREEN:** replace the O(ingredients × products) `.find()` at `recipeConversionValidation.ts:30`.

### D3. Suggestions banner
- **RED:** test that the banner's data source no longer triggers the 500-row sales fetch or the duplicate `['recipes-for-mapping']` query.
- **GREEN:** replace `useUnifiedSales(restaurantId)` in `Recipes.tsx` with a lightweight distinct-unmapped-item-names query. Do **not** modify `useUnifiedSales` itself (POSSales depends on it).

## Group E — E2E (depends on all)

### E1. Playwright spec
`tests/e2e/recipes-performance.spec.ts`:
- `/recipes` renders costs and margins for a seeded tenant.
- Create → edit → delete round-trips correctly through the query cache (the React Query conversion's main risk).
- Error state renders distinctly from empty.
- Request count to `/rest/v1/recipes*` stays bounded as recipe count grows — the standing regression guard against this N+1 returning.

## Verification (Phase 8)
`npm run test && npm run test:db && npm run test:e2e`, `npm run typecheck`, `npm run lint`, `npm run build`.
E2E gate: **covered** by E1 (behavioral change to a page + a new RPC in the request path).
