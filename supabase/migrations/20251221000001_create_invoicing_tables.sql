-- Invoicing and Payment System
-- This migration creates the core tables for invoice management with Stripe integration
-- Following Model A: Restaurant is the merchant of record (Stripe Connect)

-- Table: customers
-- Stores customer information for invoicing
CREATE TABLE IF NOT EXISTS public.customers (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  restaurant_id UUID NOT NULL REFERENCES public.restaurants(id) ON DELETE CASCADE,
  stripe_customer_id TEXT UNIQUE,
  name TEXT NOT NULL,
  email TEXT,
  phone TEXT,
  billing_address_line1 TEXT,
  billing_address_line2 TEXT,
  billing_address_city TEXT,
  billing_address_state TEXT,
  billing_address_postal_code TEXT,
  billing_address_country TEXT DEFAULT 'US',
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_by UUID REFERENCES auth.users(id),
  updated_by UUID REFERENCES auth.users(id)
);

-- Index for faster lookups
CREATE INDEX idx_customers_restaurant_id ON public.customers(restaurant_id);
CREATE INDEX idx_customers_stripe_customer_id ON public.customers(stripe_customer_id) WHERE stripe_customer_id IS NOT NULL;
CREATE INDEX idx_customers_email ON public.customers(email) WHERE email IS NOT NULL;

-- Table: stripe_connected_accounts
-- Stores Stripe Connect account information for each restaurant
CREATE TABLE IF NOT EXISTS public.stripe_connected_accounts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  restaurant_id UUID NOT NULL UNIQUE REFERENCES public.restaurants(id) ON DELETE CASCADE,
  stripe_account_id TEXT NOT NULL UNIQUE,
  account_type TEXT NOT NULL CHECK (account_type IN ('express', 'standard')),
  charges_enabled BOOLEAN NOT NULL DEFAULT false,
  payouts_enabled BOOLEAN NOT NULL DEFAULT false,
  details_submitted BOOLEAN NOT NULL DEFAULT false,
  onboarding_complete BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Index for faster lookups
CREATE INDEX idx_stripe_accounts_restaurant_id ON public.stripe_connected_accounts(restaurant_id);
CREATE INDEX idx_stripe_accounts_stripe_account_id ON public.stripe_connected_accounts(stripe_account_id);

-- Table: invoices
-- Stores invoice metadata with Stripe invoice tracking
CREATE TABLE IF NOT EXISTS public.invoices (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  restaurant_id UUID NOT NULL REFERENCES public.restaurants(id) ON DELETE CASCADE,
  customer_id UUID NOT NULL REFERENCES public.customers(id) ON DELETE RESTRICT,
  stripe_invoice_id TEXT UNIQUE,
  invoice_number TEXT,
  
  -- Status mirrors Stripe: draft, open, paid, void, uncollectible
  status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'open', 'paid', 'void', 'uncollectible')),
  
  -- Financial fields (in cents)
  currency TEXT NOT NULL DEFAULT 'usd',
  subtotal INTEGER NOT NULL DEFAULT 0,
  tax INTEGER NOT NULL DEFAULT 0,
  total INTEGER NOT NULL DEFAULT 0,
  amount_due INTEGER NOT NULL DEFAULT 0,
  amount_paid INTEGER NOT NULL DEFAULT 0,
  amount_remaining INTEGER NOT NULL DEFAULT 0,
  
  -- Dates
  due_date DATE,
  invoice_date DATE NOT NULL DEFAULT CURRENT_DATE,
  paid_at TIMESTAMPTZ,
  
  -- Stripe URLs
  hosted_invoice_url TEXT,
  invoice_pdf_url TEXT,
  
  -- Stripe fees and charges (in cents)
  stripe_fee_amount INTEGER DEFAULT 0,
  stripe_fee_description TEXT,
  application_fee_amount INTEGER DEFAULT 0,
  pass_fees_to_customer BOOLEAN NOT NULL DEFAULT false,
  
  -- Metadata
  description TEXT,
  footer TEXT,
  memo TEXT,
  
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_by UUID REFERENCES auth.users(id),
  updated_by UUID REFERENCES auth.users(id)
);

-- Indexes for faster queries
CREATE INDEX idx_invoices_restaurant_id ON public.invoices(restaurant_id);
CREATE INDEX idx_invoices_customer_id ON public.invoices(customer_id);
CREATE INDEX idx_invoices_stripe_invoice_id ON public.invoices(stripe_invoice_id) WHERE stripe_invoice_id IS NOT NULL;
CREATE INDEX idx_invoices_status ON public.invoices(status);
CREATE INDEX idx_invoices_invoice_date ON public.invoices(invoice_date DESC);
CREATE INDEX idx_invoices_due_date ON public.invoices(due_date) WHERE due_date IS NOT NULL;

-- Table: invoice_line_items
-- Stores individual line items for each invoice
CREATE TABLE IF NOT EXISTS public.invoice_line_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  invoice_id UUID NOT NULL REFERENCES public.invoices(id) ON DELETE CASCADE,
  stripe_invoice_item_id TEXT,
  
  description TEXT NOT NULL,
  quantity DECIMAL(10, 3) NOT NULL DEFAULT 1,
  unit_amount INTEGER NOT NULL, -- in cents
  amount INTEGER NOT NULL, -- quantity * unit_amount
  
  -- Tax behavior
  tax_behavior TEXT DEFAULT 'unspecified' CHECK (tax_behavior IN ('inclusive', 'exclusive', 'unspecified')),
  tax_rate DECIMAL(5, 4), -- e.g., 0.0825 for 8.25%
  
  -- Metadata for extensibility
  metadata JSONB DEFAULT '{}'::jsonb,
  
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Indexes for faster queries
CREATE INDEX idx_invoice_line_items_invoice_id ON public.invoice_line_items(invoice_id);
CREATE INDEX idx_invoice_line_items_stripe_id ON public.invoice_line_items(stripe_invoice_item_id) WHERE stripe_invoice_item_id IS NOT NULL;

-- Table: invoice_payments
-- Tracks payment attempts and status for invoices
CREATE TABLE IF NOT EXISTS public.invoice_payments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  invoice_id UUID NOT NULL REFERENCES public.invoices(id) ON DELETE CASCADE,
  stripe_payment_intent_id TEXT,
  stripe_charge_id TEXT,
  
  amount INTEGER NOT NULL, -- in cents
  currency TEXT NOT NULL DEFAULT 'usd',
  
  -- Payment method: card, us_bank_account, etc.
  payment_method_type TEXT,
  
  -- Status: requires_payment_method, requires_confirmation, requires_action, processing, succeeded, canceled
  status TEXT NOT NULL,
  
  failure_message TEXT,
  
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Indexes for faster queries
CREATE INDEX idx_invoice_payments_invoice_id ON public.invoice_payments(invoice_id);
CREATE INDEX idx_invoice_payments_stripe_payment_intent ON public.invoice_payments(stripe_payment_intent_id) WHERE stripe_payment_intent_id IS NOT NULL;

-- Enable Row Level Security on all tables
ALTER TABLE public.customers ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.stripe_connected_accounts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.invoices ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.invoice_line_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.invoice_payments ENABLE ROW LEVEL SECURITY;

-- RLS Policies for customers table
CREATE POLICY "Users can view customers for their restaurants"
  ON public.customers FOR SELECT
  USING (
    restaurant_id IN (
      SELECT restaurant_id FROM public.user_restaurants
      WHERE user_id = auth.uid()
    )
  );

CREATE POLICY "Users can insert customers for their restaurants"
  ON public.customers FOR INSERT
  WITH CHECK (
    restaurant_id IN (
      SELECT restaurant_id FROM public.user_restaurants
      WHERE user_id = auth.uid()
      AND role IN ('owner', 'manager')
    )
  );

CREATE POLICY "Users can update customers for their restaurants"
  ON public.customers FOR UPDATE
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

CREATE POLICY "Users can delete customers for their restaurants"
  ON public.customers FOR DELETE
  USING (
    restaurant_id IN (
      SELECT restaurant_id FROM public.user_restaurants
      WHERE user_id = auth.uid()
      AND role IN ('owner', 'manager')
    )
  );

-- RLS Policies for stripe_connected_accounts table
CREATE POLICY "Users can view connected accounts for their restaurants"
  ON public.stripe_connected_accounts FOR SELECT
  USING (
    restaurant_id IN (
      SELECT restaurant_id FROM public.user_restaurants
      WHERE user_id = auth.uid()
    )
  );

CREATE POLICY "Owners can manage connected accounts"
  ON public.stripe_connected_accounts FOR ALL
  USING (
    restaurant_id IN (
      SELECT restaurant_id FROM public.user_restaurants
      WHERE user_id = auth.uid()
      AND role = 'owner'
    )
  )
  WITH CHECK (
    restaurant_id IN (
      SELECT restaurant_id FROM public.user_restaurants
      WHERE user_id = auth.uid()
      AND role = 'owner'
    )
  );

-- RLS Policies for invoices table
CREATE POLICY "Users can view invoices for their restaurants"
  ON public.invoices FOR SELECT
  USING (
    restaurant_id IN (
      SELECT restaurant_id FROM public.user_restaurants
      WHERE user_id = auth.uid()
    )
  );

CREATE POLICY "Users can insert invoices for their restaurants"
  ON public.invoices FOR INSERT
  WITH CHECK (
    restaurant_id IN (
      SELECT restaurant_id FROM public.user_restaurants
      WHERE user_id = auth.uid()
      AND role IN ('owner', 'manager')
    )
  );

CREATE POLICY "Users can update invoices for their restaurants"
  ON public.invoices FOR UPDATE
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

CREATE POLICY "Users can delete draft invoices for their restaurants"
  ON public.invoices FOR DELETE
  USING (
    status = 'draft'
    AND restaurant_id IN (
      SELECT restaurant_id FROM public.user_restaurants
      WHERE user_id = auth.uid()
      AND role IN ('owner', 'manager')
    )
  );

-- RLS Policies for invoice_line_items table
CREATE POLICY "Users can view line items for their restaurant invoices"
  ON public.invoice_line_items FOR SELECT
  USING (
    invoice_id IN (
      SELECT id FROM public.invoices
      WHERE restaurant_id IN (
        SELECT restaurant_id FROM public.user_restaurants
        WHERE user_id = auth.uid()
      )
    )
  );

CREATE POLICY "Users can manage line items for their restaurant invoices"
  ON public.invoice_line_items FOR ALL
  USING (
    invoice_id IN (
      SELECT id FROM public.invoices
      WHERE restaurant_id IN (
        SELECT restaurant_id FROM public.user_restaurants
        WHERE user_id = auth.uid()
        AND role IN ('owner', 'manager')
      )
    )
  )
  WITH CHECK (
    invoice_id IN (
      SELECT id FROM public.invoices
      WHERE restaurant_id IN (
        SELECT restaurant_id FROM public.user_restaurants
        WHERE user_id = auth.uid()
        AND role IN ('owner', 'manager')
      )
    )
  );

-- RLS Policies for invoice_payments table
CREATE POLICY "Users can view payments for their restaurant invoices"
  ON public.invoice_payments FOR SELECT
  USING (
    invoice_id IN (
      SELECT id FROM public.invoices
      WHERE restaurant_id IN (
        SELECT restaurant_id FROM public.user_restaurants
        WHERE user_id = auth.uid()
      )
    )
  );

-- Only service role can insert/update payments (via webhooks)
CREATE POLICY "Service role can manage all payments"
  ON public.invoice_payments FOR ALL
  USING (
    current_setting('request.jwt.claims', true)::json->>'role' = 'service_role'
  )
  WITH CHECK (
    current_setting('request.jwt.claims', true)::json->>'role' = 'service_role'
  );

-- Triggers for updated_at timestamps
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER update_customers_updated_at
  BEFORE UPDATE ON public.customers
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_stripe_connected_accounts_updated_at
  BEFORE UPDATE ON public.stripe_connected_accounts
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_invoices_updated_at
  BEFORE UPDATE ON public.invoices
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_invoice_line_items_updated_at
  BEFORE UPDATE ON public.invoice_line_items
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_invoice_payments_updated_at
  BEFORE UPDATE ON public.invoice_payments
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();

-- Grant necessary permissions
GRANT SELECT, INSERT, UPDATE, DELETE ON public.customers TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.stripe_connected_accounts TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.invoices TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.invoice_line_items TO authenticated;
GRANT SELECT ON public.invoice_payments TO authenticated;

-- Service role needs full access for webhooks
GRANT ALL ON public.customers TO service_role;
GRANT ALL ON public.stripe_connected_accounts TO service_role;
GRANT ALL ON public.invoices TO service_role;
GRANT ALL ON public.invoice_line_items TO service_role;
GRANT ALL ON public.invoice_payments TO service_role;
