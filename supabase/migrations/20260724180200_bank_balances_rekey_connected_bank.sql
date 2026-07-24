-- Bank re-authentication flow — Stripe balance-row identity fix.
--
-- ROOT CAUSE (production incident 2026-07-24, Huntington reconnect):
--   The Stripe balance upserts in stripe-financial-connections-webhook,
--   stripe-verify-connection-session, and stripe-refresh-balance keyed
--   ON CONFLICT on stripe_financial_account_id. Stripe Financial Connections
--   mints a NEW fca_ id for every account on each reconnect, so the upsert of
--   the reconnected account did not match the pre-reconnect row (old fca_) and
--   INSERTED a second row instead. Two real accounts became four balance rows
--   ("4 accounts instead of two"), the dashboard summed all four, and the
--   orphaned old-fca_ row then made stripe-sync-transactions retrieve a dead
--   account, see it inactive, and re-flag the whole bank requires_reauth
--   seconds after the user finished reconnecting (the reauth loop).
--
-- INVARIANT (corrected): bank_account_balances is NOT one-row-per-bank. It also
-- holds non-Stripe rows: CSV/statement-import balances and the historical
-- reconciliation snapshots that useReconcileTransactions APPENDS
-- (stripe_financial_account_id IS NULL). The true invariant is narrower:
--   at most ONE Stripe-origin balance row (fca_ NOT NULL) per connected bank.
-- fca_ is a mutable attribute of that single Stripe row, not its key; the key
-- is connected_bank_id, scoped to Stripe-origin rows. This migration makes the
-- schema enforce exactly that, and nothing wider — non-Stripe snapshot rows are
-- left completely alone.
--
-- The pre-existing UNIQUE(stripe_financial_account_id) constraint is KEPT: each
-- Stripe account id still maps to one row, it permits multiple NULLs (so
-- snapshots coexist), and the reconnect duplicate never violated it (the
-- duplicate carried a new, distinct fca_). It is orthogonal to this fix.
--
-- Idempotent: guarded so a re-run (or a partially-applied deploy) is a no-op.

-- ============================================================
-- Step 1 — retire duplicate STRIPE-origin balance rows created by the
-- fca-keyed upserts. Scope strictly to stripe_financial_account_id IS NOT NULL
-- so CSV/statement/reconciliation snapshot rows (fca_ NULL) are NEVER touched.
-- For each connected_bank_id keep exactly one Stripe row: prefer the one whose
-- fca_ matches the connected bank's CURRENT fca_ (the live account after
-- reconnect); otherwise keep the freshest by as_of_date, then created_at, then
-- id. Must run before the partial unique index below or its creation would
-- fail. Measured on production 2026-07-24: deletes exactly 2 rows (the
-- Huntington orphans), touches 0 current-fca rows and 0 snapshot rows.
-- ============================================================

WITH ranked AS (
  SELECT bab.id,
         row_number() OVER (
           PARTITION BY bab.connected_bank_id
           ORDER BY (bab.stripe_financial_account_id
                       IS NOT DISTINCT FROM cb.stripe_financial_account_id) DESC,
                    bab.as_of_date  DESC NULLS LAST,
                    bab.created_at  DESC NULLS LAST,
                    bab.id          DESC
         ) AS rn
    FROM public.bank_account_balances bab
    JOIN public.connected_banks cb ON cb.id = bab.connected_bank_id
   WHERE bab.stripe_financial_account_id IS NOT NULL   -- Stripe-origin rows only
)
DELETE FROM public.bank_account_balances b
 USING ranked r
 WHERE b.id = r.id
   AND r.rn > 1;

-- ============================================================
-- Step 2 — add the identity key as a PARTIAL unique index.
-- Uniqueness applies only to Stripe-origin rows (stripe_financial_account_id
-- IS NOT NULL), so a reconnect can never spawn a second Stripe row for a bank,
-- while reconciliation/CSV/manual snapshot rows (fca_ NULL) remain unconstrained
-- and may coexist freely. PostgREST's upsert on_conflict cannot attach the WHERE
-- predicate a partial index needs, so the Stripe balance writes go through the
-- upsert_stripe_bank_balance() SECURITY DEFINER RPC (next migration), whose
-- ON CONFLICT clause repeats this predicate verbatim — the same pattern
-- connected_banks_identity_uniq / reconnect_connected_bank already use.
--
-- Plain (non-unique) index idx_bank_account_balances_stripe_account and the
-- UNIQUE(stripe_financial_account_id) constraint both already exist from
-- 20251019221101 and are intentionally left in place.
--
-- Note on locking: a plain CREATE UNIQUE INDEX briefly blocks writes to this
-- table during the build. bank_account_balances is tiny (~1 row per account,
-- low-tens of rows in production) and its writers are infrequent bank webhooks,
-- so the window is sub-millisecond; CONCURRENTLY is intentionally not used here
-- because it cannot run inside the migration's transaction and the table's
-- scale makes it unnecessary. If a duplicate raced in between Step 1 and this
-- build, the unique build fails and the whole migration rolls back (fails
-- closed) rather than committing a bad state.
-- ============================================================

CREATE UNIQUE INDEX IF NOT EXISTS bank_account_balances_stripe_bank_uniq
    ON public.bank_account_balances (connected_bank_id)
    WHERE stripe_financial_account_id IS NOT NULL;

COMMENT ON INDEX public.bank_account_balances_stripe_bank_uniq IS
  'At most one Stripe-origin balance row (fca_ NOT NULL) per connected bank (design invariant). Reconnect upserts go through upsert_stripe_bank_balance() and rotate stripe_financial_account_id in place, so a new fca_ can never spawn a duplicate Stripe row. Partial so reconciliation/CSV snapshot rows (fca_ NULL) coexist freely. Incident: 2026-07-24 Huntington reconnect.';
