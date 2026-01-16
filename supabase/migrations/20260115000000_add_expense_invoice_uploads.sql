-- Expense invoice uploads for vendor bill OCR and expense creation
CREATE TABLE public.expense_invoice_uploads (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  restaurant_id UUID NOT NULL REFERENCES public.restaurants(id) ON DELETE CASCADE,
  pending_outflow_id UUID REFERENCES public.pending_outflows(id) ON DELETE SET NULL,
  vendor_name TEXT,
  invoice_number TEXT,
  invoice_date DATE,
  due_date DATE,
  total_amount NUMERIC(15, 2),
  raw_file_url TEXT,
  file_name TEXT,
  file_size INTEGER,
  status TEXT NOT NULL DEFAULT 'uploaded' CHECK (status IN ('uploaded', 'processed', 'saved', 'error')),
  raw_ocr_data JSONB,
  field_confidence JSONB,
  processed_at TIMESTAMPTZ,
  processed_by UUID,
  error_message TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_expense_invoice_uploads_restaurant ON public.expense_invoice_uploads(restaurant_id);
CREATE INDEX idx_expense_invoice_uploads_status ON public.expense_invoice_uploads(status);
CREATE INDEX idx_expense_invoice_uploads_outflow ON public.expense_invoice_uploads(pending_outflow_id);
CREATE INDEX idx_expense_invoice_uploads_invoice_date ON public.expense_invoice_uploads(invoice_date);

ALTER TABLE public.expense_invoice_uploads ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view expense invoice uploads for their restaurants"
  ON public.expense_invoice_uploads FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM public.user_restaurants
      WHERE user_restaurants.restaurant_id = expense_invoice_uploads.restaurant_id
      AND user_restaurants.user_id = auth.uid()
    )
  );

CREATE POLICY "Owners and managers can manage expense invoice uploads"
  ON public.expense_invoice_uploads FOR ALL
  USING (
    EXISTS (
      SELECT 1 FROM public.user_restaurants
      WHERE user_restaurants.restaurant_id = expense_invoice_uploads.restaurant_id
      AND user_restaurants.user_id = auth.uid()
      AND user_restaurants.role IN ('owner', 'manager')
    )
  );

CREATE TRIGGER update_expense_invoice_uploads_updated_at
  BEFORE UPDATE ON public.expense_invoice_uploads
  FOR EACH ROW
  EXECUTE FUNCTION public.update_accounting_updated_at();
