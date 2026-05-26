-- Round-trip tests for the duplicate-detection queries used by
-- src/hooks/useReceiptImport.tsx:
--   - findDuplicateByHash:   .eq(restaurant_id).eq(file_hash).order(created_at desc).limit(1)
--   - findSemanticDuplicate: .eq(restaurant_id).ilike(vendor_name).eq(purchase_date)
--                            .gte(total_amount, total-0.01).lte(total_amount, total+0.01)
--                            .neq(id, excludeId).order(created_at desc).limit(1)
--
-- Each test runs as restaurant A's owner via set_config('role','authenticated')
-- + request.jwt.claims, so RLS is exercised the same way the client hits it.

BEGIN;
SELECT plan(14);

-- ---------- Fixture ----------

INSERT INTO public.restaurants (id, name)
VALUES
  ('11111111-1111-1111-1111-111111111111', 'Restaurant A'),
  ('22222222-2222-2222-2222-222222222222', 'Restaurant B')
ON CONFLICT (id) DO NOTHING;

INSERT INTO auth.users (id, email, instance_id, aud, role)
VALUES
  ('aaaaaaaa-1111-1111-1111-000000000001', 'owner-a@dup.test',
    '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated')
ON CONFLICT (id) DO NOTHING;

INSERT INTO public.user_restaurants (user_id, restaurant_id, role)
VALUES
  ('aaaaaaaa-1111-1111-1111-000000000001',
   '11111111-1111-1111-1111-111111111111',
   'owner')
ON CONFLICT DO NOTHING;

-- Hash-match fixture: same restaurant + hash, two rows with different created_at.
-- Plus one cross-tenant row in restaurant B.
INSERT INTO public.receipt_imports
  (id, restaurant_id, status, file_hash, file_name, created_at)
VALUES
  ('dddddd00-0000-0000-0000-000000000001',
   '11111111-1111-1111-1111-111111111111', 'uploaded', 'hash-abc', 'old.pdf',
   '2026-05-20 00:00:00+00'),
  ('dddddd00-0000-0000-0000-000000000002',
   '11111111-1111-1111-1111-111111111111', 'uploaded', 'hash-abc', 'new.pdf',
   '2026-05-22 00:00:00+00'),
  ('dddddd00-0000-0000-0000-000000000003',
   '22222222-2222-2222-2222-222222222222', 'uploaded', 'hash-abc', 'b.pdf',
   '2026-05-25 00:00:00+00')
ON CONFLICT (id) DO NOTHING;

-- Semantic-match fixture. Target query: vendor='Sysco', date='2026-05-10', total=1284.50
-- Window inclusive 1284.49..1284.51. Each row's created_at is unique to make
-- "most recent" deterministic.
INSERT INTO public.receipt_imports
  (id, restaurant_id, status, file_hash, file_name, vendor_name, purchase_date, total_amount, created_at)
VALUES
  -- IN: exact center
  ('eeeeee00-0000-0000-0000-000000000001',
   '11111111-1111-1111-1111-111111111111', 'mapped', null, 's1.pdf',
   'Sysco', '2026-05-10', 1284.50, '2026-05-12 00:00:00+00'),
  -- IN: lower boundary inclusive
  ('eeeeee00-0000-0000-0000-000000000002',
   '11111111-1111-1111-1111-111111111111', 'mapped', null, 's2.pdf',
   'Sysco', '2026-05-10', 1284.49, '2026-05-13 00:00:00+00'),
  -- IN: upper boundary inclusive
  ('eeeeee00-0000-0000-0000-000000000003',
   '11111111-1111-1111-1111-111111111111', 'mapped', null, 's3.pdf',
   'Sysco', '2026-05-10', 1284.51, '2026-05-14 00:00:00+00'),
  -- OUT: just outside lower
  ('eeeeee00-0000-0000-0000-000000000004',
   '11111111-1111-1111-1111-111111111111', 'mapped', null, 's4.pdf',
   'Sysco', '2026-05-10', 1284.48, '2026-05-15 00:00:00+00'),
  -- OUT: just outside upper
  ('eeeeee00-0000-0000-0000-000000000005',
   '11111111-1111-1111-1111-111111111111', 'mapped', null, 's5.pdf',
   'Sysco', '2026-05-10', 1284.52, '2026-05-16 00:00:00+00'),
  -- OUT: wrong date
  ('eeeeee00-0000-0000-0000-000000000006',
   '11111111-1111-1111-1111-111111111111', 'mapped', null, 's6.pdf',
   'Sysco', '2026-05-11', 1284.50, '2026-05-17 00:00:00+00'),
  -- OUT: wrong vendor
  ('eeeeee00-0000-0000-0000-000000000007',
   '11111111-1111-1111-1111-111111111111', 'mapped', null, 's7.pdf',
   'US Foods', '2026-05-10', 1284.50, '2026-05-18 00:00:00+00'),
  -- IN: case-insensitive vendor — same as Sysco under ILIKE
  ('eeeeee00-0000-0000-0000-000000000008',
   '11111111-1111-1111-1111-111111111111', 'mapped', null, 's8.pdf',
   'SYSCO', '2026-05-10', 1284.50, '2026-05-19 00:00:00+00'),
  -- OUT: cross-tenant — semantic match in restaurant B
  ('eeeeee00-0000-0000-0000-000000000009',
   '22222222-2222-2222-2222-222222222222', 'mapped', null, 's9.pdf',
   'Sysco', '2026-05-10', 1284.50, '2026-05-25 00:00:00+00'),
  -- "Current" receipt — used as excludeId in some tests
  ('ffffff00-0000-0000-0000-000000000001',
   '11111111-1111-1111-1111-111111111111', 'uploaded', null, 'current.pdf',
   'Sysco', '2026-05-10', 1284.50, '2026-05-20 00:00:00+00')
ON CONFLICT (id) DO NOTHING;

-- ---------- Helpers (run query as owner-A under RLS) ----------

CREATE OR REPLACE FUNCTION pg_temp.hash_match_id(p_restaurant_id uuid, p_hash text)
RETURNS uuid LANGUAGE plpgsql AS $$
DECLARE
  v_id uuid;
BEGIN
  PERFORM set_config('role', 'authenticated', true);
  PERFORM set_config('request.jwt.claims',
    json_build_object(
      'sub', 'aaaaaaaa-1111-1111-1111-000000000001',
      'role', 'authenticated'
    )::text,
    true);
  SELECT id INTO v_id
    FROM public.receipt_imports
    WHERE restaurant_id = p_restaurant_id
      AND file_hash = p_hash
    ORDER BY created_at DESC
    LIMIT 1;
  PERFORM set_config('role', 'postgres', true);
  RETURN v_id;
END
$$;

CREATE OR REPLACE FUNCTION pg_temp.semantic_match_id(
  p_restaurant_id uuid,
  p_vendor text,
  p_date date,
  p_total numeric,
  p_exclude_id uuid
)
RETURNS uuid LANGUAGE plpgsql AS $$
DECLARE
  v_id uuid;
  v_lower numeric := GREATEST(0::numeric, p_total - 0.01);
  v_upper numeric := p_total + 0.01;
BEGIN
  PERFORM set_config('role', 'authenticated', true);
  PERFORM set_config('request.jwt.claims',
    json_build_object(
      'sub', 'aaaaaaaa-1111-1111-1111-000000000001',
      'role', 'authenticated'
    )::text,
    true);
  SELECT id INTO v_id
    FROM public.receipt_imports
    WHERE restaurant_id = p_restaurant_id
      AND vendor_name ILIKE p_vendor
      AND purchase_date = p_date
      AND total_amount >= v_lower
      AND total_amount <= v_upper
      AND id <> p_exclude_id
    ORDER BY created_at DESC
    LIMIT 1;
  PERFORM set_config('role', 'postgres', true);
  RETURN v_id;
END
$$;

CREATE OR REPLACE FUNCTION pg_temp.semantic_count(
  p_restaurant_id uuid,
  p_vendor text,
  p_date date,
  p_total numeric,
  p_exclude_id uuid
)
RETURNS integer LANGUAGE plpgsql AS $$
DECLARE
  v_count integer;
  v_lower numeric := GREATEST(0::numeric, p_total - 0.01);
  v_upper numeric := p_total + 0.01;
BEGIN
  PERFORM set_config('role', 'authenticated', true);
  PERFORM set_config('request.jwt.claims',
    json_build_object(
      'sub', 'aaaaaaaa-1111-1111-1111-000000000001',
      'role', 'authenticated'
    )::text,
    true);
  SELECT count(*)::int INTO v_count
    FROM public.receipt_imports
    WHERE restaurant_id = p_restaurant_id
      AND vendor_name ILIKE p_vendor
      AND purchase_date = p_date
      AND total_amount >= v_lower
      AND total_amount <= v_upper
      AND id <> p_exclude_id;
  PERFORM set_config('role', 'postgres', true);
  RETURN v_count;
END
$$;

-- ---------- findDuplicateByHash tests ----------

SELECT is(
  pg_temp.hash_match_id(
    '11111111-1111-1111-1111-111111111111'::uuid,
    'hash-abc'
  ),
  'dddddd00-0000-0000-0000-000000000002'::uuid,
  'hash match returns the most recent same-hash row (ORDER BY created_at DESC)'
);

SELECT is(
  pg_temp.hash_match_id(
    '11111111-1111-1111-1111-111111111111'::uuid,
    'hash-missing'
  ),
  NULL::uuid,
  'hash match returns NULL when no row matches'
);

-- Spoofed restaurant_id: owner-A is not a member of restaurant B, so RLS hides
-- the matching row in B even though the WHERE clause would allow it.
SELECT is(
  pg_temp.hash_match_id(
    '22222222-2222-2222-2222-222222222222'::uuid,
    'hash-abc'
  ),
  NULL::uuid,
  'hash match cannot reach a restaurant the user is not a member of (RLS)'
);

-- ---------- findSemanticDuplicate tests ----------

-- With excludeId = the "current" row, the most recent match is the SYSCO case-
-- insensitive row at 2026-05-19, proving (a) ILIKE matches, (b) ORDER BY DESC wins.
SELECT is(
  pg_temp.semantic_match_id(
    '11111111-1111-1111-1111-111111111111'::uuid,
    'Sysco', '2026-05-10'::date, 1284.50,
    'ffffff00-0000-0000-0000-000000000001'::uuid
  ),
  'eeeeee00-0000-0000-0000-000000000008'::uuid,
  'semantic match returns most recent ILIKE-vendor row inside window'
);

-- Boundary inclusivity: query at 1284.50 includes rows at 1284.49 and 1284.51.
-- Window [1284.49 .. 1284.51] catches: ...001 (1284.50), ...002 (1284.49),
-- ...003 (1284.51), ...008 (SYSCO 1284.50). 4 rows (excluding the "current").
SELECT is(
  pg_temp.semantic_count(
    '11111111-1111-1111-1111-111111111111'::uuid,
    'Sysco', '2026-05-10'::date, 1284.50,
    'ffffff00-0000-0000-0000-000000000001'::uuid
  ),
  4,
  'semantic window is inclusive at the lower boundary (1284.49 matches when total=1284.50)'
);

-- Query at 1284.49: window [1284.48..1284.50] would now include the OUT-of-range
-- 1284.48 row. If the window were open on the lower side, ...004 would be missed.
SELECT is(
  pg_temp.semantic_count(
    '11111111-1111-1111-1111-111111111111'::uuid,
    'Sysco', '2026-05-10'::date, 1284.49,
    'ffffff00-0000-0000-0000-000000000001'::uuid
  ),
  4,
  'semantic window is inclusive at the upper boundary (1284.50 matches when total=1284.49)'
);

-- Just outside the window: 1284.48 with window [1284.47..1284.49] catches only
-- ...002 (1284.49) and ...004 (1284.48). ...001 (1284.50) is now excluded.
SELECT is(
  pg_temp.semantic_count(
    '11111111-1111-1111-1111-111111111111'::uuid,
    'Sysco', '2026-05-10'::date, 1284.48,
    'ffffff00-0000-0000-0000-000000000001'::uuid
  ),
  2,
  'semantic window excludes rows more than 0.01 below target (1284.50 excluded when total=1284.48)'
);

-- Symmetric: 1284.52 with window [1284.51..1284.53] catches only ...003 and ...005.
SELECT is(
  pg_temp.semantic_count(
    '11111111-1111-1111-1111-111111111111'::uuid,
    'Sysco', '2026-05-10'::date, 1284.52,
    'ffffff00-0000-0000-0000-000000000001'::uuid
  ),
  2,
  'semantic window excludes rows more than 0.01 above target (1284.50 excluded when total=1284.52)'
);

-- Different date: only ...006 has 2026-05-11, and it's the only row in the window.
SELECT is(
  pg_temp.semantic_count(
    '11111111-1111-1111-1111-111111111111'::uuid,
    'Sysco', '2026-05-11'::date, 1284.50,
    'ffffff00-0000-0000-0000-000000000001'::uuid
  ),
  1,
  'semantic match filters on purchase_date — wrong-date rows are excluded'
);

-- Different vendor: only the US Foods row matches.
SELECT is(
  pg_temp.semantic_count(
    '11111111-1111-1111-1111-111111111111'::uuid,
    'US Foods', '2026-05-10'::date, 1284.50,
    'ffffff00-0000-0000-0000-000000000001'::uuid
  ),
  1,
  'semantic match filters on vendor_name — other vendors are excluded'
);

-- excludeId actually removes the named row from the result set.
-- Drop the SYSCO row from the window via excludeId — most recent match becomes
-- ffffff00 (the "current" upload row at 2026-05-20).
SELECT is(
  pg_temp.semantic_match_id(
    '11111111-1111-1111-1111-111111111111'::uuid,
    'Sysco', '2026-05-10'::date, 1284.50,
    'eeeeee00-0000-0000-0000-000000000008'::uuid
  ),
  'ffffff00-0000-0000-0000-000000000001'::uuid,
  'excludeId hides the named row — next-most-recent match wins'
);

-- Baseline (no exclusion via a fresh UUID) is 5 in-window rows:
-- ...001, ...002, ...003, ...008, and the "current" ffffff00.
-- Excluding ...008 drops the count to 4, proving the .neq() filter actually fires.
SELECT is(
  (pg_temp.semantic_count(
    '11111111-1111-1111-1111-111111111111'::uuid,
    'Sysco', '2026-05-10'::date, 1284.50,
    gen_random_uuid()
  )
  - pg_temp.semantic_count(
    '11111111-1111-1111-1111-111111111111'::uuid,
    'Sysco', '2026-05-10'::date, 1284.50,
    'eeeeee00-0000-0000-0000-000000000008'::uuid
  )),
  1,
  'excludeId reduces the match count by exactly one'
);

-- No vendor matches → NULL.
SELECT is(
  pg_temp.semantic_match_id(
    '11111111-1111-1111-1111-111111111111'::uuid,
    'Nonexistent Vendor', '2026-05-10'::date, 1284.50,
    'ffffff00-0000-0000-0000-000000000001'::uuid
  ),
  NULL::uuid,
  'semantic match returns NULL when no vendor matches'
);

-- Cross-tenant: owner-A querying restaurant B sees zero semantic matches
-- even though ...009 is a perfect match for the criteria.
SELECT is(
  pg_temp.semantic_count(
    '22222222-2222-2222-2222-222222222222'::uuid,
    'Sysco', '2026-05-10'::date, 1284.50,
    'ffffff00-0000-0000-0000-000000000001'::uuid
  ),
  0,
  'semantic match cannot reach a restaurant the user is not a member of (RLS)'
);

SELECT * FROM finish();
ROLLBACK;
