-- Ensure key tables have the correct grants for authenticated and anon roles.
--
-- Context: Supabase local CLI ≥ 2.x runs migrations as the `postgres` role whose
-- default-privilege entry in pg_default_acl grants only Dxtm (DELETE/TRUNCATE/
-- TRIGGER/REFERENCES) to authenticated/anon, not SELECT/INSERT/UPDATE.
-- Older CLI builds (used in CI as of 2.65.5) and Supabase-hosted run migrations
-- as supabase_admin whose default-privilege entry grants arwdDxtm (ALL) — so
-- tables created there automatically have SELECT (and INSERT/UPDATE) for
-- authenticated.
--
-- Without table-level SELECT, any RLS USING clause that subqueries another table
-- fails with "permission denied" rather than the expected "row violates RLS policy"
-- — breaking tests and, in production, any client call that hits those code paths.
--
-- Without table-level INSERT/UPDATE where the RLS policy is supposed to block it,
-- tests expecting "row-level security policy" get "permission denied" instead.
--
-- Adding explicit GRANT SELECT/INSERT/UPDATE is safe: RLS policies still control
-- which rows each role can read/write; the grant is merely the gate that lets
-- PostgreSQL evaluate RLS.

-- Core lookup tables used as subqueries in other tables' RLS policies
GRANT SELECT ON public.user_restaurants TO authenticated, anon;
GRANT SELECT ON public.restaurants      TO authenticated, anon;
GRANT SELECT ON public.employees        TO authenticated, anon;

-- Tables where authenticated needs INSERT so RLS (not grant-level check) blocks
-- unauthorized writes (matching the behavior in Supabase-hosted / CI environment)
GRANT INSERT, UPDATE ON public.invoice_payments TO authenticated;

-- Tables used in tests that require SELECT access for authenticated users
GRANT SELECT, INSERT, UPDATE, DELETE ON public.auth_audit_log            TO authenticated, anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.prep_recipes              TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.prep_recipe_ingredients   TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.production_runs           TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.production_run_ingredients TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.employee_pins             TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.tip_splits                TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.tip_split_items           TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.receipt_imports           TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.receipt_line_items        TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.restaurant_financial_settings TO authenticated;
