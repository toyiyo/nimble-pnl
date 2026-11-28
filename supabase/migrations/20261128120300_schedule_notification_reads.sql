-- Read functions for the notification ledger: recipients, pending pairs,
-- and the week change log.
--
-- Design: docs/superpowers/specs/2026-11-28-mcp-publish-notifications-design.md
--
-- Recipient rule (one pair per change and employee):
--   * before side: before_data.employee_id on shift_date_before, for
--     `deleted` rows and for reassignments (an `updated` row with a new
--     employee), where the employee could see the shift
--     (before_data.is_published). For an edit with the same employee, the
--     after side is the one pair;
--   * after side: after_data.employee_id on shift_date_after, for
--     `published` and `updated` rows where after_data.is_published, and only
--     while the shift still exists and is published. A pair for a shift that
--     was later deleted as a draft, or unpublished, is void: the employee
--     cannot see it, and a later publish logs a new `published` row.
--   * active employees of the restaurant only; tracked rows only.
-- The template cascade also logs draft shifts, so the visibility tests matter.
--
-- The two public readers are SECURITY DEFINER with an explicit
-- view:scheduling check. SECURITY INVOKER would give a wrong answer: the
-- schedule_change_logs SELECT policy admits any member
-- (20251123000000_schedule_publishing.sql:74-82), but the ledger tables do
-- not, so a staff caller would see every change as pending.

-- p_change_log_ids set: only those rows (by primary key). Else the date
-- range. The two branches are separate statements, so each one gets an
-- index plan (a single statement with `x IS NULL OR ...` does not).
CREATE OR REPLACE FUNCTION public.schedule_change_recipients(
  p_restaurant_id UUID,
  p_from DATE,
  p_to DATE,
  p_change_log_ids UUID[] DEFAULT NULL
)
RETURNS TABLE (change_log_id UUID, employee_id UUID, shift_date DATE)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_from DATE := COALESCE(p_from, '-infinity'::date);
  v_to DATE := COALESCE(p_to, 'infinity'::date);
BEGIN
  IF p_change_log_ids IS NOT NULL THEN
    RETURN QUERY
    WITH rows AS (
      SELECT l.* FROM public.schedule_change_logs l
      WHERE l.id = ANY(p_change_log_ids)
        AND l.restaurant_id = p_restaurant_id
        AND l.tracked
    )
    SELECT DISTINCT ON (x.cid, x.eid) x.cid, x.eid, x.d
    FROM (
      SELECT r.id AS cid, (r.before_data->>'employee_id')::uuid AS eid, r.shift_date_before AS d, 2 AS pref
      FROM rows r
      WHERE (r.change_type = 'deleted'
             OR (r.change_type = 'updated'
                 AND r.before_data->>'employee_id' IS DISTINCT FROM r.after_data->>'employee_id'))
        AND NULLIF(r.before_data->>'employee_id', '') IS NOT NULL
        AND COALESCE((r.before_data->>'is_published')::boolean, false)
      UNION ALL
      SELECT r.id, (r.after_data->>'employee_id')::uuid, r.shift_date_after, 1
      FROM rows r
      JOIN public.shifts s ON s.id = r.shift_id AND s.is_published
      WHERE r.change_type IN ('published', 'updated')
        AND NULLIF(r.after_data->>'employee_id', '') IS NOT NULL
        AND COALESCE((r.after_data->>'is_published')::boolean, false)
    ) x
    JOIN public.employees e ON e.id = x.eid AND e.restaurant_id = p_restaurant_id AND e.status = 'active'
    ORDER BY x.cid, x.eid, x.pref;
    RETURN;
  END IF;

  RETURN QUERY
  SELECT DISTINCT ON (x.cid, x.eid) x.cid, x.eid, x.d
  FROM (
    SELECT l.id AS cid, (l.before_data->>'employee_id')::uuid AS eid, l.shift_date_before AS d, 2 AS pref
    FROM public.schedule_change_logs l
    WHERE l.restaurant_id = p_restaurant_id
      AND l.tracked
      AND l.shift_date_before BETWEEN v_from AND v_to
      AND (l.change_type = 'deleted'
           OR (l.change_type = 'updated'
               AND l.before_data->>'employee_id' IS DISTINCT FROM l.after_data->>'employee_id'))
      AND NULLIF(l.before_data->>'employee_id', '') IS NOT NULL
      AND COALESCE((l.before_data->>'is_published')::boolean, false)
    UNION ALL
    SELECT l.id, (l.after_data->>'employee_id')::uuid, l.shift_date_after, 1
    FROM public.schedule_change_logs l
    JOIN public.shifts s ON s.id = l.shift_id AND s.is_published
    WHERE l.restaurant_id = p_restaurant_id
      AND l.tracked
      AND l.shift_date_after BETWEEN v_from AND v_to
      AND l.change_type IN ('published', 'updated')
      AND NULLIF(l.after_data->>'employee_id', '') IS NOT NULL
      AND COALESCE((l.after_data->>'is_published')::boolean, false)
  ) x
  JOIN public.employees e ON e.id = x.eid AND e.restaurant_id = p_restaurant_id AND e.status = 'active'
  ORDER BY x.cid, x.eid, x.pref;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.schedule_change_recipients(UUID, DATE, DATE, UUID[])
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.schedule_change_recipients(UUID, DATE, DATE, UUID[]) TO service_role;

-- A small shift summary, never the whole row.
CREATE OR REPLACE FUNCTION public.schedule_shift_summary(p_data JSONB)
RETURNS JSONB
LANGUAGE sql
IMMUTABLE
SET search_path = public, pg_temp
AS $$
  SELECT CASE WHEN p_data IS NULL THEN NULL ELSE jsonb_strip_nulls(jsonb_build_object(
    'start_time', p_data->'start_time',
    'end_time', p_data->'end_time',
    'position', p_data->'position',
    'employee_id', p_data->'employee_id',
    'break_duration', p_data->'break_duration',
    'notes', p_data->'notes',
    'status', p_data->'status'
  )) END;
$$;

-- The state of a pair that has a ledger row that is not sent or skipped.
--   sending:  claimed less than 10 minutes ago (a notifier holds it);
--   retrying: claimed 10-60 minutes ago with no live owner; the next claim
--             sends it again under the same key;
--   failed:   the provider rejected it; the next claim sends it again;
--   in_doubt: the send may have arrived, and the key window (60 minutes)
--             is over. Nothing sends it again automatically.
CREATE OR REPLACE FUNCTION public.schedule_notification_state(
  p_status TEXT, p_uncertain BOOLEAN, p_claimed_at TIMESTAMPTZ, p_created_at TIMESTAMPTZ
)
RETURNS TEXT
LANGUAGE sql
STABLE
SET search_path = public, pg_temp
AS $$
  SELECT CASE
    WHEN p_status IS NULL THEN 'pending'
    WHEN p_status = 'failed' AND p_uncertain AND p_created_at < now() - interval '60 minutes' THEN 'in_doubt'
    WHEN p_status = 'failed' THEN 'failed'
    WHEN p_created_at < now() - interval '60 minutes' THEN 'in_doubt'
    WHEN p_claimed_at < now() - interval '10 minutes' THEN 'retrying'
    ELSE 'sending'
  END;
$$;

CREATE OR REPLACE FUNCTION public.get_schedule_pending_notifications(
  p_restaurant_id UUID,
  p_from DATE DEFAULT NULL,
  p_to DATE DEFAULT NULL
)
RETURNS TABLE (
  change_log_id UUID,
  employee_id UUID,
  employee_name TEXT,
  shift_date DATE,
  change_type TEXT,
  changed_at TIMESTAMPTZ,
  changed_by UUID,
  shift_id UUID,
  shift_before JSONB,
  shift_after JSONB,
  state TEXT,
  notification_id UUID
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF NOT public.user_has_capability(p_restaurant_id, 'view:scheduling') THEN
    RAISE EXCEPTION 'Not authorized to view scheduling for restaurant %', p_restaurant_id
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  RETURN QUERY
  SELECT r.change_log_id,
         r.employee_id,
         e.name::text,
         r.shift_date,
         l.change_type,
         l.changed_at,
         l.changed_by,
         l.shift_id,
         public.schedule_shift_summary(l.before_data),
         public.schedule_shift_summary(l.after_data),
         public.schedule_notification_state(n.status, n.uncertain, n.claimed_at, n.created_at),
         n.id
  FROM public.schedule_change_recipients(p_restaurant_id, p_from, p_to) r
  JOIN public.schedule_change_logs l ON l.id = r.change_log_id
  JOIN public.employees e ON e.id = r.employee_id
  LEFT JOIN public.schedule_notification_changes c
    ON c.change_log_id = r.change_log_id AND c.employee_id = r.employee_id
  LEFT JOIN public.schedule_notifications n ON n.id = c.notification_id
  WHERE n.id IS NULL OR n.status NOT IN ('sent', 'skipped')
  ORDER BY r.shift_date, e.name, l.changed_at;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.get_schedule_pending_notifications(UUID, DATE, DATE) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_schedule_pending_notifications(UUID, DATE, DATE) TO authenticated, service_role;

-- changed_by_name is the profile name of the actor, and only when the actor
-- is a member of this restaurant. No email: employees.email is not readable
-- by `authenticated` (20260806110000), and a log row can name any user id.
CREATE OR REPLACE FUNCTION public.get_schedule_week_change_log(
  p_restaurant_id UUID,
  p_from DATE,
  p_to DATE
)
RETURNS TABLE (
  change_log_id UUID,
  change_type TEXT,
  changed_at TIMESTAMPTZ,
  changed_by UUID,
  changed_by_name TEXT,
  shift_id UUID,
  employee_id UUID,
  employee_name TEXT,
  shift_before JSONB,
  shift_after JSONB,
  reason TEXT,
  tracked BOOLEAN,
  notified_at TIMESTAMPTZ,
  notifications JSONB,
  pending_employees JSONB
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_from DATE := COALESCE(p_from, '-infinity'::date);
  v_to DATE := COALESCE(p_to, 'infinity'::date);
  v_ids UUID[];
BEGIN
  IF NOT public.user_has_capability(p_restaurant_id, 'view:scheduling') THEN
    RAISE EXCEPTION 'Not authorized to view scheduling for restaurant %', p_restaurant_id
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  SELECT array_agg(DISTINCT x.id) INTO v_ids
  FROM (
    SELECT l.id FROM public.schedule_change_logs l
    WHERE l.restaurant_id = p_restaurant_id AND l.shift_date_after BETWEEN v_from AND v_to
    UNION ALL
    SELECT l.id FROM public.schedule_change_logs l
    WHERE l.restaurant_id = p_restaurant_id AND l.shift_date_before BETWEEN v_from AND v_to
  ) x;

  IF v_ids IS NULL THEN
    RETURN;
  END IF;

  RETURN QUERY
  WITH recips AS (
    -- One call for the whole week (by id), not one call per row.
    SELECT r.change_log_id, r.employee_id
    FROM public.schedule_change_recipients(p_restaurant_id, NULL, NULL, v_ids) r
  ),
  open_recips AS (
    SELECT r.change_log_id,
           jsonb_agg(jsonb_build_object('employee_id', r.employee_id, 'employee_name', re.name)
                     ORDER BY re.name) AS pending
    FROM recips r
    JOIN public.employees re ON re.id = r.employee_id
    WHERE NOT EXISTS (
      SELECT 1
      FROM public.schedule_notification_changes c
      JOIN public.schedule_notifications n ON n.id = c.notification_id
      WHERE c.change_log_id = r.change_log_id AND c.employee_id = r.employee_id
        AND n.status IN ('sent', 'skipped')
    )
    GROUP BY r.change_log_id
  ),
  notes AS (
    SELECT c.change_log_id,
           jsonb_agg(jsonb_build_object(
             'notification_id', n.id,
             'employee_id', c.employee_id,
             'employee_name', ce.name,
             'status', n.status,
             'source', n.source,
             'channels', to_jsonb(n.channels),
             'claimed_at', n.claimed_at,
             'sent_at', n.sent_at
           ) ORDER BY ce.name) AS list
    FROM public.schedule_notification_changes c
    JOIN public.schedule_notifications n ON n.id = c.notification_id
    LEFT JOIN public.employees ce ON ce.id = c.employee_id
    WHERE c.change_log_id = ANY(v_ids)
    GROUP BY c.change_log_id
  )
  SELECT l.id,
         l.change_type,
         l.changed_at,
         l.changed_by,
         CASE WHEN m.user_id IS NOT NULL THEN p.full_name::text END,
         l.shift_id,
         l.employee_id,
         e.name::text,
         public.schedule_shift_summary(l.before_data),
         public.schedule_shift_summary(l.after_data),
         l.reason,
         l.tracked,
         l.notified_at,
         COALESCE(nt.list, '[]'::jsonb),
         COALESCE(o.pending, '[]'::jsonb)
  FROM public.schedule_change_logs l
  LEFT JOIN public.employees e ON e.id = l.employee_id
  LEFT JOIN public.user_restaurants m ON m.user_id = l.changed_by AND m.restaurant_id = p_restaurant_id
  LEFT JOIN LATERAL (
    SELECT pr.full_name FROM public.profiles pr WHERE pr.user_id = l.changed_by LIMIT 1
  ) p ON true
  LEFT JOIN notes nt ON nt.change_log_id = l.id
  LEFT JOIN open_recips o ON o.change_log_id = l.id
  WHERE l.id = ANY(v_ids)
  ORDER BY l.changed_at, l.id;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.get_schedule_week_change_log(UUID, DATE, DATE) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_schedule_week_change_log(UUID, DATE, DATE) TO authenticated, service_role;
