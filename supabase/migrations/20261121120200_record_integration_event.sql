-- Service-role RPCs for integration disconnect events (design 4.3 and 4.5 step 5).
-- No EXECUTE with concatenated input in this file.

CREATE OR REPLACE FUNCTION public.record_integration_event(
  p_restaurant_id uuid,
  p_integration   text,
  p_event         text,
  p_actor_user_id uuid,
  p_reason        text,
  p_reason_text   text,
  p_details       jsonb
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_reason text := NULLIF(btrim(COALESCE(p_reason, '')), '');
  v_text   text := NULLIF(btrim(COALESCE(p_reason_text, '')), '');
  v_id     uuid;
BEGIN
  IF p_integration IS NULL OR p_integration NOT IN
     ('revel','toast','square','clover','shift4','focus','bank') THEN
    RAISE EXCEPTION 'unsupported integration' USING ERRCODE = '22023';
  END IF;
  IF p_event IS NULL OR p_event NOT IN
     ('connect','disconnect','pause','resume','auth_failure') THEN
    RAISE EXCEPTION 'invalid event' USING ERRCODE = '22023';
  END IF;
  IF v_reason IS NOT NULL AND v_reason NOT IN
     ('switching_pos','credentials_changed','temporary_close','no_value','too_expensive','other') THEN
    RAISE EXCEPTION 'invalid reason' USING ERRCODE = '22023';
  END IF;
  IF v_text IS NOT NULL AND char_length(v_text) > 500 THEN
    RAISE EXCEPTION 'reason text is too long' USING ERRCODE = '22023';
  END IF;

  -- Dedupe: same restaurant, integration, event, and actor in the last 60 seconds.
  SELECT e.id INTO v_id
  FROM public.integration_events e
  WHERE e.restaurant_id = p_restaurant_id
    AND e.integration = p_integration
    AND e.event = p_event
    AND e.actor_user_id IS NOT DISTINCT FROM p_actor_user_id
    AND e.created_at > now() - interval '60 seconds'
  ORDER BY e.created_at DESC
  LIMIT 1;

  IF v_id IS NOT NULL THEN
    RETURN v_id;
  END IF;

  INSERT INTO public.integration_events
    (restaurant_id, integration, event, actor_user_id, reason, reason_text, details)
  VALUES
    (p_restaurant_id, p_integration, p_event, p_actor_user_id, v_reason, v_text,
     COALESCE(p_details, '{}'::jsonb))
  RETURNING id INTO v_id;

  RETURN v_id;
END;
$$;

COMMENT ON FUNCTION public.record_integration_event(uuid, text, text, uuid, text, text, jsonb) IS
  'Insert one integration event with a 60-second dedupe. Service role only. Design: docs/superpowers/specs/2026-11-21-integration-disconnect-events-design.md 4.3.';

REVOKE ALL ON FUNCTION public.record_integration_event(uuid, text, text, uuid, text, text, jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.record_integration_event(uuid, text, text, uuid, text, text, jsonb) TO service_role;

CREATE OR REPLACE FUNCTION public.integration_alert_recipients(p_restaurant_id uuid)
RETURNS TABLE (user_id uuid, email text, full_name text, role text)
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = public, pg_temp
AS $$
  SELECT r.user_id, r.email, r.full_name, r.role
  FROM public.bank_reauth_notice_recipients(p_restaurant_id, ARRAY['owner']) r;
$$;

COMMENT ON FUNCTION public.integration_alert_recipients(uuid) IS
  'Owner recipients for disconnect alerts. Depends on bank_reauth_notice_recipients(uuid, text[]). Service role only.';

COMMENT ON FUNCTION public.bank_reauth_notice_recipients(uuid, text[]) IS
  'Owner/manager recipients for a restaurant, filtered by the roles the current escalation stage calls for. Design: docs/superpowers/specs/2026-07-23-bank-reauth-flow-design.md section 4.6. Callers: bank-reauth-notices edge function and public.integration_alert_recipients(uuid). Service role only. Change the signature only with both callers.';

REVOKE ALL ON FUNCTION public.integration_alert_recipients(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.integration_alert_recipients(uuid) TO service_role;
