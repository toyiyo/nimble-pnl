BEGIN;
SELECT plan(6);

SELECT has_table('public', 'device_tokens', 'device_tokens table exists');
SELECT has_column('public', 'device_tokens', 'user_id', 'has user_id column');
SELECT has_column('public', 'device_tokens', 'token', 'has token column');
SELECT has_column('public', 'device_tokens', 'platform', 'has platform column');
SELECT has_column('public', 'device_tokens', 'restaurant_id', 'has restaurant_id column');
SELECT has_unique('public', 'device_tokens', 'device_tokens has unique constraint');

SELECT * FROM finish();
ROLLBACK;
