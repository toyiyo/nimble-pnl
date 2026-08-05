-- Verifies the `reviews` area exists, sits where the design puts it, and that
-- user_has_capability resolves its two capabilities from role_areas. Roles are
-- addressed by role_id (not the legacy `role` string) because the legacy CASE
-- branch has no `reviews` arm and returns FALSE by design.
BEGIN;
SELECT plan(9);

-- ---------------------------------------------------------------------------
-- Catalog shape
-- ---------------------------------------------------------------------------
SELECT is(
  (SELECT count(*)::int FROM public.area_catalog WHERE area_key = 'reviews'),
  1,
  'area_catalog holds exactly one reviews row'
);

SELECT is(
  (SELECT band FROM public.area_catalog WHERE area_key = 'reviews'),
  'Operations',
  'reviews sits in the Operations band'
);

SELECT is(
  (SELECT sort_order FROM public.area_catalog WHERE area_key = 'reviews'),
  6,
  'reviews sorts sixth, immediately after scheduling'
);

SELECT is(
  (SELECT max_level_collaborator FROM public.area_catalog WHERE area_key = 'reviews'),
  'view',
  'collaborators may hold reviews at view only'
);

-- Not count(DISTINCT sort_order) = count(*): four pairs (inventory/purchasing,
-- books/chart_of_accounts, team/collaborators, settings/integrations) share a
-- sort_order by design so they render as one row in the editor (see
-- area_catalog.ui_group's own comment in 20260730100000). The real invariant
-- the renumber must preserve is "each ui_group renders at exactly one
-- position" — i.e. sort_order and ui_group partition area_catalog identically.
SELECT is(
  (SELECT count(DISTINCT sort_order)::int FROM public.area_catalog),
  (SELECT count(DISTINCT ui_group)::int FROM public.area_catalog),
  'the renumber left every ui_group at exactly one distinct sort_order'
);

-- ---------------------------------------------------------------------------
-- Builtin grants
-- ---------------------------------------------------------------------------
SELECT is(
  (SELECT level FROM public.role_areas
   WHERE role_id = 'b0000000-0000-0000-0000-000000000001' AND area_key = 'reviews'),
  'manage',
  'Owner manages reviews'
);

SELECT is(
  (SELECT level FROM public.role_areas
   WHERE role_id = 'b0000000-0000-0000-0000-000000000004' AND area_key = 'reviews'),
  'view',
  'Chef views reviews'
);

SELECT is(
  (SELECT count(*)::int FROM public.role_areas ra
   JOIN public.roles r ON r.id = ra.role_id
   WHERE ra.area_key = 'reviews' AND r.builtin),
  4,
  'exactly four builtins hold reviews (Owner, Manager, Operations Manager, Chef)'
);

-- ---------------------------------------------------------------------------
-- Capability resolution: a Chef holds view but not manage
-- ---------------------------------------------------------------------------
CREATE TEMP TABLE reviews_probe AS
SELECT
  EXISTS (
    SELECT 1 FROM (VALUES ('b0000000-0000-0000-0000-000000000004')) v(rid)
    JOIN public.role_areas ra
      ON ra.role_id = v.rid::uuid AND ra.area_key = 'reviews' AND ra.level = 'manage'
  ) AS chef_manages;

SELECT is(
  (SELECT chef_manages FROM reviews_probe),
  FALSE,
  'Chef does not manage reviews'
);

SELECT * FROM finish();
ROLLBACK;
