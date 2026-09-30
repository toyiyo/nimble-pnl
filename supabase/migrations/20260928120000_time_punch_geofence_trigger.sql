-- Off-site punch flags: server-side geofence calculation.
-- The client flag can be false, so the server calculates within_geofence,
-- distance_meters, and geofence_radius_meters on every insert or location
-- update. See docs/superpowers/specs/2026-09-28-offsite-punch-flags-design.md.

CREATE OR REPLACE FUNCTION public.set_punch_geofence()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
-- This function changes only NEW. It reads restaurants for
-- NEW.restaurant_id and writes no other table.
DECLARE
  v_restaurant RECORD;
  v_lat numeric;
  v_lng numeric;
  v_old_lat numeric;
  v_old_lng numeric;
  v_distance numeric;
BEGIN
  IF NEW.location IS NULL THEN
    RETURN NEW;
  END IF;

  -- The server owns these three keys. Delete any client-sent value first.
  NEW.location := NEW.location - 'within_geofence' - 'distance_meters' - 'geofence_radius_meters';

  -- A client may send location_unavailable alongside real coordinates.
  -- getPunchLocationFlag() checks location_unavailable first, so a
  -- stale true value here would hide a punch that does have coordinates.
  -- Delete it whenever both coordinates are present and numeric.
  IF jsonb_typeof(NEW.location -> 'latitude') = 'number'
    AND jsonb_typeof(NEW.location -> 'longitude') = 'number'
  THEN
    NEW.location := NEW.location - 'location_unavailable';
  END IF;

  -- On UPDATE, if the coordinates did not change, keep the radius at punch
  -- time by copying the server keys back from OLD.location. Skip this
  -- during the backfill below: current_setting('app.geofence_backfill')
  -- forces a full recalculation instead of a copy, because the backfill's
  -- purpose is to add the server keys to rows that lack them.
  IF TG_OP = 'UPDATE'
    AND coalesce(current_setting('app.geofence_backfill', true), 'off') <> 'on'
  THEN
    IF jsonb_typeof(NEW.location -> 'latitude') = 'number'
      AND jsonb_typeof(NEW.location -> 'longitude') = 'number'
      AND OLD.location IS NOT NULL
      AND jsonb_typeof(OLD.location -> 'latitude') = 'number'
      AND jsonb_typeof(OLD.location -> 'longitude') = 'number'
    THEN
      v_lat := (NEW.location ->> 'latitude')::numeric;
      v_lng := (NEW.location ->> 'longitude')::numeric;
      v_old_lat := (OLD.location ->> 'latitude')::numeric;
      v_old_lng := (OLD.location ->> 'longitude')::numeric;

      IF v_lat = v_old_lat AND v_lng = v_old_lng THEN
        NEW.location := NEW.location
          || jsonb_strip_nulls(jsonb_build_object(
               'within_geofence', OLD.location -> 'within_geofence',
               'distance_meters', OLD.location -> 'distance_meters',
               'geofence_radius_meters', OLD.location -> 'geofence_radius_meters'
             ));
        RETURN NEW;
      END IF;
    END IF;
  END IF;

  -- Parse defensively. A bad value must never raise an error, because an
  -- error blocks the punch. Check key existence first: jsonb_typeof()
  -- on a missing key returns SQL NULL, and `IF NULL THEN` is false, so
  -- checking only `<> 'number'` would let a missing key fall through.
  IF NOT (NEW.location ? 'latitude' AND NEW.location ? 'longitude')
    OR jsonb_typeof(NEW.location -> 'latitude') <> 'number'
    OR jsonb_typeof(NEW.location -> 'longitude') <> 'number'
  THEN
    RETURN NEW;
  END IF;

  v_lat := (NEW.location ->> 'latitude')::numeric;
  v_lng := (NEW.location ->> 'longitude')::numeric;

  IF v_lat < -90 OR v_lat > 90 OR v_lng < -180 OR v_lng > 180 THEN
    RETURN NEW;
  END IF;

  SELECT latitude, longitude, geofence_radius_meters
    INTO v_restaurant
    FROM public.restaurants
    WHERE id = NEW.restaurant_id;

  IF v_restaurant.latitude IS NULL OR v_restaurant.longitude IS NULL THEN
    RETURN NEW;
  END IF;

  -- Haversine distance in meters. Earth radius 6371000 m, matching
  -- src/lib/haversine.ts.
  v_distance := 6371000 * 2 * asin(sqrt(
    power(sin(radians(v_lat - v_restaurant.latitude) / 2), 2)
    + cos(radians(v_restaurant.latitude)) * cos(radians(v_lat))
      * power(sin(radians(v_lng - v_restaurant.longitude) / 2), 2)
  ));

  NEW.location := NEW.location || jsonb_build_object(
    'distance_meters', round(v_distance),
    'within_geofence', round(v_distance) <= v_restaurant.geofence_radius_meters,
    'geofence_radius_meters', v_restaurant.geofence_radius_meters
  );

  RETURN NEW;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.set_punch_geofence() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS trg_set_punch_geofence ON public.time_punches;

CREATE TRIGGER trg_set_punch_geofence
  BEFORE INSERT OR UPDATE OF location ON public.time_punches
  FOR EACH ROW
  EXECUTE FUNCTION public.set_punch_geofence();

CREATE INDEX IF NOT EXISTS idx_time_punches_offsite
  ON public.time_punches (restaurant_id, punch_time)
  WHERE (location ->> 'within_geofence') = 'false';

-- Backfill: recalculate location for punches at restaurants that have
-- coordinates and a location with a latitude key. The session flag
-- app.geofence_backfill forces the trigger to recalculate instead of
-- copying the (absent) server keys from OLD.location. The statement is
-- idempotent.
SELECT set_config('app.geofence_backfill', 'on', true);

-- The backfill sets location to its own value on each matching row.
-- Disable the updated_at trigger around it, or that trigger would stamp
-- updated_at = now() on every row, though nothing but the server keys
-- inside location actually changed.
ALTER TABLE public.time_punches
  DISABLE TRIGGER update_time_punches_updated_at;

UPDATE public.time_punches tp
SET location = tp.location
FROM public.restaurants r
WHERE r.id = tp.restaurant_id
  AND r.latitude IS NOT NULL
  AND r.longitude IS NOT NULL
  AND tp.location ? 'latitude';

ALTER TABLE public.time_punches
  ENABLE TRIGGER update_time_punches_updated_at;

SELECT set_config('app.geofence_backfill', 'off', true);
