

## Fix `process_weekly_brief_queue()` -- Combined Approach

Applying both my fix (correct iteration over `pgmq.read`) and Supabase's recommendation (`::json` casts for `pg_net`).

### What changes

A single database migration that replaces `process_weekly_brief_queue()` with corrected logic:

1. **Replace `SELECT pgmq.read(...) INTO v_batch`** with `FOR v_msg IN SELECT * FROM pgmq.read('weekly_brief_jobs', 300, 5)` so we iterate over the returned record set properly.

2. **Access record columns directly** instead of JSON navigation:
   - `v_msg.msg_id` instead of `(v_msg.value->>'msg_id')::bigint`
   - `v_msg.read_ct` instead of `(v_msg.value->>'read_ct')::int`
   - `v_msg.message->>'restaurant_id'` instead of `v_msg.value->'message'->>'restaurant_id'`

3. **Cast `jsonb_build_object(...)::json`** on both `headers` and `body` arguments to `net.http_post` to avoid implicit cast issues with the installed `pg_net` version.

4. **Add payload validation** before dispatching: verify `restaurant_id` and `week_end` are not null; if invalid, dead-letter the message with a descriptive error.

### What stays the same

- Vault-based service role key lookup with anon key fallback
- Dead-letter logic after 3 attempts
- Job log and ops inbox item writes
- The hardcoded project URL and anon key

### Technical detail -- the corrected function structure

```text
DECLARE
  v_msg RECORD;
  v_supabase_url, v_anon_key, v_service_role_key, v_auth_key TEXT;
  v_restaurant_id TEXT;
  v_week_end TEXT;
BEGIN
  -- Auth key resolution (unchanged)

  -- Iterate over pgmq records directly
  FOR v_msg IN SELECT * FROM pgmq.read('weekly_brief_jobs', 300, 5)
  LOOP
    v_restaurant_id := v_msg.message->>'restaurant_id';
    v_week_end := v_msg.message->>'week_end';

    -- Validate payload
    IF v_restaurant_id IS NULL OR v_week_end IS NULL THEN
      -- dead-letter with 'invalid payload' error
      CONTINUE;
    END IF;

    -- Dead-letter check: v_msg.read_ct >= 3
    IF v_msg.read_ct >= 3 THEN
      -- move to dead-letter queue, delete, log (unchanged logic)
      CONTINUE;
    END IF;

    -- Dispatch worker with explicit ::json casts
    PERFORM net.http_post(
      url := v_supabase_url || '/functions/v1/generate-weekly-brief-worker',
      headers := jsonb_build_object(
        'Content-Type', 'application/json',
        'Authorization', 'Bearer ' || v_auth_key
      )::json,
      body := jsonb_build_object(
        'restaurant_id', v_restaurant_id,
        'week_end', v_week_end,
        'msg_id', v_msg.msg_id,
        'attempt', v_msg.read_ct
      )::json
    );
  END LOOP;
END;
```

### Risk

Low. This is a `CREATE OR REPLACE FUNCTION` that fixes two bugs without changing behavior. The cron job will pick it up on its next 60-second cycle.

