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

-- Band and position now mirror the sidebar exactly (20260805120000_page_areas):
-- /reviews is the fifth item of the Main group in navigationGroups, so it is
-- band 'Main' at sort_order 5 — not the invented 'Operations' band the bundle
-- model put it in.
SELECT is(
  (SELECT band FROM public.area_catalog WHERE area_key = 'reviews'),
  'Main',
  'reviews sits in the Main band, mirroring the sidebar'
);

SELECT is(
  (SELECT sort_order FROM public.area_catalog WHERE area_key = 'reviews'),
  5,
  'reviews sorts fifth in Main, its sidebar position'
);

SELECT is(
  (SELECT max_level_collaborator FROM public.area_catalog WHERE area_key = 'reviews'),
  'view',
  'collaborators may hold reviews at view only'
);

-- Under the bundle model, paired areas deliberately shared a sort_order so
-- they rendered as one editor row, and the invariant was "sort_order and
-- ui_group partition area_catalog identically". The per-page re-cut gives
-- every page its own row, so sort_order is now unique WITHIN a group and
-- inserting reviews must not have collided with a Main sibling.
SELECT is(
  (SELECT count(*)::int FROM (
     SELECT sort_order
     FROM public.area_catalog
     WHERE ui_group = 'Main'
     GROUP BY sort_order
     HAVING count(*) > 1
   ) AS collisions),
  0,
  'no two Main pages share a sort_order after the reviews insert'
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
