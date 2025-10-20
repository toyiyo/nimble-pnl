-- Add reconciliation and period close tracking

-- Add reconciled flag to bank_transactions
ALTER TABLE bank_transactions 
ADD COLUMN IF NOT EXISTS is_reconciled BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN IF NOT EXISTS reconciled_at TIMESTAMPTZ,
ADD COLUMN IF NOT EXISTS reconciled_by UUID REFERENCES auth.users(id);

-- Create table for period closes
CREATE TABLE IF NOT EXISTS fiscal_periods (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  restaurant_id UUID NOT NULL REFERENCES restaurants(id) ON DELETE CASCADE,
  period_start DATE NOT NULL,
  period_end DATE NOT NULL,
  is_closed BOOLEAN NOT NULL DEFAULT false,
  closed_at TIMESTAMPTZ,
  closed_by UUID REFERENCES auth.users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(restaurant_id, period_start, period_end)
);

-- Create table for tracking reclassifications
CREATE TABLE IF NOT EXISTS transaction_reclassifications (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  restaurant_id UUID NOT NULL REFERENCES restaurants(id) ON DELETE CASCADE,
  bank_transaction_id UUID NOT NULL REFERENCES bank_transactions(id) ON DELETE CASCADE,
  original_journal_entry_id UUID REFERENCES journal_entries(id) ON DELETE SET NULL,
  reclass_journal_entry_id UUID NOT NULL REFERENCES journal_entries(id) ON DELETE CASCADE,
  original_category_id UUID REFERENCES chart_of_accounts(id) ON DELETE SET NULL,
  new_category_id UUID NOT NULL REFERENCES chart_of_accounts(id) ON DELETE CASCADE,
  reason TEXT,
  created_by UUID REFERENCES auth.users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Enable RLS
ALTER TABLE fiscal_periods ENABLE ROW LEVEL SECURITY;
ALTER TABLE transaction_reclassifications ENABLE ROW LEVEL SECURITY;

-- RLS policies for fiscal_periods
CREATE POLICY "Users can view fiscal periods for their restaurants"
ON fiscal_periods FOR SELECT
USING (
  EXISTS (
    SELECT 1 FROM user_restaurants
    WHERE user_restaurants.restaurant_id = fiscal_periods.restaurant_id
    AND user_restaurants.user_id = auth.uid()
  )
);

CREATE POLICY "Owners and managers can manage fiscal periods"
ON fiscal_periods FOR ALL
USING (
  EXISTS (
    SELECT 1 FROM user_restaurants
    WHERE user_restaurants.restaurant_id = fiscal_periods.restaurant_id
    AND user_restaurants.user_id = auth.uid()
    AND user_restaurants.role IN ('owner', 'manager')
  )
);

-- RLS policies for transaction_reclassifications
CREATE POLICY "Users can view reclassifications for their restaurants"
ON transaction_reclassifications FOR SELECT
USING (
  EXISTS (
    SELECT 1 FROM user_restaurants
    WHERE user_restaurants.restaurant_id = transaction_reclassifications.restaurant_id
    AND user_restaurants.user_id = auth.uid()
  )
);

CREATE POLICY "Owners and managers can create reclassifications"
ON transaction_reclassifications FOR INSERT
WITH CHECK (
  EXISTS (
    SELECT 1 FROM user_restaurants
    WHERE user_restaurants.restaurant_id = transaction_reclassifications.restaurant_id
    AND user_restaurants.user_id = auth.uid()
    AND user_restaurants.role IN ('owner', 'manager')
  )
);

-- Indexes for performance
CREATE INDEX IF NOT EXISTS idx_fiscal_periods_restaurant_dates 
ON fiscal_periods(restaurant_id, period_start, period_end);

CREATE INDEX IF NOT EXISTS idx_transaction_reclassifications_bank_txn 
ON transaction_reclassifications(bank_transaction_id);

CREATE INDEX IF NOT EXISTS idx_bank_transactions_reconciled 
ON bank_transactions(restaurant_id, is_reconciled) WHERE is_reconciled = false;