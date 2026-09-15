import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

/**
 * Absence guards for the weekly-brief / ops-inbox decommission (task 6).
 *
 * The migration drops 4 tables and 8 functions. The generated Supabase
 * types must not name the dropped objects. These tests fail if an entry
 * comes back after a type regeneration against a stale schema.
 */

const root = resolve(__dirname, '../..');

const TYPE_FILES = [
  'src/integrations/supabase/types.ts',
  'src/types/supabase.ts',
];

const DROPPED_TABLES = [
  'weekly_brief',
  'weekly_brief_job_log',
  'ops_inbox_item',
  'notification_preferences',
];

const DROPPED_FUNCTIONS = [
  'enqueue_weekly_brief_jobs',
  'process_weekly_brief_queue',
  'pgmq_delete_message',
  'compute_daily_variances',
  'compute_weekly_variances',
  'detect_uncategorized_backlog',
  'detect_metric_anomalies',
  'detect_reconciliation_gaps',
];

describe.each(TYPE_FILES)('%s names no dropped object', (file) => {
  const src = readFileSync(resolve(root, file), 'utf-8');

  it.each(DROPPED_TABLES)('table %s is absent', (table) => {
    expect(src).not.toContain(table);
  });

  it.each(DROPPED_FUNCTIONS)('function %s is absent', (fn) => {
    expect(src).not.toContain(fn);
  });
});
