-- Re-declare log_shift_change in full, and run it on INSERT too.
--
-- PROVENANCE: the only previous definition is
-- 20251123000000_schedule_publishing.sql:96-169 (checked with
--   grep -rlE "FUNCTION\s+(public\.)?log_shift_change\b" supabase/migrations/).
-- The `deleted` and `unpublished` branches are carried forward unchanged.
--
-- Changes:
-- * New `published` branch. One row when a shift becomes visible: the
--   publish_schedule flip (OLD.is_published = false, NEW.is_published = true),
--   and an INSERT with is_published = true (the open-shift claim path,
--   20260721140000_open_shift_claim_authz_guard.sql:316-322, :442-449).
-- * The `updated` branch logs only when a field that the employee sees
--   changes. Before, every UPDATE of a published shift wrote a row, so a
--   no-op Sling upsert (20260223100100_sling_sync_rpc.sql:65-73) or a clock-in
--   status change made a false "your shift changed" notification.
-- * SET search_path on this SECURITY DEFINER function.
-- * cascade_batch_id and notified_at stay NULL here, so the cascade undo
--   predicate (20260804130000_template_hours_cascade.sql:347-356) still sees
--   only its own tagged rows.

CREATE OR REPLACE FUNCTION public.log_shift_change()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NEW.is_published THEN
      INSERT INTO public.schedule_change_logs (
        restaurant_id, shift_id, employee_id, change_type, changed_by, after_data
      ) VALUES (
        NEW.restaurant_id, NEW.id, NEW.employee_id, 'published', auth.uid(),
        row_to_json(NEW)::jsonb
      );
    END IF;
    RETURN NEW;
  END IF;

  IF TG_OP = 'DELETE' THEN
    IF OLD.is_published THEN
      INSERT INTO public.schedule_change_logs (
        restaurant_id, shift_id, employee_id, change_type, changed_by, before_data
      ) VALUES (
        OLD.restaurant_id, OLD.id, OLD.employee_id, 'deleted', auth.uid(),
        row_to_json(OLD)::jsonb
      );
    END IF;
    RETURN OLD;
  END IF;

  -- UPDATE
  IF NOT OLD.is_published AND NEW.is_published THEN
    INSERT INTO public.schedule_change_logs (
      restaurant_id, shift_id, employee_id, change_type, changed_by, after_data
    ) VALUES (
      NEW.restaurant_id, NEW.id, NEW.employee_id, 'published', auth.uid(),
      row_to_json(NEW)::jsonb
    );
  ELSIF OLD.is_published AND NOT NEW.is_published THEN
    INSERT INTO public.schedule_change_logs (
      restaurant_id, shift_id, employee_id, change_type, changed_by, before_data, after_data
    ) VALUES (
      NEW.restaurant_id, NEW.id, NEW.employee_id, 'unpublished', auth.uid(),
      row_to_json(OLD)::jsonb, row_to_json(NEW)::jsonb
    );
  ELSIF OLD.is_published AND NEW.is_published
    AND (OLD.start_time, OLD.end_time, OLD.employee_id, OLD.position, OLD.break_duration)
        IS DISTINCT FROM
        (NEW.start_time, NEW.end_time, NEW.employee_id, NEW.position, NEW.break_duration)
  THEN
    INSERT INTO public.schedule_change_logs (
      restaurant_id, shift_id, employee_id, change_type, changed_by, before_data, after_data
    ) VALUES (
      NEW.restaurant_id, NEW.id, NEW.employee_id, 'updated', auth.uid(),
      row_to_json(OLD)::jsonb, row_to_json(NEW)::jsonb
    );
  END IF;
  RETURN NEW;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.log_shift_change() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS log_shift_changes ON public.shifts;
CREATE TRIGGER log_shift_changes
  AFTER INSERT OR UPDATE OR DELETE ON public.shifts
  FOR EACH ROW
  EXECUTE FUNCTION public.log_shift_change();
