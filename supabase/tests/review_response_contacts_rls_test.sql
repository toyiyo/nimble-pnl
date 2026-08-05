BEGIN;
SELECT plan(3);

-- Fixture: two restaurants, an owner in A and a chef in A, one page, one response.
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

SET LOCAL role TO postgres;
INSERT INTO public.review_pages (id, restaurant_id, slug, name)
VALUES ('22222222-0000-0000-0000-000000000001',
        '11111111-0000-0000-0000-000000000001', 'counter-a', 'Table tents');

INSERT INTO public.review_responses
  (id, restaurant_id, review_page_id, rating, routed_to)
VALUES
  ('33333333-0000-0000-0000-000000000001',
   '11111111-0000-0000-0000-000000000001',
   '22222222-0000-0000-0000-000000000001', 2, 'feedback');

INSERT INTO public.review_response_contacts
  (review_response_id, restaurant_id, contact_name, contact_email)
VALUES
  ('33333333-0000-0000-0000-000000000001',
   '00000000-0000-0000-0000-000000000000',  -- trigger overwrites
   'Dana Guest', 'dana@example.test');

SELECT is(
  (SELECT restaurant_id FROM public.review_response_contacts
   WHERE review_response_id = '33333333-0000-0000-0000-000000000001'),
  '11111111-0000-0000-0000-000000000001'::uuid,
  'the contacts trigger derives restaurant_id from the response'
);

-- Chef: view:reviews only.
SET LOCAL role TO authenticated;
SELECT set_config('request.jwt.claims', '{"sub":"aaaaaaaa-0000-0000-0000-000000000002","role":"authenticated"}', true);
SELECT set_config('request.jwt.claim.sub', 'aaaaaaaa-0000-0000-0000-000000000002', true);
SELECT set_config('request.jwt.claim.role', 'authenticated', true);

SELECT is(
  (SELECT count(*)::int FROM public.review_response_contacts),
  0,
  'a chef reads the comment but never the guest email'
);

-- Owner: manage:reviews.
SELECT set_config('request.jwt.claims', '{"sub":"aaaaaaaa-0000-0000-0000-000000000001","role":"authenticated"}', true);
SELECT set_config('request.jwt.claim.sub', 'aaaaaaaa-0000-0000-0000-000000000001', true);

SELECT is(
  (SELECT contact_email FROM public.review_response_contacts),
  'dana@example.test',
  'an owner with manage:reviews reads the guest email'
);

SELECT * FROM finish();
ROLLBACK;
