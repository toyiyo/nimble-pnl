-- Bank Statement Uploads Table
-- Similar structure to receipt_imports for tracking manually uploaded bank statements

CREATE TABLE public.bank_statement_uploads (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  restaurant_id UUID NOT NULL REFERENCES public.restaurants(id) ON DELETE CASCADE,
  bank_name TEXT,
  statement_period_start DATE,
  statement_period_end DATE,
  raw_file_url TEXT,
  file_name TEXT,
  file_size INTEGER,
  processed_at TIMESTAMPTZ,
  status TEXT NOT NULL DEFAULT 'uploaded' CHECK (status IN ('uploaded', 'processed', 'imported', 'error')),
  raw_ocr_data JSONB,
  transaction_count INTEGER,
  total_debits NUMERIC(15, 2),
  total_credits NUMERIC(15, 2),
  processed_by UUID,
  error_message TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Bank Statement Transaction Lines (staging before import to bank_transactions)
CREATE TABLE public.bank_statement_lines (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  statement_upload_id UUID NOT NULL REFERENCES public.bank_statement_uploads(id) ON DELETE CASCADE,
  transaction_date DATE NOT NULL,
  description TEXT NOT NULL,
  amount NUMERIC(15, 2) NOT NULL,
  transaction_type TEXT CHECK (transaction_type IN ('debit', 'credit', 'unknown')),
  balance NUMERIC(15, 2),
  line_sequence INTEGER NOT NULL,
  confidence_score NUMERIC(3, 2),
  is_imported BOOLEAN NOT NULL DEFAULT FALSE,
  imported_transaction_id UUID REFERENCES public.bank_transactions(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Add source tracking to bank_transactions table
ALTER TABLE public.bank_transactions 
  ADD COLUMN IF NOT EXISTS source TEXT DEFAULT 'bank_integration' 
  CHECK (source IN ('bank_integration', 'manual_upload', 'import'));

-- Add reference to statement upload
ALTER TABLE public.bank_transactions
  ADD COLUMN IF NOT EXISTS statement_upload_id UUID REFERENCES public.bank_statement_uploads(id) ON DELETE SET NULL;

-- Create indexes
CREATE INDEX idx_bank_statement_uploads_restaurant ON public.bank_statement_uploads(restaurant_id);
CREATE INDEX idx_bank_statement_uploads_status ON public.bank_statement_uploads(status);
CREATE INDEX idx_bank_statement_lines_statement ON public.bank_statement_lines(statement_upload_id);
CREATE INDEX idx_bank_statement_lines_date ON public.bank_statement_lines(transaction_date);
CREATE INDEX idx_bank_transactions_source ON public.bank_transactions(source);
CREATE INDEX idx_bank_transactions_statement_upload ON public.bank_transactions(statement_upload_id);

-- Enable RLS
ALTER TABLE public.bank_statement_uploads ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.bank_statement_lines ENABLE ROW LEVEL SECURITY;

-- RLS Policies for bank_statement_uploads
CREATE POLICY "Users can view statement uploads for their restaurants"
  ON public.bank_statement_uploads FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM public.user_restaurants
      WHERE user_restaurants.restaurant_id = bank_statement_uploads.restaurant_id
      AND user_restaurants.user_id = auth.uid()
    )
  );

CREATE POLICY "Owners and managers can manage statement uploads"
  ON public.bank_statement_uploads FOR ALL
  USING (
    EXISTS (
      SELECT 1 FROM public.user_restaurants
      WHERE user_restaurants.restaurant_id = bank_statement_uploads.restaurant_id
      AND user_restaurants.user_id = auth.uid()
      AND user_restaurants.role IN ('owner', 'manager')
    )
  );

-- RLS Policies for bank_statement_lines
CREATE POLICY "Users can view statement lines for their restaurants"
  ON public.bank_statement_lines FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM public.bank_statement_uploads bsu
      JOIN public.user_restaurants ur ON bsu.restaurant_id = ur.restaurant_id
      WHERE bsu.id = bank_statement_lines.statement_upload_id
      AND ur.user_id = auth.uid()
    )
  );

CREATE POLICY "Owners and managers can manage statement lines"
  ON public.bank_statement_lines FOR ALL
  USING (
    EXISTS (
      SELECT 1 FROM public.bank_statement_uploads bsu
      JOIN public.user_restaurants ur ON bsu.restaurant_id = ur.restaurant_id
      WHERE bsu.id = bank_statement_lines.statement_upload_id
      AND ur.user_id = auth.uid()
      AND ur.role IN ('owner', 'manager')
    )
  );

-- Trigger to update updated_at timestamps
CREATE TRIGGER update_bank_statement_uploads_updated_at
  BEFORE UPDATE ON public.bank_statement_uploads
  FOR EACH ROW
  EXECUTE FUNCTION public.update_accounting_updated_at();

CREATE TRIGGER update_bank_statement_lines_updated_at
  BEFORE UPDATE ON public.bank_statement_lines
  FOR EACH ROW
  EXECUTE FUNCTION public.update_accounting_updated_at();
