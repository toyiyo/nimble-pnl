-- ============================================================
-- §  Re-patch _sync_focus_transactions_to_unified_sales_impl
--    after 20260703120000_focus_backfill_reliability.sql
--
-- Migration 20260703120000 (merged from PR #567) re-creates
-- _sync_focus_transactions_to_unified_sales_impl with the old
-- auth-gated categorization block:
--
--   IF auth.uid() IS NOT NULL THEN
--     PERFORM apply_rules_to_pos_sales(p_restaurant_id, 10000);
--   ELSE
--     RAISE LOG '... skipping batch categorization ...';
--   END IF;
--
-- That undoes the §6 gate rewrite from 20260703090000 (which ran
-- earlier in the same migration set). This migration runs AFTER
-- 20260703120000 and re-applies the unconditional internal call,
-- using the same regexp_replace pattern as §6.
--
-- Idempotent: skips if the function already contains
-- 'apply_rules_to_pos_sales_internal'.
-- ============================================================
DO $$
DECLARE
  v_fn  regprocedure;
  v_src text;
  v_new text;
BEGIN
  -- Resolve the specific overload we need to patch.
  SELECT p.oid::regprocedure
    INTO v_fn
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'public'
     AND p.oid::regprocedure::text = '_sync_focus_transactions_to_unified_sales_impl(uuid,date,date)';

  IF v_fn IS NULL THEN
    RAISE EXCEPTION
      'gate rewrite: _sync_focus_transactions_to_unified_sales_impl(uuid,date,date) not found';
  END IF;

  v_src := pg_get_functiondef(v_fn);

  -- Idempotency: already patched — skip.
  IF v_src LIKE '%apply_rules_to_pos_sales_internal%' THEN
    RAISE LOG 'gate rewrite: _sync_focus_transactions_to_unified_sales_impl already patched — skipping';
    RETURN;
  END IF;

  -- Replace the auth-gated block with an unconditional internal call.
  v_new := regexp_replace(
    v_src,
    'IF auth\.uid\(\) IS NOT NULL THEN\s*PERFORM apply_rules_to_pos_sales\(p_restaurant_id, 10000\);\s*ELSE\s*RAISE LOG\s*[^;]+;\s*END IF;',
    'PERFORM apply_rules_to_pos_sales_internal(p_restaurant_id, 10000);'
  );

  -- Drift guard: pattern not found.
  IF v_new = v_src THEN
    RAISE EXCEPTION
      'gate rewrite: categorization gate not found in _sync_focus_transactions_to_unified_sales_impl — migration aborted (body drifted?)';
  END IF;

  EXECUTE v_new;
  RAISE LOG 'gate rewrite: patched _sync_focus_transactions_to_unified_sales_impl';
END;
$$;
