-- ============================================================================
-- Defense-in-depth for check_bank_accounts secret columns
--
-- Addresses PR #479 review (CodeRabbit + Codex):
--   1. REVOKE direct UPDATE on the three secret columns so the SECURITY DEFINER
--      RPCs are the only path that can mutate them.
--   2. Combine existence + authorization checks in get/set RPCs to avoid
--      leaking cross-restaurant existence via distinct error messages.
--   3. Raise on a 0-row UPDATE so a soft-delete race surfaces instead of
--      silently succeeding.
--   4. Add update_check_bank_account_routing RPC so users can edit routing
--      without re-entering the encrypted account number.
--   5. Add clear_check_bank_account_secrets RPC so toggling print_bank_info
--      off wipes stale routing / encrypted account / last4 server-side.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. Lock the secret columns via a BEFORE UPDATE trigger.
--
-- Column-level REVOKE is the obvious approach but PostgreSQL gives precedence
-- to a table-level GRANT over a column-level REVOKE — so as long as
-- `authenticated` holds table-level UPDATE (which it does, via PostgREST), the
-- REVOKE has no effect. A trigger lets us block direct writes regardless of
-- grants. The SECURITY DEFINER RPCs below `SET LOCAL` a session flag to
-- bypass the trigger when they perform their writes.
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public._guard_check_bank_account_secrets()
RETURNS trigger AS $$
BEGIN
  -- Allow the SECURITY DEFINER RPCs (which set this flag locally) to write.
  -- Consume (reset) the flag after each row so it can't leak across rows or
  -- subsequent statements in the same transaction.
  IF current_setting('app.allow_check_account_secrets_write', true) = 'on' THEN
    PERFORM set_config('app.allow_check_account_secrets_write', '', true);
    RETURN NEW;
  END IF;

  IF NEW.routing_number IS DISTINCT FROM OLD.routing_number
     OR NEW.account_number_encrypted IS DISTINCT FROM OLD.account_number_encrypted
     OR NEW.account_number_last4 IS DISTINCT FROM OLD.account_number_last4 THEN
    RAISE EXCEPTION 'Direct writes to check_bank_accounts secret columns are not allowed; use the set_/update_/clear_check_bank_account_* RPCs'
      USING ERRCODE = '42501';
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS check_bank_account_secrets_guard ON public.check_bank_accounts;
CREATE TRIGGER check_bank_account_secrets_guard
  BEFORE UPDATE ON public.check_bank_accounts
  FOR EACH ROW
  EXECUTE FUNCTION public._guard_check_bank_account_secrets();

-- ----------------------------------------------------------------------------
-- 2. set_check_bank_account_secrets — combined auth+existence check, race-safe
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.set_check_bank_account_secrets(
  p_id UUID,
  p_routing TEXT,
  p_account TEXT
)
RETURNS VOID AS $$
DECLARE
  v_restaurant_id UUID;
  v_key TEXT;
BEGIN
  IF p_routing IS NULL OR p_routing !~ '^[0-9]{9}$' THEN
    RAISE EXCEPTION 'Routing number must be exactly 9 digits';
  END IF;

  IF p_account IS NULL OR length(p_account) < 4 OR length(p_account) > 17 OR p_account !~ '^[0-9]+$' THEN
    RAISE EXCEPTION 'Account number must be 4 to 17 digits';
  END IF;

  -- Combined existence + authorization check. A single generic error prevents
  -- callers from probing whether a UUID belongs to another restaurant.
  SELECT cba.restaurant_id INTO v_restaurant_id
  FROM public.check_bank_accounts cba
  JOIN public.user_restaurants ur
    ON ur.restaurant_id = cba.restaurant_id
   AND ur.user_id = auth.uid()
   AND ur.role IN ('owner', 'manager')
  WHERE cba.id = p_id AND cba.is_active = true;

  IF v_restaurant_id IS NULL THEN
    RAISE EXCEPTION 'Check bank account not found or unauthorized';
  END IF;

  v_key := public._check_account_encryption_key();
  IF v_key IS NULL THEN
    RAISE EXCEPTION 'Encryption key not configured';
  END IF;

  PERFORM set_config('app.allow_check_account_secrets_write', 'on', true);
  UPDATE public.check_bank_accounts
  SET routing_number = p_routing,
      account_number_encrypted = encode(
        extensions.pgp_sym_encrypt(p_account, v_key),
        'base64'
      ),
      account_number_last4 = right(p_account, 4),
      updated_at = NOW()
  WHERE id = p_id AND is_active = true;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Check bank account no longer active: %', p_id;
  END IF;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, extensions, pg_temp;

GRANT EXECUTE ON FUNCTION public.set_check_bank_account_secrets(UUID, TEXT, TEXT) TO authenticated;

-- ----------------------------------------------------------------------------
-- 3. get_check_bank_account_secrets — combined auth+existence check
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.get_check_bank_account_secrets(p_id UUID)
RETURNS TABLE(routing_number TEXT, account_number TEXT) AS $$
DECLARE
  v_restaurant_id UUID;
  v_key TEXT;
  v_routing TEXT;
  v_encrypted TEXT;
BEGIN
  SELECT cba.restaurant_id, cba.routing_number, cba.account_number_encrypted
    INTO v_restaurant_id, v_routing, v_encrypted
  FROM public.check_bank_accounts cba
  JOIN public.user_restaurants ur
    ON ur.restaurant_id = cba.restaurant_id
   AND ur.user_id = auth.uid()
   AND ur.role IN ('owner', 'manager')
  WHERE cba.id = p_id AND cba.is_active = true;

  IF v_restaurant_id IS NULL THEN
    RAISE EXCEPTION 'Check bank account not found or unauthorized';
  END IF;

  IF v_routing IS NULL OR v_encrypted IS NULL THEN
    RETURN;
  END IF;

  v_key := public._check_account_encryption_key();
  IF v_key IS NULL THEN
    RAISE EXCEPTION 'Encryption key not configured';
  END IF;

  routing_number := v_routing;
  account_number := extensions.pgp_sym_decrypt(decode(v_encrypted, 'base64'), v_key);
  RETURN NEXT;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, extensions, pg_temp;

GRANT EXECUTE ON FUNCTION public.get_check_bank_account_secrets(UUID) TO authenticated;

-- ----------------------------------------------------------------------------
-- 4. update_check_bank_account_routing — routing-only edits without re-entry
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.update_check_bank_account_routing(
  p_id UUID,
  p_routing TEXT
)
RETURNS VOID AS $$
DECLARE
  v_restaurant_id UUID;
BEGIN
  IF p_routing IS NULL OR p_routing !~ '^[0-9]{9}$' THEN
    RAISE EXCEPTION 'Routing number must be exactly 9 digits';
  END IF;

  SELECT cba.restaurant_id INTO v_restaurant_id
  FROM public.check_bank_accounts cba
  JOIN public.user_restaurants ur
    ON ur.restaurant_id = cba.restaurant_id
   AND ur.user_id = auth.uid()
   AND ur.role IN ('owner', 'manager')
  WHERE cba.id = p_id AND cba.is_active = true;

  IF v_restaurant_id IS NULL THEN
    RAISE EXCEPTION 'Check bank account not found or unauthorized';
  END IF;

  PERFORM set_config('app.allow_check_account_secrets_write', 'on', true);
  UPDATE public.check_bank_accounts
  SET routing_number = p_routing,
      updated_at = NOW()
  WHERE id = p_id AND is_active = true;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Check bank account no longer active: %', p_id;
  END IF;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp;

GRANT EXECUTE ON FUNCTION public.update_check_bank_account_routing(UUID, TEXT) TO authenticated;

-- ----------------------------------------------------------------------------
-- 5. clear_check_bank_account_secrets — wipe MICR fields when toggle goes off
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.clear_check_bank_account_secrets(p_id UUID)
RETURNS VOID AS $$
DECLARE
  v_restaurant_id UUID;
BEGIN
  SELECT cba.restaurant_id INTO v_restaurant_id
  FROM public.check_bank_accounts cba
  JOIN public.user_restaurants ur
    ON ur.restaurant_id = cba.restaurant_id
   AND ur.user_id = auth.uid()
   AND ur.role IN ('owner', 'manager')
  WHERE cba.id = p_id AND cba.is_active = true;

  IF v_restaurant_id IS NULL THEN
    RAISE EXCEPTION 'Check bank account not found or unauthorized';
  END IF;

  PERFORM set_config('app.allow_check_account_secrets_write', 'on', true);
  UPDATE public.check_bank_accounts
  SET routing_number = NULL,
      account_number_encrypted = NULL,
      account_number_last4 = NULL,
      updated_at = NOW()
  WHERE id = p_id AND is_active = true;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Check bank account no longer active: %', p_id;
  END IF;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp;

GRANT EXECUTE ON FUNCTION public.clear_check_bank_account_secrets(UUID) TO authenticated;
