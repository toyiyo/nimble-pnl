-- ============================================================================
-- Check-printing authorization: legacy-role gating -> capability gating
--
-- See docs/superpowers/specs/2026-08-02-check-printing-capability-gating-design.md
-- for the full design rationale. Summary for future readers:
--
-- CAPABILITY CHOICE (design §2):
--   - Issuing a check (claiming numbers, writing an audit row) is gated on
--     `edit:pending_outflows` -- it is a write against the outflow the check
--     pays, not a bank-instrument configuration change.
--   - Configuring the check-printing instrument (bank accounts, settings,
--     secrets) is gated on `edit:banking`.
--   - A dedicated `edit:checks` capability was deliberately rejected: under
--     the area model, `user_has_capability` resolves capabilities through a
--     fixed capability -> (area, level) map, so a new capability mapped to
--     ('books','manage') would resolve IDENTICALLY to the `edit:*`
--     capabilities already in that bundle for every role that can ever
--     exist -- zero behavioural difference, at the cost of a 7th rewrite of
--     the most-rewritten function in the permission system (fail-closed
--     legacy CASE branch: forget to add it there and every role_id IS NULL
--     owner/manager silently loses check printing) plus a wide mirror-test
--     blast radius (Capability union, AREA_CAPABILITIES.books,
--     ROLE_CAPABILITIES, areas.test.ts, user_has_capability_areas_test.sql).
--
-- §2.4 EXCEPTION: `get_check_bank_account_secrets` is a read (a GET) but is
--   deliberately gated at `edit:banking` (manage tier), not `view:banking`.
--   It returns the plaintext routing/account number used to populate the
--   "edit bank account" form; `PrintChecks.tsx` calls it only from that
--   management flow, and a `view:banking` caller (any restaurant member,
--   post-§4) must not be able to read the plaintext MICR line.
--
-- PROVENANCE of each re-emitted body (per the lesson: CREATE OR REPLACE from
--   the ORIGINAL migration silently reverts every PR that touched it since):
--   - claim_check_numbers_for_account: copied verbatim from
--     20260304120000_check_bank_accounts.sql (its only definition
--     repo-wide; `grep -rlE "FUNCTION\s+(public\.)?claim_check_numbers_for_account\b"
--     supabase/migrations` returns exactly one hit), guard swapped in place.
--   - set_/get_/update_/clear_check_bank_account_secrets and
--     update_check_bank_account_routing: copied verbatim from
--     20260426120000_lock_check_bank_account_secrets.sql (NOT
--     20260425120100 -- 20260426120000 is the migration that rewrote these
--     bodies for the anti-enumeration combined auth+existence check and the
--     secret-column write guard), `AND ur.role IN ('owner','manager')`
--     replaced by `public.user_has_capability(cba.restaurant_id,
--     'edit:banking')`. The `user_restaurants` join is dropped in each of
--     these four RPCs once the role check that was its only purpose is
--     gone. This is multiplicity-safe: `user_restaurants` carries
--     UNIQUE(user_id, restaurant_id) (20250915210020:19), and the driving
--     table is filtered on its primary key (`cba.id = p_id`), so the join
--     could never have fanned out a row even before this change -- change
--     either of those two facts and this reasoning stops holding. Dropping
--     it also preserves the anti-enumeration property 20260426120000 was
--     written for: existence and authorization stay combined in one query
--     with one NULL-collapsing outcome, so "account doesn't exist" and
--     "exists but you're not allowed" remain indistinguishable to the
--     caller. The `public.` qualification on `user_has_capability` is new
--     in all five RPCs -- `public` was already first in each function's
--     `search_path` so the unqualified call resolved correctly before this
--     change too, but qualifying is the safer default inside a
--     SECURITY DEFINER body against any future search_path change.
--
-- SELECT NARROWING (design §4): `check_settings`, `check_bank_accounts`, and
--   `check_audit_log` SELECT policies moved from "any restaurant member"
--   to `view:banking` (settings, bank accounts) / `view:pending_outflows`
--   (audit log). Consumer sweep justifying this as safe:
--   `grep -rlE "from\(['\"]check_(settings|bank_accounts|audit_log)['\"]\)"
--   src supabase/functions` -- every hit is inside a books-management
--   surface (PrintChecks.tsx and its hooks, the check-printing edge
--   functions), none is reachable by a plain `books@view` or kiosk/staff
--   route, so no existing consumer relies on the wider grant.
--
-- `check_audit_log` keeps having NO UPDATE/DELETE policy -- audit rows stay
--   immutable (20260206000000_check_printing.sql:180 and neighbour).
-- ============================================================================

-- ----------------------------------------------------------------------------
-- RPC 1: claim_check_numbers_for_account
-- Body copied verbatim from 20260304120000_check_bank_accounts.sql, guard
-- swapped from role-literal to capability. Exception message unchanged.
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.claim_check_numbers_for_account(
  p_account_id UUID,
  p_count INTEGER DEFAULT 1
)
RETURNS INTEGER AS $$
DECLARE
  v_start_number INTEGER;
  v_restaurant_id UUID;
BEGIN
  -- Input validation
  IF p_count < 1 OR p_count > 100 THEN
    RAISE EXCEPTION 'Check count must be between 1 and 100';
  END IF;

  -- Look up restaurant_id from the account (must be active)
  SELECT restaurant_id INTO v_restaurant_id
  FROM public.check_bank_accounts
  WHERE id = p_account_id
    AND is_active = true;

  IF v_restaurant_id IS NULL THEN
    RAISE EXCEPTION 'Check bank account not found: %', p_account_id;
  END IF;

  -- Authorization: capability-gated, not role-gated. See migration header.
  IF NOT public.user_has_capability(v_restaurant_id, 'edit:pending_outflows') THEN
    RAISE EXCEPTION 'Unauthorized: insufficient permissions for this restaurant';
  END IF;

  -- Atomically claim the numbers
  UPDATE public.check_bank_accounts
  SET next_check_number = next_check_number + p_count,
      updated_at = NOW()
  WHERE id = p_account_id
    AND is_active = true
  RETURNING next_check_number - p_count INTO v_start_number;

  IF v_start_number IS NULL THEN
    RAISE EXCEPTION 'Check bank account was deleted during operation: %', p_account_id;
  END IF;

  RETURN v_start_number;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp;

-- ----------------------------------------------------------------------------
-- RPCs 2-5: set_/get_/update_/clear_check_bank_account_secrets
-- Bodies copied verbatim from
-- 20260426120000_lock_check_bank_account_secrets.sql. See migration header
-- for the join-drop and anti-enumeration reasoning.
-- ----------------------------------------------------------------------------

-- RPC 2: set_check_bank_account_secrets
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
  WHERE cba.id = p_id AND cba.is_active = true
    AND public.user_has_capability(cba.restaurant_id, 'edit:banking');

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

-- RPC 3: get_check_bank_account_secrets
-- §2.4: deliberately kept at 'edit:banking' (manage tier), not
-- 'view:banking' -- see migration header.
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
  WHERE cba.id = p_id AND cba.is_active = true
    AND public.user_has_capability(cba.restaurant_id, 'edit:banking');

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

-- RPC 4: update_check_bank_account_routing
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
  WHERE cba.id = p_id AND cba.is_active = true
    AND public.user_has_capability(cba.restaurant_id, 'edit:banking');

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

-- RPC 5: clear_check_bank_account_secrets
CREATE OR REPLACE FUNCTION public.clear_check_bank_account_secrets(p_id UUID)
RETURNS VOID AS $$
DECLARE
  v_restaurant_id UUID;
BEGIN
  SELECT cba.restaurant_id INTO v_restaurant_id
  FROM public.check_bank_accounts cba
  WHERE cba.id = p_id AND cba.is_active = true
    AND public.user_has_capability(cba.restaurant_id, 'edit:banking');

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

-- ============================================================================
-- Policies: nine total, DROP + CREATE per house style
-- (20260120100100_update_rls_for_collaborators.sql), per the §3.1 mapping.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- check_settings
-- ----------------------------------------------------------------------------
DROP POLICY IF EXISTS "Users can view check settings for their restaurants" ON public.check_settings;
DROP POLICY IF EXISTS "Owners/managers can insert check settings" ON public.check_settings;
DROP POLICY IF EXISTS "Owners/managers can update check settings" ON public.check_settings;

CREATE POLICY "Users can view check settings for their restaurants"
  ON public.check_settings
  FOR SELECT
  USING (user_has_capability(restaurant_id, 'view:banking'));

CREATE POLICY "edit:banking capability can insert check settings"
  ON public.check_settings
  FOR INSERT
  WITH CHECK (user_has_capability(restaurant_id, 'edit:banking'));

CREATE POLICY "edit:banking capability can update check settings"
  ON public.check_settings
  FOR UPDATE
  USING (user_has_capability(restaurant_id, 'edit:banking'))
  WITH CHECK (user_has_capability(restaurant_id, 'edit:banking'));

-- ----------------------------------------------------------------------------
-- check_bank_accounts
-- ----------------------------------------------------------------------------
DROP POLICY IF EXISTS "Users can view check bank accounts for their restaurants" ON public.check_bank_accounts;
DROP POLICY IF EXISTS "Owners/managers can insert check bank accounts" ON public.check_bank_accounts;
DROP POLICY IF EXISTS "Owners/managers can update check bank accounts" ON public.check_bank_accounts;
DROP POLICY IF EXISTS "Owners/managers can delete check bank accounts" ON public.check_bank_accounts;

CREATE POLICY "Users can view check bank accounts for their restaurants"
  ON public.check_bank_accounts
  FOR SELECT
  USING (user_has_capability(restaurant_id, 'view:banking'));

CREATE POLICY "edit:banking capability can insert check bank accounts"
  ON public.check_bank_accounts
  FOR INSERT
  WITH CHECK (user_has_capability(restaurant_id, 'edit:banking'));

CREATE POLICY "edit:banking capability can update check bank accounts"
  ON public.check_bank_accounts
  FOR UPDATE
  USING (user_has_capability(restaurant_id, 'edit:banking'))
  WITH CHECK (user_has_capability(restaurant_id, 'edit:banking'));

CREATE POLICY "edit:banking capability can delete check bank accounts"
  ON public.check_bank_accounts
  FOR DELETE
  USING (user_has_capability(restaurant_id, 'edit:banking'));

-- ----------------------------------------------------------------------------
-- check_audit_log
-- No UPDATE/DELETE policy added -- audit rows stay immutable.
-- ----------------------------------------------------------------------------
DROP POLICY IF EXISTS "Users can view check audit log for their restaurants" ON public.check_audit_log;
DROP POLICY IF EXISTS "Owners/managers can insert audit records" ON public.check_audit_log;

CREATE POLICY "Users can view check audit log for their restaurants"
  ON public.check_audit_log
  FOR SELECT
  USING (user_has_capability(restaurant_id, 'view:pending_outflows'));

CREATE POLICY "edit:pending_outflows capability can insert audit records"
  ON public.check_audit_log
  FOR INSERT
  WITH CHECK (user_has_capability(restaurant_id, 'edit:pending_outflows'));
