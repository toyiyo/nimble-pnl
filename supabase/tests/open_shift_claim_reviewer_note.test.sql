-- reviewer_note persistence for approve/reject. Fixture structure mirrors
-- 61_approve_open_shift_claim_active_guard.test.sql (RLS disabled in-txn,
-- SECURITY DEFINER functions run as postgres, dynamic CURRENT_DATE+N, two
-- pending claims for two employees since the unique index forbids two active
-- claims for the same employee/template/date).

BEGIN;
SELECT plan(4);

SET LOCAL role TO postgres;
ALTER TABLE public.restaurants        DISABLE ROW LEVEL SECURITY;
ALTER TABLE public.employees          DISABLE ROW LEVEL SECURITY;
ALTER TABLE public.shifts             DISABLE ROW LEVEL SECURITY;
ALTER TABLE public.shift_templates    DISABLE ROW LEVEL SECURITY;
ALTER TABLE public.open_shift_claims  DISABLE ROW LEVEL SECURITY;

DO $$
DECLARE
  v_rid   uuid := '00000000-0000-0000-0000-0000000000fa';
  v_emp1  uuid := '00000000-0000-0000-0000-0000000000f1';
  v_emp2  uuid := '00000000-0000-0000-0000-0000000000f2';
  v_tmpl  uuid := '00000000-0000-0000-0000-0000000000f3';
  v_c1    uuid := '00000000-0000-0000-0000-0000000000f5';
  v_c2    uuid := '00000000-0000-0000-0000-0000000000f6';
  v_d     date := CURRENT_DATE + 5;
  v_dow   int;
BEGIN
  v_dow := EXTRACT(DOW FROM v_d)::int;

  DELETE FROM public.open_shift_claims WHERE restaurant_id = v_rid;
  DELETE FROM public.shifts            WHERE restaurant_id = v_rid;
  DELETE FROM public.shift_templates   WHERE restaurant_id = v_rid;
  DELETE FROM public.employees         WHERE restaurant_id = v_rid;
  DELETE FROM public.restaurants       WHERE id = v_rid;

  INSERT INTO public.restaurants(id, name, timezone)
    VALUES (v_rid, 'note-persist-test', 'America/Chicago')
    ON CONFLICT (id) DO UPDATE SET timezone = EXCLUDED.timezone;

  INSERT INTO public.employees(id, restaurant_id, name, position, is_active, status)
    VALUES (v_emp1, v_rid, 'E1', 'Server', true, 'active'),
           (v_emp2, v_rid, 'E2', 'Server', true, 'active')
    ON CONFLICT (id) DO UPDATE SET position = EXCLUDED.position;

  INSERT INTO public.shift_templates(
      id, restaurant_id, name, start_time, end_time, position, capacity,
      days, is_active, break_duration
  ) VALUES (
      v_tmpl, v_rid, 'Server 12-18', '12:00'::time, '18:00'::time, 'Server', 2,
      ARRAY[v_dow], true, 0
  ) ON CONFLICT (id) DO UPDATE SET days = EXCLUDED.days, is_active = true;

  INSERT INTO public.open_shift_claims(
      id, restaurant_id, shift_template_id, shift_date, claimed_by_employee_id, status
  ) VALUES
      (v_c1, v_rid, v_tmpl, v_d, v_emp1, 'pending_approval'),
      (v_c2, v_rid, v_tmpl, v_d, v_emp2, 'pending_approval');
END $$;

-- Approve with a note.
SELECT is(
  (public.approve_open_shift_claim('00000000-0000-0000-0000-0000000000f5'::uuid,
     'Approved: welcome aboard') ->> 'success'),
  'true',
  'approve_open_shift_claim succeeds with a reviewer note');

SELECT is(
  (SELECT reviewer_note FROM public.open_shift_claims
   WHERE id = '00000000-0000-0000-0000-0000000000f5'),
  'Approved: welcome aboard',
  'approve persists reviewer_note');

-- Reject with a note.
SELECT is(
  (public.reject_open_shift_claim('00000000-0000-0000-0000-0000000000f6'::uuid,
     'Rejected: already covered') ->> 'success'),
  'true',
  'reject_open_shift_claim succeeds with a reviewer note');

SELECT is(
  (SELECT reviewer_note FROM public.open_shift_claims
   WHERE id = '00000000-0000-0000-0000-0000000000f6'),
  'Rejected: already covered',
  'reject persists reviewer_note');

SELECT * FROM finish();
ROLLBACK;
