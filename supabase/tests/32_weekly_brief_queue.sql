-- Tests for weekly brief queue pipeline (pgmq-based)
BEGIN;
SELECT plan(10);

-- ============================================================================
-- TEST CATEGORY 1: Tables & Extensions Exist
-- ============================================================================

SELECT has_table('public', 'weekly_brief_job_log', 'weekly_brief_job_log table exists');

SELECT has_extension('pgmq');

-- ============================================================================
-- TEST CATEGORY 2: Indexes on job_log
-- ============================================================================

SELECT has_index(
  'public', 'weekly_brief_job_log',
  'idx_weekly_brief_job_log_restaurant_week',
  'job_log has index on restaurant_id, brief_week_end'
);

SELECT has_index(
  'public', 'weekly_brief_job_log',
  'idx_weekly_brief_job_log_status_created',
  'job_log has index on status, created_at'
);

-- ============================================================================
-- TEST CATEGORY 3: Functions Exist
-- ============================================================================

SELECT has_function(
  'public', 'enqueue_weekly_brief_jobs', ARRAY[]::text[],
  'enqueue_weekly_brief_jobs() function exists'
);

SELECT has_function(
  'public', 'process_weekly_brief_queue', ARRAY[]::text[],
  'process_weekly_brief_queue() function exists'
);

SELECT has_function(
  'public', 'pgmq_delete_message', ARRAY['text', 'bigint'],
  'pgmq_delete_message(text, bigint) wrapper function exists'
);

-- ============================================================================
-- TEST CATEGORY 4: RLS is enabled on job_log
-- ============================================================================

SELECT row_eq(
  $$ SELECT relrowsecurity FROM pg_class WHERE relname = 'weekly_brief_job_log' $$,
  ROW(true),
  'RLS is enabled on weekly_brief_job_log'
);

-- ============================================================================
-- TEST CATEGORY 5: enqueue_weekly_brief_jobs returns valid JSONB
-- ============================================================================

-- Call the function (no restaurants exist in test context, so expect 0 enqueued)
SELECT is(
  (enqueue_weekly_brief_jobs() ->> 'enqueued')::int,
  0,
  'enqueue_weekly_brief_jobs returns 0 enqueued when no restaurants exist'
);

SELECT is(
  (enqueue_weekly_brief_jobs() ->> 'skipped')::int,
  0,
  'enqueue_weekly_brief_jobs returns 0 skipped when no restaurants exist'
);

SELECT * FROM finish();
ROLLBACK;
