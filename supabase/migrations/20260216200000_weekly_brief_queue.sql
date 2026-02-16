-- =============================================================
-- Weekly Brief Queue Pipeline (pgmq)
-- Replaces monolithic edge function with queue-based fan-out
-- for scalable weekly brief generation (200+ restaurants).
-- =============================================================

-- ========================
-- 1. Enable pgmq extension
-- ========================

CREATE EXTENSION IF NOT EXISTS pgmq;

-- ========================
-- 2. Create queues
-- ========================

SELECT pgmq.create('weekly_brief_jobs');
SELECT pgmq.create('weekly_brief_dead_letter');

-- ========================
-- 3. weekly_brief_job_log
-- ========================

CREATE TABLE public.weekly_brief_job_log (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  restaurant_id UUID NOT NULL REFERENCES public.restaurants(id) ON DELETE CASCADE,
  brief_week_end DATE NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('queued', 'processing', 'completed', 'failed', 'dead_lettered')),
  attempt INTEGER NOT NULL DEFAULT 1,
  msg_id BIGINT,
  error_message TEXT,
  duration_ms INTEGER,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

ALTER TABLE public.weekly_brief_job_log ENABLE ROW LEVEL SECURITY;

CREATE INDEX idx_weekly_brief_job_log_restaurant_week
  ON public.weekly_brief_job_log(restaurant_id, brief_week_end);

CREATE INDEX idx_weekly_brief_job_log_status_created
  ON public.weekly_brief_job_log(status, created_at DESC);

CREATE INDEX idx_weekly_brief_job_log_created
  ON public.weekly_brief_job_log(created_at DESC);

CREATE POLICY "Users can view job logs for their restaurants"
  ON public.weekly_brief_job_log FOR SELECT
  USING (EXISTS (
    SELECT 1 FROM public.user_restaurants ur
    WHERE ur.restaurant_id = weekly_brief_job_log.restaurant_id
    AND ur.user_id = auth.uid()
  ));

-- ========================
-- 4. enqueue_weekly_brief_jobs()
-- ========================

CREATE OR REPLACE FUNCTION public.enqueue_weekly_brief_jobs()
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_week_end DATE;
  v_dow INTEGER;
  v_restaurant RECORD;
  v_msg_id BIGINT;
  v_enqueued INTEGER := 0;
  v_skipped INTEGER := 0;
BEGIN
  -- Compute the most recent completed week ending on Sunday.
  -- DOW: 0=Sunday, 1=Monday, ..., 6=Saturday
  v_dow := EXTRACT(DOW FROM CURRENT_DATE)::integer;

  IF v_dow = 1 THEN
    -- Monday (cron day): last Sunday = yesterday
    v_week_end := CURRENT_DATE - 1;
  ELSIF v_dow = 0 THEN
    -- Sunday: go back 7 days to get LAST completed Sunday
    v_week_end := CURRENT_DATE - 7;
  ELSE
    -- Any other day: subtract DOW to get last Sunday
    v_week_end := CURRENT_DATE - v_dow;
  END IF;

  FOR v_restaurant IN SELECT id FROM public.restaurants LOOP
    -- Skip if brief already exists for this restaurant + week
    IF EXISTS (
      SELECT 1 FROM public.weekly_brief wb
      WHERE wb.restaurant_id = v_restaurant.id
        AND wb.brief_week_end = v_week_end
    ) THEN
      v_skipped := v_skipped + 1;
      CONTINUE;
    END IF;

    -- Enqueue the job
    v_msg_id := pgmq.send(
      'weekly_brief_jobs',
      jsonb_build_object(
        'restaurant_id', v_restaurant.id,
        'brief_week_end', v_week_end
      )
    );

    -- Log the enqueue
    INSERT INTO public.weekly_brief_job_log (
      restaurant_id, brief_week_end, status, attempt, msg_id
    ) VALUES (
      v_restaurant.id, v_week_end, 'queued', 1, v_msg_id
    );

    v_enqueued := v_enqueued + 1;
  END LOOP;

  RETURN jsonb_build_object(
    'enqueued', v_enqueued,
    'skipped', v_skipped,
    'week_end', v_week_end
  );
END;
$$;

-- ========================
-- 5. process_weekly_brief_queue()
-- ========================

CREATE OR REPLACE FUNCTION public.process_weekly_brief_queue()
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_supabase_url TEXT;
  v_service_role_key TEXT;
  v_msg RECORD;
  v_dispatched INTEGER := 0;
  v_dead_lettered INTEGER := 0;
  v_restaurant_id UUID;
  v_brief_week_end DATE;
BEGIN
  v_supabase_url := current_setting('app.settings.supabase_url');
  v_service_role_key := current_setting('app.settings.service_role_key');

  -- Read up to 5 messages with 300s visibility timeout
  FOR v_msg IN SELECT * FROM pgmq.read('weekly_brief_jobs', 300, 5) LOOP

    v_restaurant_id := (v_msg.message->>'restaurant_id')::uuid;
    v_brief_week_end := (v_msg.message->>'brief_week_end')::date;

    IF v_msg.read_ct > 3 THEN
      -- Max attempts exceeded: send to dead-letter queue
      PERFORM pgmq.send(
        'weekly_brief_dead_letter',
        jsonb_build_object(
          'restaurant_id', v_restaurant_id,
          'brief_week_end', v_brief_week_end,
          'original_msg_id', v_msg.msg_id,
          'read_ct', v_msg.read_ct
        )
      );

      -- Delete from main queue
      PERFORM pgmq.delete('weekly_brief_jobs', v_msg.msg_id);

      -- Log as dead-lettered
      INSERT INTO public.weekly_brief_job_log (
        restaurant_id, brief_week_end, status, attempt, msg_id, error_message
      ) VALUES (
        v_restaurant_id, v_brief_week_end, 'dead_lettered', v_msg.read_ct::integer,
        v_msg.msg_id, 'Max retry attempts exceeded (read_ct=' || v_msg.read_ct || ')'
      );

      -- Alert via ops_inbox_item
      INSERT INTO public.ops_inbox_item (
        restaurant_id, title, description, kind, priority, status,
        meta, created_by
      ) VALUES (
        v_restaurant_id,
        'Weekly brief generation failed after ' || v_msg.read_ct || ' attempts',
        'The weekly brief for week ending ' || v_brief_week_end ||
          ' could not be generated after multiple retries. Check the job log for details.',
        'anomaly', 2, 'open',
        jsonb_build_object(
          'type', 'weekly_brief_dead_letter',
          'brief_week_end', v_brief_week_end,
          'msg_id', v_msg.msg_id,
          'read_ct', v_msg.read_ct
        ),
        'weekly_brief_queue'
      );

      v_dead_lettered := v_dead_lettered + 1;
      CONTINUE;
    END IF;

    -- Dispatch worker via pg_net
    PERFORM net.http_post(
      url := v_supabase_url || '/functions/v1/generate-weekly-brief-worker',
      headers := jsonb_build_object(
        'Content-Type', 'application/json',
        'Authorization', 'Bearer ' || v_service_role_key
      ),
      body := jsonb_build_object(
        'restaurant_id', v_restaurant_id,
        'brief_week_end', v_brief_week_end,
        'msg_id', v_msg.msg_id,
        'attempt', v_msg.read_ct
      )
    );

    v_dispatched := v_dispatched + 1;
  END LOOP;

  RETURN jsonb_build_object(
    'dispatched', v_dispatched,
    'dead_lettered', v_dead_lettered
  );
END;
$$;

-- ========================
-- 6. pgmq_delete_message() wrapper
-- ========================

CREATE OR REPLACE FUNCTION public.pgmq_delete_message(
  p_queue_name TEXT,
  p_msg_id BIGINT
)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  RETURN pgmq.delete(p_queue_name, p_msg_id);
END;
$$;

-- ========================
-- 7. Reschedule crons
-- ========================

-- Unschedule old monolithic cron
DO $$
BEGIN
  PERFORM cron.unschedule('generate-weekly-briefs');
EXCEPTION WHEN OTHERS THEN
  NULL;
END $$;

-- Enqueue jobs every Monday at 6 AM UTC
SELECT cron.schedule(
  'enqueue-weekly-briefs',
  '0 6 * * 1',
  $$SELECT enqueue_weekly_brief_jobs()$$
);

-- Process queue every 60 seconds
SELECT cron.schedule(
  'process-weekly-brief-queue',
  '60 seconds',
  $$SELECT process_weekly_brief_queue()$$
);
