-- pgTAP tests for get_unmapped_sale_item_names(p_restaurant_id, p_limit)
-- Design: docs/superpowers/specs/2026-07-27-recipes-page-load-perf-design.md §3.11
--
-- Fixture restaurant bb000000-0000-0000-0000-000000000001 ("Unmapped Items Test
-- Restaurant A"), owned by user …a1. Restaurant B (…0002, owner …a2, NOT a
-- member of A) exists solely to prove RLS-driven cross-tenant isolation
-- (test 8) -- the function takes p_restaurant_id as a plain parameter with no
-- membership check of its own (SECURITY INVOKER, relying on
-- unified_sales/recipes RLS).
--
-- The predicates under test mirror the TS this RPC replaces
-- (createMappedItemNamesSet + hasRecipeMappingFromSet + the parent_sale_id
-- filter in useUnifiedSales.unmappedItems): case-insensitive match with NO
-- trimming, no is_active filter on recipes, parent splits excluded.
BEGIN;
SELECT plan(11);

-- ============================================================
-- Setup: two restaurants, two owners, RLS enforced via role switch
-- ============================================================
SET LOCAL role TO postgres;

INSERT INTO auth.users (id, email) VALUES
  ('bb000000-0000-0000-0000-0000000000a1'::uuid, 'unmapped-owner-a@example.com'),
  ('bb000000-0000-0000-0000-0000000000a2'::uuid, 'unmapped-owner-b@example.com')
ON CONFLICT (id) DO UPDATE SET email = EXCLUDED.email;

INSERT INTO restaurants (id, name, address, phone) VALUES
  ('bb000000-0000-0000-0000-000000000001'::uuid, 'Unmapped Items Test Restaurant A', '1 Unmapped Ave', '555-0201'),
  ('bb000000-0000-0000-0000-000000000002'::uuid, 'Unmapped Items Test Restaurant B', '2 Unmapped Ave', '555-0202')
ON CONFLICT (id) DO UPDATE SET name = EXCLUDED.name;

INSERT INTO user_restaurants (user_id, restaurant_id, role) VALUES
  ('bb000000-0000-0000-0000-0000000000a1'::uuid, 'bb000000-0000-0000-0000-000000000001'::uuid, 'owner'),
  ('bb000000-0000-0000-0000-0000000000a2'::uuid, 'bb000000-0000-0000-0000-000000000002'::uuid, 'owner')
ON CONFLICT (user_id, restaurant_id) DO UPDATE SET role = EXCLUDED.role;

-- ============================================================
-- Recipes (Restaurant A)
--   Burger   -- plain mapping, suppresses "Burger"
--   TACOS    -- mapped in a different case than the sale ("Tacos"), test 3
--   Churros  -- mapped but INACTIVE: still suppresses, test 4
--   " Pozole" -- leading space: does NOT suppress "Pozole", test 5
-- ============================================================
INSERT INTO recipes (id, restaurant_id, name, pos_item_name, is_active) VALUES
  ('bb000000-0000-0000-0000-0000000000b1'::uuid, 'bb000000-0000-0000-0000-000000000001'::uuid, 'Burger Recipe', 'Burger', true),
  ('bb000000-0000-0000-0000-0000000000b2'::uuid, 'bb000000-0000-0000-0000-000000000001'::uuid, 'Taco Recipe', 'TACOS', true),
  ('bb000000-0000-0000-0000-0000000000b3'::uuid, 'bb000000-0000-0000-0000-000000000001'::uuid, 'Churro Recipe', 'Churros', false),
  ('bb000000-0000-0000-0000-0000000000b4'::uuid, 'bb000000-0000-0000-0000-000000000001'::uuid, 'Pozole Recipe', ' Pozole', true),
  ('bb000000-0000-0000-0000-0000000000b5'::uuid, 'bb000000-0000-0000-0000-000000000001'::uuid, 'Unmapped Recipe', NULL, true)
ON CONFLICT (id) DO UPDATE SET pos_item_name = EXCLUDED.pos_item_name, is_active = EXCLUDED.is_active;

-- A recipe belonging to Restaurant B mapping "Horchata": must NOT suppress
-- Restaurant A's "Horchata" (test 6).
INSERT INTO recipes (id, restaurant_id, name, pos_item_name, is_active) VALUES
  ('bb000000-0000-0000-0000-0000000000b6'::uuid, 'bb000000-0000-0000-0000-000000000002'::uuid, 'Horchata Recipe', 'Horchata', true)
ON CONFLICT (id) DO UPDATE SET pos_item_name = EXCLUDED.pos_item_name;

-- ============================================================
-- Sales rows (Restaurant A)
-- ============================================================
INSERT INTO unified_sales (id, restaurant_id, pos_system, external_order_id, item_name, quantity, total_price, unit_price, sale_date) VALUES
  -- Mapped: suppressed.
  ('bb000000-0000-0000-0000-0000000000c1'::uuid, 'bb000000-0000-0000-0000-000000000001'::uuid, 'manual', 'un-1', 'Burger', 1, 10.00, 10.00, '2026-07-01'),
  -- Mapped only differing in case: still suppressed (test 3).
  ('bb000000-0000-0000-0000-0000000000c2'::uuid, 'bb000000-0000-0000-0000-000000000001'::uuid, 'manual', 'un-2', 'Tacos', 1, 8.00, 8.00, '2026-07-01'),
  -- Mapped by an inactive recipe: suppressed (test 4).
  ('bb000000-0000-0000-0000-0000000000c3'::uuid, 'bb000000-0000-0000-0000-000000000001'::uuid, 'manual', 'un-3', 'Churros', 1, 4.00, 4.00, '2026-07-01'),
  -- Mapping differs by a leading space: NOT suppressed (test 5).
  ('bb000000-0000-0000-0000-0000000000c4'::uuid, 'bb000000-0000-0000-0000-000000000001'::uuid, 'manual', 'un-4', 'Pozole', 1, 12.00, 12.00, '2026-07-01'),
  -- Mapped only in the OTHER restaurant: unmapped here (test 6).
  ('bb000000-0000-0000-0000-0000000000c5'::uuid, 'bb000000-0000-0000-0000-000000000001'::uuid, 'manual', 'un-5', 'Horchata', 1, 3.00, 3.00, '2026-07-01'),
  -- Plainly unmapped, sold twice: appears exactly once (test 2).
  ('bb000000-0000-0000-0000-0000000000c6'::uuid, 'bb000000-0000-0000-0000-000000000001'::uuid, 'manual', 'un-6', 'Elote', 1, 5.00, 5.00, '2026-07-01'),
  ('bb000000-0000-0000-0000-0000000000c7'::uuid, 'bb000000-0000-0000-0000-000000000001'::uuid, 'manual', 'un-7', 'Elote', 2, 10.00, 5.00, '2026-07-02')
ON CONFLICT (id) DO UPDATE SET item_name = EXCLUDED.item_name, parent_sale_id = NULL;

-- A split child of the Elote sale: its own item name must never surface (test 7).
INSERT INTO unified_sales (id, restaurant_id, pos_system, external_order_id, item_name, quantity, total_price, unit_price, sale_date, parent_sale_id) VALUES
  ('bb000000-0000-0000-0000-0000000000c8'::uuid, 'bb000000-0000-0000-0000-000000000001'::uuid, 'manual', 'un-8', 'Elote (half)', 1, 2.50, 2.50, '2026-07-01', 'bb000000-0000-0000-0000-0000000000c6'::uuid)
ON CONFLICT (id) DO UPDATE SET item_name = EXCLUDED.item_name, parent_sale_id = EXCLUDED.parent_sale_id;

-- ============================================================
-- Restaurant A's owner: positive-path assertions
-- ============================================================
SET LOCAL role TO authenticated;
SET LOCAL "request.jwt.claims" TO '{"sub": "bb000000-0000-0000-0000-0000000000a1", "role": "authenticated"}';

-- Test 1: the whole result set, alphabetically -- exactly the three unmapped names
SELECT is(
  (SELECT array_agg(item_name ORDER BY item_name)
     FROM get_unmapped_sale_item_names('bb000000-0000-0000-0000-000000000001'::uuid)),
  ARRAY['Elote', 'Horchata', 'Pozole'],
  'Returns exactly the unmapped item names, alphabetically'
);

-- Test 2: an item sold on many rows is listed once
SELECT is(
  (SELECT COUNT(*)::int FROM get_unmapped_sale_item_names('bb000000-0000-0000-0000-000000000001'::uuid)
    WHERE item_name = 'Elote'),
  1,
  'An item sold on multiple rows appears exactly once (DISTINCT)'
);

-- Test 3: "Tacos" is suppressed by the recipe mapped as "TACOS"
SELECT is(
  (SELECT COUNT(*)::int FROM get_unmapped_sale_item_names('bb000000-0000-0000-0000-000000000001'::uuid)
    WHERE lower(item_name) = 'tacos'),
  0,
  'A mapping differing only in case suppresses the item (lower() on both sides)'
);

-- Test 4: an INACTIVE mapped recipe still suppresses its item -- the TS set
-- being replaced indexes every recipe with a pos_item_name, active or not.
SELECT is(
  (SELECT COUNT(*)::int FROM get_unmapped_sale_item_names('bb000000-0000-0000-0000-000000000001'::uuid)
    WHERE item_name = 'Churros'),
  0,
  'An inactive recipe still suppresses its mapped item (no is_active filter)'
);

-- Test 5: no trimming -- " Pozole" does not match "Pozole", same as the TS
SELECT is(
  (SELECT COUNT(*)::int FROM get_unmapped_sale_item_names('bb000000-0000-0000-0000-000000000001'::uuid)
    WHERE item_name = 'Pozole'),
  1,
  'Whitespace is NOT trimmed: " Pozole" does not suppress "Pozole"'
);

-- Test 6: another restaurant's mapping does not suppress this one's item
SELECT is(
  (SELECT COUNT(*)::int FROM get_unmapped_sale_item_names('bb000000-0000-0000-0000-000000000001'::uuid)
    WHERE item_name = 'Horchata'),
  1,
  'A mapping owned by another restaurant does not suppress the item'
);

-- Test 7: split child rows are not POS items of their own
SELECT is(
  (SELECT COUNT(*)::int FROM get_unmapped_sale_item_names('bb000000-0000-0000-0000-000000000001'::uuid)
    WHERE item_name = 'Elote (half)'),
  0,
  'Split child rows (parent_sale_id IS NOT NULL) never surface as unmapped items'
);

-- Test 8: p_limit truncates, and a limit of 0 returns nothing rather than
-- everything -- the cap is what keeps this response away from PostgREST's
-- 1000-row ceiling.
SELECT is(
  (SELECT COUNT(*)::int FROM get_unmapped_sale_item_names('bb000000-0000-0000-0000-000000000001'::uuid, 2)),
  2,
  'p_limit truncates the result set'
);

SELECT is(
  (SELECT COUNT(*)::int FROM get_unmapped_sale_item_names('bb000000-0000-0000-0000-000000000001'::uuid, 0)),
  0,
  'p_limit = 0 returns no rows (never falls back to unbounded)'
);

-- ============================================================
-- Test 9: cross-tenant isolation
-- ============================================================
SET LOCAL "request.jwt.claims" TO '{"sub": "bb000000-0000-0000-0000-0000000000a2", "role": "authenticated"}';

SELECT is(
  (SELECT COUNT(*)::int FROM get_unmapped_sale_item_names('bb000000-0000-0000-0000-000000000001'::uuid)),
  0,
  'A caller with no membership in Restaurant A gets zero rows (RLS-enforced isolation)'
);

-- ============================================================
-- Sanity: function metadata matches the design
-- ============================================================
SELECT is(
  (SELECT prosecdef FROM pg_proc WHERE proname = 'get_unmapped_sale_item_names' AND pronamespace = 'public'::regnamespace),
  false,
  'get_unmapped_sale_item_names is SECURITY INVOKER (prosecdef = false)'
);

SELECT * FROM finish();
ROLLBACK;
