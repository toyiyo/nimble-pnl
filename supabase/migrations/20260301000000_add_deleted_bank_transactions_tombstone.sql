-- Migration: Add deleted_bank_transactions tombstone table
-- Purpose: Store key identification data from deleted bank transactions so
--          import pipelines (Stripe sync, CSV, PDF) can check before inserting.
--          Prevents deleted transactions from being re-imported.

-- Deterministic fingerprint for matching CSV/PDF transactions across re-uploads
CREATE OR REPLACE FUNCTION public.compute_transaction_fingerprint(
  p_transaction_date DATE,
  p_amount NUMERIC(15,2),
  p_description TEXT
) RETURNS TEXT
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT md5(
    COALESCE(p_transaction_date::TEXT, '') || '|' ||
    (COALESCE(p_amount, 0) * 100)::BIGINT::TEXT || '|' ||
    CASE WHEN COALESCE(p_amount, 0) >= 0 THEN 'credit' ELSE 'debit' END || '|' ||
    regexp_replace(lower(trim(COALESCE(p_description, ''))), '[^a-z0-9 ]', '', 'g')
  );
$$;

COMMENT ON FUNCTION public.compute_transaction_fingerprint IS
'Computes a deterministic MD5 fingerprint from transaction date, amount (in cents), direction, and normalized description.
Used to match deleted transactions across CSV/PDF re-uploads where no external provider ID exists.';

-- Tombstone table for deleted bank transactions
CREATE TABLE public.deleted_bank_transactions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  restaurant_id UUID NOT NULL REFERENCES public.restaurants(id) ON DELETE CASCADE,
  connected_bank_id UUID NOT NULL,
  source TEXT NOT NULL DEFAULT 'bank_integration',
  external_transaction_id TEXT,
  fingerprint TEXT NOT NULL,
  transaction_date DATE NOT NULL,
  amount NUMERIC(15,2) NOT NULL,
  currency TEXT DEFAULT 'USD',
  description TEXT,
  merchant_name TEXT,
  raw JSONB,
  deleted_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  deleted_by UUID
);

-- Unique constraint: one tombstone per external ID per restaurant
CREATE UNIQUE INDEX idx_deleted_txns_external_id
  ON public.deleted_bank_transactions (restaurant_id, external_transaction_id)
  WHERE external_transaction_id IS NOT NULL;

-- Unique constraint: one tombstone per fingerprint per restaurant
CREATE UNIQUE INDEX idx_deleted_txns_fingerprint
  ON public.deleted_bank_transactions (restaurant_id, fingerprint);

-- Index for date-range queries (Deleted tab)
CREATE INDEX idx_deleted_txns_date
  ON public.deleted_bank_transactions (restaurant_id, transaction_date);

-- RLS
ALTER TABLE public.deleted_bank_transactions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view deleted transactions for their restaurants"
  ON public.deleted_bank_transactions FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM public.user_restaurants
      WHERE user_restaurants.restaurant_id = deleted_bank_transactions.restaurant_id
      AND user_restaurants.user_id = auth.uid()
    )
  );

CREATE POLICY "Owners and managers can manage deleted transactions"
  ON public.deleted_bank_transactions FOR ALL
  USING (
    EXISTS (
      SELECT 1 FROM public.user_restaurants
      WHERE user_restaurants.restaurant_id = deleted_bank_transactions.restaurant_id
      AND user_restaurants.user_id = auth.uid()
      AND user_restaurants.role IN ('owner', 'manager')
    )
  );

-- Grant access
GRANT ALL ON public.deleted_bank_transactions TO authenticated;
GRANT SELECT ON public.deleted_bank_transactions TO anon;
