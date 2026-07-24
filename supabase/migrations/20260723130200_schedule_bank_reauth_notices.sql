-- Phase 4 Task 14 of the bank re-authentication flow
-- (docs/superpowers/specs/2026-07-23-bank-reauth-flow-design.md §4.6).
--
-- Three brand-new, service-role-only helper RPCs for the bank-reauth-notices
-- worker, plus the daily pg_cron registration. None of these functions
-- existed before this migration, so there is no prior CREATE OR REPLACE
-- FUNCTION body to source (2026-07-20/2026-07-22 provenance lessons) — the
-- provenance is design §4.6, cited per function below. Each pins
-- `SET search_path = public, pg_temp` per design §4.6's explicit SECURITY
-- DEFINER note (2026-07-20 lesson).
--
-- Cron registration is modelled on 20260507120300_schedule_trial_expiry_emails.sql:
-- pg_cron + pg_net, the cron.unschedule-in-a-DO-block idempotency guard, the
-- same app.settings.supabase_url / app.settings.service_role_key GUCs,
-- 0 9 * * * (09:00 UTC daily).

-- ============================================================
-- Cohort A — still down (design §4.6, steps 1-3).
--
-- One row per connected_banks row currently quarantined with a live outage
-- clock. elapsed_days is UTC-anchored (calendar-date subtraction), matching
-- the trial-email convention (users_in_trial_email_window). sent_stages is
-- the set of non-'recovered' stages already sent for THIS outage — scoped
-- by deactivated_at, exactly as the bank_reauth_notices_once dedupe key is
-- — so a later, separate outage on the same bank starts its own ladder from
-- empty. The worker's TS layer (bankReauthStages.nextStage) turns
-- (sent_stages, elapsed_days) into the stage due right now, if any.
-- ============================================================

CREATE OR REPLACE FUNCTION public.bank_reauth_cohort_a_candidates()
RETURNS TABLE (
  connected_bank_id uuid,
  restaurant_id uuid,
  institution_name text,
  account_mask text,
  deactivated_at timestamptz,
  elapsed_days integer,
  sent_stages text[]
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT
    cb.id AS connected_bank_id,
    cb.restaurant_id,
    cb.institution_name,
    cb.account_mask,
    cb.deactivated_at,
    ((now() AT TIME ZONE 'UTC')::date - (cb.deactivated_at AT TIME ZONE 'UTC')::date)::integer AS elapsed_days,
    COALESCE(
      (
        SELECT array_agg(n.stage)
        FROM public.bank_reauth_notices n
        WHERE n.connected_bank_id = cb.id
          AND n.deactivated_at = cb.deactivated_at
          AND n.stage <> 'recovered'
      ),
      ARRAY[]::text[]
    ) AS sent_stages
  FROM public.connected_banks cb
  WHERE cb.status = 'requires_reauth'
    AND cb.deactivated_at IS NOT NULL;
$$;

COMMENT ON FUNCTION public.bank_reauth_cohort_a_candidates() IS
  'Cohort A (still down) candidates for the bank-reauth-notices worker: every quarantined bank with a live outage clock, its UTC-anchored elapsed_days, and the escalation stages already sent for this exact outage. Design: docs/superpowers/specs/2026-07-23-bank-reauth-flow-design.md §4.6. Caller: bank-reauth-notices edge function (service role only).';

REVOKE ALL ON FUNCTION public.bank_reauth_cohort_a_candidates() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.bank_reauth_cohort_a_candidates() FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION public.bank_reauth_cohort_a_candidates() TO service_role;

-- ============================================================
-- Cohort B — recovered (design §4.6). The reactivated/reconnect paths null
-- out connected_banks.deactivated_at, so by the time this worker runs there
-- is no outage timestamp left on the bank row to correlate against, and
-- cohort A's own query would never return a bank that is connected again
-- anyway. The recovery notice therefore sources its correlation key from
-- bank_reauth_notices, not from connected_banks — the WHERE/NOT EXISTS
-- shape below is design §4.6's SQL block verbatim (schema-qualified;
-- extended with institution_name / account_mask / data_current_through so
-- the worker can render the recovery email without a second round trip).
-- ============================================================

CREATE OR REPLACE FUNCTION public.bank_reauth_cohort_b_recovered()
RETURNS TABLE (
  connected_bank_id uuid,
  restaurant_id uuid,
  institution_name text,
  account_mask text,
  deactivated_at timestamptz,
  data_current_through timestamptz
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT
    n.connected_bank_id,
    cb.restaurant_id,
    cb.institution_name,
    cb.account_mask,
    n.deactivated_at,
    cb.data_current_through
  FROM (
    SELECT DISTINCT ON (connected_bank_id) connected_bank_id, deactivated_at
    FROM public.bank_reauth_notices
    WHERE stage <> 'recovered'
    ORDER BY connected_bank_id, deactivated_at DESC, sent_at DESC
  ) n
  JOIN public.connected_banks cb ON cb.id = n.connected_bank_id
  WHERE cb.status = 'connected'
    AND NOT EXISTS (
      SELECT 1 FROM public.bank_reauth_notices r
      WHERE r.connected_bank_id = n.connected_bank_id
        AND r.stage = 'recovered'
        AND r.deactivated_at = n.deactivated_at
    );
$$;

COMMENT ON FUNCTION public.bank_reauth_cohort_b_recovered() IS
  'Cohort B (recovered) candidates for the bank-reauth-notices worker: the most recent outage we told someone about, for a bank that is healthy again and whose recovery we have not yet acknowledged. Design: docs/superpowers/specs/2026-07-23-bank-reauth-flow-design.md §4.6. Caller: bank-reauth-notices edge function (service role only).';

REVOKE ALL ON FUNCTION public.bank_reauth_cohort_b_recovered() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.bank_reauth_cohort_b_recovered() FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION public.bank_reauth_cohort_b_recovered() TO service_role;

-- ============================================================
-- Recipients — owners/managers for a restaurant, filtered by the roles the
-- current stage calls for (design §4.6's recipients table: day_1/day_4/
-- recovered → owner+manager, day_10 → owner only). Modelled on
-- users_in_trial_email_window's user_restaurants + auth.users + profiles
-- join (20260507120200_users_in_trial_email_window_rpc.sql). Deliberately
-- does not filter out a NULL email here — push delivery only needs
-- user_id, so that filter belongs to the caller's per-channel branching,
-- not this RPC.
-- ============================================================

CREATE OR REPLACE FUNCTION public.bank_reauth_notice_recipients(
  p_restaurant_id uuid,
  p_roles text[]
)
RETURNS TABLE (
  user_id uuid,
  email text,
  full_name text,
  role text
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT
    ur.user_id,
    u.email::text AS email,
    COALESCE(p.full_name, u.raw_user_meta_data->>'full_name', '')::text AS full_name,
    ur.role::text AS role
  FROM public.user_restaurants ur
  JOIN auth.users u ON u.id = ur.user_id
  LEFT JOIN public.profiles p ON p.user_id = u.id
  WHERE ur.restaurant_id = p_restaurant_id
    AND ur.role = ANY(p_roles);
$$;

COMMENT ON FUNCTION public.bank_reauth_notice_recipients(uuid, text[]) IS
  'Owner/manager recipients for a restaurant, filtered by the roles the current escalation stage calls for. Design: docs/superpowers/specs/2026-07-23-bank-reauth-flow-design.md §4.6. Caller: bank-reauth-notices edge function (service role only).';

REVOKE ALL ON FUNCTION public.bank_reauth_notice_recipients(uuid, text[]) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.bank_reauth_notice_recipients(uuid, text[]) FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION public.bank_reauth_notice_recipients(uuid, text[]) TO service_role;

-- ============================================================
-- Daily cron for the bank-reauth-notices worker. Fires at 09:00 UTC every
-- day, same slot as trial-expiry-emails. The edge function does its own
-- dedupe via bank_reauth_notices (ON CONFLICT DO NOTHING on the
-- bank_reauth_notices_once constraint), so re-firing is safe.
-- ============================================================

CREATE EXTENSION IF NOT EXISTS pg_cron;
CREATE EXTENSION IF NOT EXISTS pg_net;

GRANT USAGE ON SCHEMA cron TO postgres;

-- Idempotency: drop any earlier registration before re-scheduling.
DO $$
BEGIN
  PERFORM cron.unschedule('bank-reauth-notices');
EXCEPTION
  WHEN OTHERS THEN
    -- job didn't exist; first deploy of this migration
    NULL;
END $$;

SELECT cron.schedule(
  'bank-reauth-notices',
  '0 9 * * *',
  $$
  SELECT net.http_post(
    url := current_setting('app.settings.supabase_url') || '/functions/v1/bank-reauth-notices',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || current_setting('app.settings.service_role_key')
    ),
    body := '{}'::jsonb
  );
  $$
);

COMMENT ON EXTENSION pg_cron IS
  'Bank-reauth escalation sequence runs daily at 09:00 UTC. RPCs encapsulate cohort selection + dedupe.';
