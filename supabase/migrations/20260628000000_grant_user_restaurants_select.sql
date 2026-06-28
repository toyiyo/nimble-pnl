-- Restore table-level privileges for authenticated and anon roles.
--
-- Context: Supabase local CLI ≥ 2.x runs migrations as the `postgres` role whose
-- default-privilege entry (pg_default_acl) grants only Dxtm (DELETE/TRUNCATE/
-- TRIGGER/REFERENCES) to authenticated/anon — not SELECT/INSERT/UPDATE.
-- Older CLI builds (used in CI as of 2.65.5) and Supabase-hosted run migrations
-- as supabase_admin whose default-privilege entry grants arwdDxtm (ALL), so every
-- table created in CI/production automatically gets full CRUD for authenticated.
--
-- Without table-level SELECT, any RLS USING clause that subqueries another table
-- fails with "permission denied for table X" rather than the expected RLS policy
-- error — breaking both pgTAP tests and E2E helpers that seed data as the
-- authenticated user.
--
-- Adding explicit GRANT SELECT/INSERT/UPDATE/DELETE is safe because RLS policies
-- still control which rows each role can read or write; the grant is merely the
-- prerequisite for PostgreSQL to evaluate RLS at all.
--
-- The correct long-term fix is ALTER DEFAULT PRIVILEGES, but that only applies to
-- future tables, so we GRANT on all existing public tables here.  New tables added
-- in later migrations should carry their own GRANT statements (as the invoicing and
-- toast migrations already do).

-- Full CRUD for authenticated on all existing public tables.
-- RLS policies restrict actual row access; the grants just unlock the table gate.
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO authenticated;

-- anon gets read-only on all tables; individual migrations may tighten this further
-- (e.g. the "Deny anonymous access" policies on invoice_payments, etc.).
GRANT SELECT ON ALL TABLES IN SCHEMA public TO anon;

-- auth_audit_log: anon also needs INSERT/UPDATE/DELETE because the kiosk (anon)
-- creates audit entries when PINs are checked, and pgTAP tests run cleanup as anon.
GRANT INSERT, UPDATE, DELETE ON public.auth_audit_log TO anon;

-- Ensure the cron schema is accessible (needed for pg_cron functions).
GRANT USAGE ON SCHEMA cron TO authenticated, anon;
