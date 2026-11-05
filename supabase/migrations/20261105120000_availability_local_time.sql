-- Availability local time, expand step (PR 1).
-- Add restaurant-local time columns. A trigger keeps the legacy UTC columns
-- and the local columns in step. See
-- docs/superpowers/specs/2026-11-05-availability-local-time-design.md
-- sections 7.1 to 7.4. The order of the steps matters.

BEGIN;

-- Helper: UTC offset at noon local time on the local date of p_instant.
-- local = utc + offset. An invalid or null timezone gives a zero offset.
CREATE OR REPLACE FUNCTION public.availability_noon_offset(p_instant timestamptz, p_tz text)
RETURNS interval
LANGUAGE plpgsql
STABLE
SET search_path = public, pg_catalog
AS $$
DECLARE
  v_noon timestamp;
BEGIN
  v_noon := (p_instant AT TIME ZONE p_tz)::date + TIME '12:00';
  RETURN COALESCE(v_noon - ((v_noon AT TIME ZONE p_tz) AT TIME ZONE 'UTC'), INTERVAL '0');
EXCEPTION WHEN invalid_parameter_value THEN
  RETURN INTERVAL '0';
END;
$$;

REVOKE ALL ON FUNCTION public.availability_noon_offset(timestamptz, text) FROM PUBLIC, anon;

-- Backfill function. The contract PR deletes it. It exists so that pgTAP can test the backfill.
CREATE OR REPLACE FUNCTION public.backfill_employee_availability_local()
RETURNS integer
LANGUAGE plpgsql
SET search_path = public, pg_catalog
AS $$
DECLARE
  v_count integer;
BEGIN
  UPDATE public.employee_availability ea
  SET start_time_local = ea.start_time + public.availability_noon_offset(COALESCE(ea.updated_at, ea.created_at), r.timezone),
      end_time_local   = ea.end_time   + public.availability_noon_offset(COALESCE(ea.updated_at, ea.created_at), r.timezone)
  FROM public.restaurants r
  WHERE r.id = ea.restaurant_id
    AND ea.start_time IS NOT NULL
    AND ea.end_time IS NOT NULL
    AND (ea.start_time_local IS NULL OR ea.end_time_local IS NULL);
  GET DIAGNOSTICS v_count = ROW_COUNT;
  RETURN v_count;
END;
$$;

REVOKE ALL ON FUNCTION public.backfill_employee_availability_local() FROM PUBLIC, anon, authenticated, service_role;

-- Trigger function: keep the two frames in step (spec section 7.2).
CREATE OR REPLACE FUNCTION public.sync_employee_availability_frames()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $$
DECLARE
  v_tz text;
  v_off interval;
  v_local_changed boolean;
BEGIN
  SELECT timezone INTO v_tz FROM public.restaurants WHERE id = NEW.restaurant_id;
  v_off := public.availability_noon_offset(now(), v_tz);

  IF TG_OP = 'INSERT' THEN
    IF NEW.start_time_local IS NOT NULL AND NEW.end_time_local IS NOT NULL THEN
      NEW.start_time := NEW.start_time_local - v_off;
      NEW.end_time := NEW.end_time_local - v_off;
    ELSIF NEW.start_time_local IS NULL AND NEW.end_time_local IS NULL
      AND NEW.start_time IS NOT NULL AND NEW.end_time IS NOT NULL THEN
      NEW.start_time_local := NEW.start_time + v_off;
      NEW.end_time_local := NEW.end_time + v_off;
    ELSE
      RAISE EXCEPTION 'employee_availability needs a complete pair of start and end times'
        USING ERRCODE = 'not_null_violation';
    END IF;
    RETURN NEW;
  END IF;

  -- UPDATE
  IF NEW.start_time_local IS NULL OR NEW.end_time_local IS NULL THEN
    RAISE EXCEPTION 'employee_availability local times cannot be null'
      USING ERRCODE = 'not_null_violation';
  END IF;

  v_local_changed := NEW.start_time_local IS DISTINCT FROM OLD.start_time_local
    OR NEW.end_time_local IS DISTINCT FROM OLD.end_time_local;

  IF v_local_changed THEN
    NEW.start_time := NEW.start_time_local - v_off;
    NEW.end_time := NEW.end_time_local - v_off;
    RETURN NEW;
  END IF;

  IF NEW.start_time IS NULL OR NEW.end_time IS NULL THEN
    RAISE EXCEPTION 'employee_availability legacy times cannot be null'
      USING ERRCODE = 'not_null_violation';
  END IF;

  IF NEW.start_time IS DISTINCT FROM OLD.start_time THEN
    NEW.start_time_local := NEW.start_time + v_off;
  END IF;
  IF NEW.end_time IS DISTINCT FROM OLD.end_time THEN
    NEW.end_time_local := NEW.end_time + v_off;
  END IF;
  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.sync_employee_availability_frames() FROM PUBLIC, anon;

-- Step 1: add the local columns and drop NOT NULL on the legacy columns.
ALTER TABLE public.employee_availability ADD COLUMN IF NOT EXISTS start_time_local TIME;
ALTER TABLE public.employee_availability ADD COLUMN IF NOT EXISTS end_time_local TIME;
ALTER TABLE public.employee_availability ALTER COLUMN start_time DROP NOT NULL;
ALTER TABLE public.employee_availability ALTER COLUMN end_time DROP NOT NULL;

-- Step 2: keep updated_at as evidence of the write date.
ALTER TABLE public.employee_availability DISABLE TRIGGER update_employee_availability_updated_at;

-- Step 3: backfill.
SELECT public.backfill_employee_availability_local();

-- Step 4.
ALTER TABLE public.employee_availability ENABLE TRIGGER update_employee_availability_updated_at;

-- Step 5: the sync trigger must not exist during the backfill.
DROP TRIGGER IF EXISTS sync_employee_availability_frames ON public.employee_availability;
CREATE TRIGGER sync_employee_availability_frames
  BEFORE INSERT OR UPDATE ON public.employee_availability
  FOR EACH ROW EXECUTE FUNCTION public.sync_employee_availability_frames();

-- Step 6: constraint. A null passes.
ALTER TABLE public.employee_availability DROP CONSTRAINT IF EXISTS employee_availability_local_time_differs;
ALTER TABLE public.employee_availability
  ADD CONSTRAINT employee_availability_local_time_differs CHECK (end_time_local <> start_time_local);

NOTIFY pgrst, 'reload schema';

COMMIT;
