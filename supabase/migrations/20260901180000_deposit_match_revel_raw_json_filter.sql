-- Deposit Match: filter the Revel adapter on raw_json, not the stored
-- payment_type column.
--
-- supabase/functions/_shared/revelOrderProcessor.ts:172 writes
-- `card_type ?? payment_type ?? ...` into revel_payments.payment_type, so a
-- card row and a cash row can carry the same digits in that column. The
-- reliable field is raw_json->>'payment_type': production shows every one
-- of the 2,231 rows with a card brand carries the value '2' (credit), and
-- cash rows carry '1'. See docs/superpowers/specs/2026-09-01-deposit-match-design.md,
-- "Addendum (2026-09-03, after the Phase 7d re-review)".
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
  v_payment_types := public.deposit_match_require_nonempty_array(
    p_config, 'card_payment_types', 'deposit_match_source_revel'
  );

  RETURN QUERY
  SELECT rp.payment_date, SUM(rp.amount + COALESCE(rp.tip_amount, 0))::numeric AS expected_amount,
         COUNT(*)::int AS row_count
  FROM public.revel_payments rp
  WHERE rp.restaurant_id = p_restaurant_id
    AND rp.payment_date BETWEEN p_start AND p_end
    AND (rp.raw_json->>'payment_type') = ANY(v_payment_types)
  GROUP BY rp.payment_date;
END;
$$;

REVOKE ALL ON FUNCTION public.deposit_match_source_revel(uuid, date, date, jsonb) FROM PUBLIC, anon, authenticated;
