-- ============================================================================
-- Receipt images storage RLS: delete the permissive policies
--
-- Design: docs/superpowers/specs/2026-10-26-receipt-images-storage-rls-design.md
--
-- Problem: 4 PERMISSIVE policies on storage.objects from
-- 20250927214536_f9d9e0f9-0f8d-4ffb-93c9-f2667b19b4e9.sql check only
-- `bucket_id = 'receipt-images' AND auth.uid() IS NOT NULL`. Postgres ORs
-- permissive policies, so any signed-in user can read, replace or delete the
-- receipts of any restaurant. The folder policies from
-- 20250928000424_e694f874-8211-4ce1-b75c-d1378f1edf57.sql check
-- user_restaurants, but the 4 policies cancel them.
--
-- Fix:
--   1. Delete the 4 permissive policies.
--   2. Recreate the folder INSERT and UPDATE policies. The body is a copy of
--      20250928000424, with operations_manager and
--      collaborator_operations_manager added to the role array. These 2 roles
--      can insert into receipt_imports
--      (20260723120000_add_collaborator_operations_manager_role.sql), and the
--      receipt upload writes the file before the row. Without them, the
--      delete in step 1 blocks their receipt import.
--      Both policies get `TO authenticated`. The UPDATE policy gets an
--      explicit WITH CHECK, so a user cannot move an object into the folder
--      of another restaurant.
--
-- Every app upload path starts with the restaurant id folder
-- (useReceiptImport, useBankStatementImport, useExpenseInvoiceUpload,
-- useAttachments). proxy-receipt-file reads with the service role, so RLS
-- does not apply to it.
--
-- The folder SELECT and DELETE policies do not change. Other buckets do not
-- change.
-- ============================================================================

-- DROP POLICY and CREATE POLICY lock storage.objects for every bucket. Stop
-- the migration after 5 seconds if a long transaction holds a lock on the table.
SET LOCAL lock_timeout = '5s';

-- 1. Delete the permissive policies. Production can carry the INSERT policy
--    under a second name. DROP POLICY IF EXISTS does nothing when a name is
--    absent.
DROP POLICY IF EXISTS "Allow authenticated users to upload receipt images" ON storage.objects;
DROP POLICY IF EXISTS "Allow authenticated users to upload their receipt images" ON storage.objects;
DROP POLICY IF EXISTS "Allow authenticated users to view their receipt images" ON storage.objects;
DROP POLICY IF EXISTS "Allow authenticated users to update their receipt images" ON storage.objects;
DROP POLICY IF EXISTS "Allow authenticated users to delete their receipt images" ON storage.objects;

-- 2. Recreate the folder INSERT and UPDATE policies with the receipt_imports
--    writer roles. Keep the 3 role arrays below the same.
DROP POLICY IF EXISTS "Users can upload receipt images for their restaurants" ON storage.objects;
CREATE POLICY "Users can upload receipt images for their restaurants"
ON storage.objects
FOR INSERT
TO authenticated
WITH CHECK (
  bucket_id = 'receipt-images'
  AND EXISTS (
    SELECT 1
    FROM user_restaurants ur
    WHERE ur.restaurant_id::text = (storage.foldername(name))[1]
    AND ur.user_id = auth.uid()
    AND ur.role = ANY(ARRAY['owner'::text, 'manager'::text, 'chef'::text, 'operations_manager'::text, 'collaborator_operations_manager'::text])
  )
);

DROP POLICY IF EXISTS "Users can update receipt images for their restaurants" ON storage.objects;
CREATE POLICY "Users can update receipt images for their restaurants"
ON storage.objects
FOR UPDATE
TO authenticated
USING (
  bucket_id = 'receipt-images'
  AND EXISTS (
    SELECT 1
    FROM user_restaurants ur
    WHERE ur.restaurant_id::text = (storage.foldername(name))[1]
    AND ur.user_id = auth.uid()
    AND ur.role = ANY(ARRAY['owner'::text, 'manager'::text, 'chef'::text, 'operations_manager'::text, 'collaborator_operations_manager'::text])
  )
)
WITH CHECK (
  bucket_id = 'receipt-images'
  AND EXISTS (
    SELECT 1
    FROM user_restaurants ur
    WHERE ur.restaurant_id::text = (storage.foldername(name))[1]
    AND ur.user_id = auth.uid()
    AND ur.role = ANY(ARRAY['owner'::text, 'manager'::text, 'chef'::text, 'operations_manager'::text, 'collaborator_operations_manager'::text])
  )
);
