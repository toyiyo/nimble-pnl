-- Per-list email unsubscribe ledger.
--
-- `list` enumerates the email families a user can opt out of:
--   * 'trial_lifecycle' - the 4-step trial-expiry sequence
--   * 'marketing'       - future marketing/lead-magnet emails
--   * 'all'             - global opt-out (skip every list)
--
-- The unique (user_id, list) constraint plus an INSERT ... ON CONFLICT DO
-- NOTHING from the unsubscribe-email edge function makes the write idempotent.
-- Service-role bypasses RLS; no policies needed for now.

CREATE TABLE IF NOT EXISTS public.email_unsubscribes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  list TEXT NOT NULL CHECK (list IN ('trial_lifecycle', 'marketing', 'all')),
  unsubscribed_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  source TEXT,
  UNIQUE (user_id, list)
);

CREATE INDEX IF NOT EXISTS email_unsubscribes_user_idx
  ON public.email_unsubscribes(user_id);

ALTER TABLE public.email_unsubscribes ENABLE ROW LEVEL SECURITY;

COMMENT ON TABLE public.email_unsubscribes IS
  'Per-list email unsubscribe ledger. Service-role only; checked by trial-expiry-emails RPC.';
