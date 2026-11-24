-- RPC disconnect_integration: change one POS connection and record the event.
-- Only owner and manager can call it (the same rule as the RLS write policies).
-- The table names come from a fixed map. No EXECUTE with concatenated input.

CREATE OR REPLACE FUNCTION public.disconnect_integration(
  p_restaurant_id uuid,
  p_integration   text,
  p_reason        text DEFAULT NULL,
  p_reason_text   text DEFAULT NULL
) RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_uid       uuid := auth.uid();
  v_tbl       text;
  v_use_flag  boolean;
  v_snapshot  text;
  v_reason    text := NULLIF(p_reason, '');
  v_text      text := NULLIF(btrim(p_reason_text), '');
  v_details   jsonb;
  v_rows      integer;
  v_event_id  uuid;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'not authenticated' USING ERRCODE = '42501';
  END IF;

  IF NOT public.user_has_role(p_restaurant_id, ARRAY['owner','manager']) THEN
    RAISE EXCEPTION 'insufficient permissions' USING ERRCODE = '42501';
  END IF;

  -- Fixed map. The table name never comes from the caller.
  CASE p_integration
    WHEN 'revel' THEN
      v_tbl := 'revel_connections'; v_use_flag := true;
      v_snapshot := 'jsonb_build_object(''connection_ids'', jsonb_agg(id), ''establishment_ids'', jsonb_agg(establishment_id), ''connected_at'', min(created_at))';
    WHEN 'toast' THEN
      v_tbl := 'toast_connections'; v_use_flag := true;
      v_snapshot := 'jsonb_build_object(''connection_ids'', jsonb_agg(id), ''connected_at'', min(created_at))';
    WHEN 'focus' THEN
      v_tbl := 'focus_connections'; v_use_flag := true;
      v_snapshot := 'jsonb_build_object(''connection_ids'', jsonb_agg(id), ''store_ids'', jsonb_agg(store_id), ''connected_at'', min(created_at))';
    WHEN 'square' THEN
      v_tbl := 'square_connections'; v_use_flag := false;
      v_snapshot := 'jsonb_build_object(''connection_ids'', jsonb_agg(id), ''merchant_ids'', jsonb_agg(merchant_id), ''location_count'', (SELECT count(*) FROM public.square_locations sl WHERE sl.restaurant_id = $1), ''connected_at'', min(connected_at))';
    WHEN 'clover' THEN
      v_tbl := 'clover_connections'; v_use_flag := false;
      v_snapshot := 'jsonb_build_object(''connection_ids'', jsonb_agg(id), ''merchant_ids'', jsonb_agg(merchant_id), ''connected_at'', min(connected_at))';
    WHEN 'shift4' THEN
      v_tbl := 'shift4_connections'; v_use_flag := false;
      v_snapshot := 'jsonb_build_object(''connection_ids'', jsonb_agg(id), ''merchant_ids'', jsonb_agg(merchant_id), ''connected_at'', min(connected_at))';
    ELSE
      RAISE EXCEPTION 'unsupported integration' USING ERRCODE = '22023';
  END CASE;

  IF v_reason IS NOT NULL AND v_reason NOT IN
     ('switching_pos','credentials_changed','temporary_close','no_value','too_expensive','other') THEN
    RAISE EXCEPTION 'invalid reason' USING ERRCODE = '22023';
  END IF;

  IF v_text IS NOT NULL AND char_length(v_text) > 500 THEN
    RAISE EXCEPTION 'reason text is too long' USING ERRCODE = '22023';
  END IF;

  -- Change the connection. All rows of the restaurant change.
  -- One statement builds the details and the row count from the rows the change returns.
  IF v_use_flag THEN
    EXECUTE format(
      'WITH changed AS (UPDATE %I.%I SET is_active = false, updated_at = now() WHERE restaurant_id = $1 AND is_active RETURNING *) SELECT %s, count(*)::integer FROM changed',
      'public', v_tbl, v_snapshot)
    INTO v_details, v_rows USING p_restaurant_id;
  ELSE
    EXECUTE format(
      'WITH changed AS (DELETE FROM %I.%I WHERE restaurant_id = $1 RETURNING *) SELECT %s, count(*)::integer FROM changed',
      'public', v_tbl, v_snapshot)
    INTO v_details, v_rows USING p_restaurant_id;
  END IF;

  IF v_rows = 0 THEN
    RAISE EXCEPTION 'no active % connection', p_integration USING ERRCODE = 'P0002';
  END IF;

  INSERT INTO public.integration_events
    (restaurant_id, integration, event, actor_user_id, reason, reason_text, details)
  VALUES
    (p_restaurant_id, p_integration, 'disconnect', v_uid, v_reason, v_text,
     coalesce(v_details, '{}'::jsonb) || jsonb_build_object('rows_affected', v_rows))
  RETURNING id INTO v_event_id;

  RETURN v_event_id;
END;
$$;

REVOKE ALL ON FUNCTION public.disconnect_integration(uuid, text, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.disconnect_integration(uuid, text, text, text) TO authenticated;
