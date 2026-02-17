
DROP FUNCTION IF EXISTS public.process_weekly_brief_queue();

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
  v_batch JSONB;
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

  -- Read a batch of 5 messages with 5-minute visibility timeout
  SELECT pgmq.read('weekly_brief_jobs', 300, 5) INTO v_batch;

  -- If no messages, exit
  IF v_batch IS NULL OR jsonb_array_length(v_batch) = 0 THEN
    RETURN;
  END IF;

  -- Process each message
  FOR v_msg IN SELECT * FROM jsonb_array_elements(v_batch)
  LOOP
    -- Check if message has exceeded max retries (3 attempts)
    IF (v_msg.value->>'read_ct')::int >= 3 THEN
      -- Move to dead-letter queue
      PERFORM pgmq.send(
        'weekly_brief_dead_letter',
        v_msg.value->'message'
      );
      -- Delete from main queue
      PERFORM pgmq.delete('weekly_brief_jobs', (v_msg.value->>'msg_id')::bigint);
      -- Log dead-letter
      INSERT INTO weekly_brief_job_log (restaurant_id, brief_week_end, status, attempt, error_message)
      VALUES (
        (v_msg.value->'message'->>'restaurant_id')::uuid,
        (v_msg.value->'message'->>'week_end')::date,
        'dead_lettered',
        (v_msg.value->>'read_ct')::int,
        'Exceeded maximum retry attempts'
      );
      -- Create ops inbox item
      INSERT INTO ops_inbox_item (restaurant_id, type, title, body, severity, source)
      VALUES (
        (v_msg.value->'message'->>'restaurant_id')::uuid,
        'weekly_brief_failure',
        'Weekly brief generation failed',
        'The weekly brief for week ending ' || (v_msg.value->'message'->>'week_end') || ' failed after 3 attempts.',
        'high',
        'system'
      );
    ELSE
      -- Dispatch worker via pg_net
      PERFORM net.http_post(
        url := v_supabase_url || '/functions/v1/generate-weekly-brief-worker',
        headers := jsonb_build_object(
          'Content-Type', 'application/json',
          'Authorization', 'Bearer ' || v_auth_key
        ),
        body := jsonb_build_object(
          'restaurant_id', v_msg.value->'message'->>'restaurant_id',
          'week_end', v_msg.value->'message'->>'week_end',
          'msg_id', v_msg.value->>'msg_id',
          'attempt', (v_msg.value->>'read_ct')::int
        )
      );
    END IF;
  END LOOP;
END;
$$;
