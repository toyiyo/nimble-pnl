-- Serves the per-restaurant max(synced_at) probe in
-- sync_all_toast_to_unified_sales(). One statement per file: the CLI
-- pipelines a file's statements, and CONCURRENTLY cannot run inside a
-- transaction (prior art: 20260524120100_add_file_hash_indexes.sql).
--
-- No CLI comment directive turns off the pipeline. `supabase db reset`
-- and `supabase db start` fail on this file with SQLSTATE 25001 (checked
-- with CLI 2.72.7). This gap pre-dates this file. It also hits
-- 20260804090500_drop_superseded_rule_candidate_indexes.sql. A separate
-- task tracks a fix for local replay.
--
-- `supabase db push --include-all` does not use the pipeline. It applies
-- this file with no error (checked against a full local-DB clone on CLI
-- 2.72.7). Production deploy uses this same push command
-- (.github/workflows/deploy-supabase.yml). This file is safe to ship.
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_toast_orders_restaurant_synced_at
  ON public.toast_orders (restaurant_id, synced_at DESC);
