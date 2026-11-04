# Recipe Sales Stats RLS Timeout Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

Text style: STE-aligned (ASD-STE100).

**Goal:** Stop the `57014` statement timeout of `get_recipe_sales_stats`. Make it a `SECURITY DEFINER` function with an explicit tenant check.

**Architecture:** One new migration replaces the function body. The definer owner (`postgres`) has `rolbypassrls`, so the per-row RLS subplan on `unified_sales` goes away. The check `public.user_has_capability(p_restaurant_id, 'view:recipes')` keeps the access set the same. A caller without the capability gets zero rows. No TypeScript changes.

**Tech Stack:** PostgreSQL (Supabase), pgTAP, Supabase CLI 2.120.0.

**Spec:** `docs/superpowers/specs/2026-10-06-recipe-sales-stats-rls-timeout-design.md`

## Global Constraints

- New migration file name: `supabase/migrations/20261006130000_get_recipe_sales_stats_definer.sql`. Do not edit `supabase/migrations/20260727120000_get_recipe_sales_stats.sql`.
- Function attributes: `LANGUAGE sql`, `STABLE`, `SECURITY DEFINER`, `SET search_path = ''`.
- Every name in the body has the `public.` schema.
- Signature and return type do not change: `get_recipe_sales_stats(p_restaurant_id UUID) RETURNS TABLE (item_name TEXT, avg_sale_price NUMERIC)`.
- A caller without `view:recipes` gets zero rows, not `42501`.
- Grants: `REVOKE ALL ... FROM PUBLIC, anon`; `GRANT EXECUTE ... TO authenticated`.
- Do not change `src/`. Do not change the generated type files.
- Run `npm run db:reset` after each migration edit (lesson `memory/lessons.md:868`).
- Stage files with explicit paths. Never use `git add -A`. Never commit `progress.md`.
- Production is read-only. Do not apply the migration to production.
- Commit messages end with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.

## Review Focus

1. **`proacl` is NULL.** `aclexplode(NULL)` returns no rows. A "PUBLIC has no EXECUTE" test that only checks for a missing PUBLIC row passes when the ACL is the default, and the default gives EXECUTE to PUBLIC. The test must also assert `proacl IS NOT NULL`. Owner: Task 1, test 15.
2. **A member without `view:recipes`.** A `staff` member of Restaurant A has a `user_restaurants` row. A membership-only check gives that user rows. The test must use a member, not a non-member (lesson `memory/lessons.md:873`). Owner: Task 1, test 12.
3. **The check is removed later.** The definer bypasses RLS, so only the check protects other tenants. The mutation step proves that tests 7 and 12 fail without the check (lesson `memory/lessons.md:2100`). Owner: Task 2, Step 4.
4. **The owner loses `rolbypassrls`.** Then RLS applies again and the timeout comes back with no failed test. Test 17 pins the owner attribute (lesson `memory/lessons.md:2599`). Owner: Task 1, test 17.
5. **The index plan check uses a stale body.** The copy in the index test must match the new body, or the test proves nothing about the real query. Owner: Task 3.

---

### Task 1: pgTAP tests for the definer contract (fail first)

**Files:**
- Modify: `supabase/tests/get_recipe_sales_stats.sql:1-25` (header and `plan`)
- Modify: `supabase/tests/get_recipe_sales_stats.sql:32-45` (fixture users and memberships)
- Modify: `supabase/tests/get_recipe_sales_stats.sql:165-186` (test 7 comment and message, test 8)
- Modify: `supabase/tests/get_recipe_sales_stats.sql` end of file (tests 12-17, before `SELECT * FROM finish();`)

**Interfaces:**
- Consumes: the current function `public.get_recipe_sales_stats(uuid)`.
- Produces: fixture user `aa000000-0000-0000-0000-0000000000a3` with role `staff` in Restaurant A. Tests 8 and 12-17, which Task 2 makes pass.

- [ ] **Step 1: Update the file header**

Replace lines 4-10 (the paragraph that starts `-- Fixture restaurant aa000000-...0001`) with:

```sql
-- Fixture restaurant aa000000-0000-0000-0000-000000000001 ("Recipe Stats Test
-- Restaurant A"), owned by user …a1. User …a3 is a `staff` member of
-- Restaurant A. `staff` has no `view:recipes`. A second restaurant
-- aa000000-0000-0000-0000-000000000002 ("...Restaurant B") with its own owner
-- …a2 (NOT a member of Restaurant A) exists to prove cross-tenant isolation
-- (test 7).
--
-- The function is SECURITY DEFINER and its owner bypasses RLS
-- (supabase/migrations/20261006130000_get_recipe_sales_stats_definer.sql).
-- Thus RLS does not isolate tenants here. The explicit check
-- public.user_has_capability(p_restaurant_id, 'view:recipes') does.
-- Tests 7 and 12 fail if a person removes that check.
-- Design: docs/superpowers/specs/2026-10-06-recipe-sales-stats-rls-timeout-design.md
```

Change line 25 from `SELECT plan(11);` to:

```sql
SELECT plan(17);
```

- [ ] **Step 2: Add the `staff` fixture user**

Replace the two fixture `INSERT` statements for `auth.users` and `user_restaurants` with:

```sql
INSERT INTO auth.users (id, email) VALUES
  ('aa000000-0000-0000-0000-0000000000a1'::uuid, 'recipe-stats-owner-a@example.com'),
  ('aa000000-0000-0000-0000-0000000000a2'::uuid, 'recipe-stats-owner-b@example.com'),
  ('aa000000-0000-0000-0000-0000000000a3'::uuid, 'recipe-stats-staff-a@example.com')
ON CONFLICT (id) DO UPDATE SET email = EXCLUDED.email;
```

```sql
INSERT INTO user_restaurants (user_id, restaurant_id, role) VALUES
  ('aa000000-0000-0000-0000-0000000000a1'::uuid, 'aa000000-0000-0000-0000-000000000001'::uuid, 'owner'),
  ('aa000000-0000-0000-0000-0000000000a2'::uuid, 'aa000000-0000-0000-0000-000000000002'::uuid, 'owner'),
  ('aa000000-0000-0000-0000-0000000000a3'::uuid, 'aa000000-0000-0000-0000-000000000001'::uuid, 'staff')
ON CONFLICT (user_id, restaurant_id) DO UPDATE SET role = EXCLUDED.role;
```

- [ ] **Step 3: Update test 7 and test 8**

Replace the test 7 comment block and assertion with:

```sql
-- ============================================================
-- Test 7 (f): a caller from another restaurant gets zero rows, even though
-- p_restaurant_id is a valid id with real data. The function is SECURITY
-- DEFINER and bypasses RLS, so the explicit user_has_capability check in the
-- function body gives this isolation. This test fails without that check.
-- ============================================================
SET LOCAL "request.jwt.claims" TO '{"sub": "aa000000-0000-0000-0000-0000000000a2", "role": "authenticated"}';

SELECT is(
  (SELECT COUNT(*)::int FROM get_recipe_sales_stats('aa000000-0000-0000-0000-000000000001'::uuid)),
  0,
  'A caller with no membership in Restaurant A gets zero rows (explicit capability check)'
);
```

Replace test 8 with:

```sql
SELECT is(
  (SELECT prosecdef FROM pg_proc WHERE proname = 'get_recipe_sales_stats' AND pronamespace = 'public'::regnamespace),
  true,
  'get_recipe_sales_stats is SECURITY DEFINER (prosecdef = true)'
);
```

- [ ] **Step 4: Add tests 12-17 before `SELECT * FROM finish();`**

```sql
-- Test 12: a staff member of Restaurant A gets zero rows. The user has a
-- user_restaurants row, so a membership-only check gives rows. Only the
-- view:recipes capability stops this user (lesson memory/lessons.md:873).
SET LOCAL "request.jwt.claims" TO '{"sub": "aa000000-0000-0000-0000-0000000000a3", "role": "authenticated"}';

SELECT is(
  (SELECT COUNT(*)::int FROM get_recipe_sales_stats('aa000000-0000-0000-0000-000000000001'::uuid)),
  0,
  'A staff member of Restaurant A (no view:recipes) gets zero rows'
);

-- Test 13: search_path is pinned to empty (lesson memory/lessons.md:1317).
SELECT ok(
  (SELECT proconfig @> ARRAY['search_path=""']
   FROM pg_proc WHERE oid = 'public.get_recipe_sales_stats(uuid)'::regprocedure),
  'get_recipe_sales_stats pins search_path to empty'
);

-- Test 14: anon cannot execute the function.
SELECT ok(
  NOT has_function_privilege('anon', 'public.get_recipe_sales_stats(uuid)', 'EXECUTE'),
  'anon has no EXECUTE on get_recipe_sales_stats'
);

-- Test 15: PUBLIC has no EXECUTE grant. A NULL proacl means the default ACL,
-- and the default gives EXECUTE to PUBLIC. aclexplode(NULL) returns no rows,
-- so the test also asserts that proacl is not NULL.
SELECT ok(
  (SELECT p.proacl IS NOT NULL
      AND NOT EXISTS (
        SELECT 1 FROM aclexplode(p.proacl) a
        WHERE a.grantee = 0 AND a.privilege_type = 'EXECUTE'
      )
   FROM pg_proc p WHERE p.oid = 'public.get_recipe_sales_stats(uuid)'::regprocedure),
  'PUBLIC has no EXECUTE on get_recipe_sales_stats'
);

-- Test 16: authenticated can execute the function.
SELECT ok(
  has_function_privilege('authenticated', 'public.get_recipe_sales_stats(uuid)', 'EXECUTE'),
  'authenticated has EXECUTE on get_recipe_sales_stats'
);

-- Test 17: the owner bypasses RLS. If the owner changes to a role without
-- rolbypassrls, the per-row RLS subplan and the timeout come back
-- (lesson memory/lessons.md:2599).
SELECT ok(
  (SELECT r.rolbypassrls
   FROM pg_proc p JOIN pg_roles r ON r.oid = p.proowner
   WHERE p.oid = 'public.get_recipe_sales_stats(uuid)'::regprocedure),
  'the owner of get_recipe_sales_stats has rolbypassrls'
);
```

- [ ] **Step 5: Run the test file and check that it fails**

Run: `npm run db:reset && npx supabase test db supabase/tests/get_recipe_sales_stats.sql`

Expected: FAIL. Tests 8 (`prosecdef`), 13 (`search_path`), 14 (`anon`), and 15 (`PUBLIC`) fail. Tests 1-7, 9-12, 16, and 17 pass. Test 12 passes now because the `recipes` RLS policy stops the `staff` user. Task 2 moves that duty to the explicit check.

- [ ] **Step 6: Do not commit yet**

The failing test file goes into the Task 2 commit with the migration, so each commit on the branch passes `test:db`.

---

### Task 2: The definer migration

**Files:**
- Create: `supabase/migrations/20261006130000_get_recipe_sales_stats_definer.sql`
- Test: `supabase/tests/get_recipe_sales_stats.sql` (from Task 1)

**Interfaces:**
- Consumes: `public.user_has_capability(uuid, text) RETURNS boolean` (STABLE, SECURITY DEFINER, `supabase/migrations/20260806140000_legacy_role_sensitive_flags.sql:27-35`). Tests 8 and 12-17 from Task 1.
- Produces: `public.get_recipe_sales_stats(p_restaurant_id UUID) RETURNS TABLE (item_name TEXT, avg_sale_price NUMERIC)`, now SECURITY DEFINER. Task 3 copies its body.

- [ ] **Step 1: Write the migration**

```sql
-- get_recipe_sales_stats: SECURITY DEFINER with an explicit tenant check.
-- Design: docs/superpowers/specs/2026-10-06-recipe-sales-stats-rls-timeout-design.md
--
-- Why: the earlier version (20260727120000_get_recipe_sales_stats.sql) is
-- SECURITY INVOKER with SET search_path, so Postgres does not inline it and
-- plans p_restaurant_id as $1 (a generic plan). In the generic plan, the
-- unified_sales RLS EXISTS subplan is correlated and runs one time for each
-- sales row. For a tenant with 68,276 sales rows this cost 546,109 buffers
-- and 3.2 s on a warm cache, and the call hit the 8 s statement_timeout
-- (57014) for authenticated. As a definer owned by postgres (rolbypassrls),
-- the body has no RLS subplan: 3,202 buffers, about 21 ms.
--
-- The definer bypasses RLS, so the explicit check
-- public.user_has_capability(p_restaurant_id, 'view:recipes') gives tenant
-- isolation. It gives the same access set as the old RLS pair: the recipes
-- policy is user_has_capability(restaurant_id, 'view:recipes'), and that
-- function returns false when the caller has no user_restaurants row. The
-- check has constant arguments and is STABLE, so the planner runs it one time
-- (One-Time Filter), not for each row. A caller without the capability gets
-- zero rows, not an error: useRecipes also runs on /pos-sales, where a
-- collaborator with the sales area but not the recipes area must not see an
-- error toast.
--
-- coalesce(nullif(quantity,0), 1) is load-bearing: it mirrors the TS it
-- replaces (`sale.quantity || 1`) exactly -- every row with NULL or 0
-- quantity counts as 1 in the denominator, never as skipped/zero. A bare
-- sum(quantity) would let a NULL-quantity row vanish and a 0-quantity row
-- contribute 0, shrinking the denominator and inflating avg_sale_price (and
-- every downstream margin). unified_sales.quantity is NUMERIC NOT NULL
-- DEFAULT 1 today, so the NULL branch is defensive; the 0 branch is live.
--
-- coalesce(total_price, 0) is load-bearing for the same reason, on the
-- numerator side: unified_sales.total_price is NULLABLE, and the TS this
-- replaces summed `sale.total_price || 0`. A bare sum() returns NULL when every
-- row in a group has a NULL total_price (a manual sale with unit_price set but
-- no total), which would flip that item from "avg price 0" to "No sales data".
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

-- Postgres and the Supabase default privileges give EXECUTE to PUBLIC and
-- anon. Only signed-in users call this function.
REVOKE ALL ON FUNCTION public.get_recipe_sales_stats(UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_recipe_sales_stats(UUID) TO authenticated;
```

- [ ] **Step 2: Reset the database and run the test file**

Run: `npm run db:reset && npx supabase test db supabase/tests/get_recipe_sales_stats.sql`

Expected: PASS, 17 of 17.

- [ ] **Step 3: Run the full pgTAP suite**

Run: `npm run test:db`

Expected: PASS for `get_recipe_sales_stats.sql`. `idx_unified_sales_restaurant_item_name_cover.sql` also passes, because its copy still uses the old body. Task 3 updates that copy. If other files fail, compare with a run on `origin/main` before you continue. Do not change unrelated tests.

- [ ] **Step 4: Prove that the tests are not vacuous (mutation check)**

Warning: put the line back before you commit.

1. Delete this line from the new migration:
   `    AND public.user_has_capability(p_restaurant_id, 'view:recipes')`
2. Run: `npm run db:reset && npx supabase test db supabase/tests/get_recipe_sales_stats.sql`
3. Expected: FAIL. Test 7 (non-member) and test 12 (`staff`) each return more than 0 rows.
4. Put the line back. Run `git diff --stat` and check that the migration has no change from Step 1.
5. Run: `npm run db:reset && npx supabase test db supabase/tests/get_recipe_sales_stats.sql`
6. Expected: PASS, 17 of 17.

Write the output lines of the failed tests 7 and 12 into `progress.md` as evidence.

- [ ] **Step 5: Commit**

```bash
git add supabase/migrations/20261006130000_get_recipe_sales_stats_definer.sql supabase/tests/get_recipe_sales_stats.sql
git commit -m "fix(recipes): make get_recipe_sales_stats a definer with a tenant check

The RLS subplan on unified_sales ran one time for each sales row in the
generic plan. Large tenants hit the 8 s statement timeout (57014).

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 3: Update the index plan check to the new body

**Files:**
- Modify: `supabase/tests/idx_unified_sales_restaurant_item_name_cover.sql:1-4` (header citation)
- Modify: `supabase/tests/idx_unified_sales_restaurant_item_name_cover.sql:79-111` (comment and copied body)

**Interfaces:**
- Consumes: the function body from Task 2, Step 1.
- Produces: nothing for later tasks.

- [ ] **Step 1: Update the header citation**

Replace lines 1-2 with:

```sql
-- Verifies the covering index backing get_recipe_sales_stats
-- (supabase/migrations/20261006130000_get_recipe_sales_stats_definer.sql) and
```

- [ ] **Step 2: Update the comment and the copied body**

Replace lines 79-86 (the comment above `SET LOCAL enable_seqscan = off;`) with:

```sql
-- The plan check runs EXPLAIN on the function body, not on the call: the
-- function has `SET search_path`, so Postgres does not inline it and EXPLAIN on
-- the call shows only a Function Scan. The query is a copy of the body in
-- 20261006130000_get_recipe_sales_stats_definer.sql. When a migration changes
-- that body, change this copy too. This test runs as postgres, so
-- user_has_capability returns false at run time. EXPLAIN does not run the
-- query, and the planner puts the check in a One-Time Filter above the scan,
-- so the plan still shows the index. Seq and bitmap scans are off so the
-- result does not depend on the table statistics of the test database. It
-- asserts the index name and not "Index Only Scan": this transaction cannot
-- VACUUM, so the visibility map is empty and the planner may pick an Index Scan.
```

Replace the `EXPLAIN (COSTS OFF)` query (lines 97-107) with:

```sql
    EXPLAIN (COSTS OFF)
    SELECT us.item_name,
           SUM(COALESCE(us.total_price, 0)) / NULLIF(SUM(COALESCE(NULLIF(us.quantity, 0), 1)), 0)
    FROM public.unified_sales us
    JOIN public.recipes r
      ON r.restaurant_id = us.restaurant_id
     AND r.pos_item_name = us.item_name
     AND r.is_active
    WHERE us.restaurant_id = '00000000-0000-0000-0000-000000000000'::uuid
      AND us.unit_price IS NOT NULL
      AND public.user_has_capability('00000000-0000-0000-0000-000000000000'::uuid, 'view:recipes')
    GROUP BY us.item_name
```

- [ ] **Step 3: Run the test file**

Run: `npx supabase test db supabase/tests/idx_unified_sales_restaurant_item_name_cover.sql`

Expected: PASS, 7 of 7. If test 7 fails, print the plan lines (`SELECT line FROM recipe_sales_stats_plan`) and record them in `progress.md`. Do not remove the capability filter from the copy to make the test pass.

- [ ] **Step 4: Run the full pgTAP suite**

Run: `npm run test:db`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add supabase/tests/idx_unified_sales_restaurant_item_name_cover.sql
git commit -m "test(recipes): copy the definer body into the index plan check

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 4: Verification

**Files:**
- No file changes.

**Interfaces:**
- Consumes: the branch after Tasks 1-3.
- Produces: evidence lines in `progress.md`.

- [ ] **Step 1: Check that no client code changed**

Run: `git diff --stat origin/main...HEAD -- src supabase/functions`

Expected: no output.

- [ ] **Step 2: Run the static checks and the unit tests**

Run: `npm run typecheck && npm run lint && npm run test`

Expected: PASS. No file in this branch is TypeScript, so a failure here is a baseline failure. Compare with `origin/main` before you continue.

- [ ] **Step 3: Run the Recipes E2E spec**

Warning: the local Supabase stack and the dev server must run. Do not use a poll loop to wait for them.

Run: `npx playwright test tests/e2e/recipes-performance.spec.ts --reporter=line`

Expected: PASS. The spec checks the margin values 4.00, 10.00, and 60.0% (`tests/e2e/recipes-performance.spec.ts:93-151`). These values come from this RPC, so the owner path works from end to end.

- [ ] **Step 4: Record the evidence**

Write the pass counts from Steps 2-3, the 17 of 17 pgTAP result, and the mutation-check output into `progress.md`.
