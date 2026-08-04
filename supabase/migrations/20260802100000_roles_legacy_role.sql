-- ============================================================================
-- roles.legacy_role — the builtin-role-string <-> roles-row mapping, exposed.
--
-- The role picker (2026-08-02-role-assignment-design.md) renders area chips
-- and a permission delta for builtin roles as well as custom ones, so the
-- client needs to resolve 'chef' -> the Chef roles row. That mapping exists
-- only inside builtin_role_id_for(), and no builtin UUID appears anywhere in
-- src/ — deliberately. Matching on display name is not an option either: the
-- DB names ('Employee (self-service)') and ROLE_METADATA's labels are
-- maintained separately, so a rename would break the join silently.
--
-- builtin_role_id_for() is deliberately NOT rewritten to read this column. It
-- is IMMUTABLE and referenced inside a RESTRICTIVE policy's WITH CHECK
-- (20260730180000_close_role_id_self_escalation.sql); reading a table would
-- force it to STABLE, which is a change to a security-critical function this
-- work has no reason to make. A pgTAP test asserts the two agree instead.
-- ============================================================================

ALTER TABLE public.roles ADD COLUMN legacy_role TEXT;

COMMENT ON COLUMN public.roles.legacy_role IS
'The user_restaurants.role string this builtin row corresponds to. NULL for every custom role, which has no legacy string — every custom role shares ''collaborator_custom'' and is distinguished by id alone. Read by the client to map a builtin role string to its roles row without hardcoding builtin UUIDs.';

-- Backfilled through builtin_role_id_for rather than by re-listing the pairs,
-- so this migration cannot introduce a mapping the function disagrees with.
--
-- roles_block_builtin_mutation (20260730100000_roles_and_areas_tables.sql)
-- rejects any UPDATE of a builtin row unconditionally, so this one-time
-- migration-time backfill must step around it. ALTER TABLE ... DISABLE/ENABLE
-- TRIGGER acquires a ShareRowExclusiveLock, which is a known concern for a
-- statement run against live traffic (see the GUC-flag pattern in
-- 20260215200000_fix_toast_sync_timeout.sql) but is fine for a migration:
-- there is no concurrent writer to block, and the trigger is re-enabled
-- before the transaction commits.
ALTER TABLE public.roles DISABLE TRIGGER roles_block_builtin_mutation;

UPDATE public.roles r
SET legacy_role = m.legacy_role
FROM (VALUES
  ('owner'), ('manager'), ('operations_manager'), ('chef'), ('staff'),
  ('kiosk'), ('collaborator_accountant'), ('collaborator_inventory'),
  ('collaborator_chef'), ('collaborator_operations_manager')
) AS m(legacy_role)
WHERE r.id = public.builtin_role_id_for(m.legacy_role);

ALTER TABLE public.roles ENABLE TRIGGER roles_block_builtin_mutation;

-- Invariants in the database, not only in a test. A pgTAP agreement test
-- catches drift only if CI runs and the test was not itself edited to match
-- the mistake; the index catches a duplicate unconditionally, in production.
CREATE UNIQUE INDEX roles_legacy_role_key ON public.roles (legacy_role)
  WHERE legacy_role IS NOT NULL;

ALTER TABLE public.roles ADD CONSTRAINT roles_legacy_role_builtin_only
  CHECK (legacy_role IS NULL OR builtin);
