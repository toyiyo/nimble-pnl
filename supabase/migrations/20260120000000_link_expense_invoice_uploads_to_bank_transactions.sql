-- Link expense invoice uploads to bank transactions for matched expenses
ALTER TABLE public.bank_transactions
  ADD COLUMN IF NOT EXISTS expense_invoice_upload_id UUID
  REFERENCES public.expense_invoice_uploads(id)
  ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_bank_transactions_expense_invoice_upload_id
  ON public.bank_transactions(expense_invoice_upload_id)
  WHERE expense_invoice_upload_id IS NOT NULL;
