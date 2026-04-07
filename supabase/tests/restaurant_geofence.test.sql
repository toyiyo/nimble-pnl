BEGIN;
SELECT plan(4);

SELECT has_column('public', 'restaurants', 'latitude', 'has latitude column');
SELECT has_column('public', 'restaurants', 'longitude', 'has longitude column');
SELECT has_column('public', 'restaurants', 'geofence_radius_meters', 'has geofence_radius_meters column');
SELECT has_column('public', 'restaurants', 'geofence_enforcement', 'has geofence_enforcement column');

SELECT * FROM finish();
ROLLBACK;
