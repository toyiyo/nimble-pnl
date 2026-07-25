-- upsert_stripe_bank_balance — identity-safe Stripe balance upsert.
--
-- Exists for the same reason reconnect_connected_bank does: the balance
-- identity key is the PARTIAL unique index bank_account_balances_stripe_bank_uniq
-- (UNIQUE(connected_bank_id) WHERE stripe_financial_account_id IS NOT NULL), and
-- PostgREST's upsert on_conflict parameter accepts only a column list — it
-- cannot attach the index's WHERE predicate. Postgres will not infer a partial
-- index as the ON CONFLICT arbiter unless the conflict clause repeats that
-- predicate verbatim, which is only reachable from a database function, not a
-- REST upsert. So all three Stripe balance writers (webhook, verify-session,
-- refresh-balance) call this function instead of upserting on connected_bank_id.
--
-- Behaviour: insert a Stripe-origin balance row for the bank, or — if one
-- already exists — rotate its stripe_financial_account_id to the new fca_ and
-- refresh its fields in place. A reconnect therefore updates the single existing
-- Stripe row rather than inserting a duplicate (incident 2026-07-24). Non-Stripe
-- snapshot rows (fca_ NULL) are outside the partial index and never collide.
--
-- Caller: service role only (edge functions).

CREATE OR REPLACE FUNCTION public.upsert_stripe_bank_balance(
  p_connected_bank_id           uuid,
  p_stripe_financial_account_id text,
  p_account_name                text,
  p_account_type                text,
  p_account_mask                text,
  p_current_balance             numeric,
  p_available_balance           numeric,
  p_currency                    text,
  p_is_active                   boolean,
  p_as_of_date                  timestamptz DEFAULT NULL
)
RETURNS public.bank_account_balances
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_row public.bank_account_balances;
BEGIN
  -- The partial unique index only covers rows with a non-null fca_; a null
  -- here would silently bypass the identity guard and could append duplicates.
  IF p_stripe_financial_account_id IS NULL THEN
    RAISE EXCEPTION
      'upsert_stripe_bank_balance requires a non-null stripe_financial_account_id';
  END IF;

  INSERT INTO public.bank_account_balances (
    connected_bank_id, stripe_financial_account_id, account_name, account_type,
    account_mask, current_balance, available_balance, currency, is_active, as_of_date
  )
  VALUES (
    p_connected_bank_id, p_stripe_financial_account_id, p_account_name, p_account_type,
    p_account_mask, p_current_balance, p_available_balance, p_currency, p_is_active, p_as_of_date
  )
  ON CONFLICT (connected_bank_id) WHERE stripe_financial_account_id IS NOT NULL
  DO UPDATE SET
    stripe_financial_account_id = EXCLUDED.stripe_financial_account_id,
    account_name      = EXCLUDED.account_name,
    account_type      = EXCLUDED.account_type,
    account_mask      = EXCLUDED.account_mask,
    current_balance   = EXCLUDED.current_balance,
    available_balance = EXCLUDED.available_balance,
    currency          = EXCLUDED.currency,
    is_active         = EXCLUDED.is_active,
    -- Never invent a date: only overwrite as_of_date when the caller supplied
    -- one (they pass NULL when Stripe gave no balance.as_of), else keep the
    -- persisted value.
    as_of_date        = COALESCE(EXCLUDED.as_of_date, public.bank_account_balances.as_of_date)
  RETURNING * INTO v_row;

  RETURN v_row;
END;
$$;

COMMENT ON FUNCTION public.upsert_stripe_bank_balance(uuid, text, text, text, text, numeric, numeric, text, boolean, timestamptz) IS
  'Identity-safe Stripe balance upsert: inserts the single Stripe-origin balance row for a connected bank, or rotates its stripe_financial_account_id + refreshes fields in place on reconnect. Targets the partial unique index bank_account_balances_stripe_bank_uniq, whose WHERE predicate PostgREST cannot express. Caller: edge functions (service role only). Incident: 2026-07-24 Huntington reconnect.';

REVOKE ALL ON FUNCTION public.upsert_stripe_bank_balance(uuid, text, text, text, text, numeric, numeric, text, boolean, timestamptz) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.upsert_stripe_bank_balance(uuid, text, text, text, text, numeric, numeric, text, boolean, timestamptz) FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION public.upsert_stripe_bank_balance(uuid, text, text, text, text, numeric, numeric, text, boolean, timestamptz) TO service_role;
