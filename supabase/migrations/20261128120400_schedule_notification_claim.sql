-- Claim and mark functions for the notification ledger. Both notifiers
-- (notify-schedule-published, notify-shift-changed) use them, for the UI and
-- for the MCP tools.
--
-- Design: docs/superpowers/specs/2026-11-28-mcp-publish-notifications-design.md
-- TLA+:   specs/tla/publish-notifications/PublishNotifications.tla
--   UniqueClaim -> the advisory lock plus the UNIQUE (change, employee) link.
--   IdemKey     -> a taken-back row keeps its id and its change set.
--   RecordAfter -> mark_schedule_notification runs after the provider answers.
--
-- Reclaim rules:
--   * a 'failed' row (the provider rejected it): up to 5 attempts;
--   * a 'claimed' row older than 10 minutes (no live owner) and created less
--     than 60 minutes ago (inside the provider idempotency window).
-- A 'claimed' row created more than 60 minutes ago is never sent again by
-- this function. get_schedule_pending_notifications shows it as in_doubt.

CREATE OR REPLACE FUNCTION public.claim_schedule_notifications(
  p_restaurant_id UUID,
  p_from DATE,
  p_to DATE,
  p_source TEXT,
  p_publication_id UUID DEFAULT NULL,
  p_change_log_id UUID DEFAULT NULL
)
RETURNS TABLE (notification_id UUID, employee_id UUID, change_log_ids UUID[], reclaimed BOOLEAN)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_row RECORD;
  v_id UUID;
  v_links INTEGER;
BEGIN
  IF p_source NOT IN ('publish', 'shift_change') THEN
    RAISE EXCEPTION 'Invalid source %', p_source USING ERRCODE = 'invalid_parameter_value';
  END IF;

  -- One claimer per restaurant at a time.
  PERFORM pg_advisory_xact_lock(hashtext('schedule_notifications'), hashtext(p_restaurant_id::text));

  CREATE TEMP TABLE IF NOT EXISTS pg_temp.claim_scope (
    change_log_id UUID, employee_id UUID
  ) ON COMMIT DROP;
  TRUNCATE pg_temp.claim_scope;
  INSERT INTO pg_temp.claim_scope
  SELECT r.change_log_id, r.employee_id
  FROM public.schedule_change_recipients(p_restaurant_id, p_from, p_to, p_change_log_id) r;

  -- 1. Take back eligible rows that hold a pair in scope. Same id, same set.
  FOR v_row IN
    UPDATE public.schedule_notifications n
    SET status = 'claimed',
        claimed_at = now(),
        attempts = n.attempts + 1,
        last_error = NULL
    WHERE n.restaurant_id = p_restaurant_id
      AND (
        (n.status = 'failed' AND n.attempts < 5)
        OR (n.status = 'claimed'
            AND n.claimed_at < now() - interval '10 minutes'
            AND n.created_at >= now() - interval '60 minutes')
      )
      AND EXISTS (
        SELECT 1 FROM public.schedule_notification_changes c
        JOIN pg_temp.claim_scope s
          ON s.change_log_id = c.change_log_id AND s.employee_id = c.employee_id
        WHERE c.notification_id = n.id
      )
    RETURNING n.id, n.employee_id
  LOOP
    notification_id := v_row.id;
    employee_id := v_row.employee_id;
    reclaimed := true;
    SELECT array_agg(c.change_log_id ORDER BY c.change_log_id) INTO change_log_ids
    FROM public.schedule_notification_changes c WHERE c.notification_id = v_row.id;
    RETURN NEXT;
  END LOOP;

  -- 2. New rows for free pairs, one row per employee.
  FOR v_row IN
    SELECT s.employee_id AS emp, array_agg(s.change_log_id ORDER BY s.change_log_id) AS ids
    FROM pg_temp.claim_scope s
    WHERE NOT EXISTS (
      SELECT 1 FROM public.schedule_notification_changes c
      WHERE c.change_log_id = s.change_log_id AND c.employee_id = s.employee_id
    )
    GROUP BY s.employee_id
  LOOP
    INSERT INTO public.schedule_notifications (restaurant_id, employee_id, source, publication_id)
    VALUES (p_restaurant_id, v_row.emp, p_source, p_publication_id)
    RETURNING id INTO v_id;

    INSERT INTO public.schedule_notification_changes (notification_id, change_log_id, employee_id, restaurant_id)
    SELECT v_id, unnest(v_row.ids), v_row.emp, p_restaurant_id
    ON CONFLICT DO NOTHING;
    GET DIAGNOSTICS v_links = ROW_COUNT;

    IF v_links = 0 THEN
      DELETE FROM public.schedule_notifications WHERE id = v_id;
      CONTINUE;
    END IF;

    notification_id := v_id;
    employee_id := v_row.emp;
    reclaimed := false;
    SELECT array_agg(c.change_log_id ORDER BY c.change_log_id) INTO change_log_ids
    FROM public.schedule_notification_changes c WHERE c.notification_id = v_id;
    RETURN NEXT;
  END LOOP;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.claim_schedule_notifications(UUID, DATE, DATE, TEXT, UUID, UUID)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.claim_schedule_notifications(UUID, DATE, DATE, TEXT, UUID, UUID) TO service_role;

CREATE OR REPLACE FUNCTION public.mark_schedule_notification(
  p_id UUID,
  p_status TEXT,
  p_channels TEXT[] DEFAULT '{}',
  p_error TEXT DEFAULT NULL
)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF p_status NOT IN ('sent', 'failed') THEN
    RAISE EXCEPTION 'Invalid status %', p_status USING ERRCODE = 'invalid_parameter_value';
  END IF;

  UPDATE public.schedule_notifications
  SET status = p_status,
      channels = COALESCE(p_channels, '{}'),
      last_error = LEFT(p_error, 500),
      sent_at = CASE WHEN p_status = 'sent' THEN now() ELSE NULL END
  WHERE id = p_id AND status = 'claimed';

  RETURN FOUND;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.mark_schedule_notification(UUID, TEXT, TEXT[], TEXT)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.mark_schedule_notification(UUID, TEXT, TEXT[], TEXT) TO service_role;
