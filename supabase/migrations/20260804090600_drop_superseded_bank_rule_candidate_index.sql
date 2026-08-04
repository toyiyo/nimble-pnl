-- Superseded by idx_bank_transactions_rule_candidates_v2 -- same partial
-- predicate, same leading column, plus rules_evaluated_at.
--
-- DROP INDEX CONCURRENTLY has the same no-transaction restriction as CREATE,
-- so this file contains only this statement.
-- Design: docs/superpowers/specs/2026-08-03-pos-sync-categorization-rescan-design.md §3.6
DROP INDEX CONCURRENTLY IF EXISTS public.idx_bank_transactions_rule_candidates;
