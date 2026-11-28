-- Schedule notification ledger: one row for each message to one employee,
-- and the change-log rows that each message covers.
--
-- Design: docs/superpowers/specs/2026-11-28-mcp-publish-notifications-design.md
-- TLA+:   specs/tla/publish-notifications/PublishNotifications.tla
--
-- Writers: only claim_schedule_notifications() and
-- mark_schedule_notification() (SECURITY DEFINER, service role). No client
-- write policy exists. Precedent: schedule_retractions
-- (20260802120000_schedule_retractions.sql:81-83).

CREATE TABLE IF NOT EXISTS public.schedule_notifications (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  restaurant_id  UUID NOT NULL REFERENCES public.restaurants(id) ON DELETE CASCADE,
  employee_id    UUID REFERENCES public.employees(id) ON DELETE SET NULL,
  source         TEXT NOT NULL CHECK (source IN ('publish', 'shift_change')),
  publication_id UUID REFERENCES public.schedule_publications(id) ON DELETE SET NULL,
  -- claimed: a notifier holds it. sent: a channel went out. skipped: the
  -- changes cancel out, so there is nothing to tell. failed: no channel went
  -- out; uncertain = true when the provider answer did not arrive (a timeout).
  status         TEXT NOT NULL DEFAULT 'claimed' CHECK (status IN ('claimed', 'sent', 'skipped', 'failed')),
  uncertain      BOOLEAN NOT NULL DEFAULT false,
  channels       TEXT[] NOT NULL DEFAULT '{}',
  attempts       INTEGER NOT NULL DEFAULT 1,
  last_error     TEXT,
  claimed_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  sent_at        TIMESTAMPTZ,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.schedule_notifications IS
  'One schedule message to one employee. The id is also the email Idempotency-Key and the push tag.';

CREATE TABLE IF NOT EXISTS public.schedule_notification_changes (
  notification_id UUID NOT NULL REFERENCES public.schedule_notifications(id) ON DELETE CASCADE,
  change_log_id   UUID NOT NULL REFERENCES public.schedule_change_logs(id) ON DELETE CASCADE,
  employee_id     UUID NOT NULL REFERENCES public.employees(id) ON DELETE CASCADE,
  restaurant_id   UUID NOT NULL REFERENCES public.restaurants(id) ON DELETE CASCADE,
  PRIMARY KEY (notification_id, change_log_id, employee_id)
);

-- TLA+ NoDuplicateDelivery: one message per (change, employee), ever.
CREATE UNIQUE INDEX IF NOT EXISTS uq_schedule_notification_changes_change_employee
  ON public.schedule_notification_changes (change_log_id, employee_id);

CREATE INDEX IF NOT EXISTS idx_schedule_notifications_restaurant_created
  ON public.schedule_notifications (restaurant_id, created_at);
CREATE INDEX IF NOT EXISTS idx_schedule_notifications_open
  ON public.schedule_notifications (restaurant_id, claimed_at)
  WHERE status IN ('claimed', 'failed');
CREATE INDEX IF NOT EXISTS idx_schedule_notification_changes_restaurant
  ON public.schedule_notification_changes (restaurant_id);

ALTER TABLE public.schedule_notifications ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.schedule_notification_changes ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON public.schedule_notifications FROM PUBLIC, anon, authenticated;
REVOKE ALL ON public.schedule_notification_changes FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.schedule_notifications TO authenticated;
GRANT SELECT ON public.schedule_notification_changes TO authenticated;
GRANT ALL ON public.schedule_notifications TO service_role;
GRANT ALL ON public.schedule_notification_changes TO service_role;

DROP POLICY IF EXISTS "Schedule viewers can read notifications" ON public.schedule_notifications;
CREATE POLICY "Schedule viewers can read notifications"
  ON public.schedule_notifications FOR SELECT TO authenticated
  USING (public.user_has_capability(restaurant_id, 'view:scheduling'));

DROP POLICY IF EXISTS "Schedule viewers can read notification changes" ON public.schedule_notification_changes;
CREATE POLICY "Schedule viewers can read notification changes"
  ON public.schedule_notification_changes FOR SELECT TO authenticated
  USING (public.user_has_capability(restaurant_id, 'view:scheduling'));
