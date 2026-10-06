# Design: Recipe sales stats RPC timeout (RLS per-row cost)

Date: 2026-10-06
Branch: `fix/recipe-sales-stats-rls-timeout`
Status: draft, for approval
Text style: STE-aligned (ASD-STE100)

## 1. Problem

The Recipes page fails for some tenants. The RPC `get_recipe_sales_stats` stops
with `57014` (statement timeout) for the role `authenticated`. That role has
`statement_timeout = 8s`.

The failing tenant is `7c0c76e3-e770-401b-a2a9-c1edd407efed`. It has 68,276
`unified_sales` rows and 17 active recipes.

The RPC is one of four parallel loads in `fetchRecipes`
(`src/hooks/useRecipes.tsx:516-549`). `fetchAllRows` throws on an error
(`supabase/functions/_shared/labor/fetchAllRows.ts:51`, re-exported by
`src/utils/fetchAllRows.ts:3`). Thus one failed RPC aborts the full recipe
load (`src/hooks/useRecipes.tsx:514-516`). The
user sees the error toast (`src/hooks/useRecipes.tsx:660-667`) and no recipes.

## 2. Cause (production evidence)

All production tests ran inside one transaction that ended with an exception.
Postgres rolled back each test. No probe object stays in production
(`probe_fn_left = 0`).

### 2.1 Current function

The current function is `LANGUAGE sql`, `SECURITY INVOKER`, with
`SET search_path = public`
(`supabase/migrations/20260727120000_get_recipe_sales_stats.sql:27-44`).
The `SET` clause stops inlining. Thus the planner plans `p_restaurant_id` as
`$1`, and the plan is generic.

| Test | Time | Shared buffers | Rows |
|---|---|---|---|
| A: real call as the tenant owner (RLS on) | 3,232 ms | 546,109 | 14 |
| Body with a literal restaurant ID (custom plan) | 38 ms | 3,754 | 14 |
| Body with `$1`, `plan_cache_mode = force_generic_plan` | 3,252 ms | 544,900 | 14 |

The generic plan matches the real call. The hot node is the RLS subplan of the
`unified_sales` policy "Users can view sales for their restaurants":

```sql
EXISTS (SELECT 1 FROM user_restaurants
        WHERE restaurant_id = unified_sales.restaurant_id
          AND user_id = auth.uid())
```

In the generic plan, this subplan is correlated. It runs one time for each
`unified_sales` row: 21,670 loops. Each loop does a Bitmap Heap Scan on
`user_restaurants`. Each loop also applies the `user_restaurants` RLS policy,
which calls `user_is_internal_team(restaurant_id)` for 32 member rows. This
costs 541,750 of the 546,109 buffers.

In the custom plan, the planner hashes the same subplan and runs it one time.

### 2.2 Limit of the evidence

The warm-cache time is 3.2 s. That is less than 8 s. The tests do not show the
cold-cache time or the time under load. Those conditions push the call past
8 s in production. The fix removes the 541,750-buffer subplan, so it removes
the cause in all conditions.

### 2.3 Candidate fix, measured

The candidate (Section 3) ran in production in a rolled-back transaction:

| Call | Time | Rows |
|---|---|---|
| Body plan, generic, as the definer | 48.8 ms, 3,202 buffers | 14 |
| Real call as the owner (role `authenticated`), 7 calls | 20.5 – 21.7 ms each | 14 |
| Real call as a non-member | — | 0 |

The plan shows `One-Time Filter: user_has_capability(...)`. Postgres runs the
check one time for each call, not for each row. The scan uses
`idx_unified_sales_restaurant_item_name_cover`.

## 3. Design

### 3.1 New migration

File: `supabase/migrations/20261006120000_get_recipe_sales_stats_definer.sql`.
The prefix is unique and sorts after the latest migration
(`20260930120300_schedule_mark_stale_pending_outflows.sql`).

```sql
CREATE OR REPLACE FUNCTION public.get_recipe_sales_stats(p_restaurant_id UUID)
RETURNS TABLE (item_name TEXT, avg_sale_price NUMERIC)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT us.item_name,
         SUM(COALESCE(us.total_price, 0)) / NULLIF(SUM(COALESCE(NULLIF(us.quantity, 0), 1)), 0)
  FROM public.unified_sales us
  JOIN public.recipes r
    ON r.restaurant_id = us.restaurant_id
   AND r.pos_item_name = us.item_name
   AND r.is_active
  WHERE us.restaurant_id = p_restaurant_id
    AND us.unit_price IS NOT NULL
    AND public.user_has_capability(p_restaurant_id, 'view:recipes')
  GROUP BY us.item_name;
$$;

REVOKE ALL ON FUNCTION public.get_recipe_sales_stats(UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_recipe_sales_stats(UUID) TO authenticated;
```

The body is the same as the latest body
(`supabase/migrations/20260727120000_get_recipe_sales_stats.sql:34-43`). Only
one migration defines this function (`grep -rl` result). The changes are:

1. `SECURITY DEFINER`. The owner is `postgres`, which has `rolbypassrls`. The
   per-row RLS subplan goes away.
2. `SET search_path = ''`, and every name has the `public.` schema. This
   follows the lesson in `memory/lessons.md:1300-1311`.
3. An explicit tenant check: `public.user_has_capability(p_restaurant_id,
   'view:recipes')`. A definer function without this check would leak sales
   data across tenants (`memory/lessons.md:1932-1934`).
4. `REVOKE ... FROM PUBLIC, anon`. Postgres grants `EXECUTE` to `PUBLIC` by
   default on a new function.

The header comments about `coalesce(nullif(quantity,0),1)` and
`coalesce(total_price,0)` move to the new migration, because they still apply.

### 3.2 Why `LANGUAGE sql` and not plpgsql

The check has constant arguments and `user_has_capability` is `STABLE`
(`supabase/migrations/20260806140000_legacy_role_sensitive_flags.sql:27-35`).
Thus the planner makes it a one-time filter (Section 2.3). A plpgsql
`IF ... RAISE` block is not necessary. The language stays `sql`, so pgTAP test
10 does not change.

### 3.3 Access for a caller without the capability: zero rows, not 42501

The earlier probe raised `42501` for a non-member. This design returns zero
rows. The reasons:

- `useRecipes` is also used on `/pos-sales` (`src/pages/POSSales.tsx:145`),
  `POSSaleDialog` (`src/components/POSSaleDialog.tsx:85`), and
  `MapPOSItemDialog` (`src/components/MapPOSItemDialog.tsx:36`).
- A custom collaborator role can have the `sales` area without the `recipes`
  area (`src/lib/permissions/areaData.ts:43`, `:54`;
  `src/lib/permissions/routeAreas.ts:80-119`). Today, that user gets zero
  recipes from RLS and no error. (`StaffRoleChecker` sends a `staff` user away
  from `/pos-sales`, `src/App.tsx:335-342`, so `staff` does not reach this
  page.) With `42501`, `fetchAllRows` throws, and the
  `/pos-sales` page shows an error toast. That is a regression.
- Zero rows is the current contract. pgTAP test 7 asserts it
  (`supabase/tests/get_recipe_sales_stats.sql:165-180`).
- Zero rows does not leak data. The caller cannot tell "no access" from "no
  sales".

### 3.4 Access set: same as today

The lesson in `memory/lessons.md` (2026-07-22) says: a guard must match the
deployed policy. Today, a row comes back only if two policies pass:

- `unified_sales`: the caller has a `user_restaurants` row for the restaurant.
- `recipes`: `user_has_capability(restaurant_id, 'view:recipes')`.

`user_has_capability` returns `false` when the caller has no `user_restaurants`
row. Thus the `recipes` policy implies the `unified_sales` policy. The new check
`user_has_capability(p_restaurant_id, 'view:recipes')` gives the same access
set. No role gains access. No role loses access.

### 3.5 Callers

- The only runtime caller is `src/hooks/useRecipes.tsx:546-549`. It uses the
  authenticated client, so `auth.uid()` is set. No edge function and no
  service-role caller exists (`grep` of `supabase/functions`). The lesson in
  `memory/lessons.md:903-905` does not apply.
- No client code changes. The signature and the return type do not change, so
  `src/integrations/supabase/types.ts` and `src/types/supabase.ts` do not
  change.

## 4. Tests

### 4.1 pgTAP: `supabase/tests/get_recipe_sales_stats.sql`

Tests 1–6, 9, 10, 11 stay the same. They run as the owner `…a1` with the role
`authenticated`, so the capability check passes for them.

Changes:

- Test 7 stays as "zero rows for a non-member". Update its comment: the
  explicit check, not RLS, now gives the isolation. This test now fails if a
  person removes the check, because the definer bypasses RLS.
- Test 8: `prosecdef` is `true`.
- New test: a member of Restaurant A with the role `staff` gets zero rows.
  `staff` has no `view:recipes`. This test fails if the check uses membership
  only (lesson `memory/lessons.md:865-868`: use a subject that only the clause
  under test controls).
- New test: `proconfig` contains `search_path=""`.
- New test: `anon` has no `EXECUTE` (`has_function_privilege`).
- New test: `PUBLIC` has no `EXECUTE` (`aclexplode` on `proacl`).
- New test: `authenticated` has `EXECUTE`.
- `plan(11)` becomes `plan(16)`.

### 4.2 pgTAP: `supabase/tests/idx_unified_sales_restaurant_item_name_cover.sql`

The plan check copies the function body
(`supabase/tests/idx_unified_sales_restaurant_item_name_cover.sql:79-108`).
Update the copy to the new body and the new file citation. The test runs as
`postgres`, so `user_has_capability` returns `false`. The planner still plans
the scan below the one-time filter, so `EXPLAIN (COSTS OFF)` still shows the
index name.

### 4.3 Unit and E2E

- No TypeScript changes, so no new unit test.
- `tests/e2e/recipes-performance.spec.ts:93-151` loads the Recipes page and
  checks the margin values that come from this RPC. It covers the change from
  end to end.

## 5. Rollout

- The migration is one `CREATE OR REPLACE`. It takes a short lock on the
  function only. No table lock and no data change.
- Rollback: re-apply the body of
  `supabase/migrations/20260727120000_get_recipe_sales_stats.sql` in a new
  migration.

## 6. Out of scope

- Option 2: rewrite the `unified_sales` policy to
  `restaurant_id IN (SELECT ... WHERE user_id = (SELECT auth.uid()))`. That fix
  helps every reader of `unified_sales`, but it has a much larger blast radius.
  Track it as a separate task.

## 7. Lessons applied

| Lesson | Where |
|---|---|
| `memory/lessons.md:1300-1311` pin `search_path`, schema-qualify | 3.1 |
| `memory/lessons.md:1932-1934` definer needs an explicit tenant check | 3.1, 3.4 |
| `memory/lessons.md` 2026-07-22 guard set matches the deployed policy | 3.4 |
| `memory/lessons.md:865-868` RLS test subject | 4.1 |
| `memory/lessons.md:903-905` grep callers before an `auth.uid()` guard | 3.5 |
| `memory/lessons.md:896` unique migration prefix | 3.1 |
| `memory/lessons.md:860-863` run `db:reset` after a migration edit | Plan |
