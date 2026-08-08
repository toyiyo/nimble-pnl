-- TZ sweep cluster F (bank re-auth notice dates,
-- .superpowers/sdd/tz-f-bank-reauth-brief.md).
--
-- `bank_reauth_notice_content.ts` renders `deactivated_at` /
-- `data_current_through` (both `timestamptz` — genuine instants, not stored
-- calendar days) via a date formatter with no timezone override, so the
-- rendered day depended on the edge function runtime's local zone instead of
-- the restaurant's. Case (b) per the sweep's dispatch rule
-- (.superpowers/sdd/tz-sweep-common.md): route through the restaurant's own
-- timezone, not the server's.
--
-- The restaurant's timezone was never selected by either cohort RPC, so the
-- TS layer had nothing to plumb through. This migration adds
-- `restaurant_timezone` (sourced from `restaurants.timezone`, same column
-- already used by the availability-conflict and Revel sold_at timezone
-- fixes) to both cohort candidate functions.
--
-- RETURNS TABLE shape is changing, so each function is dropped before being
-- recreated (CREATE OR REPLACE FUNCTION cannot alter the output column list),
-- matching the pattern in 20251122170000_fix_split_pos_sale_cleanup.sql.

DROP FUNCTION IF EXISTS public.bank_reauth_cohort_a_candidates();

CREATE OR REPLACE FUNCTION public.bank_reauth_cohort_a_candidates()
RETURNS TABLE (
  connected_bank_id uuid,
  restaurant_id uuid,
  institution_name text,
  account_mask text,
  deactivated_at timestamptz,
  elapsed_days integer,
  sent_stages text[],
  restaurant_timezone text
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
    ) AS sent_stages,
    r.timezone AS restaurant_timezone
  FROM public.connected_banks cb
  LEFT JOIN public.restaurants r ON r.id = cb.restaurant_id
  WHERE cb.status = 'requires_reauth'
    AND cb.deactivated_at IS NOT NULL;
$$;

COMMENT ON FUNCTION public.bank_reauth_cohort_a_candidates() IS
  'Cohort A (still down) candidates for the bank-reauth-notices worker: every quarantined bank with a live outage clock, its UTC-anchored elapsed_days, the escalation stages already sent for this exact outage, and the restaurant''s IANA timezone for rendering notice dates. Design: docs/superpowers/specs/2026-07-23-bank-reauth-flow-design.md §4.6. Caller: bank-reauth-notices edge function (service role only).';

REVOKE ALL ON FUNCTION public.bank_reauth_cohort_a_candidates() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.bank_reauth_cohort_a_candidates() FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION public.bank_reauth_cohort_a_candidates() TO service_role;

DROP FUNCTION IF EXISTS public.bank_reauth_cohort_b_recovered();

CREATE OR REPLACE FUNCTION public.bank_reauth_cohort_b_recovered()
RETURNS TABLE (
  connected_bank_id uuid,
  restaurant_id uuid,
  institution_name text,
  account_mask text,
  deactivated_at timestamptz,
  data_current_through timestamptz,
  restaurant_timezone text
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
    cb.data_current_through,
    r.timezone AS restaurant_timezone
  FROM (
    SELECT DISTINCT ON (connected_bank_id) connected_bank_id, deactivated_at
    FROM public.bank_reauth_notices
    WHERE stage <> 'recovered'
    ORDER BY connected_bank_id, deactivated_at DESC, sent_at DESC
  ) n
  JOIN public.connected_banks cb ON cb.id = n.connected_bank_id
  LEFT JOIN public.restaurants r ON r.id = cb.restaurant_id
  WHERE cb.status = 'connected'
    AND NOT EXISTS (
      SELECT 1 FROM public.bank_reauth_notices r2
      WHERE r2.connected_bank_id = n.connected_bank_id
        AND r2.stage = 'recovered'
        AND r2.deactivated_at = n.deactivated_at
    );
$$;

COMMENT ON FUNCTION public.bank_reauth_cohort_b_recovered() IS
  'Cohort B (recovered) candidates for the bank-reauth-notices worker: the most recent outage we told someone about, for a bank that is healthy again and whose recovery we have not yet acknowledged, plus the restaurant''s IANA timezone for rendering notice dates. Design: docs/superpowers/specs/2026-07-23-bank-reauth-flow-design.md §4.6. Caller: bank-reauth-notices edge function (service role only).';

REVOKE ALL ON FUNCTION public.bank_reauth_cohort_b_recovered() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.bank_reauth_cohort_b_recovered() FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION public.bank_reauth_cohort_b_recovered() TO service_role;
