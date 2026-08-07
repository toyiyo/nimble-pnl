-- Candidate index for apply_rules_to_bank_transactions_internal's batch
-- selection. Mirrors idx_unified_sales_rule_candidates_v2; supersedes
-- idx_bank_transactions_rule_candidates, which carried the same partial
-- predicate without the rules_evaluated_at key.
--
-- CONCURRENTLY cannot run inside a transaction, so this lives in its own
-- migration file containing only this statement.
-- Design: docs/superpowers/specs/2026-08-03-pos-sync-categorization-rescan-design.md §3.6
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_bank_transactions_rule_candidates_v2
  ON public.bank_transactions (restaurant_id, rules_evaluated_at, transaction_date DESC)
  WHERE is_split = false AND excluded_reason IS NULL
    AND (is_categorized = false OR category_id IS NULL);
