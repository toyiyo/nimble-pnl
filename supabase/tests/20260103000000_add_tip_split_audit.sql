-- Test: Tip Split Audit Trail Migration
-- Tests the log_tip_split_change() trigger function
-- Verifies INSERT, UPDATE (approval, reopen, modify), and DELETE operations

BEGIN;

-- Load pgTAP extension
SELECT plan(15);

-- Setup: Disable RLS for testing
ALTER TABLE restaurants DISABLE ROW LEVEL SECURITY;
ALTER TABLE tip_splits DISABLE ROW LEVEL SECURITY;
ALTER TABLE tip_split_audit DISABLE ROW LEVEL SECURITY;
ALTER TABLE user_restaurants DISABLE ROW LEVEL SECURITY;

-- Setup authenticated user context
SET LOCAL role TO postgres;
SET LOCAL "request.jwt.claims" TO '{"sub": "22222222-2222-2222-2222-222222222222"}';

-- Test user and restaurant
INSERT INTO auth.users (id, email) VALUES 
  ('11111111-1111-1111-1111-111111111111', 'test@example.com'),
  ('22222222-2222-2222-2222-222222222222', 'manager@example.com')
ON CONFLICT (id) DO NOTHING;

INSERT INTO restaurants (id, name) VALUES
  ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'Test Restaurant')
ON CONFLICT (id) DO NOTHING;

INSERT INTO user_restaurants (user_id, restaurant_id, role) VALUES
  ('11111111-1111-1111-1111-111111111111', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'owner'),
  ('22222222-2222-2222-2222-222222222222', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'manager')
ON CONFLICT (user_id, restaurant_id) DO NOTHING;

-- Test 1: INSERT creates 'created' audit entry
INSERT INTO tip_splits (
  id, 
  restaurant_id, 
  split_date, 
  total_amount, 
  status, 
  created_by
) VALUES (
  'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb',
  'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
  '2026-01-03',
  10000,
  'draft',
  '11111111-1111-1111-1111-111111111111'
);

SELECT ok(
  EXISTS (
    SELECT 1 FROM tip_split_audit 
    WHERE tip_split_id = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb' 
    AND action = 'created'
    AND changed_by = '11111111-1111-1111-1111-111111111111'
  ),
  'INSERT creates "created" audit entry with correct changed_by'
);

-- Test 2: UPDATE draft → approved creates 'approved' audit entry
UPDATE tip_splits 
SET status = 'approved',
    approved_by = '22222222-2222-2222-2222-222222222222',
    approved_at = NOW()
WHERE id = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb';

SELECT ok(
  EXISTS (
    SELECT 1 FROM tip_split_audit 
    WHERE tip_split_id = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb' 
    AND action = 'approved'
    AND changed_by = '22222222-2222-2222-2222-222222222222'
  ),
  'UPDATE draft→approved creates "approved" audit entry'
);

SELECT ok(
  (SELECT changes FROM tip_split_audit 
   WHERE tip_split_id = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb' 
   AND action = 'approved')::jsonb ? 'status',
  'Approved audit entry contains status change in JSONB'
);

-- Test 3: UPDATE approved → draft creates 'reopened' audit entry
-- Set session for auth.uid() to work
SET LOCAL request.jwt.claims.sub = '22222222-2222-2222-2222-222222222222';

UPDATE tip_splits 
SET status = 'draft',
    approved_by = NULL,
    approved_at = NULL
WHERE id = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb';

SELECT ok(
  EXISTS (
    SELECT 1 FROM tip_split_audit 
    WHERE tip_split_id = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb' 
    AND action = 'reopened'
  ),
  'UPDATE approved→draft creates "reopened" audit entry'
);

SELECT ok(
  (SELECT reason FROM tip_split_audit 
   WHERE tip_split_id = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb' 
   AND action = 'reopened') IS NOT NULL,
  'Reopened audit entry includes reason text'
);

SELECT ok(
  (SELECT reason FROM tip_split_audit 
   WHERE tip_split_id = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb' 
   AND action = 'reopened') LIKE '%Manager reopened%',
  'Reopened audit entry reason mentions "Manager reopened"'
);

-- Test 4: UPDATE total_amount creates 'modified' audit entry
UPDATE tip_splits 
SET total_amount = 12000
WHERE id = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb';

SELECT ok(
  EXISTS (
    SELECT 1 FROM tip_split_audit 
    WHERE tip_split_id = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb' 
    AND action = 'modified'
  ),
  'UPDATE total_amount creates "modified" audit entry'
);

SELECT ok(
  (SELECT changes FROM tip_split_audit 
   WHERE tip_split_id = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb' 
   AND action = 'modified')::jsonb ? 'total_amount',
  'Modified audit entry contains total_amount change in JSONB'
);

SELECT ok(
  (SELECT changes->'total_amount'->>'old' FROM tip_split_audit 
   WHERE tip_split_id = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb' 
   AND action = 'modified') = '10000',
  'Modified audit entry captures old value correctly'
);

SELECT ok(
  (SELECT changes->'total_amount'->>'new' FROM tip_split_audit 
   WHERE tip_split_id = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb' 
   AND action = 'modified') = '12000',
  'Modified audit entry captures new value correctly'
);

-- Test 5: DELETE creates 'deleted' audit entry
DELETE FROM tip_splits WHERE id = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb';

SELECT ok(
  EXISTS (
    SELECT 1 FROM tip_split_audit 
    WHERE action = 'deleted'
    AND split_reference = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb'
    AND tip_split_id IS NULL
  ),
  'DELETE creates "deleted" audit entry (tip_split_id is NULL, split_reference preserved)'
);

-- Test 6: Verify audit entries survive parent deletion
SELECT ok(
  (SELECT COUNT(*) FROM tip_split_audit 
   WHERE split_reference = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb') >= 5,
  'Audit entries survive after parent tip_split is deleted'
);

-- Test 7: Verify changed_by is captured correctly
SELECT ok(
  EXISTS (
    SELECT 1 FROM tip_split_audit 
    WHERE action = 'created'
    AND changed_by = '11111111-1111-1111-1111-111111111111'
  ),
  'changed_by correctly captures user who created split'
);

-- Test 8: Verify changed_at timestamp is set
SELECT ok(
  (SELECT changed_at FROM tip_split_audit WHERE action = 'created' LIMIT 1) IS NOT NULL,
  'changed_at timestamp is automatically set'
);

-- Test 9: Verify action constraint
SELECT throws_ok(
  $$INSERT INTO tip_split_audit (tip_split_id, action, changed_by) 
    VALUES ('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', 'invalid_action', '11111111-1111-1111-1111-111111111111')$$,
  NULL,
  NULL,
  'Invalid action value is rejected by CHECK constraint'
);

-- Cleanup
DELETE FROM tip_split_audit WHERE split_reference = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb';
DELETE FROM tip_splits WHERE id = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb';
DELETE FROM user_restaurants WHERE restaurant_id = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
DELETE FROM restaurants WHERE id = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
-- Don't delete auth.users as they may be referenced elsewhere

SELECT * FROM finish();

ROLLBACK;
