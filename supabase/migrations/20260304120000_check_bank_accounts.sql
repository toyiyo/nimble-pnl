-- ============================================================================
-- Multi-bank-account check support
-- Moves bank_name + next_check_number from check_settings into a dedicated
-- per-account table so restaurants can manage multiple checking accounts.
-- ============================================================================

-- 1. Create check_bank_accounts table
CREATE TABLE public.check_bank_accounts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  restaurant_id UUID NOT NULL REFERENCES public.restaurants(id) ON DELETE CASCADE,
  account_name TEXT NOT NULL,
  bank_name TEXT,
  connected_bank_id UUID REFERENCES public.connected_banks(id) ON DELETE SET NULL,
  next_check_number INTEGER NOT NULL DEFAULT 1001,
  is_default BOOLEAN NOT NULL DEFAULT false,
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 2. Indexes
-- Prevent duplicate account names per restaurant
CREATE UNIQUE INDEX idx_check_bank_accounts_restaurant_name
  ON public.check_bank_accounts(restaurant_id, account_name);

-- Enforce at most one default account per restaurant
CREATE UNIQUE INDEX idx_check_bank_accounts_one_default
  ON public.check_bank_accounts(restaurant_id) WHERE is_default = true;

-- Regular lookup index
CREATE INDEX idx_check_bank_accounts_restaurant
  ON public.check_bank_accounts(restaurant_id);

-- 3. RLS
ALTER TABLE public.check_bank_accounts ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view check bank accounts for their restaurants"
  ON public.check_bank_accounts
  FOR SELECT
  USING (
    restaurant_id IN (
      SELECT restaurant_id FROM public.user_restaurants
      WHERE user_id = auth.uid()
    )
  );

CREATE POLICY "Owners/managers can insert check bank accounts"
  ON public.check_bank_accounts
  FOR INSERT
  WITH CHECK (
    restaurant_id IN (
      SELECT restaurant_id FROM public.user_restaurants
      WHERE user_id = auth.uid()
      AND role IN ('owner', 'manager')
    )
  );

CREATE POLICY "Owners/managers can update check bank accounts"
  ON public.check_bank_accounts
  FOR UPDATE
  USING (
    restaurant_id IN (
      SELECT restaurant_id FROM public.user_restaurants
      WHERE user_id = auth.uid()
      AND role IN ('owner', 'manager')
    )
  )
  WITH CHECK (
    restaurant_id IN (
      SELECT restaurant_id FROM public.user_restaurants
      WHERE user_id = auth.uid()
      AND role IN ('owner', 'manager')
    )
  );

CREATE POLICY "Owners/managers can delete check bank accounts"
  ON public.check_bank_accounts
  FOR DELETE
  USING (
    restaurant_id IN (
      SELECT restaurant_id FROM public.user_restaurants
      WHERE user_id = auth.uid()
      AND role IN ('owner', 'manager')
    )
  );

-- 4. Reuse existing trigger function for updated_at
CREATE TRIGGER update_check_bank_accounts_updated_at
  BEFORE UPDATE ON public.check_bank_accounts
  FOR EACH ROW
  EXECUTE FUNCTION update_check_settings_updated_at();

-- 5. Per-account claim_check_numbers RPC
CREATE OR REPLACE FUNCTION claim_check_numbers_for_account(
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

  -- Look up restaurant_id from the account
  SELECT restaurant_id INTO v_restaurant_id
  FROM public.check_bank_accounts
  WHERE id = p_account_id;

  IF v_restaurant_id IS NULL THEN
    RAISE EXCEPTION 'Check bank account not found: %', p_account_id;
  END IF;

  -- Authorization: caller must be owner/manager of this restaurant
  IF NOT EXISTS (
    SELECT 1 FROM public.user_restaurants
    WHERE user_id = auth.uid()
      AND restaurant_id = v_restaurant_id
      AND role IN ('owner', 'manager')
  ) THEN
    RAISE EXCEPTION 'Unauthorized: insufficient permissions for this restaurant';
  END IF;

  -- Atomically claim the numbers
  UPDATE public.check_bank_accounts
  SET next_check_number = next_check_number + p_count,
      updated_at = NOW()
  WHERE id = p_account_id
  RETURNING next_check_number - p_count INTO v_start_number;

  RETURN v_start_number;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp;

-- 6. Add check_bank_account_id FK to check_audit_log
ALTER TABLE public.check_audit_log
  ADD COLUMN check_bank_account_id UUID
  REFERENCES public.check_bank_accounts(id) ON DELETE SET NULL;

-- 7. Add check_bank_account_id FK to pending_outflows
ALTER TABLE public.pending_outflows
  ADD COLUMN check_bank_account_id UUID
  REFERENCES public.check_bank_accounts(id) ON DELETE SET NULL;

-- 8. Migrate existing data: for each restaurant with check_settings,
--    create a default check_bank_account row carrying over bank_name
--    and next_check_number.
INSERT INTO public.check_bank_accounts (
  restaurant_id,
  account_name,
  bank_name,
  next_check_number,
  is_default
)
SELECT
  cs.restaurant_id,
  COALESCE(NULLIF(cs.bank_name, ''), 'Primary Account') AS account_name,
  cs.bank_name,
  cs.next_check_number,
  true
FROM public.check_settings cs;

-- 9. Drop the migrated columns from check_settings
ALTER TABLE public.check_settings DROP COLUMN bank_name;
ALTER TABLE public.check_settings DROP COLUMN next_check_number;

-- 10. Drop the old restaurant-level claim function
DROP FUNCTION IF EXISTS claim_check_numbers(UUID, INTEGER);
