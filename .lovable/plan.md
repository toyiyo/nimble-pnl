

## Fix: Wrong Message Key + NOT NULL Constraint

### Root cause

The `enqueue_weekly_brief_jobs()` function stores the date as `brief_week_end` in the PGMQ message payload. But `process_weekly_brief_queue()` reads `v_msg.message->>'week_end'` -- which doesn't exist, so it's always NULL. Every message immediately hits the "invalid payload" branch, which then crashes because `brief_week_end` is NOT NULL in `weekly_brief_job_log`.

### What changes

A single migration with two fixes:

1. **Fix the key name** in `process_weekly_brief_queue()`: read `brief_week_end` instead of `week_end` from the message payload, and pass it as `brief_week_end` (not `week_end`) to the worker.

2. **Make `restaurant_id` and `brief_week_end` nullable** on `weekly_brief_job_log` so the invalid-payload guard can actually log malformed messages without crashing.

### Technical detail

```text
-- 1. Allow nulls for the guard clause to work
ALTER TABLE weekly_brief_job_log ALTER COLUMN restaurant_id DROP NOT NULL;
ALTER TABLE weekly_brief_job_log ALTER COLUMN brief_week_end DROP NOT NULL;

-- 2. Replace function with corrected key name
CREATE OR REPLACE FUNCTION process_weekly_brief_queue() ...
  v_week_end := v_msg.message->>'brief_week_end';  -- was 'week_end'
  ...
  body := jsonb_build_object(
    'restaurant_id', v_restaurant_id,
    'brief_week_end', v_week_end,  -- was 'week_end'
    'msg_id', v_msg.msg_id,
    'attempt', v_msg.read_ct
  )::json
```

### What stays the same

Everything else: auth key resolution, dead-letter logic, `::json` casts, iteration pattern.

### Risk

Low -- fixes a key name typo and relaxes a constraint. The 10 messages currently in the queue will process correctly on the next cron cycle.

