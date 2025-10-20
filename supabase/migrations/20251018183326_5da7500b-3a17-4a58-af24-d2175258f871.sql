-- Phase 1: Accounting Database Schema

-- Create enums for account types
CREATE TYPE public.account_type_enum AS ENUM (
  'asset',
  'liability',
  'equity',
  'revenue',
  'expense'
);

CREATE TYPE public.account_subtype_enum AS ENUM (
  -- Asset subtypes
  'cash',
  'bank',
  'accounts_receivable',
  'inventory',
  'fixed_assets',
  'other_current_assets',
  'other_assets',
  -- Liability subtypes
  'accounts_payable',
  'credit_card',
  'loan',
  'other_current_liabilities',
  'long_term_liabilities',
  -- Equity subtypes
  'owners_equity',
  'retained_earnings',
  -- Revenue subtypes
  'sales',
  'other_income',
  -- Expense subtypes
  'cost_of_goods_sold',
  'operating_expenses',
  'payroll',
  'tax_expense',
  'other_expenses'
);

CREATE TYPE public.transaction_status_enum AS ENUM (
  'pending',
  'posted',
  'reconciled',
  'void'
);

CREATE TYPE public.bank_connection_status_enum AS ENUM (
  'connected',
  'disconnected',
  'requires_reauth',
  'error'
);

-- Connected Banks Table
CREATE TABLE public.connected_banks (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  restaurant_id UUID NOT NULL REFERENCES public.restaurants(id) ON DELETE CASCADE,
  stripe_financial_account_id TEXT NOT NULL UNIQUE,
  institution_name TEXT NOT NULL,
  institution_logo_url TEXT,
  status bank_connection_status_enum NOT NULL DEFAULT 'connected',
  last_sync_at TIMESTAMPTZ,
  sync_error TEXT,
  connected_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  disconnected_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(restaurant_id, stripe_financial_account_id)
);

-- Bank Account Balances Table
CREATE TABLE public.bank_account_balances (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  connected_bank_id UUID NOT NULL REFERENCES public.connected_banks(id) ON DELETE CASCADE,
  account_name TEXT NOT NULL,
  account_type TEXT,
  account_mask TEXT,
  current_balance NUMERIC(15, 2) NOT NULL DEFAULT 0,
  available_balance NUMERIC(15, 2),
  currency TEXT NOT NULL DEFAULT 'USD',
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  as_of_date TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Chart of Accounts Table
CREATE TABLE public.chart_of_accounts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  restaurant_id UUID NOT NULL REFERENCES public.restaurants(id) ON DELETE CASCADE,
  account_code TEXT NOT NULL,
  account_name TEXT NOT NULL,
  account_type account_type_enum NOT NULL,
  account_subtype account_subtype_enum NOT NULL,
  description TEXT,
  parent_account_id UUID REFERENCES public.chart_of_accounts(id) ON DELETE SET NULL,
  is_system_account BOOLEAN NOT NULL DEFAULT FALSE,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  normal_balance TEXT NOT NULL CHECK (normal_balance IN ('debit', 'credit')),
  current_balance NUMERIC(15, 2) NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(restaurant_id, account_code)
);

-- Bank Transactions Table
CREATE TABLE public.bank_transactions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  restaurant_id UUID NOT NULL REFERENCES public.restaurants(id) ON DELETE CASCADE,
  connected_bank_id UUID NOT NULL REFERENCES public.connected_banks(id) ON DELETE CASCADE,
  stripe_transaction_id TEXT NOT NULL UNIQUE,
  transaction_date DATE NOT NULL,
  posted_date DATE,
  description TEXT NOT NULL,
  merchant_name TEXT,
  amount NUMERIC(15, 2) NOT NULL,
  currency TEXT NOT NULL DEFAULT 'USD',
  transaction_type TEXT,
  status transaction_status_enum NOT NULL DEFAULT 'posted',
  category_id UUID REFERENCES public.chart_of_accounts(id) ON DELETE SET NULL,
  is_categorized BOOLEAN NOT NULL DEFAULT FALSE,
  is_split BOOLEAN NOT NULL DEFAULT FALSE,
  notes TEXT,
  receipt_id UUID REFERENCES public.receipt_imports(id) ON DELETE SET NULL,
  inventory_transaction_id UUID REFERENCES public.inventory_transactions(id) ON DELETE SET NULL,
  matched_at TIMESTAMPTZ,
  matched_by UUID,
  raw_data JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Transaction Split Lines (for split transactions)
CREATE TABLE public.bank_transaction_splits (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  transaction_id UUID NOT NULL REFERENCES public.bank_transactions(id) ON DELETE CASCADE,
  category_id UUID NOT NULL REFERENCES public.chart_of_accounts(id) ON DELETE RESTRICT,
  amount NUMERIC(15, 2) NOT NULL,
  description TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Transaction Categorization Rules Table
CREATE TABLE public.transaction_categorization_rules (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  restaurant_id UUID NOT NULL REFERENCES public.restaurants(id) ON DELETE CASCADE,
  rule_name TEXT NOT NULL,
  match_type TEXT NOT NULL CHECK (match_type IN ('exact', 'contains', 'starts_with', 'ends_with', 'regex')),
  match_value TEXT NOT NULL,
  category_id UUID NOT NULL REFERENCES public.chart_of_accounts(id) ON DELETE CASCADE,
  priority INTEGER NOT NULL DEFAULT 0,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  apply_count INTEGER NOT NULL DEFAULT 0,
  last_applied_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Journal Entries Table (Double-entry bookkeeping)
CREATE TABLE public.journal_entries (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  restaurant_id UUID NOT NULL REFERENCES public.restaurants(id) ON DELETE CASCADE,
  entry_number TEXT NOT NULL,
  entry_date DATE NOT NULL,
  description TEXT NOT NULL,
  reference_type TEXT,
  reference_id UUID,
  total_debit NUMERIC(15, 2) NOT NULL DEFAULT 0,
  total_credit NUMERIC(15, 2) NOT NULL DEFAULT 0,
  is_balanced BOOLEAN GENERATED ALWAYS AS (total_debit = total_credit) STORED,
  created_by UUID,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(restaurant_id, entry_number)
);

-- Journal Entry Lines Table
CREATE TABLE public.journal_entry_lines (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  journal_entry_id UUID NOT NULL REFERENCES public.journal_entries(id) ON DELETE CASCADE,
  account_id UUID NOT NULL REFERENCES public.chart_of_accounts(id) ON DELETE RESTRICT,
  debit_amount NUMERIC(15, 2) NOT NULL DEFAULT 0,
  credit_amount NUMERIC(15, 2) NOT NULL DEFAULT 0,
  description TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Financial Statement Cache Table
CREATE TABLE public.financial_statement_cache (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  restaurant_id UUID NOT NULL REFERENCES public.restaurants(id) ON DELETE CASCADE,
  statement_type TEXT NOT NULL CHECK (statement_type IN ('balance_sheet', 'income_statement', 'cash_flow', 'trial_balance')),
  start_date DATE NOT NULL,
  end_date DATE NOT NULL,
  statement_data JSONB NOT NULL,
  generated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(restaurant_id, statement_type, start_date, end_date)
);

-- Create indexes for performance
CREATE INDEX idx_connected_banks_restaurant ON public.connected_banks(restaurant_id);
CREATE INDEX idx_connected_banks_status ON public.connected_banks(status);
CREATE INDEX idx_bank_balances_connected_bank ON public.bank_account_balances(connected_bank_id);
CREATE INDEX idx_chart_accounts_restaurant ON public.chart_of_accounts(restaurant_id);
CREATE INDEX idx_chart_accounts_type ON public.chart_of_accounts(account_type);
CREATE INDEX idx_chart_accounts_parent ON public.chart_of_accounts(parent_account_id);
CREATE INDEX idx_bank_transactions_restaurant ON public.bank_transactions(restaurant_id);
CREATE INDEX idx_bank_transactions_bank ON public.bank_transactions(connected_bank_id);
CREATE INDEX idx_bank_transactions_date ON public.bank_transactions(transaction_date);
CREATE INDEX idx_bank_transactions_category ON public.bank_transactions(category_id);
CREATE INDEX idx_bank_transactions_status ON public.bank_transactions(status);
CREATE INDEX idx_bank_transactions_stripe_id ON public.bank_transactions(stripe_transaction_id);
CREATE INDEX idx_transaction_splits_transaction ON public.bank_transaction_splits(transaction_id);
CREATE INDEX idx_categorization_rules_restaurant ON public.transaction_categorization_rules(restaurant_id);
CREATE INDEX idx_journal_entries_restaurant ON public.journal_entries(restaurant_id);
CREATE INDEX idx_journal_entries_date ON public.journal_entries(entry_date);
CREATE INDEX idx_journal_entry_lines_entry ON public.journal_entry_lines(journal_entry_id);
CREATE INDEX idx_journal_entry_lines_account ON public.journal_entry_lines(account_id);
CREATE INDEX idx_financial_cache_restaurant ON public.financial_statement_cache(restaurant_id);

-- Enable RLS
ALTER TABLE public.connected_banks ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.bank_account_balances ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.chart_of_accounts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.bank_transactions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.bank_transaction_splits ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.transaction_categorization_rules ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.journal_entries ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.journal_entry_lines ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.financial_statement_cache ENABLE ROW LEVEL SECURITY;

-- RLS Policies for connected_banks
CREATE POLICY "Users can view banks for their restaurants"
  ON public.connected_banks FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM public.user_restaurants
      WHERE user_restaurants.restaurant_id = connected_banks.restaurant_id
      AND user_restaurants.user_id = auth.uid()
    )
  );

CREATE POLICY "Owners and managers can manage banks"
  ON public.connected_banks FOR ALL
  USING (
    EXISTS (
      SELECT 1 FROM public.user_restaurants
      WHERE user_restaurants.restaurant_id = connected_banks.restaurant_id
      AND user_restaurants.user_id = auth.uid()
      AND user_restaurants.role IN ('owner', 'manager')
    )
  );

-- RLS Policies for bank_account_balances
CREATE POLICY "Users can view balances for their restaurants"
  ON public.bank_account_balances FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM public.connected_banks cb
      JOIN public.user_restaurants ur ON cb.restaurant_id = ur.restaurant_id
      WHERE cb.id = bank_account_balances.connected_bank_id
      AND ur.user_id = auth.uid()
    )
  );

CREATE POLICY "Owners and managers can manage balances"
  ON public.bank_account_balances FOR ALL
  USING (
    EXISTS (
      SELECT 1 FROM public.connected_banks cb
      JOIN public.user_restaurants ur ON cb.restaurant_id = ur.restaurant_id
      WHERE cb.id = bank_account_balances.connected_bank_id
      AND ur.user_id = auth.uid()
      AND ur.role IN ('owner', 'manager')
    )
  );

-- RLS Policies for chart_of_accounts
CREATE POLICY "Users can view chart of accounts for their restaurants"
  ON public.chart_of_accounts FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM public.user_restaurants
      WHERE user_restaurants.restaurant_id = chart_of_accounts.restaurant_id
      AND user_restaurants.user_id = auth.uid()
    )
  );

CREATE POLICY "Owners and managers can manage chart of accounts"
  ON public.chart_of_accounts FOR ALL
  USING (
    EXISTS (
      SELECT 1 FROM public.user_restaurants
      WHERE user_restaurants.restaurant_id = chart_of_accounts.restaurant_id
      AND user_restaurants.user_id = auth.uid()
      AND user_restaurants.role IN ('owner', 'manager')
    )
  );

-- RLS Policies for bank_transactions
CREATE POLICY "Users can view transactions for their restaurants"
  ON public.bank_transactions FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM public.user_restaurants
      WHERE user_restaurants.restaurant_id = bank_transactions.restaurant_id
      AND user_restaurants.user_id = auth.uid()
    )
  );

CREATE POLICY "Owners and managers can manage transactions"
  ON public.bank_transactions FOR ALL
  USING (
    EXISTS (
      SELECT 1 FROM public.user_restaurants
      WHERE user_restaurants.restaurant_id = bank_transactions.restaurant_id
      AND user_restaurants.user_id = auth.uid()
      AND user_restaurants.role IN ('owner', 'manager')
    )
  );

-- RLS Policies for bank_transaction_splits
CREATE POLICY "Users can view transaction splits for their restaurants"
  ON public.bank_transaction_splits FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM public.bank_transactions bt
      JOIN public.user_restaurants ur ON bt.restaurant_id = ur.restaurant_id
      WHERE bt.id = bank_transaction_splits.transaction_id
      AND ur.user_id = auth.uid()
    )
  );

CREATE POLICY "Owners and managers can manage transaction splits"
  ON public.bank_transaction_splits FOR ALL
  USING (
    EXISTS (
      SELECT 1 FROM public.bank_transactions bt
      JOIN public.user_restaurants ur ON bt.restaurant_id = ur.restaurant_id
      WHERE bt.id = bank_transaction_splits.transaction_id
      AND ur.user_id = auth.uid()
      AND ur.role IN ('owner', 'manager')
    )
  );

-- RLS Policies for transaction_categorization_rules
CREATE POLICY "Users can view categorization rules for their restaurants"
  ON public.transaction_categorization_rules FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM public.user_restaurants
      WHERE user_restaurants.restaurant_id = transaction_categorization_rules.restaurant_id
      AND user_restaurants.user_id = auth.uid()
    )
  );

CREATE POLICY "Owners and managers can manage categorization rules"
  ON public.transaction_categorization_rules FOR ALL
  USING (
    EXISTS (
      SELECT 1 FROM public.user_restaurants
      WHERE user_restaurants.restaurant_id = transaction_categorization_rules.restaurant_id
      AND user_restaurants.user_id = auth.uid()
      AND user_restaurants.role IN ('owner', 'manager')
    )
  );

-- RLS Policies for journal_entries
CREATE POLICY "Users can view journal entries for their restaurants"
  ON public.journal_entries FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM public.user_restaurants
      WHERE user_restaurants.restaurant_id = journal_entries.restaurant_id
      AND user_restaurants.user_id = auth.uid()
    )
  );

CREATE POLICY "Owners and managers can manage journal entries"
  ON public.journal_entries FOR ALL
  USING (
    EXISTS (
      SELECT 1 FROM public.user_restaurants
      WHERE user_restaurants.restaurant_id = journal_entries.restaurant_id
      AND user_restaurants.user_id = auth.uid()
      AND user_restaurants.role IN ('owner', 'manager')
    )
  );

-- RLS Policies for journal_entry_lines
CREATE POLICY "Users can view journal entry lines for their restaurants"
  ON public.journal_entry_lines FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM public.journal_entries je
      JOIN public.user_restaurants ur ON je.restaurant_id = ur.restaurant_id
      WHERE je.id = journal_entry_lines.journal_entry_id
      AND ur.user_id = auth.uid()
    )
  );

CREATE POLICY "Owners and managers can manage journal entry lines"
  ON public.journal_entry_lines FOR ALL
  USING (
    EXISTS (
      SELECT 1 FROM public.journal_entries je
      JOIN public.user_restaurants ur ON je.restaurant_id = ur.restaurant_id
      WHERE je.id = journal_entry_lines.journal_entry_id
      AND ur.user_id = auth.uid()
      AND ur.role IN ('owner', 'manager')
    )
  );

-- RLS Policies for financial_statement_cache
CREATE POLICY "Users can view financial statements for their restaurants"
  ON public.financial_statement_cache FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM public.user_restaurants
      WHERE user_restaurants.restaurant_id = financial_statement_cache.restaurant_id
      AND user_restaurants.user_id = auth.uid()
    )
  );

CREATE POLICY "Owners and managers can manage financial statements"
  ON public.financial_statement_cache FOR ALL
  USING (
    EXISTS (
      SELECT 1 FROM public.user_restaurants
      WHERE user_restaurants.restaurant_id = financial_statement_cache.restaurant_id
      AND user_restaurants.user_id = auth.uid()
      AND user_restaurants.role IN ('owner', 'manager')
    )
  );

-- Trigger to update updated_at timestamps
CREATE OR REPLACE FUNCTION public.update_accounting_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER update_connected_banks_updated_at
  BEFORE UPDATE ON public.connected_banks
  FOR EACH ROW
  EXECUTE FUNCTION public.update_accounting_updated_at();

CREATE TRIGGER update_bank_account_balances_updated_at
  BEFORE UPDATE ON public.bank_account_balances
  FOR EACH ROW
  EXECUTE FUNCTION public.update_accounting_updated_at();

CREATE TRIGGER update_chart_of_accounts_updated_at
  BEFORE UPDATE ON public.chart_of_accounts
  FOR EACH ROW
  EXECUTE FUNCTION public.update_accounting_updated_at();

CREATE TRIGGER update_bank_transactions_updated_at
  BEFORE UPDATE ON public.bank_transactions
  FOR EACH ROW
  EXECUTE FUNCTION public.update_accounting_updated_at();

CREATE TRIGGER update_transaction_categorization_rules_updated_at
  BEFORE UPDATE ON public.transaction_categorization_rules
  FOR EACH ROW
  EXECUTE FUNCTION public.update_accounting_updated_at();

CREATE TRIGGER update_journal_entries_updated_at
  BEFORE UPDATE ON public.journal_entries
  FOR EACH ROW
  EXECUTE FUNCTION public.update_accounting_updated_at();