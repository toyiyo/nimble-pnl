BEGIN;
SELECT plan(7);

-- Table exists
SELECT has_table('public', 'web_push_subscriptions', 'web_push_subscriptions table exists');

-- Required columns
SELECT has_column('public', 'web_push_subscriptions', 'id', 'has id column');
SELECT has_column('public', 'web_push_subscriptions', 'user_id', 'has user_id column');
SELECT has_column('public', 'web_push_subscriptions', 'restaurant_id', 'has restaurant_id column');
SELECT has_column('public', 'web_push_subscriptions', 'endpoint', 'has endpoint column');
SELECT has_column('public', 'web_push_subscriptions', 'p256dh', 'has p256dh column');
SELECT has_column('public', 'web_push_subscriptions', 'auth', 'has auth column');

SELECT * FROM finish();
ROLLBACK;
