-- Candidate index for apply_rules_to_pos_sales_internal's batch selection.
--
-- Supersedes idx_unified_sales_rule_candidates (restaurant_id, sale_date DESC)
-- with the same partial predicate. rules_evaluated_at is inserted as the second
-- key so the new `rules_evaluated_at < v_rules_changed_at` predicate is an index
-- range condition rather than a heap filter: once a restaurant's rows have all
-- been stamped, the scan finds nothing without touching them.
--
-- Column order is deliberate. (restaurant_id, rules_evaluated_at) makes the
-- steady state -- zero unevaluated rows -- an empty range scan, which is the
-- case that runs 288 times a day. The trailing sale_date DESC still orders
-- within a single rules_evaluated_at value, which is the shape of the drain
-- (every unevaluated row sits at '-infinity'), so the ORDER BY ... LIMIT is
-- satisfied from the index there too.
--
-- CONCURRENTLY cannot run inside a transaction, so this lives in its own
-- migration file containing only this statement.
-- Design: docs/superpowers/specs/2026-08-03-pos-sync-categorization-rescan-design.md §3.6
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_unified_sales_rule_candidates_v2
  ON public.unified_sales (restaurant_id, rules_evaluated_at, sale_date DESC)
  WHERE is_split = false AND (is_categorized = false OR category_id IS NULL);
