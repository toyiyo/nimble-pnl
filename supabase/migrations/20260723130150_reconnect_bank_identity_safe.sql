-- Phase 4 Task 5 of the bank re-authentication flow
-- (docs/superpowers/specs/2026-07-23-bank-reauth-flow-design.md §4.1, §4.2).
--
-- Three brand-new, service-role-only RPCs called by
-- stripe-financial-connections-webhook. None of these functions existed
-- before this migration, so there is no prior CREATE OR REPLACE FUNCTION
-- body to source (per the 2026-07-20/2026-07-22 provenance lessons) — the
-- provenance is this design doc, cited per function below.
--
-- mark_connected_bank_deactivated / mark_connected_bank_reactivated exist
-- because PostgREST upsert/update payloads can only carry literal values,
-- not SQL expressions referencing the existing row (design §4.1's
-- `deactivated_at = COALESCE(deactivated_at, now())` needs exactly that).
--
-- reconnect_connected_bank exists because the design's step-2 INSERT
-- (§4.2) must repeat the connected_banks_identity_uniq partial index's
-- predicate verbatim in its ON CONFLICT clause for Postgres to infer it as
-- the arbiter index — and PostgREST's upsert `on_conflict` param only
-- accepts a column list, with no way to attach a WHERE predicate. Verified
-- locally: `ON CONFLICT (a,b) DO UPDATE` against a table whose only
-- matching unique index is partial raises "no unique or exclusion
-- constraint matching the ON CONFLICT specification"; only
-- `ON CONFLICT (a,b) WHERE <predicate> DO UPDATE` resolves. That predicate
-- is therefore only reachable via a database function, not a REST upsert.

-- ============================================================
-- financial_connections.account.deactivated (§4.1)
-- ============================================================

CREATE OR REPLACE FUNCTION public.mark_connected_bank_deactivated(
  p_stripe_financial_account_id text,
  p_sync_error text
)
RETURNS public.connected_banks
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_row public.connected_banks;
BEGIN
  UPDATE public.connected_banks
     SET status = 'requires_reauth',
         deactivated_at = COALESCE(deactivated_at, now()),
         sync_error = p_sync_error
   WHERE stripe_financial_account_id = p_stripe_financial_account_id
  RETURNING * INTO v_row;

  RETURN v_row;
END;
$$;

COMMENT ON FUNCTION public.mark_connected_bank_deactivated(text, text) IS
  'Stripe financial_connections.account.deactivated handler. COALESCE keeps the first deactivated_at across a redelivered event, so the reauth escalation clock does not reset. Design: docs/superpowers/specs/2026-07-23-bank-reauth-flow-design.md §4.1. Caller: stripe-financial-connections-webhook (service role only).';

REVOKE ALL ON FUNCTION public.mark_connected_bank_deactivated(text, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.mark_connected_bank_deactivated(text, text) FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION public.mark_connected_bank_deactivated(text, text) TO service_role;

-- ============================================================
-- financial_connections.account.reactivated (§4.1)
-- ============================================================

CREATE OR REPLACE FUNCTION public.mark_connected_bank_reactivated(
  p_stripe_financial_account_id text
)
RETURNS public.connected_banks
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_row public.connected_banks;
BEGIN
  UPDATE public.connected_banks
     SET status = 'connected',
         deactivated_at = NULL,
         sync_error = NULL
   WHERE stripe_financial_account_id = p_stripe_financial_account_id
  RETURNING * INTO v_row;

  RETURN v_row;
END;
$$;

COMMENT ON FUNCTION public.mark_connected_bank_reactivated(text) IS
  'Stripe financial_connections.account.reactivated handler. Design: docs/superpowers/specs/2026-07-23-bank-reauth-flow-design.md §4.1. Caller: stripe-financial-connections-webhook (service role only); the webhook re-triggers stripe-sync-transactions for the bank after calling this.';

REVOKE ALL ON FUNCTION public.mark_connected_bank_reactivated(text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.mark_connected_bank_reactivated(text) FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION public.mark_connected_bank_reactivated(text) TO service_role;

-- ============================================================
-- Identity-safe reconnect matching for financial_connections.account.created
-- (§4.2). Replaces the old "claim any disconnected row at this institution"
-- lookup, whose failure mode was grafting one real account's history onto
-- an unrelated row when a restaurant has multiple accounts at one bank.
-- ============================================================

CREATE OR REPLACE FUNCTION public.reconnect_connected_bank(
  p_restaurant_id uuid,
  p_stripe_financial_account_id text,
  p_institution_name text,
  p_institution_logo_url text,
  p_account_mask text
)
RETURNS public.connected_banks
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_row public.connected_banks;
BEGIN
  -- Step 1 — identity match. Guarded so it cannot steal a row that is
  -- already live (status not in the "needs reconnect" set) under a
  -- different stripe_financial_account_id. NULL account_mask never
  -- matches here (plain `=`, not IS NOT DISTINCT FROM) — that is the
  -- legacy/unknown-mask path, and it always takes step 2 below.
  UPDATE public.connected_banks
     SET stripe_financial_account_id = p_stripe_financial_account_id,
         status = 'connected',
         connected_at = now(),
         disconnected_at = NULL,
         deactivated_at = NULL,
         sync_error = NULL,
         institution_logo_url = COALESCE(p_institution_logo_url, institution_logo_url)
   WHERE restaurant_id = p_restaurant_id
     AND institution_name = p_institution_name
     AND account_mask = p_account_mask
     AND status IN ('disconnected', 'requires_reauth', 'error')
     AND stripe_financial_account_id IS DISTINCT FROM p_stripe_financial_account_id
  RETURNING * INTO v_row;

  IF FOUND THEN
    RETURN v_row;
  END IF;

  -- Step 2 — no identity match: insert a new row. Never fall back to
  -- claiming an arbitrary row at the same institution — a brand-new
  -- account at a known bank is a new row, which is correct and cheap.
  --
  -- Conflict-aware because the partial unique index
  -- (connected_banks_identity_uniq) creates a race the old code did not
  -- have: two concurrent account.created events for distinct fca_ ids
  -- sharing (restaurant_id, institution_name, account_mask) — a
  -- double-submitted Link flow — both miss step 1 and both reach here.
  -- The ON CONFLICT inference clause repeats the partial index's
  -- predicate verbatim; Postgres cannot match it to the index otherwise.
  INSERT INTO public.connected_banks (
    restaurant_id, stripe_financial_account_id, institution_name,
    institution_logo_url, account_mask, status, connected_at
  )
  VALUES (
    p_restaurant_id, p_stripe_financial_account_id, p_institution_name,
    p_institution_logo_url, p_account_mask, 'connected', now()
  )
  ON CONFLICT (restaurant_id, institution_name, account_mask)
    WHERE status <> 'disconnected' AND account_mask IS NOT NULL
  DO UPDATE SET
    stripe_financial_account_id = EXCLUDED.stripe_financial_account_id,
    status = 'connected',
    connected_at = now(),
    disconnected_at = NULL,
    deactivated_at = NULL,
    sync_error = NULL,
    institution_logo_url = COALESCE(EXCLUDED.institution_logo_url, public.connected_banks.institution_logo_url)
  RETURNING * INTO v_row;

  RETURN v_row;
END;
$$;

COMMENT ON FUNCTION public.reconnect_connected_bank(uuid, text, text, text, text) IS
  'Identity-safe reconnect matching for financial_connections.account.created: relinks the account-identity-matching existing row (never an arbitrary disconnected row at the same institution), or inserts a new one, conflict-aware for double-submitted Link flows. Design: docs/superpowers/specs/2026-07-23-bank-reauth-flow-design.md §4.2. Caller: stripe-financial-connections-webhook (service role only).';

REVOKE ALL ON FUNCTION public.reconnect_connected_bank(uuid, text, text, text, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.reconnect_connected_bank(uuid, text, text, text, text) FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION public.reconnect_connected_bank(uuid, text, text, text, text) TO service_role;
