-- Trial-expiry email dedupe ledger.
-- One row per (restaurant, owner, email_type) actually sent. Uniqueness on
-- that triple is the dedupe gate; the candidate-selection RPC also filters
-- on NOT EXISTS over this table so we never re-render an email we already
-- shipped.
--
-- Service-role key bypasses RLS for the trial-expiry-emails edge function;
-- no policies needed (the table is server-only).

CREATE TABLE IF NOT EXISTS public.trial_emails_sent (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  restaurant_id UUID NOT NULL REFERENCES public.restaurants(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  email_type TEXT NOT NULL CHECK (email_type IN ('halfway', '3_days', 'tomorrow', 'expired')),
  variant TEXT NOT NULL CHECK (variant IN ('activated', 'not_activated')),
  sent_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  resend_message_id TEXT,
  trial_day_at_send INTEGER NOT NULL,
  UNIQUE (restaurant_id, user_id, email_type)
);

CREATE INDEX IF NOT EXISTS trial_emails_sent_user_idx
  ON public.trial_emails_sent(user_id);

CREATE INDEX IF NOT EXISTS trial_emails_sent_restaurant_idx
  ON public.trial_emails_sent(restaurant_id);

CREATE INDEX IF NOT EXISTS trial_emails_sent_sent_at_idx
  ON public.trial_emails_sent(sent_at DESC);

ALTER TABLE public.trial_emails_sent ENABLE ROW LEVEL SECURITY;

COMMENT ON TABLE public.trial_emails_sent IS
  'Dedupe ledger for trial-expiry email sequence. Service-role only; no RLS policies.';
