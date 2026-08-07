-- pgTAP tests for review_response_submit_followup, the service-role-only RPC
-- that review-public's handleComment calls to write the guest follow-up.
--
-- Coverage:
--   1-3. a contact-only write (no comment, consent, name + email) reports
--      true, stamps commented_at, and stores the guest email
--   4. the trigger still derives review_response_contacts.restaurant_id
--   5-6. a replay (commented_at already set) updates zero rows, returns
--      false, and leaves the first contact row untouched
--   7-8. a failed contact insert (forced primary-key collision) raises
--      instead of swallowing the error, and rolls the UPDATE back too, so
--      commented_at stays NULL and a retry can work
--   9-10. authenticated has no EXECUTE privilege (service_role only)

BEGIN;
SELECT plan(10);

-- Fixture: one page in restaurant A, three responses ready for a follow-up.
INSERT INTO public.restaurants (id, name) VALUES
  ('11111111-0000-0000-0000-000000000001', 'Restaurant A');

SET LOCAL role TO postgres;

INSERT INTO public.review_pages (id, restaurant_id, slug, name)
VALUES ('22222222-0000-0000-0000-000000000001',
        '11111111-0000-0000-0000-000000000001', 'counter-a', 'Table tents');

INSERT INTO public.review_responses
  (id, restaurant_id, review_page_id, rating, routed_to)
VALUES
  ('33333333-0000-0000-0000-000000000001',
   '11111111-0000-0000-0000-000000000001',
   '22222222-0000-0000-0000-000000000001', 5, 'destination'),
  ('33333333-0000-0000-0000-000000000002',
   '11111111-0000-0000-0000-000000000001',
   '22222222-0000-0000-0000-000000000001', 4, 'destination'),
  ('33333333-0000-0000-0000-000000000003',
   '11111111-0000-0000-0000-000000000001',
   '22222222-0000-0000-0000-000000000001', 3, 'feedback');

-- ---------- 1-3. contact-only write stores both rows ----------
SELECT is(
  public.review_response_submit_followup(
    '33333333-0000-0000-0000-000000000001'::uuid,
    NULL, TRUE, 'Dana Guest', 'dana@example.test'
  ),
  TRUE,
  'a contact-only write reports true'
);

SELECT is(
  (SELECT commented_at IS NOT NULL FROM public.review_responses
   WHERE id = '33333333-0000-0000-0000-000000000001'),
  TRUE,
  'the response is stamped commented_at even with no comment text'
);

SELECT is(
  (SELECT contact_email FROM public.review_response_contacts
   WHERE review_response_id = '33333333-0000-0000-0000-000000000001'),
  'dana@example.test',
  'the guest email is stored, not lost'
);

-- ---------- 4. the trigger still derives restaurant_id ----------
SELECT is(
  (SELECT restaurant_id FROM public.review_response_contacts
   WHERE review_response_id = '33333333-0000-0000-0000-000000000001'),
  '11111111-0000-0000-0000-000000000001'::uuid,
  'the contacts trigger still derives restaurant_id from the response'
);

-- ---------- 5-6. a replay updates zero rows and leaves the row alone ----------
SELECT is(
  public.review_response_submit_followup(
    '33333333-0000-0000-0000-000000000001'::uuid,
    NULL, TRUE, 'Someone Else', 'someone-else@example.test'
  ),
  FALSE,
  'a replay against an already-commented row reports false'
);

SELECT is(
  (SELECT contact_email FROM public.review_response_contacts
   WHERE review_response_id = '33333333-0000-0000-0000-000000000001'),
  'dana@example.test',
  'the replay does not overwrite the first guest email'
);

-- ---------- 7-8. a failed contact insert rolls back the UPDATE too ----------
-- Pre-seed the target contact row so the RPC's own INSERT hits the primary
-- key. review_response_id is the primary key, so the collision is
-- guaranteed regardless of any other constraint on the table.
INSERT INTO public.review_response_contacts
  (review_response_id, restaurant_id, contact_name, contact_email)
VALUES
  ('33333333-0000-0000-0000-000000000002',
   '00000000-0000-0000-0000-000000000000', -- trigger overwrites
   'Existing Row', 'existing@example.test');

SELECT throws_like(
  $$SELECT public.review_response_submit_followup(
      '33333333-0000-0000-0000-000000000002'::uuid,
      NULL, TRUE, 'Second Attempt', 'second@example.test'
    )$$,
  '%duplicate key%',
  'a contact insert that collides raises, rather than swallowing the error'
);

SELECT is(
  (SELECT commented_at FROM public.review_responses
   WHERE id = '33333333-0000-0000-0000-000000000002'),
  NULL::timestamptz,
  'the failed insert rolls the UPDATE back too, so commented_at stays NULL for a retry'
);

-- ---------- 9-10. authenticated has no EXECUTE (service_role only) ----------
SELECT ok(
  has_function_privilege(
    'service_role',
    'public.review_response_submit_followup(uuid,text,boolean,text,text)',
    'EXECUTE'
  ),
  'service_role can execute review_response_submit_followup'
);

SELECT ok(
  NOT has_function_privilege(
    'authenticated',
    'public.review_response_submit_followup(uuid,text,boolean,text,text)',
    'EXECUTE'
  ),
  'authenticated cannot execute review_response_submit_followup'
);

SELECT * FROM finish();
ROLLBACK;
