-- Derive a trial_expired status from a stored status and a trial end date.
-- The helper reads no table. The caller reads restaurants under RLS.
-- Boundary: the gates keep access while NOW() <= trial_ends_at, so the
-- helper returns trial_expired only when trial_ends_at < now().

CREATE OR REPLACE FUNCTION public.effective_subscription_status(
  p_status TEXT,
  p_trial_ends_at TIMESTAMPTZ
) RETURNS TEXT
LANGUAGE sql
STABLE
PARALLEL SAFE
SECURITY INVOKER
SET search_path = ''
AS $$
  SELECT CASE
    WHEN p_status = 'trialing'
     AND p_trial_ends_at IS NOT NULL
     AND p_trial_ends_at < pg_catalog.now()
    THEN 'trial_expired'
    ELSE p_status
  END;
$$;

REVOKE ALL ON FUNCTION public.effective_subscription_status(TEXT, TIMESTAMPTZ) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.effective_subscription_status(TEXT, TIMESTAMPTZ)
  TO authenticated, service_role;

COMMENT ON FUNCTION public.effective_subscription_status(TEXT, TIMESTAMPTZ) IS
  'Returns trial_expired when status is trialing and trial_ends_at is in the past. Otherwise returns the stored status.';
