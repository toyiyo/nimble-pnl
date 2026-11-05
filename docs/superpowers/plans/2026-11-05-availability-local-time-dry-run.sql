-- Read-only dry run for the availability local time backfill.
-- Run this file on production BEFORE the migration. It has SELECT statements only.
-- The helper availability_noon_offset does not exist on production before the merge.
-- So each query computes the offset inline, the same way as the helper:
--   noon  = (instant AT TIME ZONE tz)::date + 12:00
--   offset = noon - ((noon AT TIME ZONE tz) AT TIME ZONE 'UTC')
-- A null or invalid timezone gives a zero offset (tz.name IS NULL).
-- The LEFT JOIN on pg_timezone_names is slow, but it runs one time.

-- Query 1: total rows, available rows, and closed rows.
SELECT
  count(*)                                        AS total_rows,
  count(*) FILTER (WHERE is_available)            AS available_rows,
  count(*) FILTER (WHERE NOT is_available)        AS closed_rows
FROM public.employee_availability;

-- Query 2: for each old pair and new pair, the count of rows.
-- The anchor is COALESCE(updated_at, created_at), as in the backfill.
SELECT
  ea.start_time,
  ea.end_time,
  ea.start_time + o.off AS new_start_time_local,
  ea.end_time + o.off   AS new_end_time_local,
  count(*)              AS row_count
FROM public.employee_availability ea
JOIN public.restaurants r ON r.id = ea.restaurant_id
LEFT JOIN pg_timezone_names tz ON tz.name = r.timezone
CROSS JOIN LATERAL (
  SELECT CASE WHEN tz.name IS NULL THEN INTERVAL '0'
    ELSE ((COALESCE(ea.updated_at, ea.created_at) AT TIME ZONE tz.name)::date + TIME '12:00')
       - ((((COALESCE(ea.updated_at, ea.created_at) AT TIME ZONE tz.name)::date + TIME '12:00')
           AT TIME ZONE tz.name) AT TIME ZONE 'UTC')
  END AS off
) o
WHERE ea.start_time IS NOT NULL
  AND ea.end_time IS NOT NULL
GROUP BY ea.start_time, ea.end_time, ea.start_time + o.off, ea.end_time + o.off
ORDER BY row_count DESC, ea.start_time, ea.end_time;

-- Query 3: rows where created_at and updated_at have different noon offsets.
SELECT
  ea.id,
  ea.restaurant_id,
  r.timezone,
  ea.created_at,
  ea.updated_at,
  oc.off AS created_offset,
  ou.off AS updated_offset
FROM public.employee_availability ea
JOIN public.restaurants r ON r.id = ea.restaurant_id
LEFT JOIN pg_timezone_names tz ON tz.name = r.timezone
CROSS JOIN LATERAL (
  SELECT CASE WHEN tz.name IS NULL THEN INTERVAL '0'
    ELSE ((ea.created_at AT TIME ZONE tz.name)::date + TIME '12:00')
       - ((((ea.created_at AT TIME ZONE tz.name)::date + TIME '12:00')
           AT TIME ZONE tz.name) AT TIME ZONE 'UTC')
  END AS off
) oc
CROSS JOIN LATERAL (
  SELECT CASE WHEN tz.name IS NULL THEN INTERVAL '0'
    ELSE ((ea.updated_at AT TIME ZONE tz.name)::date + TIME '12:00')
       - ((((ea.updated_at AT TIME ZONE tz.name)::date + TIME '12:00')
           AT TIME ZONE tz.name) AT TIME ZONE 'UTC')
  END AS off
) ou
WHERE ea.created_at IS NOT NULL
  AND ea.updated_at IS NOT NULL
  AND oc.off IS DISTINCT FROM ou.off
ORDER BY ea.restaurant_id, ea.updated_at;

-- Query 4: rows with an anchor on the day of a time change,
-- and rows in a restaurant with an invalid or null timezone.
-- A time change day has a different noon offset on the next local day.
SELECT
  ea.id,
  ea.restaurant_id,
  r.timezone,
  COALESCE(ea.updated_at, ea.created_at) AS anchor,
  CASE WHEN tz.name IS NULL THEN 'invalid_or_null_timezone'
       ELSE 'time_change_day' END AS reason
FROM public.employee_availability ea
JOIN public.restaurants r ON r.id = ea.restaurant_id
LEFT JOIN pg_timezone_names tz ON tz.name = r.timezone
CROSS JOIN LATERAL (
  SELECT (COALESCE(ea.updated_at, ea.created_at) AT TIME ZONE tz.name)::date + TIME '12:00' AS noon
) d
WHERE tz.name IS NULL
   OR (
     (d.noon - ((d.noon AT TIME ZONE tz.name) AT TIME ZONE 'UTC'))
     IS DISTINCT FROM
     ((d.noon + INTERVAL '1 day') - (((d.noon + INTERVAL '1 day') AT TIME ZONE tz.name) AT TIME ZONE 'UTC'))
   )
ORDER BY reason, ea.restaurant_id, anchor;
