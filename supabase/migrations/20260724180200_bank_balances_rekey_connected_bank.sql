-- Bank re-authentication flow — balance-row identity fix.
--
-- ROOT CAUSE (production incident 2026-07-24, Huntington reconnect):
--   bank_account_balances' only unique key was stripe_financial_account_id
--   (bank_account_balances_stripe_account_unique). Stripe Financial
--   Connections mints a NEW fca_ id for every account on each reconnect, so
--   the fca-keyed upserts in stripe-financial-connections-webhook,
--   stripe-verify-connection-session, and stripe-refresh-balance MISS the
--   pre-reconnect row and INSERT a second one. The old-fca row is never
--   retired. Two real accounts became four balance rows ("4 accounts instead
--   of two"), and the orphaned old-fca row then made stripe-sync-transactions
--   retrieve a dead account, see it inactive, and re-flag the whole bank
--   requires_reauth seconds after the user finished reconnecting (the loop).
--
-- The real identity of a balance row is its connected_banks row: the
-- invariant is 1 connected_banks row <-> 1 account <-> 1 balance row (verified
-- 1:1 across every institution in production). fca_ is a MUTABLE attribute of
-- that row, not its key. This migration makes the schema say so.
--
-- Idempotent: guarded so a re-run (or a partially-applied deploy) is a no-op.

-- ============================================================
-- Step 1 — retire duplicate balance rows created by fca-keyed upserts.
-- For each connected_bank_id keep exactly one row: prefer the one whose fca
-- matches the connected bank's CURRENT fca (the live account after reconnect);
-- otherwise keep the freshest by as_of_date, then created_at, then id. This
-- must run before the unique index below or its creation would fail.
-- Measured on production 2026-07-24: deletes exactly 2 rows (the Huntington
-- orphans), touches 0 current-fca rows.
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
)
DELETE FROM public.bank_account_balances b
 USING ranked r
 WHERE b.id = r.id
   AND r.rn > 1;

-- ============================================================
-- Step 2 — swap the identity key.
-- Drop the fca uniqueness (fca is now a mutable attribute). It is a UNIQUE
-- CONSTRAINT (not a bare index), so DROP CONSTRAINT is required — DROP INDEX
-- is rejected while the constraint depends on it. Keep a plain, non-unique
-- index on stripe_financial_account_id for lookups (created defensively in
-- case dropping the constraint removed the only index on the column). Then add
-- uniqueness on connected_bank_id, the true 1:1 key; connected_bank_id is
-- NOT NULL, so this fully enforces one balance row per connected bank.
-- ============================================================

ALTER TABLE public.bank_account_balances
  DROP CONSTRAINT IF EXISTS bank_account_balances_stripe_account_unique;

CREATE INDEX IF NOT EXISTS idx_bank_account_balances_stripe_account
    ON public.bank_account_balances (stripe_financial_account_id);

CREATE UNIQUE INDEX IF NOT EXISTS bank_account_balances_connected_bank_uniq
    ON public.bank_account_balances (connected_bank_id);

COMMENT ON INDEX public.bank_account_balances_connected_bank_uniq IS
  'One balance row per connected bank (1:1 invariant). Reconnect upserts key on connected_bank_id and rotate stripe_financial_account_id in place, so a new fca_ can never spawn a duplicate row. Incident: 2026-07-24 Huntington reconnect.';
