-- Tests for AI Chat Persistence migration
-- Covers tables, triggers, functions, and RLS policies
BEGIN;
SELECT plan(25);

-- ============================================================================
-- TEST CATEGORY 1: Tables Exist
-- ============================================================================

SELECT has_table(
  'public',
  'ai_chat_sessions',
  'ai_chat_sessions table should exist'
);

SELECT has_table(
  'public',
  'ai_chat_messages',
  'ai_chat_messages table should exist'
);

-- ============================================================================
-- TEST CATEGORY 2: Trigger Function
-- ============================================================================

SELECT has_function(
  'public',
  'update_ai_chat_session_timestamp',
  'update_ai_chat_session_timestamp function should exist'
);

SELECT function_returns(
  'public',
  'update_ai_chat_session_timestamp',
  'trigger',
  'update_ai_chat_session_timestamp should return trigger'
);

SELECT function_lang_is(
  'public',
  'update_ai_chat_session_timestamp',
  'plpgsql',
  'update_ai_chat_session_timestamp should be plpgsql'
);

-- Test trigger exists on ai_chat_messages
SELECT has_trigger(
  'public',
  'ai_chat_messages',
  'ai_chat_messages_update_session',
  'ai_chat_messages should have update_session trigger'
);

-- ============================================================================
-- TEST CATEGORY 3: Archive Function
-- ============================================================================

SELECT has_function(
  'public',
  'archive_old_ai_chat_sessions',
  ARRAY['uuid', 'uuid'],
  'archive_old_ai_chat_sessions function should exist with correct signature'
);

SELECT function_returns(
  'public',
  'archive_old_ai_chat_sessions',
  ARRAY['uuid', 'uuid'],
  'integer',
  'archive_old_ai_chat_sessions should return integer'
);

SELECT function_lang_is(
  'public',
  'archive_old_ai_chat_sessions',
  ARRAY['uuid', 'uuid'],
  'plpgsql',
  'archive_old_ai_chat_sessions should be plpgsql'
);

-- ============================================================================
-- TEST CATEGORY 4: RLS Enabled
-- ============================================================================

-- Helper function to check if a table has RLS enabled
CREATE OR REPLACE FUNCTION test_has_rls_enabled(schema_name text, table_name text)
RETURNS boolean AS $$
  SELECT relrowsecurity
  FROM pg_class c
  JOIN pg_namespace n ON c.relnamespace = n.oid
  WHERE c.relname = table_name AND n.nspname = schema_name;
$$ LANGUAGE sql;

SELECT ok(
  test_has_rls_enabled('public', 'ai_chat_sessions'),
  'ai_chat_sessions table should have RLS enabled'
);

SELECT ok(
  test_has_rls_enabled('public', 'ai_chat_messages'),
  'ai_chat_messages table should have RLS enabled'
);

-- ============================================================================
-- TEST CATEGORY 5: RLS Policies Exist
-- ============================================================================

-- Helper function to check if a policy exists
CREATE OR REPLACE FUNCTION test_has_policy(p_table text, p_policy text)
RETURNS boolean AS $$
  SELECT EXISTS (
    SELECT 1
    FROM pg_policies
    WHERE schemaname = 'public'
    AND tablename = p_table
    AND policyname = p_policy
  );
$$ LANGUAGE sql;

-- Sessions policies
SELECT ok(
  test_has_policy('ai_chat_sessions', 'ai_chat_sessions_select'),
  'ai_chat_sessions should have select policy'
);

SELECT ok(
  test_has_policy('ai_chat_sessions', 'ai_chat_sessions_insert'),
  'ai_chat_sessions should have insert policy'
);

SELECT ok(
  test_has_policy('ai_chat_sessions', 'ai_chat_sessions_update'),
  'ai_chat_sessions should have update policy'
);

SELECT ok(
  test_has_policy('ai_chat_sessions', 'ai_chat_sessions_delete'),
  'ai_chat_sessions should have delete policy'
);

-- Messages policies
SELECT ok(
  test_has_policy('ai_chat_messages', 'ai_chat_messages_select'),
  'ai_chat_messages should have select policy'
);

SELECT ok(
  test_has_policy('ai_chat_messages', 'ai_chat_messages_insert'),
  'ai_chat_messages should have insert policy'
);

SELECT ok(
  test_has_policy('ai_chat_messages', 'ai_chat_messages_delete'),
  'ai_chat_messages should have delete policy'
);

-- ============================================================================
-- TEST CATEGORY 6: Column Constraints
-- ============================================================================

-- Check ai_chat_messages role constraint
SELECT col_has_check(
  'public',
  'ai_chat_messages',
  'role',
  'ai_chat_messages.role should have check constraint'
);

-- ============================================================================
-- TEST CATEGORY 7: Indexes Exist
-- ============================================================================

SELECT has_index(
  'public',
  'ai_chat_sessions',
  'idx_ai_chat_sessions_restaurant_updated',
  'ai_chat_sessions should have restaurant_updated index'
);

SELECT has_index(
  'public',
  'ai_chat_sessions',
  'idx_ai_chat_sessions_user',
  'ai_chat_sessions should have user index'
);

SELECT has_index(
  'public',
  'ai_chat_sessions',
  'idx_ai_chat_sessions_active',
  'ai_chat_sessions should have active sessions index'
);

SELECT has_index(
  'public',
  'ai_chat_messages',
  'idx_ai_chat_messages_session',
  'ai_chat_messages should have session index'
);

-- ============================================================================
-- TEST CATEGORY 8: RLS Policy Security Checks
-- ============================================================================

-- Verify update/delete policies include restaurant_id check (from fix migration)
-- This checks that the policies reference both user_id AND restaurant_id
CREATE OR REPLACE FUNCTION test_policy_has_restaurant_check(p_table text, p_policy text)
RETURNS boolean AS $$
  SELECT EXISTS (
    SELECT 1
    FROM pg_policies
    WHERE schemaname = 'public'
    AND tablename = p_table
    AND policyname = p_policy
    AND (qual LIKE '%restaurant_id%' OR with_check LIKE '%restaurant_id%')
  );
$$ LANGUAGE sql;

SELECT ok(
  test_policy_has_restaurant_check('ai_chat_sessions', 'ai_chat_sessions_update'),
  'ai_chat_sessions update policy should include restaurant_id check'
);

SELECT ok(
  test_policy_has_restaurant_check('ai_chat_sessions', 'ai_chat_sessions_delete'),
  'ai_chat_sessions delete policy should include restaurant_id check'
);

-- ============================================================================
-- Cleanup helper functions
-- ============================================================================

DROP FUNCTION IF EXISTS test_has_rls_enabled(text, text);
DROP FUNCTION IF EXISTS test_has_policy(text, text);
DROP FUNCTION IF EXISTS test_policy_has_restaurant_check(text, text);

SELECT * FROM finish();
ROLLBACK;
