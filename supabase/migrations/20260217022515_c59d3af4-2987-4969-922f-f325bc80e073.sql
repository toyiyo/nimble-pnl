
CREATE OR REPLACE FUNCTION public.process_weekly_brief_queue()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_msg RECORD;
  v_supabase_url TEXT := 'https://ncdujvdgqtaunuyigflp.supabase.co';
  v_anon_key TEXT := 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im5jZHVqdmRncXRhdW51eWlnZmxwIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NTc5NjgyMTYsImV4cCI6MjA3MzU0NDIxNn0.mlrSpU6RgiQLzLmYgtwcEBpOgoju9fow-_8xv4KRSZw';
  v_service_role_key TEXT;
  v_auth_key TEXT;
  v_restaurant_id TEXT;
  v_week_end TEXT;
BEGIN
  -- Try to get service_role key from vault for proper auth bypass
  BEGIN
    SELECT decrypted_secret INTO v_service_role_key
    FROM vault.decrypted_secrets
    WHERE name = 'supabase_service_role_key'
    LIMIT 1;
  EXCEPTION WHEN OTHERS THEN
    v_service_role_key := NULL;
  END;

  -- Use service role if available, otherwise fall back to anon key
  v_auth_key := COALESCE(v_service_role_key, v_anon_key);

  -- Iterate over pgmq records directly (returns a set of records, not JSON)
  FOR v_msg IN SELECT * FROM pgmq.read('weekly_brief_jobs', 300, 5)
  LOOP
    -- Extract payload fields from the message jsonb column
    v_restaurant_id := v_msg.message->>'restaurant_id';
    v_week_end := v_msg.message->>'brief_week_end';

    -- Validate payload before processing
    IF v_restaurant_id IS NULL OR v_week_end IS NULL THEN
      RAISE WARNING '[weekly-brief-queue] Invalid payload in msg %: %', v_msg.msg_id, v_msg.message;
      PERFORM pgmq.delete('weekly_brief_jobs', v_msg.msg_id);
      CONTINUE;
    END IF;

    -- Check if message has exceeded max retries (3 attempts)
    IF v_msg.read_ct >= 3 THEN
      -- Move to dead-letter queue
      PERFORM pgmq.send('weekly_brief_dead_letter', v_msg.message);
      -- Delete from main queue
      PERFORM pgmq.delete('weekly_brief_jobs', v_msg.msg_id);
      -- Log dead-letter
      INSERT INTO weekly_brief_job_log (restaurant_id, brief_week_end, status, attempt, error_message)
      VALUES (
        v_restaurant_id::uuid,
        v_week_end::date,
        'dead_lettered',
        v_msg.read_ct,
        'Exceeded maximum retry attempts'
      );
      -- Create ops inbox item
      INSERT INTO ops_inbox_item (restaurant_id, type, title, body, severity, source)
      VALUES (
        v_restaurant_id::uuid,
        'weekly_brief_failure',
        'Weekly brief generation failed',
        'The weekly brief for week ending ' || v_week_end || ' failed after 3 attempts.',
        'high',
        'system'
      );
      CONTINUE;
    END IF;

    -- Dispatch worker via pg_net with explicit ::json casts
    PERFORM net.http_post(
      url := v_supabase_url || '/functions/v1/generate-weekly-brief-worker',
      headers := jsonb_build_object(
        'Content-Type', 'application/json',
        'Authorization', 'Bearer ' || v_auth_key
      )::json,
      body := jsonb_build_object(
        'restaurant_id', v_restaurant_id,
        'brief_week_end', v_week_end,
        'msg_id', v_msg.msg_id,
        'attempt', v_msg.read_ct
      )::json
    );
  END LOOP;
END;
$$;
