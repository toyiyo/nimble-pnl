-- pgTAP: focus_connections gains the FocusLink API columns, and the legacy
-- portal credentials become optional.
BEGIN;
SELECT plan(7);

-- New API columns exist.
SELECT has_column('public', 'focus_connections', 'api_key', 'api_key column added');
SELECT has_column('public', 'focus_connections', 'api_secret_encrypted', 'api_secret_encrypted column added');
SELECT has_column('public', 'focus_connections', 'mid', 'mid column added');
SELECT has_column('public', 'focus_connections', 'environment', 'environment column added');

-- environment is constrained to 'sandbox' | 'production' exactly.
SELECT ok(
  EXISTS (
    SELECT 1
    FROM pg_constraint c
    JOIN pg_attribute a
      ON a.attrelid = c.conrelid
     AND a.attnum = ANY(c.conkey)
    WHERE c.conrelid = 'public.focus_connections'::regclass
      AND c.contype = 'c'
      AND a.attname = 'environment'
      AND pg_get_constraintdef(c.oid) LIKE '%sandbox%'
      AND pg_get_constraintdef(c.oid) LIKE '%production%'
  ),
  'environment CHECK allows only sandbox and production'
);

-- Portal credentials are no longer required (FocusLink uses key/secret).
SELECT col_is_null('public', 'focus_connections', 'username', 'username is now nullable');
SELECT col_is_null('public', 'focus_connections', 'password_encrypted', 'password_encrypted is now nullable');

SELECT * FROM finish();
ROLLBACK;
