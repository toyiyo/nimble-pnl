# Plan: receipt images storage RLS

Design: `docs/superpowers/specs/2026-10-26-receipt-images-storage-rls-design.md`

## Task 1: Write the failing pgTAP test

- Create `supabase/tests/receipt_images_storage_rls.test.sql`.
- Set up 2 restaurants, an owner for each, and an `operations_manager` for
  restaurant A. Put 1 object in each folder as superuser.
- As user A: check that a SELECT on the folder of B returns 0 rows, that an
  UPDATE and a DELETE in the folder of B change 0 rows, and that an INSERT in
  the folder of B fails with `42501`.
- As user A: check that a SELECT on its own folder returns the object, and
  that an INSERT in its own folder succeeds.
- As the `operations_manager`: check that an INSERT in the folder of A
  succeeds.
- Check in `pg_policies` that the 4 permissive policies do not exist.
- Add the other cases from the "Tests" section of the design doc: chef,
  staff, move into another folder, path without a folder, and the catalog
  check.
- Expected result before Task 2: the cross-tenant tests and the
  `operations_manager` test fail.

## Task 2: Write the migration

- Create `supabase/migrations/20261026120300_receipt_images_storage_rls.sql`.
- Delete the 4 permissive policies with `DROP POLICY IF EXISTS`.
- Recreate the folder INSERT and UPDATE policies with the 2 extra roles.
- Expected result: all tests in Task 1 pass.

## Task 3: Verify

- Run the test on a Postgres 16 harness with stubs for `auth.uid()`,
  `storage.objects` and `storage.foldername()`. (Docker is not available, so
  `supabase start` cannot run here.)
- Push, and let CI run the full pgTAP suite against the real schema.
