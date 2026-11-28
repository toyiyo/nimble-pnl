-- Read functions for the notification ledger: recipients, pending pairs,
-- and the week change log.
--
-- Design: docs/superpowers/specs/2026-11-28-mcp-publish-notifications-design.md
--
-- Recipients follow deriveShiftChangeRecipients
-- (supabase/functions/_shared/shiftChangedNotification.ts:68-87): the
-- before employee (on the before date) and the after employee (on the after
-- date). Only active employees, only tracked rows, only change types that
-- tell an employee something (published, updated, deleted), and only a side
-- that the employee could see (is_published in that snapshot). The template
-- cascade also logs draft shifts, so the visibility test matters.
--
-- The two public readers are SECURITY DEFINER with an explicit
-- view:scheduling check. SECURITY INVOKER would give a wrong answer: the
-- schedule_change_logs SELECT policy admits any member
-- (20251123000000_schedule_publishing.sql:74-82), but the ledger tables do
-- not, so a staff caller would see every change as pending.

CREATE OR REPLACE FUNCTION public.schedule_change_recipients(
  p_restaurant_id UUID,
  p_from DATE,
  p_to DATE,
  p_change_log_id UUID DEFAULT NULL
)
RETURNS TABLE (change_log_id UUID, employee_id UUID, shift_date DATE)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT DISTINCT ON (x.change_log_id, x.employee_id)
         x.change_log_id, x.employee_id, x.shift_date
  FROM (
    SELECT l.id AS change_log_id,
           (l.before_data->>'employee_id')::uuid AS employee_id,
           l.shift_date_before AS shift_date,
           2 AS pref
    FROM public.schedule_change_logs l
    WHERE l.restaurant_id = p_restaurant_id
      AND l.tracked
      AND l.change_type IN ('updated', 'deleted')
      AND NULLIF(l.before_data->>'employee_id', '') IS NOT NULL
      AND COALESCE((l.before_data->>'is_published')::boolean, false)
      AND (p_change_log_id IS NULL OR l.id = p_change_log_id)
      AND (p_from IS NULL OR l.shift_date_before >= p_from)
      AND (p_to IS NULL OR l.shift_date_before <= p_to)
    UNION ALL
    SELECT l.id,
           (l.after_data->>'employee_id')::uuid,
           l.shift_date_after,
           1
    FROM public.schedule_change_logs l
    WHERE l.restaurant_id = p_restaurant_id
      AND l.tracked
      AND l.change_type IN ('published', 'updated')
      AND NULLIF(l.after_data->>'employee_id', '') IS NOT NULL
      AND COALESCE((l.after_data->>'is_published')::boolean, false)
      AND (p_change_log_id IS NULL OR l.id = p_change_log_id)
      AND (p_from IS NULL OR l.shift_date_after >= p_from)
      AND (p_to IS NULL OR l.shift_date_after <= p_to)
  ) x
  JOIN public.employees e
    ON e.id = x.employee_id
   AND e.restaurant_id = p_restaurant_id
   AND e.status = 'active'
  ORDER BY x.change_log_id, x.employee_id, x.pref;
$$;

REVOKE EXECUTE ON FUNCTION public.schedule_change_recipients(UUID, DATE, DATE, UUID)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.schedule_change_recipients(UUID, DATE, DATE, UUID) TO service_role;

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
    'break_duration', p_data->'break_duration'
  )) END;
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
         CASE
           WHEN n.id IS NULL THEN 'pending'
           WHEN n.status = 'failed' THEN 'failed'
           WHEN n.claimed_at < now() - interval '10 minutes' THEN 'in_doubt'
           ELSE 'sending'
         END,
         n.id
  FROM public.schedule_change_recipients(p_restaurant_id, p_from, p_to) r
  JOIN public.schedule_change_logs l ON l.id = r.change_log_id
  JOIN public.employees e ON e.id = r.employee_id
  LEFT JOIN public.schedule_notification_changes c
    ON c.change_log_id = r.change_log_id AND c.employee_id = r.employee_id
  LEFT JOIN public.schedule_notifications n ON n.id = c.notification_id
  WHERE n.id IS NULL OR n.status <> 'sent'
  ORDER BY r.shift_date, e.name, l.changed_at;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.get_schedule_pending_notifications(UUID, DATE, DATE) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_schedule_pending_notifications(UUID, DATE, DATE) TO authenticated, service_role;

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
  changed_by_email TEXT,
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
BEGIN
  IF NOT public.user_has_capability(p_restaurant_id, 'view:scheduling') THEN
    RAISE EXCEPTION 'Not authorized to view scheduling for restaurant %', p_restaurant_id
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  RETURN QUERY
  SELECT l.id,
         l.change_type,
         l.changed_at,
         l.changed_by,
         p.full_name::text,
         u.email::text,
         l.shift_id,
         l.employee_id,
         e.name::text,
         public.schedule_shift_summary(l.before_data),
         public.schedule_shift_summary(l.after_data),
         l.reason,
         l.tracked,
         l.notified_at,
         COALESCE((
           SELECT jsonb_agg(jsonb_build_object(
                    'notification_id', n.id,
                    'employee_id', c.employee_id,
                    'employee_name', ce.name,
                    'status', n.status,
                    'source', n.source,
                    'channels', to_jsonb(n.channels),
                    'claimed_at', n.claimed_at,
                    'sent_at', n.sent_at
                  ) ORDER BY ce.name)
           FROM public.schedule_notification_changes c
           JOIN public.schedule_notifications n ON n.id = c.notification_id
           LEFT JOIN public.employees ce ON ce.id = c.employee_id
           WHERE c.change_log_id = l.id
         ), '[]'::jsonb),
         -- The same rule as get_schedule_pending_notifications.
         COALESCE((
           SELECT jsonb_agg(jsonb_build_object('employee_id', r.employee_id, 'employee_name', re.name)
                            ORDER BY re.name)
           FROM public.schedule_change_recipients(p_restaurant_id, NULL, NULL, l.id) r
           JOIN public.employees re ON re.id = r.employee_id
           WHERE NOT EXISTS (
             SELECT 1
             FROM public.schedule_notification_changes c
             JOIN public.schedule_notifications n ON n.id = c.notification_id
             WHERE c.change_log_id = l.id AND c.employee_id = r.employee_id AND n.status = 'sent'
           )
         ), '[]'::jsonb)
  FROM public.schedule_change_logs l
  LEFT JOIN public.employees e ON e.id = l.employee_id
  LEFT JOIN auth.users u ON u.id = l.changed_by
  LEFT JOIN LATERAL (
    SELECT pr.full_name FROM public.profiles pr WHERE pr.user_id = l.changed_by LIMIT 1
  ) p ON true
  WHERE l.restaurant_id = p_restaurant_id
    AND (
      (l.shift_date_before IS NOT NULL
        AND (p_from IS NULL OR l.shift_date_before >= p_from)
        AND (p_to IS NULL OR l.shift_date_before <= p_to))
      OR
      (l.shift_date_after IS NOT NULL
        AND (p_from IS NULL OR l.shift_date_after >= p_from)
        AND (p_to IS NULL OR l.shift_date_after <= p_to))
    )
  ORDER BY l.changed_at, l.id;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.get_schedule_week_change_log(UUID, DATE, DATE) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_schedule_week_change_log(UUID, DATE, DATE) TO authenticated, service_role;
