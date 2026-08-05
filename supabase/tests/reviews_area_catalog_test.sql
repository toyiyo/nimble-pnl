-- Verifies the `reviews` area exists, sits where the design puts it, and that
-- user_has_capability resolves its two capabilities from role_areas. Roles are
-- addressed by role_id (not the legacy `role` string) because the legacy CASE
-- branch has no `reviews` arm and returns FALSE by design.
BEGIN;
SELECT plan(11);

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
-- Capability resolution: through user_has_capability, not through role_areas
--
-- The role_areas assertions above prove the grant rows exist. They do not
-- prove the function every RLS policy and every ProtectedRoute actually calls
-- can see them — that path runs through user_has_capability's own area lookup,
-- and a `reviews` row nobody resolves is a menu entry nobody can open.
-- ---------------------------------------------------------------------------
INSERT INTO auth.users (id, email) VALUES
  ('cccccccc-0000-0000-0000-000000000001', 'catalog-owner@test.local'),
  ('cccccccc-0000-0000-0000-000000000002', 'catalog-chef@test.local');

INSERT INTO public.restaurants (id, name)
VALUES ('cccccccc-0000-0000-0000-000000000099', 'Catalog Test Restaurant');

-- role_id, not the legacy `role` string: the legacy CASE has no reviews arm.
INSERT INTO public.user_restaurants (user_id, restaurant_id, role, role_id) VALUES
  ('cccccccc-0000-0000-0000-000000000001', 'cccccccc-0000-0000-0000-000000000099',
   'owner', 'b0000000-0000-0000-0000-000000000001'),
  ('cccccccc-0000-0000-0000-000000000002', 'cccccccc-0000-0000-0000-000000000099',
   'chef',  'b0000000-0000-0000-0000-000000000004');

SELECT set_config('request.jwt.claims',
  '{"sub":"cccccccc-0000-0000-0000-000000000001","role":"authenticated"}', true);

SELECT is(
  public.user_has_capability('cccccccc-0000-0000-0000-000000000099'::uuid, 'manage:reviews'),
  TRUE,
  'user_has_capability resolves manage:reviews for the Owner'
);

SELECT set_config('request.jwt.claims',
  '{"sub":"cccccccc-0000-0000-0000-000000000002","role":"authenticated"}', true);

SELECT is(
  public.user_has_capability('cccccccc-0000-0000-0000-000000000099'::uuid, 'view:reviews'),
  TRUE,
  'user_has_capability resolves view:reviews for the Chef'
);

SELECT is(
  public.user_has_capability('cccccccc-0000-0000-0000-000000000099'::uuid, 'manage:reviews'),
  FALSE,
  'user_has_capability withholds manage:reviews from the Chef'
);

SELECT * FROM finish();
ROLLBACK;
