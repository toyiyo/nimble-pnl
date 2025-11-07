-- Create pending_outflows table for tracking committed but uncleared payments
CREATE TABLE public.pending_outflows (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  restaurant_id UUID NOT NULL REFERENCES public.restaurants(id) ON DELETE CASCADE,
  vendor_name TEXT NOT NULL,
  category_id UUID REFERENCES public.chart_of_accounts(id) ON DELETE SET NULL,
  payment_method TEXT NOT NULL CHECK (payment_method IN ('check', 'ach', 'other')),
  amount NUMERIC(15, 2) NOT NULL,
  issue_date DATE NOT NULL,
  due_date DATE,
  notes TEXT,
  reference_number TEXT,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'cleared', 'voided', 'stale_30', 'stale_60', 'stale_90')),
  linked_bank_transaction_id UUID REFERENCES public.bank_transactions(id) ON DELETE SET NULL,
  cleared_at TIMESTAMPTZ,
  voided_at TIMESTAMPTZ,
  voided_reason TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Create indexes for performance
CREATE INDEX idx_pending_outflows_restaurant ON public.pending_outflows(restaurant_id);
CREATE INDEX idx_pending_outflows_status ON public.pending_outflows(status);
CREATE INDEX idx_pending_outflows_issue_date ON public.pending_outflows(issue_date);
CREATE INDEX idx_pending_outflows_linked_txn ON public.pending_outflows(linked_bank_transaction_id);

-- Enable Row Level Security
ALTER TABLE public.pending_outflows ENABLE ROW LEVEL SECURITY;

-- RLS Policies
CREATE POLICY "Users can view pending outflows for their restaurants"
  ON public.pending_outflows
  FOR SELECT
  USING (
    restaurant_id IN (
      SELECT restaurant_id FROM public.user_restaurants
      WHERE user_id = auth.uid()
    )
  );

CREATE POLICY "Users can insert pending outflows for their restaurants"
  ON public.pending_outflows
  FOR INSERT
  WITH CHECK (
    restaurant_id IN (
      SELECT restaurant_id FROM public.user_restaurants
      WHERE user_id = auth.uid()
      AND role IN ('owner', 'manager')
    )
  );

CREATE POLICY "Users can update pending outflows for their restaurants"
  ON public.pending_outflows
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

CREATE POLICY "Users can delete pending outflows for their restaurants"
  ON public.pending_outflows
  FOR DELETE
  USING (
    restaurant_id IN (
      SELECT restaurant_id FROM public.user_restaurants
      WHERE user_id = auth.uid()
      AND role IN ('owner', 'manager')
    )
  );

-- Function to update updated_at timestamp
CREATE OR REPLACE FUNCTION update_pending_outflows_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Trigger to automatically update updated_at
CREATE TRIGGER update_pending_outflows_updated_at
  BEFORE UPDATE ON public.pending_outflows
  FOR EACH ROW
  EXECUTE FUNCTION update_pending_outflows_updated_at();

-- Function to automatically mark stale pending outflows
CREATE OR REPLACE FUNCTION mark_stale_pending_outflows()
RETURNS void AS $$
BEGIN
  -- Mark as stale_30 (30-59 days old)
  UPDATE public.pending_outflows
  SET status = 'stale_30'
  WHERE status = 'pending'
    AND issue_date < CURRENT_DATE - INTERVAL '30 days'
    AND issue_date >= CURRENT_DATE - INTERVAL '60 days';
  
  -- Mark as stale_60 (60-89 days old)
  UPDATE public.pending_outflows
  SET status = 'stale_60'
  WHERE status IN ('pending', 'stale_30')
    AND issue_date < CURRENT_DATE - INTERVAL '60 days'
    AND issue_date >= CURRENT_DATE - INTERVAL '90 days';
  
  -- Mark as stale_90 (90+ days old)
  UPDATE public.pending_outflows
  SET status = 'stale_90'
  WHERE status IN ('pending', 'stale_30', 'stale_60')
    AND issue_date < CURRENT_DATE - INTERVAL '90 days';
END;
$$ LANGUAGE plpgsql;

-- Function to suggest matches between pending outflows and bank transactions
CREATE OR REPLACE FUNCTION suggest_pending_outflow_matches(
  p_restaurant_id UUID,
  p_pending_outflow_id UUID DEFAULT NULL
)
RETURNS TABLE (
  pending_outflow_id UUID,
  bank_transaction_id UUID,
  match_score INTEGER,
  amount_delta NUMERIC,
  date_delta INTEGER,
  payee_similarity TEXT
) AS $$
BEGIN
  RETURN QUERY
  SELECT 
    po.id AS pending_outflow_id,
    bt.id AS bank_transaction_id,
    -- Calculate match score (0-100)
    CASE
      -- Exact amount match
      WHEN ABS(po.amount + bt.amount) < 0.01 THEN 60
      -- Within $1
      WHEN ABS(po.amount + bt.amount) < 1.00 THEN 45
      -- Within $5
      WHEN ABS(po.amount + bt.amount) < 5.00 THEN 20
      ELSE 0
    END +
    CASE
      -- Same day
      WHEN bt.transaction_date = po.issue_date THEN 20
      -- Within 3 days
      WHEN ABS(EXTRACT(EPOCH FROM (bt.transaction_date - po.issue_date)) / 86400) <= 3 THEN 15
      -- Within 7 days
      WHEN ABS(EXTRACT(EPOCH FROM (bt.transaction_date - po.issue_date)) / 86400) <= 7 THEN 10
      -- Within 10 days
      WHEN ABS(EXTRACT(EPOCH FROM (bt.transaction_date - po.issue_date)) / 86400) <= 10 THEN 5
      ELSE 0
    END +
    CASE
      -- Payee name similarity (basic contains check)
      WHEN bt.merchant_name IS NOT NULL AND 
           LOWER(bt.merchant_name) LIKE '%' || LOWER(SUBSTRING(po.vendor_name, 1, 5)) || '%' THEN 20
      WHEN bt.description IS NOT NULL AND 
           LOWER(bt.description) LIKE '%' || LOWER(SUBSTRING(po.vendor_name, 1, 5)) || '%' THEN 10
      ELSE 0
    END AS match_score,
    -- Additional info for review
    po.amount + bt.amount AS amount_delta,
    EXTRACT(EPOCH FROM (bt.transaction_date - po.issue_date))::INTEGER / 86400 AS date_delta,
    CASE
      WHEN bt.merchant_name IS NOT NULL THEN 
        COALESCE(bt.merchant_name, bt.description)
      ELSE bt.description
    END AS payee_similarity
  FROM public.pending_outflows po
  CROSS JOIN public.bank_transactions bt
  WHERE po.restaurant_id = p_restaurant_id
    AND bt.restaurant_id = p_restaurant_id
    AND po.status = 'pending'
    AND po.linked_bank_transaction_id IS NULL
    AND bt.is_categorized = false
    AND bt.amount < 0  -- Only negative (outgoing) transactions
    -- Amount tolerance: within $10
    AND ABS(po.amount + bt.amount) < 10.00
    -- Date tolerance: within 30 days
    AND ABS(EXTRACT(EPOCH FROM (bt.transaction_date - po.issue_date)) / 86400) <= 30
    -- Optional filter by specific pending outflow
    AND (p_pending_outflow_id IS NULL OR po.id = p_pending_outflow_id)
  ORDER BY match_score DESC, ABS(po.amount + bt.amount) ASC
  LIMIT 100;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
