-- ============================================================================
-- Migration: user_restaurants.role_id
--
-- Task 3 of the "data-driven roles built from areas" design
-- (docs/superpowers/specs/2026-07-29-roles-and-areas-design.md). Adds a
-- nullable `role_id` alongside the existing `role text` column and backfills
-- it for every membership already on one of the ten legacy role strings.
--
-- The legacy `role` column KEEPS its meaning and its CHECK constraint is
-- untouched here (the CHECK is widened for `collaborator_custom` in Task 4).
-- A membership on a builtin role now carries both: `role` for every existing
-- policy that still compares against it, and `role_id` pointing at the
-- matching seeded builtin row in `public.roles`
-- (20260730110000_seed_builtin_roles.sql). A membership on a *custom* role
-- (introduced in Task 4) will store `role = 'collaborator_custom'` and point
-- `role_id` at the custom row — but that is Task 4's job, not this one's.
--
-- Mapping is by explicit id, not by joining on `roles.name` — the seed
-- migration's own comment calls this out ("Task 3's backfill maps the legacy
-- role string to these rows explicitly, it does not rely on name equality"),
-- because several builtins' display names don't match their legacy string
-- (`staff` -> "Employee (self-service)", `collaborator_accountant` ->
-- "Accountant", etc).
--
-- The backfill is a named, idempotent function
-- (`public.backfill_user_restaurants_role_id`) rather than an inline
-- one-shot UPDATE, guarded by `WHERE role_id IS NULL` so re-running it is
-- always safe and never clobbers a role_id that was set some other way.
-- This migration calls it once, immediately, for whatever memberships exist
-- at deploy time.
-- ============================================================================

ALTER TABLE public.user_restaurants
  ADD COLUMN role_id UUID REFERENCES public.roles(id);

CREATE INDEX idx_user_restaurants_user_restaurant_role_id
  ON public.user_restaurants (user_id, restaurant_id, role_id);

CREATE OR REPLACE FUNCTION public.backfill_user_restaurants_role_id()
RETURNS void
LANGUAGE sql
AS $$
  WITH role_id_map (legacy_role, builtin_role_id) AS (
    VALUES
      ('owner',                           'b0000000-0000-0000-0000-000000000001'::uuid),
      ('manager',                         'b0000000-0000-0000-0000-000000000002'::uuid),
      ('operations_manager',              'b0000000-0000-0000-0000-000000000003'::uuid),
      ('chef',                            'b0000000-0000-0000-0000-000000000004'::uuid),
      ('staff',                           'b0000000-0000-0000-0000-000000000005'::uuid),
      ('kiosk',                           'b0000000-0000-0000-0000-000000000006'::uuid),
      ('collaborator_accountant',         'b0000000-0000-0000-0000-000000000007'::uuid),
      ('collaborator_inventory',          'b0000000-0000-0000-0000-000000000008'::uuid),
      ('collaborator_chef',               'b0000000-0000-0000-0000-000000000009'::uuid),
      ('collaborator_operations_manager', 'b0000000-0000-0000-0000-00000000000a'::uuid)
  )
  UPDATE public.user_restaurants ur
  SET role_id = m.builtin_role_id
  FROM role_id_map m
  WHERE ur.role = m.legacy_role
    AND ur.role_id IS NULL;
$$;

COMMENT ON FUNCTION public.backfill_user_restaurants_role_id IS
'Backfills user_restaurants.role_id from the legacy role text column for the ten builtin roles. Idempotent: only ever fills in rows where role_id IS NULL, so it is safe to call again (e.g. to catch memberships created between deploys).';

SELECT public.backfill_user_restaurants_role_id();
