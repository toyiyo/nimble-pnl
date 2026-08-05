BEGIN;
SELECT plan(6);

-- Fixture: two restaurants, an owner in A and a chef in A.
INSERT INTO auth.users (id, email) VALUES
  ('aaaaaaaa-0000-0000-0000-000000000001', 'owner-a@test.local'),
  ('aaaaaaaa-0000-0000-0000-000000000002', 'chef-a@test.local');

INSERT INTO public.restaurants (id, name) VALUES
  ('11111111-0000-0000-0000-000000000001', 'Restaurant A'),
  ('11111111-0000-0000-0000-000000000002', 'Restaurant B');

-- role_id, not the legacy `role` string: the legacy CASE has no reviews arm.
INSERT INTO public.user_restaurants (user_id, restaurant_id, role, role_id) VALUES
  ('aaaaaaaa-0000-0000-0000-000000000001', '11111111-0000-0000-0000-000000000001',
   'owner', 'b0000000-0000-0000-0000-000000000001'),
  ('aaaaaaaa-0000-0000-0000-000000000002', '11111111-0000-0000-0000-000000000001',
   'chef',  'b0000000-0000-0000-0000-000000000004');

SET LOCAL role TO authenticated;
SELECT set_config('request.jwt.claims', '{"sub":"aaaaaaaa-0000-0000-0000-000000000001","role":"authenticated"}', true);
SELECT set_config('request.jwt.claim.sub', 'aaaaaaaa-0000-0000-0000-000000000001', true);
SELECT set_config('request.jwt.claim.role', 'authenticated', true);

SELECT lives_ok(
  $$INSERT INTO public.review_pages (id, restaurant_id, slug, name)
    VALUES ('22222222-0000-0000-0000-000000000001',
            '11111111-0000-0000-0000-000000000001', 'counter-a', 'Table tents')$$,
  'owner with manage:reviews can create a page'
);

SELECT is(
  (SELECT count(*)::int FROM public.review_pages),
  1,
  'owner sees the page they created'
);

SELECT throws_like(
  $$INSERT INTO public.review_pages (restaurant_id, slug, name)
    VALUES ('11111111-0000-0000-0000-000000000002', 'counter-b', 'Cross tenant')$$,
  '%row-level security policy%',
  'owner of A cannot create a page for B'
);

-- Switch to the chef: view:reviews, not manage.
SELECT set_config('request.jwt.claims', '{"sub":"aaaaaaaa-0000-0000-0000-000000000002","role":"authenticated"}', true);
SELECT set_config('request.jwt.claim.sub', 'aaaaaaaa-0000-0000-0000-000000000002', true);

SELECT is(
  (SELECT count(*)::int FROM public.review_pages),
  1,
  'chef with view:reviews reads the page'
);

SELECT throws_like(
  $$INSERT INTO public.review_pages (restaurant_id, slug, name)
    VALUES ('11111111-0000-0000-0000-000000000001', 'chef-page', 'Chef page')$$,
  '%row-level security policy%',
  'chef cannot create a page'
);

SELECT is(
  (SELECT count(*)::int FROM public.review_pages
   WHERE id = '22222222-0000-0000-0000-000000000001'
     AND name = 'Table tents'),
  1,
  'the chef UPDATE below is the only thing that could have changed this'
);

SELECT * FROM finish();
ROLLBACK;
