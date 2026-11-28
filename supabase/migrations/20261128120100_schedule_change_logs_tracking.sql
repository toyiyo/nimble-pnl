-- Change-log columns for the notification ledger.
--
-- Design: docs/superpowers/specs/2026-11-28-mcp-publish-notifications-design.md
--
-- * shift_date_before / shift_date_after: the restaurant-local date of
--   before_data.start_time and after_data.start_time. A BEFORE INSERT trigger
--   fills them, so every writer gets them: log_shift_change, unpublish_schedule
--   (20260802120000_schedule_retractions.sql:201-211), the template cascade
--   (20260805160000_template_cascade_undo_restores_template.sql:260-267), and
--   the cascade undo (20260804130000_template_hours_cascade.sql:442-444).
--   Time zone rule: the publish_schedule rule, UTC when the zone is null,
--   empty, or invalid (20260729120000_publish_schedule_tz_bucketing.sql:76-91).
-- * tracked: only tracked rows can be pending. Every row that exists before
--   this migration reads false, so the first publish after deploy does not
--   email employees about old changes. The column is added with DEFAULT
--   false (a catalog change, no table rewrite), then the default becomes
--   true for new rows.
-- * Only rows changed in the last 90 days get dates (for the change log).
--   Older rows keep null dates, so the backfill stays small.
-- * changed_by becomes nullable. Null means a service-role write (for
--   example the Sling sync, sling-bulk-sync/index.ts:214), where auth.uid()
--   is null. Before this change such a write failed NOT NULL.

ALTER TABLE public.schedule_change_logs
  ADD COLUMN IF NOT EXISTS shift_date_before DATE,
  ADD COLUMN IF NOT EXISTS shift_date_after  DATE,
  ADD COLUMN IF NOT EXISTS tracked BOOLEAN NOT NULL DEFAULT false;

ALTER TABLE public.schedule_change_logs ALTER COLUMN tracked SET DEFAULT true;

ALTER TABLE public.schedule_change_logs ALTER COLUMN changed_by DROP NOT NULL;

COMMENT ON COLUMN public.schedule_change_logs.changed_by IS
  'The user who made the change. Null for a service-role (system) write.';
COMMENT ON COLUMN public.schedule_change_logs.tracked IS
  'False for rows that existed before the notification ledger. Only tracked rows can be pending.';

-- Resolve a restaurant zone with the publish_schedule fallback rule.
CREATE OR REPLACE FUNCTION public.schedule_restaurant_tz(p_restaurant_id UUID)
RETURNS TEXT
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_tz TEXT;
BEGIN
  SELECT r.timezone INTO v_tz FROM public.restaurants r WHERE r.id = p_restaurant_id;
  v_tz := COALESCE(NULLIF(v_tz, ''), 'UTC');
  BEGIN
    PERFORM now() AT TIME ZONE v_tz;
  EXCEPTION WHEN invalid_parameter_value THEN
    v_tz := 'UTC';
  END;
  RETURN v_tz;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.schedule_restaurant_tz(UUID) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.schedule_change_log_fill_dates()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_tz TEXT;
BEGIN
  -- Always derived from the snapshots. A value that the client sends is
  -- ignored, so a direct INSERT cannot file a change under another week.
  NEW.shift_date_before := NULL;
  NEW.shift_date_after := NULL;
  IF NEW.before_data ? 'start_time' OR NEW.after_data ? 'start_time' THEN
    v_tz := public.schedule_restaurant_tz(NEW.restaurant_id);
    IF NULLIF(NEW.before_data->>'start_time', '') IS NOT NULL THEN
      NEW.shift_date_before := ((NEW.before_data->>'start_time')::timestamptz AT TIME ZONE v_tz)::date;
    END IF;
    IF NULLIF(NEW.after_data->>'start_time', '') IS NOT NULL THEN
      NEW.shift_date_after := ((NEW.after_data->>'start_time')::timestamptz AT TIME ZONE v_tz)::date;
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.schedule_change_log_fill_dates() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS schedule_change_log_fill_dates ON public.schedule_change_logs;
CREATE TRIGGER schedule_change_log_fill_dates
  BEFORE INSERT ON public.schedule_change_logs
  FOR EACH ROW
  EXECUTE FUNCTION public.schedule_change_log_fill_dates();

-- Backfill dates for the last 90 days only. One join to restaurants, and the
-- zone is checked against pg_timezone_names, so no per-row function call or
-- subtransaction runs. tracked stays false on these rows.
UPDATE public.schedule_change_logs l
SET shift_date_before = CASE WHEN NULLIF(l.before_data->>'start_time', '') IS NOT NULL
      THEN ((l.before_data->>'start_time')::timestamptz AT TIME ZONE z.tz)::date END,
    shift_date_after = CASE WHEN NULLIF(l.after_data->>'start_time', '') IS NOT NULL
      THEN ((l.after_data->>'start_time')::timestamptz AT TIME ZONE z.tz)::date END
FROM (
  SELECT r.id,
         CASE WHEN EXISTS (SELECT 1 FROM pg_timezone_names t WHERE t.name = r.timezone)
              THEN r.timezone ELSE 'UTC' END AS tz
  FROM public.restaurants r
) z
WHERE z.id = l.restaurant_id
  AND l.changed_at >= now() - interval '90 days'
  AND (l.before_data ? 'start_time' OR l.after_data ? 'start_time');

-- The change log reads by date. Pending and the claim read tracked rows only.
CREATE INDEX IF NOT EXISTS idx_schedule_change_logs_restaurant_date_after
  ON public.schedule_change_logs (restaurant_id, shift_date_after)
  WHERE shift_date_after IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_schedule_change_logs_restaurant_date_before
  ON public.schedule_change_logs (restaurant_id, shift_date_before)
  WHERE shift_date_before IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_schedule_change_logs_tracked_after
  ON public.schedule_change_logs (restaurant_id, shift_date_after)
  WHERE tracked;
CREATE INDEX IF NOT EXISTS idx_schedule_change_logs_tracked_before
  ON public.schedule_change_logs (restaurant_id, shift_date_before)
  WHERE tracked;
