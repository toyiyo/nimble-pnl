-- Add cost snapshot fields to production run ingredients for auditability
ALTER TABLE public.production_run_ingredients
  ADD COLUMN IF NOT EXISTS unit_cost_snapshot NUMERIC,
  ADD COLUMN IF NOT EXISTS total_cost_snapshot NUMERIC;

COMMENT ON COLUMN public.production_run_ingredients.unit_cost_snapshot IS 'Unit cost at time of production completion (locked snapshot)';
COMMENT ON COLUMN public.production_run_ingredients.total_cost_snapshot IS 'Total cost (unit cost x actual qty) locked at completion';
