-- ============================================================================
-- receipt_images_storage_rls.test.sql
--
-- pgTAP coverage for the receipt-images storage RLS fix. See
-- docs/superpowers/specs/2026-10-26-receipt-images-storage-rls-design.md.
--
-- The problem: 4 PERMISSIVE policies on storage.objects
-- (supabase/migrations/20250927214536_f9d9e0f9-0f8d-4ffb-93c9-f2667b19b4e9.sql)
-- check only `bucket_id = 'receipt-images' AND auth.uid() IS NOT NULL`.
-- Permissive policies are ORed, so any signed-in user can read, replace or
-- delete the receipts of any restaurant. The fix deletes the 4 policies and
-- keeps the folder policies that check user_restaurants.
--
-- Run as the real `authenticated` role with JWT claims so that RLS applies.
-- As superuser, RLS does not apply.
--
-- All fixture data (restaurant and user ids, emails, object names) is
-- fictional and exists only for the duration of this transaction (ROLLBACK).
-- ============================================================================
BEGIN;

SELECT plan(17);

-- ----------------------------------------------------------------------------
-- Fixtures: two restaurants, five users. `e3000000-…` prefix so the ids do
-- not collide with any other test file.
--
--   restaurant A (e3000000-...-0000000000a1)
--   restaurant B (e3000000-...-0000000000b1)
--   USER_A  (...01) — owner of restaurant A
--   USER_B  (...02) — owner of restaurant B
--   OPS_A   (...03) — operations_manager of restaurant A
--   CHEF_A  (...04) — chef of restaurant A
--   STAFF_A (...05) — staff of restaurant A
-- ----------------------------------------------------------------------------
INSERT INTO auth.users (id, email) VALUES
  ('e3000000-0000-0000-0000-000000000001', 'rcpt-rls-a@example.test'),
  ('e3000000-0000-0000-0000-000000000002', 'rcpt-rls-b@example.test'),
  ('e3000000-0000-0000-0000-000000000003', 'rcpt-rls-ops-a@example.test'),
  ('e3000000-0000-0000-0000-000000000004', 'rcpt-rls-chef-a@example.test'),
  ('e3000000-0000-0000-0000-000000000005', 'rcpt-rls-staff-a@example.test')
ON CONFLICT (id) DO UPDATE SET email = EXCLUDED.email;

INSERT INTO public.restaurants (id, name) VALUES
  ('e3000000-0000-0000-0000-0000000000a1', 'Receipt RLS Test Restaurant A'),
  ('e3000000-0000-0000-0000-0000000000b1', 'Receipt RLS Test Restaurant B')
ON CONFLICT (id) DO UPDATE SET name = EXCLUDED.name;

INSERT INTO public.user_restaurants (user_id, restaurant_id, role) VALUES
  ('e3000000-0000-0000-0000-000000000001', 'e3000000-0000-0000-0000-0000000000a1', 'owner'),
  ('e3000000-0000-0000-0000-000000000002', 'e3000000-0000-0000-0000-0000000000b1', 'owner'),
  ('e3000000-0000-0000-0000-000000000003', 'e3000000-0000-0000-0000-0000000000a1', 'operations_manager'),
  ('e3000000-0000-0000-0000-000000000004', 'e3000000-0000-0000-0000-0000000000a1', 'chef'),
  ('e3000000-0000-0000-0000-000000000005', 'e3000000-0000-0000-0000-0000000000a1', 'staff')
ON CONFLICT (user_id, restaurant_id) DO UPDATE SET role = EXCLUDED.role;

INSERT INTO storage.buckets (id, name, public) VALUES
  ('receipt-images', 'receipt-images', false)
ON CONFLICT (id) DO UPDATE SET public = EXCLUDED.public;

-- One receipt in each restaurant folder, written as superuser. move-me.pdf
-- exists only for the move test, so that test cannot change receipt-a.pdf.
INSERT INTO storage.objects (bucket_id, name) VALUES
  ('receipt-images', 'e3000000-0000-0000-0000-0000000000a1/receipt-a.pdf'),
  ('receipt-images', 'e3000000-0000-0000-0000-0000000000a1/move-me.pdf'),
  ('receipt-images', 'e3000000-0000-0000-0000-0000000000b1/receipt-b.pdf')
ON CONFLICT (bucket_id, name) DO UPDATE SET name = EXCLUDED.name;

-- ============================================================================
-- 1. The 4 permissive policies do not exist.
-- ============================================================================
SELECT is(
  (SELECT count(*)::int FROM pg_policies
    WHERE schemaname = 'storage'
      AND tablename = 'objects'
      AND policyname IN (
        'Allow authenticated users to upload receipt images',
        'Allow authenticated users to upload their receipt images',
        'Allow authenticated users to view their receipt images',
        'Allow authenticated users to update their receipt images',
        'Allow authenticated users to delete their receipt images'
      )),
  0,
  'the permissive receipt-images policies do not exist'
);

-- ============================================================================
-- 2. Only the 4 folder policies refer to the receipt-images bucket. A
--    permissive policy with another name would open the bucket again.
-- ============================================================================
SELECT set_eq(
  $$ SELECT policyname::text FROM pg_policies
      WHERE schemaname = 'storage'
        AND tablename = 'objects'
        AND (coalesce(qual, '') || coalesce(with_check, '')) LIKE '%receipt-images%' $$,
  ARRAY[
    'Users can view receipt images for their restaurants',
    'Users can upload receipt images for their restaurants',
    'Users can update receipt images for their restaurants',
    'Users can delete receipt images for their restaurants'
  ],
  'only the 4 folder policies refer to the receipt-images bucket'
);

-- ============================================================================
-- 3-8. USER_A against the folder of restaurant B: no access.
-- ============================================================================
SET LOCAL ROLE authenticated;
SET LOCAL request.jwt.claims = '{"sub":"e3000000-0000-0000-0000-000000000001","role":"authenticated"}';

SELECT is(
  (SELECT count(*)::int FROM storage.objects
   WHERE bucket_id = 'receipt-images'
     AND name = 'e3000000-0000-0000-0000-0000000000b1/receipt-b.pdf'),
  0,
  'user A cannot select a receipt in the folder of restaurant B'
);

WITH changed AS (
  UPDATE storage.objects
     SET metadata = '{"tampered":true}'::jsonb
   WHERE bucket_id = 'receipt-images'
     AND name = 'e3000000-0000-0000-0000-0000000000b1/receipt-b.pdf'
   RETURNING 1
)
SELECT is(count(*)::int, 0, 'user A cannot update a receipt in the folder of restaurant B')
  FROM changed;

WITH deleted AS (
  DELETE FROM storage.objects
   WHERE bucket_id = 'receipt-images'
     AND name = 'e3000000-0000-0000-0000-0000000000b1/receipt-b.pdf'
   RETURNING 1
)
SELECT is(count(*)::int, 0, 'user A cannot delete a receipt in the folder of restaurant B')
  FROM deleted;

SELECT throws_ok(
  $$ INSERT INTO storage.objects (bucket_id, name)
     VALUES ('receipt-images', 'e3000000-0000-0000-0000-0000000000b1/planted.pdf') $$,
  '42501',
  NULL,
  'user A cannot upload into the folder of restaurant B'
);

-- A path without a restaurant folder matches no membership.
SELECT throws_ok(
  $$ INSERT INTO storage.objects (bucket_id, name)
     VALUES ('receipt-images', 'no-folder.pdf') $$,
  '42501',
  NULL,
  'user A cannot upload a receipt outside a restaurant folder'
);

-- User A cannot move its own receipt into the folder of restaurant B.
SELECT throws_ok(
  $$ UPDATE storage.objects
        SET name = 'e3000000-0000-0000-0000-0000000000b1/moved.pdf'
      WHERE bucket_id = 'receipt-images'
        AND name = 'e3000000-0000-0000-0000-0000000000a1/move-me.pdf' $$,
  '42501',
  NULL,
  'user A cannot move a receipt into the folder of restaurant B'
);

-- ============================================================================
-- 9-11. USER_A in its own folder: read, upload and update still work.
-- ============================================================================
SELECT is(
  (SELECT count(*)::int FROM storage.objects
   WHERE bucket_id = 'receipt-images'
     AND name = 'e3000000-0000-0000-0000-0000000000a1/receipt-a.pdf'),
  1,
  'user A can select a receipt in its own folder'
);

SELECT lives_ok(
  $$ INSERT INTO storage.objects (bucket_id, name)
     VALUES ('receipt-images', 'e3000000-0000-0000-0000-0000000000a1/expense-invoices/new.pdf') $$,
  'user A can upload into its own folder'
);

WITH changed AS (
  UPDATE storage.objects
     SET metadata = '{"size":1}'::jsonb
   WHERE bucket_id = 'receipt-images'
     AND name = 'e3000000-0000-0000-0000-0000000000a1/receipt-a.pdf'
   RETURNING 1
)
SELECT is(count(*)::int, 1, 'user A can update a receipt in its own folder')
  FROM changed;

-- ============================================================================
-- 12-13. OPS_A: receipt_imports admits operations_manager, so storage must
--        admit the receipt upload too.
-- ============================================================================
SET LOCAL request.jwt.claims = '{"sub":"e3000000-0000-0000-0000-000000000003","role":"authenticated"}';

SELECT lives_ok(
  $$ INSERT INTO storage.objects (bucket_id, name)
     VALUES ('receipt-images', 'e3000000-0000-0000-0000-0000000000a1/ops-receipt.pdf') $$,
  'an operations_manager can upload a receipt into its own restaurant folder'
);

SELECT throws_ok(
  $$ INSERT INTO storage.objects (bucket_id, name)
     VALUES ('receipt-images', 'e3000000-0000-0000-0000-0000000000b1/ops-planted.pdf') $$,
  '42501',
  NULL,
  'an operations_manager cannot upload into the folder of another restaurant'
);

-- ============================================================================
-- 14-15. CHEF_A keeps its upload. STAFF_A cannot upload.
-- ============================================================================
SET LOCAL request.jwt.claims = '{"sub":"e3000000-0000-0000-0000-000000000004","role":"authenticated"}';

SELECT lives_ok(
  $$ INSERT INTO storage.objects (bucket_id, name)
     VALUES ('receipt-images', 'e3000000-0000-0000-0000-0000000000a1/chef-receipt.pdf') $$,
  'a chef can upload a receipt into its own restaurant folder'
);

SET LOCAL request.jwt.claims = '{"sub":"e3000000-0000-0000-0000-000000000005","role":"authenticated"}';

SELECT throws_ok(
  $$ INSERT INTO storage.objects (bucket_id, name)
     VALUES ('receipt-images', 'e3000000-0000-0000-0000-0000000000a1/staff-receipt.pdf') $$,
  '42501',
  NULL,
  'a staff member cannot upload a receipt'
);

-- ============================================================================
-- 16-17. As superuser: the receipt of restaurant B did not change.
-- ============================================================================
RESET ROLE;
RESET request.jwt.claims;

SELECT is(
  (SELECT count(*)::int FROM storage.objects
   WHERE bucket_id = 'receipt-images'
     AND name = 'e3000000-0000-0000-0000-0000000000b1/receipt-b.pdf'
      AND (metadata IS NULL OR NOT metadata ? 'tampered')),
  1,
  'the receipt of restaurant B still exists and has no change'
);

SELECT is(
  (SELECT count(*)::int FROM storage.objects
   WHERE bucket_id = 'receipt-images'
      AND name LIKE 'e3000000-0000-0000-0000-0000000000b1/%'),
  1,
  'no object was planted in the folder of restaurant B'
);

SELECT * FROM finish();
ROLLBACK;
