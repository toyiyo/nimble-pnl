-- Deposit Match: one adapter function per POS source, plus a dispatcher.
--
-- Each adapter has the fixed signature:
--   deposit_match_source_<source>(p_restaurant_id, p_start, p_end, p_config)
--     RETURNS TABLE (business_date date, expected_amount numeric, row_count int)
--
-- These functions have NO caller-identity check. They trust the
-- p_restaurant_id argument and filter every table read by it. This is the
-- "internal engine" tier of the internal/public split
-- (memory/lessons.md:904): the capability check lives in the public wrapper
-- (refresh_deposit_matches / get_deposit_match_report, Task 3), never here.
-- EXECUTE is revoked from PUBLIC, anon, and authenticated on every function
-- below. A plain REVOKE ... FROM PUBLIC is not enough on this project: the
-- public schema carries a default ACL that grants EXECUTE on every new
-- function to anon and authenticated at creation time, so the grant must be
-- revoked from both roles by name. Otherwise an authenticated user could
-- call an adapter directly and read another restaurant's totals by
-- guessing its id (memory/lessons.md:1933, 2026-07-29).

-- ─────────────────────────────────────────────────────────────────────
-- focus: sum focus_payments.amount for the configured card tender names.
-- amount already includes the tip (settlement proved gross on production).
-- ─────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.deposit_match_source_focus(
  p_restaurant_id uuid, p_start date, p_end date, p_config jsonb
) RETURNS TABLE (business_date date, expected_amount numeric, row_count int)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
STABLE
AS $$
DECLARE
  v_tender_names text[];
BEGIN
  IF NOT (p_config ? 'card_tender_names') THEN
    RAISE EXCEPTION 'deposit_match_source_focus: source_config is missing required key "card_tender_names"';
  END IF;
  SELECT array_agg(v) INTO v_tender_names
  FROM jsonb_array_elements_text(p_config->'card_tender_names') AS v;
  -- An empty array (`[]`) is present, so the key-absent guard above does
  -- not catch it, but array_agg over zero rows returns NULL, which makes
  -- `= ANY(v_tender_names)` NULL for every row — a silent zero total, not
  -- a raised error. The design bars exactly this ("a missing key must not
  -- read as a zero card total").
  IF v_tender_names IS NULL OR array_length(v_tender_names, 1) = 0 THEN
    RAISE EXCEPTION 'deposit_match_source_focus: source_config "card_tender_names" is empty; add at least one tender name';
  END IF;

  RETURN QUERY
  SELECT fp.business_date, SUM(fp.amount)::numeric AS expected_amount, COUNT(*)::int AS row_count
  FROM public.focus_payments fp
  WHERE fp.restaurant_id = p_restaurant_id
    AND fp.business_date BETWEEN p_start AND p_end
    AND fp.name = ANY(v_tender_names)
  GROUP BY fp.business_date;
END;
$$;

REVOKE ALL ON FUNCTION public.deposit_match_source_focus(uuid, date, date, jsonb) FROM PUBLIC, anon, authenticated;

-- ─────────────────────────────────────────────────────────────────────
-- toast: sum amount + tip_amount for the configured card payment_type.
-- ─────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.deposit_match_source_toast(
  p_restaurant_id uuid, p_start date, p_end date, p_config jsonb
) RETURNS TABLE (business_date date, expected_amount numeric, row_count int)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
STABLE
AS $$
DECLARE
  v_payment_type text;
BEGIN
  IF NOT (p_config ? 'card_payment_type') THEN
    RAISE EXCEPTION 'deposit_match_source_toast: source_config is missing required key "card_payment_type"';
  END IF;
  v_payment_type := p_config->>'card_payment_type';

  RETURN QUERY
  SELECT tp.payment_date, SUM(tp.amount + COALESCE(tp.tip_amount, 0))::numeric AS expected_amount,
         COUNT(*)::int AS row_count
  FROM public.toast_payments tp
  WHERE tp.restaurant_id = p_restaurant_id
    AND tp.payment_date BETWEEN p_start AND p_end
    AND tp.payment_type = v_payment_type
  GROUP BY tp.payment_date;
END;
$$;

REVOKE ALL ON FUNCTION public.deposit_match_source_toast(uuid, date, date, jsonb) FROM PUBLIC, anon, authenticated;

-- ─────────────────────────────────────────────────────────────────────
-- square: card payments minus card refunds, keyed on raw_json->>'source_type'
-- (Task 0 finding, 2026-09-01). Neither table has a business_date column;
-- created_at is cast to date. row_count covers both payment and refund rows.
-- The WHERE clause bounds created_at with a timestamptz range instead of
-- casting created_at::date, so the composite (restaurant_id, created_at)
-- index (20260901170000_deposit_match_square_perf.sql) stays sargable —
-- a ::date cast on the column would force a full-history scan per refresh.
-- ─────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.deposit_match_source_square(
  p_restaurant_id uuid, p_start date, p_end date, p_config jsonb
) RETURNS TABLE (business_date date, expected_amount numeric, row_count int)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
STABLE
AS $$
DECLARE
  v_source_types text[];
BEGIN
  IF NOT (p_config ? 'card_source_types') THEN
    RAISE EXCEPTION 'deposit_match_source_square: source_config is missing required key "card_source_types"';
  END IF;
  SELECT array_agg(v) INTO v_source_types
  FROM jsonb_array_elements_text(p_config->'card_source_types') AS v;
  -- An empty array (`[]`) is present, so the key-absent guard above does
  -- not catch it, but array_agg over zero rows returns NULL, which makes
  -- `= ANY(v_source_types)` NULL for every row — a silent zero total, not
  -- a raised error. The design bars exactly this ("a missing key must not
  -- read as a zero card total").
  IF v_source_types IS NULL OR array_length(v_source_types, 1) = 0 THEN
    RAISE EXCEPTION 'deposit_match_source_square: source_config "card_source_types" is empty; add at least one source type';
  END IF;

  RETURN QUERY
  SELECT d.business_date, SUM(d.amount)::numeric AS expected_amount, COUNT(*)::int AS row_count
  FROM (
    SELECT (sp.created_at::date) AS business_date, sp.amount_money AS amount
    FROM public.square_payments sp
    WHERE sp.restaurant_id = p_restaurant_id
      AND sp.created_at >= p_start::timestamptz
      AND sp.created_at < (p_end + 1)::timestamptz
      AND (sp.raw_json->>'source_type') = ANY(v_source_types)
    UNION ALL
    SELECT (sr.created_at::date) AS business_date, -sr.amount_money AS amount
    FROM public.square_refunds sr
    WHERE sr.restaurant_id = p_restaurant_id
      AND sr.created_at >= p_start::timestamptz
      AND sr.created_at < (p_end + 1)::timestamptz
      AND (sr.raw_json->>'source_type') = ANY(v_source_types)
  ) d
  GROUP BY d.business_date;
END;
$$;

REVOKE ALL ON FUNCTION public.deposit_match_source_square(uuid, date, date, jsonb) FROM PUBLIC, anon, authenticated;

-- ─────────────────────────────────────────────────────────────────────
-- revel: sum amount + tip_amount for the configured payment_type values.
-- ─────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.deposit_match_source_revel(
  p_restaurant_id uuid, p_start date, p_end date, p_config jsonb
) RETURNS TABLE (business_date date, expected_amount numeric, row_count int)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
STABLE
AS $$
DECLARE
  v_payment_types text[];
BEGIN
  IF NOT (p_config ? 'card_payment_types') THEN
    RAISE EXCEPTION 'deposit_match_source_revel: source_config is missing required key "card_payment_types"';
  END IF;
  SELECT array_agg(v) INTO v_payment_types
  FROM jsonb_array_elements_text(p_config->'card_payment_types') AS v;
  -- An empty array (`[]`) is present, so the key-absent guard above does
  -- not catch it, but array_agg over zero rows returns NULL, which makes
  -- `= ANY(v_payment_types)` NULL for every row — a silent zero total, not
  -- a raised error. The design bars exactly this ("a missing key must not
  -- read as a zero card total").
  IF v_payment_types IS NULL OR array_length(v_payment_types, 1) = 0 THEN
    RAISE EXCEPTION 'deposit_match_source_revel: source_config "card_payment_types" is empty; add at least one payment type';
  END IF;

  RETURN QUERY
  SELECT rp.payment_date, SUM(rp.amount + COALESCE(rp.tip_amount, 0))::numeric AS expected_amount,
         COUNT(*)::int AS row_count
  FROM public.revel_payments rp
  WHERE rp.restaurant_id = p_restaurant_id
    AND rp.payment_date BETWEEN p_start AND p_end
    AND rp.payment_type = ANY(v_payment_types)
  GROUP BY rp.payment_date;
END;
$$;

REVOKE ALL ON FUNCTION public.deposit_match_source_revel(uuid, date, date, jsonb) FROM PUBLIC, anon, authenticated;

-- ─────────────────────────────────────────────────────────────────────
-- shift4: charges minus refunds by service_date. Amounts are stored in
-- cents (see 20251113200000_shift4_integration.sql), converted to dollars
-- the same way the unified_sales sync does it (that migration, lines
-- 394/435/488). No source_config key: shift4_charges holds only card
-- charges, so no tender filter applies.
-- ─────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.deposit_match_source_shift4(
  p_restaurant_id uuid, p_start date, p_end date, p_config jsonb
) RETURNS TABLE (business_date date, expected_amount numeric, row_count int)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
STABLE
AS $$
BEGIN
  RETURN QUERY
  SELECT d.business_date, SUM(d.amount)::numeric AS expected_amount, COUNT(*)::int AS row_count
  FROM (
    SELECT sc.service_date AS business_date, (sc.amount / 100.0) AS amount
    FROM public.shift4_charges sc
    WHERE sc.restaurant_id = p_restaurant_id
      AND sc.service_date BETWEEN p_start AND p_end
    UNION ALL
    SELECT sr.service_date AS business_date, -(sr.amount / 100.0) AS amount
    FROM public.shift4_refunds sr
    WHERE sr.restaurant_id = p_restaurant_id
      AND sr.service_date BETWEEN p_start AND p_end
  ) d
  GROUP BY d.business_date;
END;
$$;

REVOKE ALL ON FUNCTION public.deposit_match_source_shift4(uuid, date, date, jsonb) FROM PUBLIC, anon, authenticated;

-- ─────────────────────────────────────────────────────────────────────
-- clover: no normalized tender rows exist. clover_orders holds order
-- totals only, with no per-payment card/cash split (design doc,
-- "POS source coverage"). Returns zero rows; the UI shows the source as
-- "not yet supported" rather than fake a card split.
-- ─────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.deposit_match_source_clover(
  p_restaurant_id uuid, p_start date, p_end date, p_config jsonb
) RETURNS TABLE (business_date date, expected_amount numeric, row_count int)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
STABLE
AS $$
BEGIN
  RETURN;
END;
$$;

REVOKE ALL ON FUNCTION public.deposit_match_source_clover(uuid, date, date, jsonb) FROM PUBLIC, anon, authenticated;

-- ─────────────────────────────────────────────────────────────────────
-- Dispatcher: maps deposit_match_rules.pos_source to its adapter with a
-- static CASE. No dynamic SQL. Rejects an unknown source by name.
-- ─────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.deposit_match_dispatch(
  p_source text, p_restaurant_id uuid, p_start date, p_end date, p_config jsonb
) RETURNS TABLE (business_date date, expected_amount numeric, row_count int)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
STABLE
AS $$
BEGIN
  CASE p_source
    WHEN 'focus' THEN
      RETURN QUERY SELECT * FROM public.deposit_match_source_focus(p_restaurant_id, p_start, p_end, p_config);
    WHEN 'toast' THEN
      RETURN QUERY SELECT * FROM public.deposit_match_source_toast(p_restaurant_id, p_start, p_end, p_config);
    WHEN 'square' THEN
      RETURN QUERY SELECT * FROM public.deposit_match_source_square(p_restaurant_id, p_start, p_end, p_config);
    WHEN 'revel' THEN
      RETURN QUERY SELECT * FROM public.deposit_match_source_revel(p_restaurant_id, p_start, p_end, p_config);
    WHEN 'shift4' THEN
      RETURN QUERY SELECT * FROM public.deposit_match_source_shift4(p_restaurant_id, p_start, p_end, p_config);
    WHEN 'clover' THEN
      RETURN QUERY SELECT * FROM public.deposit_match_source_clover(p_restaurant_id, p_start, p_end, p_config);
    ELSE
      RAISE EXCEPTION 'deposit_match_dispatch: unknown pos_source "%"', p_source;
  END CASE;
END;
$$;

REVOKE ALL ON FUNCTION public.deposit_match_dispatch(text, uuid, date, date, jsonb) FROM PUBLIC, anon, authenticated;
