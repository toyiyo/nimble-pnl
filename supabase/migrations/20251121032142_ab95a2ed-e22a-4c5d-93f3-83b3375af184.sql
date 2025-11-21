-- Create rule application log table for tracking categorization rule applications
CREATE TABLE IF NOT EXISTS public.rule_application_log (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  rule_id UUID NOT NULL REFERENCES public.categorization_rules(id) ON DELETE CASCADE,
  transaction_id UUID,
  pos_sale_id UUID,
  category_id UUID NOT NULL REFERENCES public.chart_of_accounts(id) ON DELETE CASCADE,
  applied_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  result TEXT NOT NULL CHECK (result IN ('success', 'skipped', 'error')),
  error_message TEXT,
  restaurant_id UUID NOT NULL REFERENCES public.restaurants(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Add index for efficient querying
CREATE INDEX idx_rule_application_log_rule_id ON public.rule_application_log(rule_id);
CREATE INDEX idx_rule_application_log_transaction_id ON public.rule_application_log(transaction_id) WHERE transaction_id IS NOT NULL;
CREATE INDEX idx_rule_application_log_pos_sale_id ON public.rule_application_log(pos_sale_id) WHERE pos_sale_id IS NOT NULL;
CREATE INDEX idx_rule_application_log_restaurant_id ON public.rule_application_log(restaurant_id);
CREATE INDEX idx_rule_application_log_applied_at ON public.rule_application_log(applied_at DESC);

-- Enable RLS
ALTER TABLE public.rule_application_log ENABLE ROW LEVEL SECURITY;

-- RLS Policies
CREATE POLICY "Users can view rule logs for their restaurants"
  ON public.rule_application_log
  FOR SELECT
  USING (
    restaurant_id IN (
      SELECT restaurant_id 
      FROM public.user_restaurants 
      WHERE user_id = auth.uid()
    )
  );

-- Only system/functions can insert logs (users don't manually create them)
CREATE POLICY "System can insert rule logs"
  ON public.rule_application_log
  FOR INSERT
  WITH CHECK (true);

COMMENT ON TABLE public.rule_application_log IS 'Logs when categorization rules are applied to transactions or POS sales, useful for debugging and auditing';
COMMENT ON COLUMN public.rule_application_log.result IS 'Outcome: success (rule applied), skipped (rule did not match), error (rule matching failed)';
COMMENT ON COLUMN public.rule_application_log.transaction_id IS 'Bank transaction ID if rule was applied to a bank transaction';
COMMENT ON COLUMN public.rule_application_log.pos_sale_id IS 'POS sale ID if rule was applied to a POS sale';