-- pgTAP coverage for the UNIQUE(restaurant_id, user_id, email_type) constraint
-- on public.trial_emails_sent. The dedupe gate in
-- supabase/functions/_shared/trialExpiryEmailsHandler.ts depends on this:
-- the candidate-selection RPC excludes rows already present here, but the
-- INSERT path itself is what protects against double-sends if two cron
-- invocations race or a manual backfill overlaps a scheduled run. If the
-- UNIQUE drops, dedupe silently breaks. Lock it in.

BEGIN;

SELECT plan(2);

SET LOCAL role TO postgres;

ALTER TABLE public.trial_emails_sent DISABLE ROW LEVEL SECURITY;
ALTER TABLE public.restaurants DISABLE ROW LEVEL SECURITY;

CREATE TEMP TABLE _ids AS
SELECT
  '00000000-0000-0000-0000-0000000c0001'::uuid AS u_one,
  '00000000-0000-0000-0000-0000000c0002'::uuid AS r_one;

DELETE FROM public.trial_emails_sent WHERE restaurant_id = (SELECT r_one FROM _ids);
DELETE FROM public.restaurants       WHERE id            = (SELECT r_one FROM _ids);
DELETE FROM auth.users               WHERE id            = (SELECT u_one FROM _ids);

INSERT INTO auth.users
  (id, instance_id, aud, role, email, encrypted_password,
   email_confirmed_at, created_at, updated_at,
   confirmation_token, recovery_token, email_change_token_new, email_change)
SELECT
  u_one, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
  'unique-test@example.com', crypt('password123', gen_salt('bf')),
  now(), now(), now(),
  '', '', '', ''
FROM _ids;

INSERT INTO public.restaurants (id, name, created_at, subscription_status)
SELECT r_one, 'R Unique Test', now() - INTERVAL '7 days', 'trialing' FROM _ids;

-- First insert succeeds.
SELECT lives_ok(
  $$
    INSERT INTO public.trial_emails_sent
      (restaurant_id, user_id, email_type, variant, trial_day_at_send)
    SELECT r_one, u_one, 'halfway', 'not_activated', 7 FROM _ids
  $$,
  'first (restaurant_id, user_id, email_type) row inserts cleanly'
);

-- Second insert with the same triple must throw.
-- 23505 = unique_violation
SELECT throws_ok(
  $$
    INSERT INTO public.trial_emails_sent
      (restaurant_id, user_id, email_type, variant, trial_day_at_send)
    SELECT r_one, u_one, 'halfway', 'activated', 7 FROM _ids
  $$,
  '23505',
  NULL,
  'duplicate (restaurant_id, user_id, email_type) raises unique_violation'
);

SELECT * FROM finish();
ROLLBACK;
