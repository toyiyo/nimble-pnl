-- Audit table for integration lifecycle events (disconnect events, PR 1).
-- Rows stay after the connection row is deleted, so there is no FK to a connection.
-- Only service_role and SECURITY DEFINER functions write to this table.

CREATE TABLE IF NOT EXISTS public.integration_events (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  restaurant_id    uuid NOT NULL REFERENCES public.restaurants(id) ON DELETE CASCADE,
  integration      text NOT NULL CHECK (integration IN
                     ('revel','toast','square','clover','shift4','focus','bank')),
  event            text NOT NULL CHECK (event IN
                     ('connect','disconnect','pause','resume','auth_failure')),
  actor_user_id    uuid NULL REFERENCES auth.users(id) ON DELETE SET NULL,
  reason           text NULL CHECK (reason IN ('switching_pos','credentials_changed',
                     'temporary_close','no_value','too_expensive','other')),
  reason_text      text NULL CHECK (char_length(reason_text) <= 500),
  details          jsonb NOT NULL DEFAULT '{}'::jsonb,
  alert_claimed_at timestamptz NULL,
  alerted_at       timestamptz NULL,
  created_at       timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_integration_events_restaurant_created
  ON public.integration_events (restaurant_id, created_at DESC);

ALTER TABLE public.integration_events ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Owners and managers can read integration events"
  ON public.integration_events;
CREATE POLICY "Owners and managers can read integration events"
  ON public.integration_events
  FOR SELECT TO authenticated
  USING (public.user_has_role(restaurant_id, ARRAY['owner','manager']));

REVOKE ALL ON public.integration_events FROM PUBLIC, anon, authenticated, service_role;
GRANT SELECT ON public.integration_events TO authenticated;
GRANT SELECT, INSERT ON public.integration_events TO service_role;
GRANT UPDATE (alert_claimed_at, alerted_at) ON public.integration_events TO service_role;
