-- Provenance: this function body is a whole copy of
-- deposit_match_source_toast from
-- supabase/migrations/20260901150000_deposit_match_adapters.sql:89-123,
-- the only prior definition. The one change is one new WHERE condition:
-- tp.payment_status = 'CAPTURED'.
--
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
  -- source_config is arbitrary JSON, so a JSON null or an all-whitespace
  -- string can reach this point. Either one would make the filter below
  -- match zero rows and silently report an expected total of zero, rather
  -- than raising, so normalize and reject blank up front.
  v_payment_type := NULLIF(btrim(p_config->>'card_payment_type'), '');
  IF v_payment_type IS NULL THEN
    RAISE EXCEPTION 'deposit_match_source_toast: source_config key "card_payment_type" cannot be null or blank';
  END IF;

  RETURN QUERY
  SELECT tp.payment_date, SUM(tp.amount + COALESCE(tp.tip_amount, 0))::numeric AS expected_amount,
         COUNT(*)::int AS row_count
  FROM public.toast_payments tp
  WHERE tp.restaurant_id = p_restaurant_id
    AND tp.payment_date BETWEEN p_start AND p_end
    AND tp.payment_type = v_payment_type
    -- Only CAPTURED rows settle to the bank. DENIED, VOIDED, AUTHORIZED,
    -- CANCELLED, ERROR, OPEN, PROCESSING_VOID, and NULL rows do not.
    AND tp.payment_status = 'CAPTURED'
  GROUP BY tp.payment_date;
END;
$$;

REVOKE ALL ON FUNCTION public.deposit_match_source_toast(uuid, date, date, jsonb) FROM PUBLIC, anon, authenticated;
