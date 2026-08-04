-- Negative-result cache for the rule-matching sweeps.
--
-- apply_rules_to_pos_sales_internal / apply_rules_to_bank_transactions_internal
-- re-evaluated every uncategorized row against every active rule on every cron
-- tick (288x/day for Toast). Rows that match nothing stayed candidates forever.
-- rules_evaluated_at records "this row was already evaluated against the rule
-- set as of <timestamp>"; the sweep skips rows whose stamp is at or above the
-- restaurant's current rule watermark.
--
-- '-infinity' is a non-volatile constant, so on PG 11+ this ADD COLUMN uses the
-- fast-default path: metadata-only, no rewrite of the 190k-row unified_sales
-- heap. Existing rows therefore become candidates exactly once, then drain.
--
-- Design: docs/superpowers/specs/2026-08-03-pos-sync-categorization-rescan-design.md §3.1, §3.5

ALTER TABLE public.unified_sales
  ADD COLUMN IF NOT EXISTS rules_evaluated_at timestamptz NOT NULL DEFAULT '-infinity';

ALTER TABLE public.bank_transactions
  ADD COLUMN IF NOT EXISTS rules_evaluated_at timestamptz NOT NULL DEFAULT '-infinity';

COMMENT ON COLUMN public.unified_sales.rules_evaluated_at IS
  'Rule watermark this row was last evaluated against by '
  'apply_rules_to_pos_sales_internal. -infinity means "never evaluated". '
  'Reset to -infinity by trigger when item_name/total_price/pos_category change.';

COMMENT ON COLUMN public.bank_transactions.rules_evaluated_at IS
  'Rule watermark this row was last evaluated against by '
  'apply_rules_to_bank_transactions_internal. -infinity means "never evaluated". '
  'Reset to -infinity by trigger when description/amount/supplier_id change.';

-- Reset the cache when the row's own match inputs change.
--
-- A trigger rather than patching each writer: POS sync RPCs, edge-function
-- PostgREST upserts, and manual UI edits all reach these tables by different
-- paths, and an ON CONFLICT DO UPDATE in one of them is not visible to the
-- others. The trigger deliberately does NOT honour
-- app.skip_unified_sales_triggers -- suppressing it would silently poison the
-- cache for exactly the rows a sync just rewrote.
CREATE OR REPLACE FUNCTION public.reset_unified_sales_rules_evaluated_at()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog, public
AS $$
BEGIN
  IF NEW.item_name    IS DISTINCT FROM OLD.item_name
  OR NEW.total_price  IS DISTINCT FROM OLD.total_price
  OR NEW.pos_category IS DISTINCT FROM OLD.pos_category THEN
    NEW.rules_evaluated_at := '-infinity';
  END IF;
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.reset_bank_transactions_rules_evaluated_at()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog, public
AS $$
BEGIN
  IF NEW.description IS DISTINCT FROM OLD.description
  OR NEW.amount      IS DISTINCT FROM OLD.amount
  OR NEW.supplier_id IS DISTINCT FROM OLD.supplier_id THEN
    NEW.rules_evaluated_at := '-infinity';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trigger_reset_unified_sales_rules_evaluated_at
  ON public.unified_sales;
CREATE TRIGGER trigger_reset_unified_sales_rules_evaluated_at
  BEFORE UPDATE ON public.unified_sales
  FOR EACH ROW
  EXECUTE FUNCTION public.reset_unified_sales_rules_evaluated_at();

DROP TRIGGER IF EXISTS trigger_reset_bank_transactions_rules_evaluated_at
  ON public.bank_transactions;
CREATE TRIGGER trigger_reset_bank_transactions_rules_evaluated_at
  BEFORE UPDATE ON public.bank_transactions
  FOR EACH ROW
  EXECUTE FUNCTION public.reset_bank_transactions_rules_evaluated_at();

NOTIFY pgrst, 'reload schema';
