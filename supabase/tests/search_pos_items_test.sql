-- ============================================================================
-- Tests for search_pos_items(p_restaurant_id uuid, p_search text, p_limit int)
--
-- Design:  docs/superpowers/specs/2026-07-28-pos-items-truncation-and-scroll-design.md
-- Plan:    docs/superpowers/plans/2026-07-28-pos-items-truncation-and-scroll-plan.md
-- Privacy: every identifier below is a fictional placeholder; no real
--          tenant, person or item name appears in this file.
--
-- Migration under test (not yet applied when this test is written):
--   supabase/migrations/20260728140000_search_pos_items.sql
--
-- Covers, per the plan's Task 1 test list:
--   1. case-insensitive dedupe across pos_sales + unified_sales
--   2. ranking sales_count DESC with the item_name ASC tiebreaker
--   3. p_search filters to matching items
--   4. p_search is literal (%, _ and \ are escaped, not treated as wildcards)
--   5. p_limit clamps: NULL/0/negative -> 100, > 500 -> 500
--   6. source resolution ('pos_sales' wins when any contributing row is)
--   7. item_id FILTER fallback (newest row's NULL id must not shadow an
--      older row's real id)
--   8. cross-tenant isolation, denied-baseline-first ([2026-07-13] lesson)
--   9. an item whose raw sales rows sit entirely beyond row 1000 of the
--      table is still found and counted correctly (the reported bug)
--
-- Functional assertions (1-6, 9) run as the default `postgres` connection
-- role, which carries BYPASSRLS -- confirmed locally
-- (`SELECT rolbypassrls FROM pg_roles WHERE rolname = 'postgres'` -> t) --
-- so no auth.users/user_restaurants fixture is needed for those tenants.
-- Only the cross-tenant isolation scenario (8) needs to exercise the real
-- RLS boundary, so it alone impersonates `authenticated` via
-- `SET LOCAL ROLE authenticated` + `request.jwt.claims`, per the pattern in
-- supabase/tests/22_operations_manager_rls.sql and
-- supabase/tests/54_accept_shift_trade_authz.sql.
--
-- Fixture namespace: UUIDs starting with 88000000-...
--   ...0001 = Tenant A (small, scoped fixtures for assertions 1-7, each
--             fixture group scoped to a unique p_search prefix/term so
--             groups cannot bleed into each other's assertions)
--   ...0002 = Tenant B (cross-tenant negative control, assertion 8)
--   ...0003 = Tenant C (520 distinct items, assertion 5 limit-clamp bulk)
--   ...0004 = Tenant D (1000+ raw rows, assertion 9 row-beyond-1000 bulk)
--   ...0101 = principal A (owner of Tenant A)
--   ...0102 = principal B (owner of Tenant B, NOT a member of Tenant A)
-- ============================================================================

BEGIN;
SELECT plan(28);

-- ============================================================================
-- Fixtures (inserted as the default `postgres` role, which bypasses RLS)
-- ============================================================================

INSERT INTO public.restaurants (id, name) VALUES
  ('88000000-0000-0000-0000-000000000001', 'Fixture Tenant A'),
  ('88000000-0000-0000-0000-000000000002', 'Fixture Tenant B'),
  ('88000000-0000-0000-0000-000000000003', 'Fixture Tenant C'),
  ('88000000-0000-0000-0000-000000000004', 'Fixture Tenant D')
ON CONFLICT (id) DO NOTHING;

INSERT INTO auth.users (id, email) VALUES
  ('88000000-0000-0000-0000-000000000101', 'search-pos-items-principal-a@example.com'),
  ('88000000-0000-0000-0000-000000000102', 'search-pos-items-principal-b@example.com')
ON CONFLICT (id) DO NOTHING;

INSERT INTO public.user_restaurants (user_id, restaurant_id, role) VALUES
  ('88000000-0000-0000-0000-000000000101', '88000000-0000-0000-0000-000000000001', 'owner'),
  ('88000000-0000-0000-0000-000000000102', '88000000-0000-0000-0000-000000000002', 'owner')
ON CONFLICT (user_id, restaurant_id) DO UPDATE SET role = EXCLUDED.role;

-- ----------------------------------------------------------------------------
-- Group: case-insensitive dedupe (assertions 1-3)
-- Same item, three different casings, most recent row last.
-- ----------------------------------------------------------------------------
INSERT INTO public.unified_sales (id, restaurant_id, pos_system, external_order_id, item_name, quantity, total_price, sale_date) VALUES
  ('88000000-0000-0000-0000-000000010001', '88000000-0000-0000-0000-000000000001', 'square', 'order-dedupe-1', 'Dedupe Burger', 1, 9.00, '2024-01-01'),
  ('88000000-0000-0000-0000-000000010002', '88000000-0000-0000-0000-000000000001', 'square', 'order-dedupe-2', 'dedupe burger', 1, 9.00, '2024-01-02'),
  ('88000000-0000-0000-0000-000000010003', '88000000-0000-0000-0000-000000000001', 'square', 'order-dedupe-3', 'DEDUPE BURGER', 1, 9.00, '2024-01-03')
ON CONFLICT DO NOTHING;

-- ----------------------------------------------------------------------------
-- Group: ranking (assertions 4-6)
-- Alpha and Zulu tie on count -> alphabetical tiebreaker; Omega has fewer
-- sales and must rank last.
-- ----------------------------------------------------------------------------
INSERT INTO public.unified_sales (id, restaurant_id, pos_system, external_order_id, item_name, quantity, total_price, sale_date) VALUES
  ('88000000-0000-0000-0000-000000020001', '88000000-0000-0000-0000-000000000001', 'square', 'order-rank-1', 'Rank Zulu Item', 1, 5.00, '2024-01-01'),
  ('88000000-0000-0000-0000-000000020002', '88000000-0000-0000-0000-000000000001', 'square', 'order-rank-2', 'Rank Zulu Item', 1, 5.00, '2024-01-02'),
  ('88000000-0000-0000-0000-000000020003', '88000000-0000-0000-0000-000000000001', 'square', 'order-rank-3', 'Rank Alpha Item', 1, 5.00, '2024-01-01'),
  ('88000000-0000-0000-0000-000000020004', '88000000-0000-0000-0000-000000000001', 'square', 'order-rank-4', 'Rank Alpha Item', 1, 5.00, '2024-01-02'),
  ('88000000-0000-0000-0000-000000020005', '88000000-0000-0000-0000-000000000001', 'square', 'order-rank-5', 'Rank Omega Item', 1, 5.00, '2024-01-01')
ON CONFLICT DO NOTHING;

-- ----------------------------------------------------------------------------
-- Group: p_search filtering (assertions 7-8)
-- ----------------------------------------------------------------------------
INSERT INTO public.unified_sales (id, restaurant_id, pos_system, external_order_id, item_name, quantity, total_price, sale_date) VALUES
  ('88000000-0000-0000-0000-000000030001', '88000000-0000-0000-0000-000000000001', 'square', 'order-search-1', 'Search Falafel Wrap', 1, 8.00, '2024-01-01'),
  ('88000000-0000-0000-0000-000000030002', '88000000-0000-0000-0000-000000000001', 'square', 'order-search-2', 'Search Salad', 1, 6.00, '2024-01-01')
ON CONFLICT DO NOTHING;

-- ----------------------------------------------------------------------------
-- Group: p_search literal escaping (assertions 9-14)
-- '%' item contains a literal percent sign; '_' item contains a literal
-- underscore (and a decoy that would ALSO match if '_' were left as an
-- unescaped single-character wildcard); the backslash item contains a
-- literal backslash (an unescaped backslash would swallow the following
-- character instead of matching it literally, so an unescaped search would
-- find nothing here -- see inline comment at the assertion).
-- ----------------------------------------------------------------------------
INSERT INTO public.unified_sales (id, restaurant_id, pos_system, external_order_id, item_name, quantity, total_price, sale_date) VALUES
  ('88000000-0000-0000-0000-000000040001', '88000000-0000-0000-0000-000000000001', 'square', 'order-escape-1', 'Escape 50% Off Combo', 1, 12.00, '2024-01-01'),
  ('88000000-0000-0000-0000-000000040002', '88000000-0000-0000-0000-000000000001', 'square', 'order-escape-2', 'Escape Regular Combo', 1, 12.00, '2024-01-01'),
  ('88000000-0000-0000-0000-000000040003', '88000000-0000-0000-0000-000000000001', 'square', 'order-escape-3', 'Escape A_B Widget', 1, 4.00, '2024-01-01'),
  ('88000000-0000-0000-0000-000000040004', '88000000-0000-0000-0000-000000000001', 'square', 'order-escape-4', 'Escape AXB Widget', 1, 4.00, '2024-01-01'),
  ('88000000-0000-0000-0000-000000040005', '88000000-0000-0000-0000-000000000001', 'square', 'order-escape-5', 'Escape Back\Slash Item', 1, 4.00, '2024-01-01')
ON CONFLICT DO NOTHING;

-- ----------------------------------------------------------------------------
-- Group: item_id FILTER fallback (assertion 15)
-- Older row carries a real id; the newest row's id is NULL. The FILTER
-- clause in the design must make the older, non-NULL id survive.
-- ----------------------------------------------------------------------------
INSERT INTO public.unified_sales (id, restaurant_id, pos_system, external_order_id, item_name, external_item_id, quantity, total_price, sale_date) VALUES
  ('88000000-0000-0000-0000-000000050001', '88000000-0000-0000-0000-000000000001', 'square', 'order-fallback-1', 'Fallback Item', 'FALLBACK-OLD', 1, 7.00, '2024-01-01'),
  ('88000000-0000-0000-0000-000000050002', '88000000-0000-0000-0000-000000000001', 'square', 'order-fallback-2', 'Fallback Item', NULL, 1, 7.00, '2024-01-05')
ON CONFLICT DO NOTHING;

-- ----------------------------------------------------------------------------
-- Group: source resolution (assertions 16-18)
-- Pure unified_sales item, pure pos_sales item, and a mixed item that must
-- resolve to 'pos_sales' because at least one contributing row is.
-- ----------------------------------------------------------------------------
INSERT INTO public.unified_sales (id, restaurant_id, pos_system, external_order_id, item_name, quantity, total_price, sale_date) VALUES
  ('88000000-0000-0000-0000-000000060001', '88000000-0000-0000-0000-000000000001', 'square', 'order-source-1', 'SourceMix Pure Unified', 1, 3.00, '2024-01-01'),
  ('88000000-0000-0000-0000-000000060002', '88000000-0000-0000-0000-000000000001', 'square', 'order-source-2', 'SourceMix Item', 1, 3.00, '2024-01-01')
ON CONFLICT DO NOTHING;

INSERT INTO public.pos_sales (id, restaurant_id, pos_item_name, pos_item_id, quantity, sale_price, sale_date) VALUES
  ('88000000-0000-0000-0000-000000060003', '88000000-0000-0000-0000-000000000001', 'SourceMix Pure Pos', 'POS-PURE-1', 1, 3.00, '2024-01-01'),
  ('88000000-0000-0000-0000-000000060004', '88000000-0000-0000-0000-000000000001', 'sourcemix item', 'POS-MIX-1', 1, 3.00, '2024-01-02')
ON CONFLICT DO NOTHING;

-- ----------------------------------------------------------------------------
-- Group: limit clamping (assertions 19-22)
-- Tenant C gets 520 distinct single-sale items so both the default-100
-- clamp and the max-500 clamp are meaningfully exercised (neither would be
-- distinguishable from "return everything" with a smaller fixture).
-- ----------------------------------------------------------------------------
INSERT INTO public.unified_sales (id, restaurant_id, pos_system, external_order_id, item_name, quantity, total_price, sale_date)
SELECT
  gen_random_uuid(),
  '88000000-0000-0000-0000-000000000003',
  'square',
  'order-limit-' || gs,
  'LimitItem ' || lpad(gs::text, 4, '0'),
  1,
  1.00,
  '2024-01-01'::date
FROM generate_series(1, 520) AS gs;

-- ----------------------------------------------------------------------------
-- Group: item beyond row 1000 (assertions 23-24) -- the reported bug's
-- regression test. 1000 filler rows land physically ahead of the target
-- item's 3 rows in the table; a correct implementation aggregates over the
-- whole table server-side (no client-side row cap), so the target item's
-- true count must still come back exactly right.
-- ----------------------------------------------------------------------------
INSERT INTO public.unified_sales (id, restaurant_id, pos_system, external_order_id, item_name, quantity, total_price, sale_date)
SELECT
  gen_random_uuid(),
  '88000000-0000-0000-0000-000000000004',
  'square',
  'order-filler-' || gs,
  'Filler Item',
  1,
  2.00,
  '2024-01-01'::date
FROM generate_series(1, 1000) AS gs;

INSERT INTO public.unified_sales (id, restaurant_id, pos_system, external_order_id, item_name, external_item_id, quantity, total_price, sale_date) VALUES
  ('88000000-0000-0000-0000-000000070001', '88000000-0000-0000-0000-000000000004', 'square', 'order-needle-1', 'Needle Item', 'NEEDLE-1', 1, 5.00, '2024-02-01'),
  ('88000000-0000-0000-0000-000000070002', '88000000-0000-0000-0000-000000000004', 'square', 'order-needle-2', 'Needle Item', 'NEEDLE-2', 1, 5.00, '2024-02-02'),
  ('88000000-0000-0000-0000-000000070003', '88000000-0000-0000-0000-000000000004', 'square', 'order-needle-3', 'Needle Item', NULL, 1, 5.00, '2024-02-03')
ON CONFLICT DO NOTHING;

-- ============================================================================
-- Test: function exists with the documented signature
-- ============================================================================

SELECT has_function(
  'public', 'search_pos_items', ARRAY['uuid', 'text', 'int'],
  'search_pos_items function should exist'
);

SELECT function_returns(
  'public', 'search_pos_items', ARRAY['uuid', 'text', 'int'], 'setof record',
  'search_pos_items should return setof record'
);

-- ============================================================================
-- Test: case-insensitive dedupe across casings (3 differently-cased rows
-- collapse into 1 grouped row)
-- ============================================================================

SELECT is(
  (SELECT sales_count FROM public.search_pos_items(
    '88000000-0000-0000-0000-000000000001'::uuid, 'Dedupe', 100
  )),
  3::bigint,
  'dedupe: 3 differently-cased rows collapse into one with sales_count 3'
);

SELECT is(
  (SELECT item_name FROM public.search_pos_items(
    '88000000-0000-0000-0000-000000000001'::uuid, 'Dedupe', 100
  )),
  'DEDUPE BURGER',
  'dedupe: displayed item_name comes from the most recent contributing row'
);

SELECT is(
  (SELECT count(*)::int FROM public.search_pos_items(
    '88000000-0000-0000-0000-000000000001'::uuid, 'Dedupe', 100
  )),
  1,
  'dedupe: exactly one grouped row is returned, not three'
);

-- ============================================================================
-- Test: ranking by sales_count DESC with item_name ASC tiebreaker
-- ============================================================================

SELECT is(
  (SELECT item_name FROM public.search_pos_items(
    '88000000-0000-0000-0000-000000000001'::uuid, 'Rank', 100
  ) OFFSET 0 LIMIT 1),
  'Rank Alpha Item',
  'ranking: tied top count breaks alphabetically -> Alpha first'
);

SELECT is(
  (SELECT item_name FROM public.search_pos_items(
    '88000000-0000-0000-0000-000000000001'::uuid, 'Rank', 100
  ) OFFSET 1 LIMIT 1),
  'Rank Zulu Item',
  'ranking: tied top count breaks alphabetically -> Zulu second'
);

SELECT is(
  (SELECT item_name FROM public.search_pos_items(
    '88000000-0000-0000-0000-000000000001'::uuid, 'Rank', 100
  ) OFFSET 2 LIMIT 1),
  'Rank Omega Item',
  'ranking: lower sales_count ranks last'
);

-- ============================================================================
-- Test: p_search filters to matching items
-- ============================================================================

SELECT is(
  (SELECT count(*)::int FROM public.search_pos_items(
    '88000000-0000-0000-0000-000000000001'::uuid, 'Falafel', 100
  )),
  1,
  'search: only the matching item is returned'
);

SELECT is(
  (SELECT item_name FROM public.search_pos_items(
    '88000000-0000-0000-0000-000000000001'::uuid, 'Falafel', 100
  )),
  'Search Falafel Wrap',
  'search: the returned item is the one that actually matches'
);

-- ============================================================================
-- Test: p_search is a literal, not a wildcard pattern
-- ============================================================================

SELECT is(
  (SELECT count(*)::int FROM public.search_pos_items(
    '88000000-0000-0000-0000-000000000001'::uuid, '%', 100
  )),
  1,
  'search escaping: a literal %% only matches the item containing a real %% character'
);

SELECT is(
  (SELECT item_name FROM public.search_pos_items(
    '88000000-0000-0000-0000-000000000001'::uuid, '%', 100
  )),
  'Escape 50% Off Combo',
  'search escaping: %% resolves to the item that literally contains it'
);

SELECT is(
  (SELECT count(*)::int FROM public.search_pos_items(
    '88000000-0000-0000-0000-000000000001'::uuid, 'A_B', 100
  )),
  1,
  'search escaping: a literal underscore does not act as a single-char wildcard (excludes the AXB decoy)'
);

SELECT is(
  (SELECT item_name FROM public.search_pos_items(
    '88000000-0000-0000-0000-000000000001'::uuid, 'A_B', 100
  )),
  'Escape A_B Widget',
  'search escaping: underscore search resolves to the item with a real underscore'
);

-- An unescaped backslash swallows the character that follows it (Postgres
-- LIKE semantics), so a search for the literal string "Back\Slash" would
-- match nothing at all unless the caller's own backslash is escaped first.
SELECT is(
  (SELECT count(*)::int FROM public.search_pos_items(
    '88000000-0000-0000-0000-000000000001'::uuid, 'Back\Slash', 100
  )),
  1,
  'search escaping: a literal backslash in the search term is matched, not swallowed'
);

SELECT is(
  (SELECT item_name FROM public.search_pos_items(
    '88000000-0000-0000-0000-000000000001'::uuid, 'Back\Slash', 100
  )),
  'Escape Back\Slash Item',
  'search escaping: backslash search resolves to the item with a real backslash'
);

-- ============================================================================
-- Test: item_id FILTER fallback -- an older non-NULL id survives a newer
-- NULL one
-- ============================================================================

SELECT is(
  (SELECT item_id FROM public.search_pos_items(
    '88000000-0000-0000-0000-000000000001'::uuid, 'Fallback', 100
  )),
  'FALLBACK-OLD',
  'item_id fallback: the older non-NULL id is returned, not the newer NULL one'
);

-- ============================================================================
-- Test: source resolution
-- ============================================================================

SELECT is(
  (SELECT source FROM public.search_pos_items(
    '88000000-0000-0000-0000-000000000001'::uuid, 'SourceMix Pure Unified', 100
  )),
  'unified_sales',
  'source resolution: an item found only in unified_sales resolves to unified_sales'
);

SELECT is(
  (SELECT source FROM public.search_pos_items(
    '88000000-0000-0000-0000-000000000001'::uuid, 'SourceMix Pure Pos', 100
  )),
  'pos_sales',
  'source resolution: an item found only in pos_sales resolves to pos_sales'
);

SELECT is(
  (SELECT source FROM public.search_pos_items(
    '88000000-0000-0000-0000-000000000001'::uuid, 'SourceMix Item', 100
  )),
  'pos_sales',
  'source resolution: an item present in both tables resolves to pos_sales'
);

-- ============================================================================
-- Test: p_limit clamps (NULL/0/negative -> 100, > 500 -> 500)
-- ============================================================================

SELECT is(
  (SELECT count(*)::int FROM public.search_pos_items(
    '88000000-0000-0000-0000-000000000003'::uuid, NULL, NULL
  )),
  100,
  'limit clamp: NULL p_limit defaults to 100 rows'
);

SELECT is(
  (SELECT count(*)::int FROM public.search_pos_items(
    '88000000-0000-0000-0000-000000000003'::uuid, NULL, 0
  )),
  100,
  'limit clamp: 0 defaults to 100 rows, not a 0- or 1-row page'
);

SELECT is(
  (SELECT count(*)::int FROM public.search_pos_items(
    '88000000-0000-0000-0000-000000000003'::uuid, NULL, -5
  )),
  100,
  'limit clamp: a negative p_limit defaults to 100 rows'
);

SELECT is(
  (SELECT count(*)::int FROM public.search_pos_items(
    '88000000-0000-0000-0000-000000000003'::uuid, NULL, 1000
  )),
  500,
  'limit clamp: a p_limit above 500 clamps down to 500, not 520 or 1000'
);

-- ============================================================================
-- Test: an item whose raw sales rows sit entirely beyond row 1000 of the
-- table is still found with its true count -- the reported bug's
-- regression test
-- ============================================================================

SELECT ok(
  (SELECT count(*) FROM public.unified_sales
   WHERE restaurant_id = '88000000-0000-0000-0000-000000000004'::uuid) > 1000,
  'row-1000 regression: fixture sanity check -- tenant D really has more than 1000 raw rows'
);

SELECT is(
  (SELECT sales_count FROM public.search_pos_items(
    '88000000-0000-0000-0000-000000000004'::uuid, 'Needle', 500
  )),
  3::bigint,
  'row-1000 regression: an item whose only rows sit past row 1000 is still counted correctly'
);

-- ============================================================================
-- Test: cross-tenant isolation, denied-baseline-first ([2026-07-13] lesson)
-- Principal B is a member of Tenant B only. Assert the DENIED case first (B
-- querying Tenant A must get zero rows), then assert principal A -- who is
-- actually entitled to Tenant A -- gets real rows for the same query, so
-- the denial above cannot be passing vacuously (e.g. from a query that
-- always returns nothing regardless of caller).
-- ============================================================================

SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims', '{"sub":"88000000-0000-0000-0000-000000000102","role":"authenticated"}', true);

SELECT is(
  (SELECT count(*)::int FROM public.search_pos_items(
    '88000000-0000-0000-0000-000000000001'::uuid, NULL, 100
  )),
  0,
  'cross-tenant isolation: a principal with no membership in Tenant A gets zero rows for it'
);

RESET ROLE;
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims', '{"sub":"88000000-0000-0000-0000-000000000101","role":"authenticated"}', true);

SELECT ok(
  (SELECT count(*)::int FROM public.search_pos_items(
    '88000000-0000-0000-0000-000000000001'::uuid, NULL, 100
  )) > 0,
  'cross-tenant isolation: the entitled principal gets real rows for Tenant A (denial above is not vacuous)'
);

RESET ROLE;

SELECT * FROM finish();
ROLLBACK;
