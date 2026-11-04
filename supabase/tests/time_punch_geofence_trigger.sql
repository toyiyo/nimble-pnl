BEGIN;
SELECT plan(19);

-- Restaurant with coordinates: San Francisco Ferry Building, radius 200 m.
INSERT INTO public.restaurants (id, name, latitude, longitude, geofence_radius_meters)
VALUES ('11111111-1111-1111-1111-111111111111', 'Geofenced Diner', 37.7955, -122.3937, 200);

-- Restaurant with no coordinates.
INSERT INTO public.restaurants (id, name)
VALUES ('22222222-2222-2222-2222-222222222222', 'No-Coordinates Diner');

INSERT INTO public.employees (id, restaurant_id, name, position)
VALUES ('33333333-3333-3333-3333-333333333333', '11111111-1111-1111-1111-111111111111', 'Geofenced Employee', 'Server');

INSERT INTO public.employees (id, restaurant_id, name, position)
VALUES ('44444444-4444-4444-4444-444444444444', '22222222-2222-2222-2222-222222222222', 'No-Coordinates Employee', 'Server');

-- 1. A punch ~50 m away: within_geofence = true, distance_meters near 50.
INSERT INTO public.time_punches (id, restaurant_id, employee_id, punch_type, location)
VALUES (
  '55555555-5555-5555-5555-555555555555',
  '11111111-1111-1111-1111-111111111111',
  '33333333-3333-3333-3333-333333333333',
  'clock_in',
  jsonb_build_object('latitude', 37.7960, 'longitude', -122.3937)
);

SELECT is(
  (SELECT location->>'within_geofence' FROM public.time_punches WHERE id = '55555555-5555-5555-5555-555555555555'),
  'true',
  'a punch 50 m away is within the geofence'
);

SELECT ok(
  (SELECT (location->>'distance_meters')::numeric FROM public.time_punches WHERE id = '55555555-5555-5555-5555-555555555555') BETWEEN 30 AND 70,
  'the distance of a 50 m punch is near 50'
);

SELECT is(
  (SELECT (location->>'geofence_radius_meters')::int FROM public.time_punches WHERE id = '55555555-5555-5555-5555-555555555555'),
  200,
  'the punch keeps the radius at punch time'
);

-- 2. A punch ~1 km away: within_geofence = false.
INSERT INTO public.time_punches (id, restaurant_id, employee_id, punch_type, location)
VALUES (
  '66666666-6666-6666-6666-666666666666',
  '11111111-1111-1111-1111-111111111111',
  '33333333-3333-3333-3333-333333333333',
  'clock_in',
  jsonb_build_object('latitude', 37.8045, 'longitude', -122.3937)
);

SELECT is(
  (SELECT location->>'within_geofence' FROM public.time_punches WHERE id = '66666666-6666-6666-6666-666666666666'),
  'false',
  'a punch about 1 km away is off-site'
);

-- 3. Client sends within_geofence: true, distance_meters: 0 from 1 km away. Server overrides.
INSERT INTO public.time_punches (id, restaurant_id, employee_id, punch_type, location)
VALUES (
  '77777777-7777-7777-7777-777777777777',
  '11111111-1111-1111-1111-111111111111',
  '33333333-3333-3333-3333-333333333333',
  'clock_in',
  jsonb_build_object(
    'latitude', 37.8045, 'longitude', -122.3937,
    'within_geofence', true, 'distance_meters', 0
  )
);

SELECT is(
  (SELECT location->>'within_geofence' FROM public.time_punches WHERE id = '77777777-7777-7777-7777-777777777777'),
  'false',
  'the server overrides a spoofed within_geofence value'
);

SELECT ok(
  (SELECT (location->>'distance_meters')::numeric FROM public.time_punches WHERE id = '77777777-7777-7777-7777-777777777777') > 500,
  'the server overrides a spoofed distance_meters value'
);

-- 4. A restaurant with no coordinates: the three server keys are absent.
INSERT INTO public.time_punches (id, restaurant_id, employee_id, punch_type, location)
VALUES (
  '88888888-8888-8888-8888-888888888888',
  '22222222-2222-2222-2222-222222222222',
  '44444444-4444-4444-4444-444444444444',
  'clock_in',
  jsonb_build_object('latitude', 37.7960, 'longitude', -122.3937)
);

SELECT ok(
  NOT (SELECT location ?| array['within_geofence', 'distance_meters', 'geofence_radius_meters']
       FROM public.time_punches WHERE id = '88888888-8888-8888-8888-888888888888'),
  'a restaurant with no coordinates gets no server keys'
);

-- 5. location IS NULL: the row keeps location IS NULL.
INSERT INTO public.time_punches (id, restaurant_id, employee_id, punch_type, location)
VALUES (
  '99999999-9999-9999-9999-999999999999',
  '11111111-1111-1111-1111-111111111111',
  '33333333-3333-3333-3333-333333333333',
  'clock_in',
  NULL
);

SELECT ok(
  (SELECT location IS NULL FROM public.time_punches WHERE id = '99999999-9999-9999-9999-999999999999'),
  'a punch with location IS NULL keeps location IS NULL'
);

-- 6. A Sling-style insert with no location column: lives_ok, no change.
SELECT lives_ok(
  $$ INSERT INTO public.time_punches (id, restaurant_id, employee_id, punch_type)
     VALUES ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', '11111111-1111-1111-1111-111111111111',
             '33333333-3333-3333-3333-333333333333', 'clock_in') $$,
  'a Sling-style insert with no location column succeeds'
);

-- 7. latitude as a JSON string: lives_ok, no server keys.
SELECT lives_ok(
  $$ INSERT INTO public.time_punches (id, restaurant_id, employee_id, punch_type, location)
     VALUES ('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', '11111111-1111-1111-1111-111111111111',
             '33333333-3333-3333-3333-333333333333', 'clock_in',
             jsonb_build_object('latitude', '37.7960', 'longitude', -122.3937)) $$,
  'a punch with latitude as a JSON string succeeds'
);

SELECT ok(
  NOT (SELECT location ?| array['within_geofence', 'distance_meters', 'geofence_radius_meters']
       FROM public.time_punches WHERE id = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb'),
  'a string latitude gets no server keys'
);

-- 8. latitude = 999: lives_ok, no server keys.
SELECT lives_ok(
  $$ INSERT INTO public.time_punches (id, restaurant_id, employee_id, punch_type, location)
     VALUES ('cccccccc-cccc-cccc-cccc-cccccccccccc', '11111111-1111-1111-1111-111111111111',
             '33333333-3333-3333-3333-333333333333', 'clock_in',
             jsonb_build_object('latitude', 999, 'longitude', -122.3937)) $$,
  'a punch with an out-of-range latitude succeeds'
);

SELECT ok(
  NOT (SELECT location ?| array['within_geofence', 'distance_meters', 'geofence_radius_meters']
       FROM public.time_punches WHERE id = 'cccccccc-cccc-cccc-cccc-cccccccccccc'),
  'an out-of-range latitude gets no server keys'
);

-- 9. location_unavailable: true is kept.
INSERT INTO public.time_punches (id, restaurant_id, employee_id, punch_type, location)
VALUES (
  'dddddddd-dddd-dddd-dddd-dddddddddddd',
  '11111111-1111-1111-1111-111111111111',
  '33333333-3333-3333-3333-333333333333',
  'clock_in',
  jsonb_build_object('location_unavailable', true)
);

SELECT is(
  (SELECT location->>'location_unavailable' FROM public.time_punches WHERE id = 'dddddddd-dddd-dddd-dddd-dddddddddddd'),
  'true',
  'location_unavailable stays true'
);

-- The restaurant has coordinates, but this punch has no latitude/longitude
-- keys at all. The server must skip the flag, not write null server keys.
SELECT ok(
  NOT (SELECT location ?| array['within_geofence', 'distance_meters', 'geofence_radius_meters']
       FROM public.time_punches WHERE id = 'dddddddd-dddd-dddd-dddd-dddddddddddd'),
  'a punch with no GPS keys gets no server keys, even at a restaurant with coordinates'
);

-- 9b. A client sends location_unavailable: true alongside real coordinates.
-- The server deletes the stale flag, since getPunchLocationFlag() checks
-- location_unavailable first and would otherwise hide a punch that has
-- coordinates.
INSERT INTO public.time_punches (id, restaurant_id, employee_id, punch_type, location)
VALUES (
  'eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee',
  '11111111-1111-1111-1111-111111111111',
  '33333333-3333-3333-3333-333333333333',
  'clock_in',
  jsonb_build_object('latitude', 37.7960, 'longitude', -122.3937, 'location_unavailable', true)
);

SELECT ok(
  NOT (SELECT location ? 'location_unavailable' FROM public.time_punches WHERE id = 'eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee'),
  'location_unavailable is deleted when real coordinates are present'
);

-- 10. UPDATE ... SET punch_time: the flags do not change.
UPDATE public.time_punches
SET punch_time = punch_time + interval '1 minute'
WHERE id = '66666666-6666-6666-6666-666666666666';

SELECT is(
  (SELECT location->>'within_geofence' FROM public.time_punches WHERE id = '66666666-6666-6666-6666-666666666666'),
  'false',
  'an update of punch_time does not change the flags'
);

-- 11. Restaurant radius changes to 2000, then UPDATE ... SET location with the
-- same coordinates: geofence_radius_meters stays 200.
UPDATE public.restaurants
SET geofence_radius_meters = 2000
WHERE id = '11111111-1111-1111-1111-111111111111';

UPDATE public.time_punches
SET location = jsonb_build_object('latitude', 37.7960, 'longitude', -122.3937)
WHERE id = '55555555-5555-5555-5555-555555555555';

SELECT is(
  (SELECT (location->>'geofence_radius_meters')::int FROM public.time_punches WHERE id = '55555555-5555-5555-5555-555555555555'),
  200,
  'an update to the same coordinates keeps the radius at punch time'
);

-- 12. The partial index idx_time_punches_offsite exists.
SELECT has_index('public', 'time_punches', 'idx_time_punches_offsite', 'the off-site partial index exists');

SELECT * FROM finish();
ROLLBACK;
