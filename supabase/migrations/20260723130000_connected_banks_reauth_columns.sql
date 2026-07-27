-- Bank re-authentication flow — schema (design §3.1).
--
-- Adds the three columns the reauth flow needs on connected_banks, backfills
-- account_mask from bank_account_balances, and adds a partial unique index
-- that makes reconnect matching identity-safe (restaurant + institution +
-- last4, only among "live" rows). Also adds a supporting composite index on
-- bank_transactions for the data_current_through recompute.

ALTER TABLE public.connected_banks
  ADD COLUMN IF NOT EXISTS account_mask text,
  ADD COLUMN IF NOT EXISTS deactivated_at timestamptz,
  ADD COLUMN IF NOT EXISTS data_current_through timestamptz;

COMMENT ON COLUMN public.connected_banks.account_mask IS
  'Stripe account.last4. Backfilled from bank_account_balances; written going '
  'forward on account.created. Needed on the bank row (not just the balances '
  'row) to make reconnect matching identity-safe.';

COMMENT ON COLUMN public.connected_banks.deactivated_at IS
  'When Stripe told us the authorization died (financial_connections.account.deactivated). '
  'Drives the day_1/day_4/day_10 escalation ladder. Nulled on reactivation/reconnect.';

COMMENT ON COLUMN public.connected_banks.data_current_through IS
  'MAX(transaction_date) over bank_transactions actually held for this bank, '
  'recomputed after a successful stripe-sync-transactions fetch. This is what '
  'the UI prints for freshness — never last_sync_at. NULL means "never proven fresh".';

-- Backfill account_mask from the balances row that already carries it.
-- data_current_through is deliberately left NULL: NULL means "we have never
-- proven freshness" and the UI renders that as "Not yet verified" rather than
-- inventing a date.
UPDATE public.connected_banks cb
SET account_mask = b.account_mask
FROM public.bank_account_balances b
WHERE b.connected_bank_id = cb.id
  AND cb.account_mask IS NULL
  AND b.account_mask IS NOT NULL;

-- Identity-safe reconnect matching: only one *live* (non-disconnected) row
-- per (restaurant, institution, last4). Disconnected rows are excluded from
-- the predicate so history is never blocked, and a NULL account_mask never
-- conflicts (NULLs are distinct in a unique index) — the legacy/unknown-mask
-- path simply inserts.
CREATE UNIQUE INDEX IF NOT EXISTS connected_banks_identity_uniq
  ON public.connected_banks (restaurant_id, institution_name, account_mask)
  WHERE status <> 'disconnected' AND account_mask IS NOT NULL;

-- Supports the data_current_through recompute in stripe-sync-transactions: a
-- backward index scan for MAX(transaction_date) per connected_bank_id.
-- bank_transactions only had idx_bank_transactions_bank(connected_bank_id)
-- before this.
CREATE INDEX IF NOT EXISTS idx_bank_transactions_bank_date
  ON public.bank_transactions (connected_bank_id, transaction_date DESC);
