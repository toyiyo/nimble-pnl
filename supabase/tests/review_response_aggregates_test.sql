BEGIN;
SELECT plan(6);

-- Fixture: one page in restaurant A with four responses — one commented, one
-- contact-only, two silent — plus an owner (manage:reviews) and an outsider
-- with no restaurant at all.
INSERT INTO auth.users (id, email) VALUES
  ('aaaaaaaa-0000-0000-0000-000000000001', 'owner-a@test.local'),
  ('aaaaaaaa-0000-0000-0000-000000000099', 'outsider@test.local');

INSERT INTO public.restaurants (id, name) VALUES
  ('11111111-0000-0000-0000-000000000001', 'Restaurant A');

-- role_id, not the legacy `role` string: the legacy CASE has no reviews arm.
INSERT INTO public.user_restaurants (user_id, restaurant_id, role, role_id) VALUES
  ('aaaaaaaa-0000-0000-0000-000000000001', '11111111-0000-0000-0000-000000000001',
   'owner', 'b0000000-0000-0000-0000-000000000001');

SET LOCAL role TO postgres;
INSERT INTO public.review_pages (id, restaurant_id, slug, name)
VALUES ('22222222-0000-0000-0000-000000000001',
        '11111111-0000-0000-0000-000000000001', 'counter-a', 'Table tents');

INSERT INTO public.review_responses
  (id, restaurant_id, review_page_id, rating, routed_to, comment, contact_consent, status)
VALUES
  ('33333333-0000-0000-0000-000000000001',
   '11111111-0000-0000-0000-000000000001',
   '22222222-0000-0000-0000-000000000001', 5, 'destination', NULL, false, 'new'),
  ('33333333-0000-0000-0000-000000000002',
   '11111111-0000-0000-0000-000000000001',
   '22222222-0000-0000-0000-000000000001', 2, 'feedback', 'The soup was cold', false, 'new'),
  ('33333333-0000-0000-0000-000000000003',
   '11111111-0000-0000-0000-000000000001',
   '22222222-0000-0000-0000-000000000001', 4, 'destination', NULL, false, 'resolved'),
  -- A promoter who left an email and no comment. The guest asked to hear
  -- back, so the row is actionable and must reach the Unread badge.
  ('33333333-0000-0000-0000-000000000004',
   '11111111-0000-0000-0000-000000000001',
   '22222222-0000-0000-0000-000000000001', 5, 'destination', NULL, true, 'new');

SET LOCAL role TO authenticated;
SELECT set_config('request.jwt.claims', '{"sub":"aaaaaaaa-0000-0000-0000-000000000001","role":"authenticated"}', true);
SELECT set_config('request.jwt.claim.sub', 'aaaaaaaa-0000-0000-0000-000000000001', true);
SELECT set_config('request.jwt.claim.role', 'authenticated', true);

SELECT is(
  (SELECT average_rating FROM public.review_response_metrics('11111111-0000-0000-0000-000000000001')),
  4.0::numeric,
  'review_response_metrics averages every rating, not just commented ones ((5+2+4+5)/4 = 4.0)'
);

SELECT is(
  (SELECT total_ratings FROM public.review_response_metrics('11111111-0000-0000-0000-000000000001')),
  4::bigint,
  'review_response_metrics counts all four responses, unbounded by any row cap'
);

SELECT is(
  (SELECT comment_count FROM public.review_response_metrics('11111111-0000-0000-0000-000000000001')),
  1::bigint,
  'review_response_metrics counts only the one commented response'
);

-- Three rows are status 'new': a comment, a contact-only submit, and a
-- silent five-star tap. The first two need a reply. The third needs no
-- triage, so counting it would put a badge on the tab that the manager has
-- no row to act on and no way to clear.
SELECT is(
  (SELECT unread_count FROM public.review_response_metrics('11111111-0000-0000-0000-000000000001')),
  2::bigint,
  'review_response_metrics counts a new comment and a new contact-only row, not a silent tap'
);

SELECT is(
  (SELECT rating_count FROM public.review_page_stats('11111111-0000-0000-0000-000000000001')
   WHERE review_page_id = '22222222-0000-0000-0000-000000000001'),
  4::bigint,
  'review_page_stats aggregates per page via GROUP BY, not per-card round trips'
);

-- Outsider has no user_restaurants row at all, so view:reviews is false and
-- RLS filters out every row before the aggregate runs. A bare aggregate with
-- no GROUP BY still returns one row (that is how SQL aggregates work), but
-- its total_ratings is 0, not restaurant A's real count — not another
-- tenant's numbers.
SELECT set_config('request.jwt.claims', '{"sub":"aaaaaaaa-0000-0000-0000-000000000099","role":"authenticated"}', true);
SELECT set_config('request.jwt.claim.sub', 'aaaaaaaa-0000-0000-0000-000000000099', true);

SELECT is(
  (SELECT total_ratings FROM public.review_response_metrics('11111111-0000-0000-0000-000000000001')),
  0::bigint,
  'a user with no view:reviews on the restaurant gets a zeroed aggregate, not its numbers'
);

SELECT * FROM finish();
ROLLBACK;
