-- Absence guards for the weekly-brief and ops-inbox decommission.
-- The migration 20260915120000_decommission_weekly_brief_ops_inbox.sql
-- drops these tables, functions, cron jobs, and queues. These tests fail
-- if a migration brings any of them back.
BEGIN;
SELECT plan(15);

-- ============================================================================
-- TEST CATEGORY 1: The feature tables are gone
-- ============================================================================

SELECT hasnt_table('public', 'ops_inbox_item', 'ops_inbox_item table is dropped');
SELECT hasnt_table('public', 'weekly_brief', 'weekly_brief table is dropped');
SELECT hasnt_table('public', 'weekly_brief_job_log', 'weekly_brief_job_log table is dropped');
SELECT hasnt_table('public', 'notification_preferences', 'notification_preferences table is dropped');

-- ============================================================================
-- TEST CATEGORY 2: The queue and detector functions are gone
-- ============================================================================

SELECT hasnt_function('public', 'enqueue_weekly_brief_jobs', 'enqueue_weekly_brief_jobs is dropped');
SELECT hasnt_function('public', 'process_weekly_brief_queue', 'process_weekly_brief_queue is dropped');
SELECT hasnt_function('public', 'pgmq_delete_message', 'pgmq_delete_message is dropped');
SELECT hasnt_function('public', 'compute_daily_variances', 'compute_daily_variances is dropped');
SELECT hasnt_function('public', 'compute_weekly_variances', 'compute_weekly_variances is dropped');
SELECT hasnt_function('public', 'detect_uncategorized_backlog', 'detect_uncategorized_backlog is dropped');
SELECT hasnt_function('public', 'detect_metric_anomalies', 'detect_metric_anomalies is dropped');
SELECT hasnt_function('public', 'detect_reconciliation_gaps', 'detect_reconciliation_gaps is dropped');

-- ============================================================================
-- TEST CATEGORY 3: The cron jobs are gone
-- ============================================================================

SELECT is(
  (SELECT count(*)::int FROM cron.job
   WHERE jobname IN ('enqueue-weekly-briefs', 'process-weekly-brief-queue', 'generate-weekly-briefs')),
  0,
  'no weekly-brief cron job stays scheduled'
);

-- ============================================================================
-- TEST CATEGORY 4: The pgmq queues are gone (pgmq stores a queue as
-- pgmq.q_<name>; the extension itself stays installed)
-- ============================================================================

SELECT hasnt_table('pgmq', 'q_weekly_brief_jobs', 'weekly_brief_jobs queue is dropped');
SELECT hasnt_table('pgmq', 'q_weekly_brief_dead_letter', 'weekly_brief_dead_letter queue is dropped');

SELECT * FROM finish();
ROLLBACK;
