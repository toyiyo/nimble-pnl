-- ============================================================================
-- product_suppliers_pack_size.test.sql
--
-- pgTAP coverage for the pack_size_qty / pack_size_unit columns on
-- public.product_suppliers. See
-- docs/superpowers/specs/2026-08-30-supplier-pack-size-design.md.
--
-- All fixture data (restaurant/user/product/supplier ids, emails) is
-- fictional and exists only for the duration of this transaction
-- (ROLLBACK). The "f7000000-…" id prefix avoids collision with other
-- test files.
-- ============================================================================
BEGIN;

SELECT plan(18);

-- ----------------------------------------------------------------------------
-- Fixtures: two restaurants (A, B), one owner per restaurant, one product
-- and one supplier under restaurant A.
-- ----------------------------------------------------------------------------
INSERT INTO auth.users (id, email) VALUES
  ('f7000000-0000-0000-0000-000000000001', 'psps-owner-a@example.test'),
  ('f7000000-0000-0000-0000-000000000002', 'psps-owner-b@example.test');

INSERT INTO public.restaurants (id, name) VALUES
  ('f7000000-0000-0000-0000-0000000000a1', 'Pack Size Test Restaurant A'),
  ('f7000000-0000-0000-0000-0000000000b1', 'Pack Size Test Restaurant B');

INSERT INTO public.user_restaurants (id, user_id, restaurant_id, role) VALUES
  ('f7000000-0000-0000-0000-000000000101', 'f7000000-0000-0000-0000-000000000001', 'f7000000-0000-0000-0000-0000000000a1', 'owner'),
  ('f7000000-0000-0000-0000-000000000102', 'f7000000-0000-0000-0000-000000000002', 'f7000000-0000-0000-0000-0000000000b1', 'owner');

INSERT INTO public.products (id, restaurant_id, sku, name) VALUES
  ('f7000000-0000-0000-0000-000000000201', 'f7000000-0000-0000-0000-0000000000a1', 'PSPS-SKU-1', 'Pack Size Test Product'),
  ('f7000000-0000-0000-0000-000000000202', 'f7000000-0000-0000-0000-0000000000a1', 'PSPS-SKU-2', 'Pack Size Test Product 2');

INSERT INTO public.suppliers (id, restaurant_id, name) VALUES
  ('f7000000-0000-0000-0000-000000000301', 'f7000000-0000-0000-0000-0000000000a1', 'Pack Size Test Supplier');

-- ============================================================================
-- 1-4. Columns exist with the right type.
-- ============================================================================
SELECT has_column(
  'public', 'product_suppliers', 'pack_size_qty',
  'product_suppliers should have pack_size_qty column'
);

SELECT has_column(
  'public', 'product_suppliers', 'pack_size_unit',
  'product_suppliers should have pack_size_unit column'
);

SELECT col_type_is(
  'public', 'product_suppliers', 'pack_size_qty', 'numeric',
  'pack_size_qty should be NUMERIC type'
);

SELECT col_type_is(
  'public', 'product_suppliers', 'pack_size_unit', 'text',
  'pack_size_unit should be TEXT type'
);

-- ============================================================================
-- 5-7. A row with both pack columns NULL inserts without error.
-- ============================================================================
SELECT lives_ok(
  $$
    INSERT INTO public.product_suppliers (
      id, restaurant_id, product_id, supplier_id, pack_size_qty, pack_size_unit
    ) VALUES (
      'f7000000-0000-0000-0000-000000000401',
      'f7000000-0000-0000-0000-0000000000a1',
      'f7000000-0000-0000-0000-000000000201',
      'f7000000-0000-0000-0000-000000000301',
      NULL, NULL
    )
  $$,
  'a row with both pack columns NULL inserts without error'
);

SELECT is(
  (SELECT pack_size_qty FROM public.product_suppliers WHERE id = 'f7000000-0000-0000-0000-000000000401'),
  NULL,
  'pack_size_qty stays NULL when not provided'
);

SELECT is(
  (SELECT pack_size_unit FROM public.product_suppliers WHERE id = 'f7000000-0000-0000-0000-000000000401'),
  NULL,
  'pack_size_unit stays NULL when not provided'
);

-- ============================================================================
-- 8-10. A row with valid, paired pack data inserts and reads back correctly.
-- ============================================================================
SELECT lives_ok(
  $$
    INSERT INTO public.product_suppliers (
      id, restaurant_id, product_id, supplier_id, pack_size_qty, pack_size_unit
    ) VALUES (
      'f7000000-0000-0000-0000-000000000402',
      'f7000000-0000-0000-0000-0000000000a1',
      'f7000000-0000-0000-0000-000000000202',
      'f7000000-0000-0000-0000-000000000301',
      30, 'lb'
    )
  $$,
  'a row with valid paired pack data inserts without error'
);

SELECT is(
  (SELECT pack_size_qty FROM public.product_suppliers WHERE id = 'f7000000-0000-0000-0000-000000000402'),
  30::numeric,
  'pack_size_qty reads back as 30'
);

SELECT is(
  (SELECT pack_size_unit FROM public.product_suppliers WHERE id = 'f7000000-0000-0000-0000-000000000402'),
  'lb',
  'pack_size_unit reads back as lb'
);

-- ============================================================================
-- 11-12. Zero and negative pack_size_qty violate the positivity CHECK.
-- ============================================================================
SELECT throws_ok(
  $$
    INSERT INTO public.product_suppliers (
      restaurant_id, product_id, supplier_id, pack_size_qty, pack_size_unit
    ) VALUES (
      'f7000000-0000-0000-0000-0000000000a1',
      'f7000000-0000-0000-0000-000000000201',
      'f7000000-0000-0000-0000-000000000301',
      0, 'lb'
    )
  $$,
  '23514',
  NULL,
  'pack_size_qty = 0 violates the positivity CHECK'
);

SELECT throws_ok(
  $$
    INSERT INTO public.product_suppliers (
      restaurant_id, product_id, supplier_id, pack_size_qty, pack_size_unit
    ) VALUES (
      'f7000000-0000-0000-0000-0000000000a1',
      'f7000000-0000-0000-0000-000000000201',
      'f7000000-0000-0000-0000-000000000301',
      -5, 'lb'
    )
  $$,
  '23514',
  NULL,
  'a negative pack_size_qty violates the positivity CHECK'
);

-- ============================================================================
-- 13-14. An unpaired qty or unit violates the paired CHECK.
-- ============================================================================
SELECT throws_ok(
  $$
    INSERT INTO public.product_suppliers (
      restaurant_id, product_id, supplier_id, pack_size_qty, pack_size_unit
    ) VALUES (
      'f7000000-0000-0000-0000-0000000000a1',
      'f7000000-0000-0000-0000-000000000201',
      'f7000000-0000-0000-0000-000000000301',
      30, NULL
    )
  $$,
  '23514',
  NULL,
  'a qty without a unit violates the paired CHECK'
);

SELECT throws_ok(
  $$
    INSERT INTO public.product_suppliers (
      restaurant_id, product_id, supplier_id, pack_size_qty, pack_size_unit
    ) VALUES (
      'f7000000-0000-0000-0000-0000000000a1',
      'f7000000-0000-0000-0000-000000000201',
      'f7000000-0000-0000-0000-000000000301',
      NULL, 'lb'
    )
  $$,
  '23514',
  NULL,
  'a unit without a qty violates the paired CHECK'
);

-- ============================================================================
-- 15-17. A purchase-style UPDATE (only touching the price-tracking columns,
-- as upsert_product_supplier does) keeps the pack columns intact.
-- ============================================================================
SELECT lives_ok(
  $$
    UPDATE public.product_suppliers
    SET last_unit_cost = 12.50, purchase_count = purchase_count + 1
    WHERE id = 'f7000000-0000-0000-0000-000000000402'
  $$,
  'a purchase-style UPDATE that does not touch pack columns runs without error'
);

SELECT is(
  (SELECT pack_size_qty FROM public.product_suppliers WHERE id = 'f7000000-0000-0000-0000-000000000402'),
  30::numeric,
  'pack_size_qty survives a purchase-style UPDATE'
);

SELECT is(
  (SELECT pack_size_unit FROM public.product_suppliers WHERE id = 'f7000000-0000-0000-0000-000000000402'),
  'lb',
  'pack_size_unit survives a purchase-style UPDATE'
);

-- ============================================================================
-- 18. A cross-tenant UPDATE that sets the pack columns fails under RLS: the
-- owner of restaurant B has no membership in restaurant A, so the FOR ALL
-- policy's USING clause matches zero rows and the UPDATE is a silent no-op.
-- Run as the real `authenticated` role with JWT claims so RLS is actually
-- enforced — as superuser these policies do not apply at all.
-- ============================================================================
SET LOCAL ROLE authenticated;
SET LOCAL request.jwt.claims = '{"sub":"f7000000-0000-0000-0000-000000000002","role":"authenticated"}';

UPDATE public.product_suppliers
SET pack_size_qty = 99, pack_size_unit = 'ea'
WHERE id = 'f7000000-0000-0000-0000-000000000402';

RESET ROLE;
RESET request.jwt.claims;

SELECT is(
  (SELECT pack_size_qty FROM public.product_suppliers WHERE id = 'f7000000-0000-0000-0000-000000000402'),
  30::numeric,
  'a cross-tenant UPDATE cannot change pack_size_qty under RLS'
);

SELECT * FROM finish();
ROLLBACK;
