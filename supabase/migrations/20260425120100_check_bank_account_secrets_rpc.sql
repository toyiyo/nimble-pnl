-- ============================================================================
-- Encryption key (Vault) + set/get RPCs for check bank account secrets
-- See: docs/superpowers/specs/2026-04-25-check-printing-micr-design.md
-- ============================================================================

CREATE EXTENSION IF NOT EXISTS pgcrypto WITH SCHEMA extensions;
CREATE EXTENSION IF NOT EXISTS supabase_vault WITH SCHEMA vault;

-- Create the encryption key as a Vault secret if it doesn't already exist.
-- Each environment generates its own random 32-byte key on first apply.
DO $$
DECLARE
  v_existing UUID;
BEGIN
  SELECT id INTO v_existing
  FROM vault.secrets
  WHERE name = 'check_account_encryption_key';

  IF v_existing IS NULL THEN
    PERFORM vault.create_secret(
      encode(extensions.gen_random_bytes(32), 'hex'),
      'check_account_encryption_key',
      'Symmetric key for encrypting check_bank_accounts.account_number_encrypted'
    );
  END IF;
END $$;

-- Private helper to read the key. Not granted to anon/authenticated.
CREATE OR REPLACE FUNCTION public._check_account_encryption_key()
RETURNS TEXT AS $$
  SELECT decrypted_secret
  FROM vault.decrypted_secrets
  WHERE name = 'check_account_encryption_key'
  LIMIT 1;
$$ LANGUAGE sql SECURITY DEFINER SET search_path = public, vault, pg_temp;

REVOKE EXECUTE ON FUNCTION public._check_account_encryption_key() FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public._check_account_encryption_key() FROM anon, authenticated;

-- ----------------------------------------------------------------------------
-- set_check_bank_account_secrets
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

  SELECT restaurant_id INTO v_restaurant_id
  FROM public.check_bank_accounts
  WHERE id = p_id AND is_active = true;

  IF v_restaurant_id IS NULL THEN
    RAISE EXCEPTION 'Check bank account not found: %', p_id;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.user_restaurants
    WHERE user_id = auth.uid()
      AND restaurant_id = v_restaurant_id
      AND role IN ('owner', 'manager')
  ) THEN
    RAISE EXCEPTION 'Unauthorized: insufficient permissions for this restaurant';
  END IF;

  v_key := public._check_account_encryption_key();
  IF v_key IS NULL THEN
    RAISE EXCEPTION 'Encryption key not configured';
  END IF;

  UPDATE public.check_bank_accounts
  SET routing_number = p_routing,
      account_number_encrypted = encode(
        extensions.pgp_sym_encrypt(p_account, v_key),
        'base64'
      ),
      account_number_last4 = right(p_account, 4),
      updated_at = NOW()
  WHERE id = p_id AND is_active = true;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, extensions, pg_temp;

GRANT EXECUTE ON FUNCTION public.set_check_bank_account_secrets(UUID, TEXT, TEXT) TO authenticated;

-- ----------------------------------------------------------------------------
-- get_check_bank_account_secrets
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
  WHERE cba.id = p_id AND cba.is_active = true;

  IF v_restaurant_id IS NULL THEN
    RAISE EXCEPTION 'Check bank account not found: %', p_id;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.user_restaurants
    WHERE user_id = auth.uid()
      AND restaurant_id = v_restaurant_id
      AND role IN ('owner', 'manager')
  ) THEN
    RAISE EXCEPTION 'Unauthorized: insufficient permissions for this restaurant';
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
