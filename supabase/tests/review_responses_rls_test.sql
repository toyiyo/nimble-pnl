BEGIN;
SELECT plan(11);

-- Fixture: two restaurants, an owner in A and a chef in A, plus one page.
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

-- The service role is the only writer. Insert the response as the table owner
-- before switching to `authenticated`.
INSERT INTO public.review_responses
  (id, restaurant_id, review_page_id, rating, routed_to)
VALUES
  ('33333333-0000-0000-0000-000000000001',
   '00000000-0000-0000-0000-000000000000',  -- deliberately wrong; the trigger fixes it
   '22222222-0000-0000-0000-000000000001', 2, 'feedback');

SELECT is(
  (SELECT restaurant_id FROM public.review_responses
   WHERE id = '33333333-0000-0000-0000-000000000001'),
  '11111111-0000-0000-0000-000000000001'::uuid,
  'the trigger overwrites restaurant_id from the page, ignoring what was supplied'
);

SET LOCAL role TO authenticated;
SELECT set_config('request.jwt.claims', '{"sub":"aaaaaaaa-0000-0000-0000-000000000002","role":"authenticated"}', true);
SELECT set_config('request.jwt.claim.sub', 'aaaaaaaa-0000-0000-0000-000000000002', true);
SELECT set_config('request.jwt.claim.role', 'authenticated', true);

SELECT is(
  (SELECT count(*)::int FROM public.review_responses),
  1,
  'chef with view:reviews reads the response'
);

SELECT throws_like(
  $$INSERT INTO public.review_responses (restaurant_id, review_page_id, rating, routed_to)
    VALUES ('11111111-0000-0000-0000-000000000001',
            '22222222-0000-0000-0000-000000000001', 5, 'destination')$$,
  '%permission denied%',
  'authenticated has no INSERT grant at all — a restaurant cannot fake a five-star rating'
);

SELECT is(
  (SELECT count(*)::int FROM public.review_responses
   WHERE status = 'new'),
  1,
  'the response starts in the new status'
);

-- Switch to the owner, who does hold manage:reviews, so what is being tested
-- below is the column grant and not the RLS policy: with a table-level UPDATE
-- grant both of these would succeed and a manager could rewrite the ratings
-- behind their own metrics.
SELECT set_config('request.jwt.claims', '{"sub":"aaaaaaaa-0000-0000-0000-000000000001","role":"authenticated"}', true);
SELECT set_config('request.jwt.claim.sub', 'aaaaaaaa-0000-0000-0000-000000000001', true);

SELECT throws_like(
  $$UPDATE public.review_responses SET rating = 5
    WHERE id = '33333333-0000-0000-0000-000000000001'$$,
  '%permission denied%',
  'a reviews manager cannot PATCH rating — UPDATE is granted on the status column only'
);

SELECT lives_ok(
  $$UPDATE public.review_responses SET status = 'resolved'
    WHERE id = '33333333-0000-0000-0000-000000000001'$$,
  'the same manager can still move status, which is what triage actually does'
);

-- `service_role` carries rolbypassrls, so no policy constrains it and the table
-- ACL is the only control left. Its UPDATE is column-scoped to the three
-- columns handleComment writes; a leaked service key must not be able to turn a
-- one-star complaint into a five-star rave inside the restaurant's own metrics.
--
-- These assertions are the reason 20260804120000 revokes before it grants.
-- Production creates every public table with `ALTER DEFAULT PRIVILEGES … GRANT
-- ALL ON TABLES TO service_role` already in force, so the narrow grants are
-- inert unless the broad one is taken away first — and that difference is
-- invisible on a bare local Postgres, which has no default privileges to
-- revoke. This block failed in CI and passed locally before the revoke landed.
SET LOCAL role TO postgres;

SELECT is(
  has_column_privilege('service_role', 'public.review_responses', 'rating', 'UPDATE'),
  FALSE,
  'service_role cannot UPDATE rating'
);

SELECT is(
  has_column_privilege('service_role', 'public.review_responses', 'comment', 'UPDATE'),
  TRUE,
  'service_role can UPDATE comment, which is the one write the public form makes'
);

-- review-public never deletes, so DELETE has no reason to be inside the blast
-- radius of a leaked key: erasing a restaurant's feedback history would be
-- unrecoverable and leave no INSERT behind to show it happened.
SELECT is(
  has_table_privilege('service_role', 'public.review_responses', 'DELETE'),
  FALSE,
  'service_role cannot DELETE a response'
);

-- handlePage reads pages; it never edits them. Page edits are the manager's,
-- through `authenticated` and RLS.
SELECT is(
  has_table_privilege('service_role', 'public.review_pages', 'UPDATE'),
  FALSE,
  'service_role cannot UPDATE a page'
);

-- Contacts are write-only for the public form: handleComment files an email
-- address, and reading them back is the inbox's job, under RLS.
SELECT is(
  has_table_privilege('service_role', 'public.review_response_contacts', 'SELECT'),
  FALSE,
  'service_role cannot read the contact rows it writes'
);

SELECT * FROM finish();
ROLLBACK;
