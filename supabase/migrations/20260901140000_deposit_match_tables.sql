-- Deposit Match: tables, RLS, and guard triggers.
--
-- Design ref: docs/superpowers/specs/2026-09-01-deposit-match-design.md
--
-- Three restaurant-scoped tables:
--   deposit_match_rules  — one row per restaurant, POS source, and rail
--   deposit_match_items  — one row per restaurant, rule, and business date
--   deposit_match_links  — allocations between an item and a bank transaction
--
-- Each REVOKE sits right after its own CREATE TABLE. Production's
-- pg_default_acl grants `anon` and `authenticated` full CRUD on a new public
-- table, so any gap between creation and revoke is a window in which the
-- table is writable by both (see 20260804100100_review_funnel_tables.sql).

-- =====================================================================
-- 1. deposit_match_rules
-- =====================================================================
CREATE TABLE public.deposit_match_rules (
  id                    UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  restaurant_id         UUID        NOT NULL REFERENCES public.restaurants(id) ON DELETE CASCADE,
  pos_source            TEXT        NOT NULL,
  rail                  TEXT        NOT NULL CHECK (rail IN ('card')),
  connected_bank_id     UUID        NOT NULL REFERENCES public.connected_banks(id),
  settlement            TEXT        NOT NULL CHECK (settlement IN ('gross', 'net')),
  lag_days_min          INTEGER     NOT NULL,
  lag_days_max          INTEGER     NOT NULL,
  fee_pct_min           NUMERIC     NOT NULL DEFAULT 0,
  fee_pct_max           NUMERIC     NOT NULL DEFAULT 0,
  amount_tolerance      NUMERIC     NOT NULL DEFAULT 0,
  amount_tolerance_pct  NUMERIC     NOT NULL DEFAULT 0,
  source_config         JSONB       NOT NULL DEFAULT '{}'::jsonb,
  descriptor_pattern    TEXT,
  active                BOOLEAN     NOT NULL DEFAULT true,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT deposit_match_rules_unique UNIQUE (restaurant_id, pos_source, rail)
);

REVOKE ALL ON public.deposit_match_rules FROM anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.deposit_match_rules TO authenticated;
ALTER TABLE public.deposit_match_rules ENABLE ROW LEVEL SECURITY;

-- =====================================================================
-- 2. deposit_match_items
-- =====================================================================
CREATE TABLE public.deposit_match_items (
  id                UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  restaurant_id     UUID        NOT NULL REFERENCES public.restaurants(id) ON DELETE CASCADE,
  rule_id           UUID        NOT NULL REFERENCES public.deposit_match_rules(id) ON DELETE CASCADE,
  business_date     DATE        NOT NULL,
  expected_amount   NUMERIC     NOT NULL DEFAULT 0,
  received_amount   NUMERIC     NOT NULL DEFAULT 0,
  fee_amount        NUMERIC     NOT NULL DEFAULT 0,
  status            TEXT        NOT NULL DEFAULT 'pending'
    CHECK (status IN ('matched', 'matched_net', 'pending', 'late', 'short', 'over', 'needs_review', 'incomplete')),
  status_reason     TEXT,
  resolution        TEXT        CHECK (resolution IN ('accepted', 'disputed')),
  resolution_note   TEXT,
  resolved_by       UUID        REFERENCES auth.users(id) ON DELETE SET NULL,
  resolved_at       TIMESTAMPTZ,
  source_row_count  INTEGER     NOT NULL DEFAULT 0,
  computed_at       TIMESTAMPTZ,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT deposit_match_items_unique UNIQUE (restaurant_id, rule_id, business_date)
);

CREATE INDEX deposit_match_items_rid_date_idx
  ON public.deposit_match_items (restaurant_id, business_date);

REVOKE ALL ON public.deposit_match_items FROM anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.deposit_match_items TO authenticated;
ALTER TABLE public.deposit_match_items ENABLE ROW LEVEL SECURITY;

-- =====================================================================
-- 3. deposit_match_links
-- =====================================================================
CREATE TABLE public.deposit_match_links (
  id                  UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  restaurant_id       UUID        NOT NULL REFERENCES public.restaurants(id) ON DELETE CASCADE,
  item_id             UUID        NOT NULL REFERENCES public.deposit_match_items(id) ON DELETE CASCADE,
  bank_transaction_id UUID        NOT NULL REFERENCES public.bank_transactions(id) ON DELETE CASCADE,
  allocated_amount    NUMERIC     NOT NULL CHECK (allocated_amount > 0),
  method              TEXT        NOT NULL CHECK (method IN ('auto', 'manual')),
  state               TEXT        NOT NULL DEFAULT 'suggested' CHECK (state IN ('suggested', 'confirmed')),
  match_reason        TEXT,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT deposit_match_links_unique UNIQUE (item_id, bank_transaction_id)
);

CREATE INDEX deposit_match_links_txn_state_idx
  ON public.deposit_match_links (bank_transaction_id, state);

REVOKE ALL ON public.deposit_match_links FROM anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.deposit_match_links TO authenticated;
ALTER TABLE public.deposit_match_links ENABLE ROW LEVEL SECURITY;

-- =====================================================================
-- 4. updated_at triggers (reuse the existing shared trigger function)
-- =====================================================================
CREATE TRIGGER deposit_match_rules_updated_at
  BEFORE UPDATE ON public.deposit_match_rules
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE TRIGGER deposit_match_items_updated_at
  BEFORE UPDATE ON public.deposit_match_items
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE TRIGGER deposit_match_links_updated_at
  BEFORE UPDATE ON public.deposit_match_links
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- =====================================================================
-- 5. Row Level Security
--    ONE permissive SELECT policy per table, with a single ANDed USING
--    clause (view:banking AND view:pos_sales). Two SELECT policies would
--    OR together and widen access to either capability alone
--    (memory/lessons.md:848, 2026-07-03). INSERT/UPDATE/DELETE each get
--    one policy that requires edit:banking.
-- =====================================================================
CREATE POLICY deposit_match_rules_select ON public.deposit_match_rules
  FOR SELECT TO authenticated
  USING (
    user_has_capability(restaurant_id, 'view:banking')
    AND user_has_capability(restaurant_id, 'view:pos_sales')
  );

CREATE POLICY deposit_match_rules_insert ON public.deposit_match_rules
  FOR INSERT TO authenticated
  WITH CHECK (user_has_capability(restaurant_id, 'edit:banking'));

CREATE POLICY deposit_match_rules_update ON public.deposit_match_rules
  FOR UPDATE TO authenticated
  USING (user_has_capability(restaurant_id, 'edit:banking'))
  WITH CHECK (user_has_capability(restaurant_id, 'edit:banking'));

CREATE POLICY deposit_match_rules_delete ON public.deposit_match_rules
  FOR DELETE TO authenticated
  USING (user_has_capability(restaurant_id, 'edit:banking'));

CREATE POLICY deposit_match_items_select ON public.deposit_match_items
  FOR SELECT TO authenticated
  USING (
    user_has_capability(restaurant_id, 'view:banking')
    AND user_has_capability(restaurant_id, 'view:pos_sales')
  );

CREATE POLICY deposit_match_items_insert ON public.deposit_match_items
  FOR INSERT TO authenticated
  WITH CHECK (user_has_capability(restaurant_id, 'edit:banking'));

CREATE POLICY deposit_match_items_update ON public.deposit_match_items
  FOR UPDATE TO authenticated
  USING (user_has_capability(restaurant_id, 'edit:banking'))
  WITH CHECK (user_has_capability(restaurant_id, 'edit:banking'));

CREATE POLICY deposit_match_items_delete ON public.deposit_match_items
  FOR DELETE TO authenticated
  USING (user_has_capability(restaurant_id, 'edit:banking'));

CREATE POLICY deposit_match_links_select ON public.deposit_match_links
  FOR SELECT TO authenticated
  USING (
    user_has_capability(restaurant_id, 'view:banking')
    AND user_has_capability(restaurant_id, 'view:pos_sales')
  );

-- The capability check alone is not enough: the FKs on item_id and
-- bank_transaction_id only require the referenced row to exist, in ANY
-- tenant. Without the two EXISTS clauses below, an authenticated user of
-- restaurant A could INSERT a row with restaurant_id = A, item_id = one
-- of A's own items, and bank_transaction_id belonging to restaurant B —
-- a cross-tenant allocation the capability check alone cannot see
-- (Codex adversarial review, 2026-09-02). The app itself never inserts
-- into this table directly (only the SECURITY DEFINER
-- refresh_deposit_matches does), but the table GRANT still lets a caller
-- reach this policy through the REST API.
CREATE POLICY deposit_match_links_insert ON public.deposit_match_links
  FOR INSERT TO authenticated
  WITH CHECK (
    user_has_capability(restaurant_id, 'edit:banking')
    AND EXISTS (
      SELECT 1 FROM public.deposit_match_items i
      WHERE i.id = item_id AND i.restaurant_id = deposit_match_links.restaurant_id
    )
    AND EXISTS (
      SELECT 1 FROM public.bank_transactions bt
      WHERE bt.id = bank_transaction_id AND bt.restaurant_id = deposit_match_links.restaurant_id
    )
  );

-- Same cross-tenant gap as the INSERT policy above, but on a re-point:
-- WITH CHECK also runs on UPDATE, so without it a caller could UPDATE an
-- existing (same-tenant) row's item_id or bank_transaction_id to point at
-- another tenant's row.
CREATE POLICY deposit_match_links_update ON public.deposit_match_links
  FOR UPDATE TO authenticated
  USING (user_has_capability(restaurant_id, 'edit:banking'))
  WITH CHECK (
    user_has_capability(restaurant_id, 'edit:banking')
    AND EXISTS (
      SELECT 1 FROM public.deposit_match_items i
      WHERE i.id = item_id AND i.restaurant_id = deposit_match_links.restaurant_id
    )
    AND EXISTS (
      SELECT 1 FROM public.bank_transactions bt
      WHERE bt.id = bank_transaction_id AND bt.restaurant_id = deposit_match_links.restaurant_id
    )
  );

CREATE POLICY deposit_match_links_delete ON public.deposit_match_links
  FOR DELETE TO authenticated
  USING (user_has_capability(restaurant_id, 'edit:banking'));

-- =====================================================================
-- 6. Tenant guard: a rule's connected_bank_id must belong to the rule's
--    own restaurant_id. The FK alone does not check the tenant, and the
--    refresh function is SECURITY DEFINER — a cross-tenant bank id would
--    expose another restaurant's bank rows.
-- =====================================================================
CREATE OR REPLACE FUNCTION public.deposit_match_rules_bank_tenant_check()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM public.connected_banks
    WHERE id = NEW.connected_bank_id
      AND restaurant_id = NEW.restaurant_id
  ) THEN
    RAISE EXCEPTION 'connected_bank_id % does not belong to restaurant_id %',
      NEW.connected_bank_id, NEW.restaurant_id;
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER deposit_match_rules_bank_tenant_check_trg
  BEFORE INSERT OR UPDATE OF connected_bank_id, restaurant_id ON public.deposit_match_rules
  FOR EACH ROW EXECUTE FUNCTION public.deposit_match_rules_bank_tenant_check();

-- =====================================================================
-- 7. Allocation cap: the sum of confirmed allocated_amount per bank
--    transaction must stay at or below the transaction amount. The
--    trigger takes pg_advisory_xact_lock on the bank transaction id
--    first, so two concurrent confirms cannot both pass the sum check
--    (pattern: 20260705130000_claim_open_shift_active_guard.sql:58).
--    Only confirmed links count toward the cap.
-- =====================================================================
CREATE OR REPLACE FUNCTION public.deposit_match_links_allocation_cap()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_txn_amount NUMERIC;
  v_confirmed_sum NUMERIC;
BEGIN
  IF NEW.state <> 'confirmed' THEN
    RETURN NEW;
  END IF;

  PERFORM pg_advisory_xact_lock(hashtext(NEW.bank_transaction_id::text));

  SELECT amount INTO v_txn_amount
  FROM public.bank_transactions
  WHERE id = NEW.bank_transaction_id;

  SELECT COALESCE(SUM(allocated_amount), 0) INTO v_confirmed_sum
  FROM public.deposit_match_links
  WHERE bank_transaction_id = NEW.bank_transaction_id
    AND state = 'confirmed'
    AND id <> NEW.id;

  IF v_confirmed_sum + NEW.allocated_amount > v_txn_amount THEN
    RAISE EXCEPTION
      'confirmed allocations (%) would exceed bank transaction % amount (%)',
      v_confirmed_sum + NEW.allocated_amount, NEW.bank_transaction_id, v_txn_amount;
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER deposit_match_links_allocation_cap_trg
  BEFORE INSERT OR UPDATE OF allocated_amount, state, bank_transaction_id ON public.deposit_match_links
  FOR EACH ROW EXECUTE FUNCTION public.deposit_match_links_allocation_cap();
