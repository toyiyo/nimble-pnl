ALTER TABLE public.restaurants
  ADD COLUMN IF NOT EXISTS latitude numeric,
  ADD COLUMN IF NOT EXISTS longitude numeric,
  ADD COLUMN IF NOT EXISTS geofence_radius_meters integer NOT NULL DEFAULT 200,
  ADD COLUMN IF NOT EXISTS geofence_enforcement text NOT NULL DEFAULT 'off'
    CHECK (geofence_enforcement IN ('off', 'warn', 'block'));
