# Weekly Brief Pipeline Scaling Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Replace the monolithic weekly brief generator with a pgmq queue-based fan-out pipeline that scales to 200+ restaurants with automatic retry and Grafana observability.

**Architecture:** pg_cron enqueues one job per restaurant into pgmq. A 60s processor reads batches and dispatches per-restaurant worker edge functions via pg_net. Workers write to a job_log table for Grafana dashboards. Dead-lettered jobs create ops_inbox alerts.

**Tech Stack:** pgmq 1.5.1, pg_net (already installed), pg_cron (already installed), Resend batch API, Supabase Edge Functions (Deno), Grafana (Postgres data source)

---

### Task 1: Migration — pgmq setup, job_log table, SQL functions, cron reschedule

**Files:**
- Create: `supabase/migrations/20260216200000_weekly_brief_queue.sql`

**Context:**
- pgmq is available but not enabled (version 1.5.1)
- pg_net is at `extensions` schema, pg_cron at `pg_catalog`
- The existing cron job `generate-weekly-briefs` (Monday 6 AM) calls the monolithic edge function
- `weekly_brief` table has UNIQUE(restaurant_id, brief_week_end) for idempotent upsert
- pgmq.read() returns `msg_id`, `read_ct`, `enqueued_at`, `vt`, `message` (jsonb)
- pgmq.send() takes `(queue_name, msg_jsonb)` and returns bigint msg_id
- pgmq.delete() takes `(queue_name, msg_id)` and returns boolean

**Step 1: Write the migration SQL**

Create file `supabase/migrations/20260216200000_weekly_brief_queue.sql`:

```sql
-- =============================================================
-- Weekly Brief Queue Pipeline
-- pgmq-based fan-out for scalable brief generation
-- =============================================================

-- 1. Enable pgmq extension
CREATE EXTENSION IF NOT EXISTS pgmq;

-- 2. Create queues
SELECT pgmq.create('weekly_brief_jobs');
SELECT pgmq.create('weekly_brief_dead_letter');

-- 3. Job log table for observability (Grafana dashboards)
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

CREATE INDEX idx_job_log_restaurant ON public.weekly_brief_job_log(restaurant_id, brief_week_end);
CREATE INDEX idx_job_log_status ON public.weekly_brief_job_log(status, created_at DESC);
CREATE INDEX idx_job_log_created ON public.weekly_brief_job_log(created_at DESC);

-- RLS: owners/managers can view their restaurant's job logs
CREATE POLICY "Users can view job logs for their restaurants"
  ON public.weekly_brief_job_log FOR SELECT
  USING (EXISTS (
    SELECT 1 FROM public.user_restaurants ur
    WHERE ur.restaurant_id = weekly_brief_job_log.restaurant_id
    AND ur.user_id = auth.uid()
  ));

-- 4. Enqueue function — called by cron on Monday 6 AM
CREATE OR REPLACE FUNCTION public.enqueue_weekly_brief_jobs()
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_week_end DATE;
  v_restaurant RECORD;
  v_count INTEGER := 0;
  v_skipped INTEGER := 0;
  v_msg_id BIGINT;
BEGIN
  -- Compute most recent completed week (Mon-Sun), ending last Sunday
  v_week_end := CURRENT_DATE - EXTRACT(DOW FROM CURRENT_DATE)::integer;
  -- If today is Sunday (DOW=0), go back 7 days to get LAST Sunday
  IF EXTRACT(DOW FROM CURRENT_DATE) = 0 THEN
    v_week_end := CURRENT_DATE - 7;
  END IF;

  FOR v_restaurant IN
    SELECT r.id AS restaurant_id
    FROM restaurants r
    ORDER BY r.id
  LOOP
    -- Skip if brief already exists for this week
    IF EXISTS (
      SELECT 1 FROM weekly_brief
      WHERE restaurant_id = v_restaurant.restaurant_id
        AND brief_week_end = v_week_end
    ) THEN
      v_skipped := v_skipped + 1;
      CONTINUE;
    END IF;

    -- Enqueue job
    SELECT * INTO v_msg_id FROM pgmq.send(
      'weekly_brief_jobs',
      jsonb_build_object(
        'restaurant_id', v_restaurant.restaurant_id,
        'brief_week_end', v_week_end
      )
    );

    -- Log enqueue
    INSERT INTO weekly_brief_job_log (restaurant_id, brief_week_end, status, msg_id)
    VALUES (v_restaurant.restaurant_id, v_week_end, 'queued', v_msg_id);

    v_count := v_count + 1;
  END LOOP;

  RETURN jsonb_build_object(
    'enqueued', v_count,
    'skipped', v_skipped,
    'week_end', v_week_end
  );
END;
$$;

-- 5. Queue processor — called by cron every 60s
--    Reads batch of 5 messages, dispatches worker edge functions via pg_net
CREATE OR REPLACE FUNCTION public.process_weekly_brief_queue()
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_msg RECORD;
  v_count INTEGER := 0;
  v_dead_lettered INTEGER := 0;
  v_supabase_url TEXT;
  v_service_key TEXT;
  v_max_attempts INTEGER := 3;
BEGIN
  v_supabase_url := current_setting('app.settings.supabase_url', true);
  v_service_key := current_setting('app.settings.service_role_key', true);

  IF v_supabase_url IS NULL OR v_service_key IS NULL THEN
    RETURN jsonb_build_object('error', 'Missing app.settings.supabase_url or service_role_key');
  END IF;

  -- Read up to 5 messages with 300s (5 min) visibility timeout
  FOR v_msg IN
    SELECT msg_id, read_ct, message
    FROM pgmq.read('weekly_brief_jobs', 300, 5)
  LOOP
    -- Check if max retries exceeded
    IF v_msg.read_ct > v_max_attempts THEN
      -- Move to dead letter queue
      PERFORM pgmq.send(
        'weekly_brief_dead_letter',
        v_msg.message || jsonb_build_object('original_msg_id', v_msg.msg_id, 'read_ct', v_msg.read_ct)
      );
      PERFORM pgmq.delete('weekly_brief_jobs', v_msg.msg_id);

      -- Log dead letter
      INSERT INTO weekly_brief_job_log (
        restaurant_id, brief_week_end, status, attempt, msg_id, error_message
      ) VALUES (
        (v_msg.message->>'restaurant_id')::uuid,
        (v_msg.message->>'brief_week_end')::date,
        'dead_lettered',
        v_msg.read_ct,
        v_msg.msg_id,
        'Exceeded max attempts (' || v_max_attempts || ')'
      );

      -- Create ops_inbox_item alert
      INSERT INTO ops_inbox_item (
        restaurant_id, title, description, kind, priority, meta, created_by
      ) VALUES (
        (v_msg.message->>'restaurant_id')::uuid,
        'Weekly brief generation failed after ' || v_max_attempts || ' attempts',
        'The weekly brief for week ending ' || (v_msg.message->>'brief_week_end') ||
          ' could not be generated. Check the job log for details.',
        'anomaly',
        2,
        jsonb_build_object(
          'type', 'weekly_brief_failure',
          'brief_week_end', v_msg.message->>'brief_week_end',
          'attempts', v_msg.read_ct
        ),
        'weekly_brief_queue'
      );

      v_dead_lettered := v_dead_lettered + 1;
      CONTINUE;
    END IF;

    -- Dispatch worker edge function via pg_net
    PERFORM net.http_post(
      url := v_supabase_url || '/functions/v1/generate-weekly-brief-worker',
      headers := jsonb_build_object(
        'Content-Type', 'application/json',
        'Authorization', 'Bearer ' || v_service_key
      ),
      body := v_msg.message || jsonb_build_object('msg_id', v_msg.msg_id, 'attempt', v_msg.read_ct)
    );

    v_count := v_count + 1;
  END LOOP;

  RETURN jsonb_build_object('dispatched', v_count, 'dead_lettered', v_dead_lettered);
END;
$$;

-- 6. Reschedule crons
-- Remove old monolithic cron
DO $$
BEGIN
  PERFORM cron.unschedule('generate-weekly-briefs');
EXCEPTION WHEN OTHERS THEN
  NULL;
END $$;

-- Enqueue cron: Monday 6 AM UTC
SELECT cron.schedule(
  'enqueue-weekly-briefs',
  '0 6 * * 1',
  $$SELECT enqueue_weekly_brief_jobs()$$
);

-- Queue processor cron: every 60 seconds
SELECT cron.schedule(
  'process-weekly-brief-queue',
  '60 seconds',
  $$SELECT process_weekly_brief_queue()$$
);
```

**Step 2: Verify the migration parses correctly**

Run: `npx supabase migration list` (or visually inspect — migration will be applied via PR merge to production)

**Step 3: Commit**

```bash
git add supabase/migrations/20260216200000_weekly_brief_queue.sql
git commit -m "feat: add pgmq queue pipeline for weekly brief scaling"
```

---

### Task 2: New edge function — generate-weekly-brief-worker

**Files:**
- Create: `supabase/functions/generate-weekly-brief-worker/index.ts`

**Context:**
- This extracts the per-restaurant logic from `supabase/functions/generate-weekly-brief/index.ts` (lines 77-263)
- The worker receives `{ restaurant_id, brief_week_end, msg_id, attempt }` in the request body
- It must write to `weekly_brief_job_log` at start (processing) and end (completed/failed)
- On success: delete the pgmq message via direct SQL (supabase.rpc not available for pgmq, use raw SQL)
- On failure: let the message stay in the queue (visibility timeout expires, processor retries)
- The existing `buildRecommendations` and `formatMetricName` helper functions must be copied here
- Uses same imports: `serve`, `createClient`, `corsHeaders`, `callAIWithFallback`
- Triggers `send-weekly-brief-email` via fetch fire-and-forget (same as current code)

**Step 1: Create the worker edge function**

Create file `supabase/functions/generate-weekly-brief-worker/index.ts`:

```typescript
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { corsHeaders } from "../_shared/cors.ts";
import { callAIWithFallback } from "../_shared/ai-caller.ts";

interface VarianceItem {
  metric: string;
  flag: string | null;
  value: number;
  direction: string;
  delta_pct_vs_prior?: number | null;
  delta_pct_vs_avg?: number | null;
}

interface Recommendation {
  title: string;
  body: string;
  impact: string;
  effort: string;
}

const jsonHeaders = { ...corsHeaders, "Content-Type": "application/json" };

function jsonResponse(body: Record<string, unknown>, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: jsonHeaders });
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  const startTime = Date.now();
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
  const supabaseUrl = Deno.env.get("SUPABASE_URL") ?? "";

  // Auth guard
  const authHeader = req.headers.get("Authorization");
  if (authHeader !== `Bearer ${serviceRoleKey}`) {
    return jsonResponse({ success: false, error: "Unauthorized" }, 401);
  }

  const supabase = createClient(supabaseUrl, serviceRoleKey);

  let restaurantId: string | undefined;
  let briefWeekEnd: string | undefined;
  let msgId: number | undefined;
  let attempt: number | undefined;

  try {
    const body = await req.json();
    restaurantId = body.restaurant_id;
    briefWeekEnd = body.brief_week_end;
    msgId = body.msg_id;
    attempt = body.attempt ?? 1;

    if (!restaurantId || !briefWeekEnd) {
      return jsonResponse({ success: false, error: "restaurant_id and brief_week_end required" }, 400);
    }

    // Log: processing
    await supabase.from("weekly_brief_job_log").insert({
      restaurant_id: restaurantId,
      brief_week_end: briefWeekEnd,
      status: "processing",
      attempt,
      msg_id: msgId,
    });

    // Compute week range
    const [year, month, day] = briefWeekEnd.split("-").map(Number);
    const weekEnd = new Date(year, month - 1, day);
    const weekStart = new Date(weekEnd);
    weekStart.setDate(weekEnd.getDate() - 6);
    const weekEndStr = briefWeekEnd;
    const weekStartStr = weekStart.toISOString().split("T")[0];

    // Check if brief already exists (idempotent)
    const { data: existing } = await supabase
      .from("weekly_brief")
      .select("id")
      .eq("restaurant_id", restaurantId)
      .eq("brief_week_end", weekEndStr)
      .maybeSingle();

    if (existing) {
      // Already generated — delete queue message and log success
      if (msgId) {
        await supabase.rpc("pgmq_delete_message", {
          p_queue_name: "weekly_brief_jobs",
          p_msg_id: msgId,
        });
      }
      await logCompleted(supabase, restaurantId, briefWeekEnd, attempt, msgId, Date.now() - startTime);
      return jsonResponse({ success: true, status: "already_exists" });
    }

    // Run variance engine
    const { data: variances, error: varError } = await supabase.rpc(
      "compute_weekly_variances",
      { p_restaurant_id: restaurantId, p_week_end: weekEndStr }
    );
    if (varError) {
      console.error(`Variance error for ${restaurantId}:`, varError.message);
    }

    // Run anomaly detectors (non-fatal errors)
    const detectors = [
      { name: "detect_uncategorized_backlog", params: { p_restaurant_id: restaurantId } },
      { name: "detect_metric_anomalies", params: { p_restaurant_id: restaurantId, p_date: weekEndStr } },
      { name: "detect_reconciliation_gaps", params: { p_restaurant_id: restaurantId, p_date: weekEndStr } },
    ];

    for (const det of detectors) {
      const { error } = await supabase.rpc(det.name, det.params);
      if (error) console.error(`${det.name} error for ${restaurantId}:`, error.message);
    }

    // Query open ops_inbox_item counts
    const { count: openCount } = await supabase
      .from("ops_inbox_item")
      .select("id", { count: "exact", head: true })
      .eq("restaurant_id", restaurantId)
      .eq("status", "open");

    const { count: criticalCount } = await supabase
      .from("ops_inbox_item")
      .select("id", { count: "exact", head: true })
      .eq("restaurant_id", restaurantId)
      .eq("status", "open")
      .eq("priority", 1);

    // Fetch restaurant name
    const { data: restaurant } = await supabase
      .from("restaurants")
      .select("name")
      .eq("id", restaurantId)
      .single();

    const restaurantName = restaurant?.name || "Unknown Restaurant";

    // Build metrics_json from daily_pnl
    const { data: pnlRows } = await supabase
      .from("daily_pnl")
      .select("net_revenue, food_cost, labor_cost, prime_cost, gross_profit")
      .eq("restaurant_id", restaurantId)
      .gte("date", weekStartStr)
      .lte("date", weekEndStr);

    const metricsJson: Record<string, number> = {};
    if (pnlRows && pnlRows.length > 0) {
      metricsJson.net_revenue = pnlRows.reduce((s: number, r: any) => s + (r.net_revenue || 0), 0);
      metricsJson.food_cost = pnlRows.reduce((s: number, r: any) => s + (r.food_cost || 0), 0);
      metricsJson.labor_cost = pnlRows.reduce((s: number, r: any) => s + (r.labor_cost || 0), 0);
      metricsJson.prime_cost = pnlRows.reduce((s: number, r: any) => s + (r.prime_cost || 0), 0);
      metricsJson.gross_profit = pnlRows.reduce((s: number, r: any) => s + (r.gross_profit || 0), 0);
      if (metricsJson.net_revenue > 0) {
        metricsJson.food_cost_pct = Math.round(metricsJson.food_cost / metricsJson.net_revenue * 1000) / 10;
        metricsJson.labor_cost_pct = Math.round(metricsJson.labor_cost / metricsJson.net_revenue * 1000) / 10;
        metricsJson.prime_cost_pct = Math.round(metricsJson.prime_cost / metricsJson.net_revenue * 1000) / 10;
      }
    }

    const variancesJson = variances || [];
    const recommendations = buildRecommendations(variancesJson);

    // Generate narrative via LLM
    const openRouterApiKey = Deno.env.get("OPENROUTER_API_KEY");
    let narrativeText = "";
    if (openRouterApiKey) {
      try {
        const aiResult = await callAIWithFallback<{ narrative: string }>(
          {
            messages: [
              {
                role: "system",
                content:
                  'You are a restaurant financial analyst. Summarize this week\'s performance in 3-4 sentences. ONLY reference the numbers provided below. Do not invent or estimate any figures. Write in a direct, professional tone. Lead with the most important change. Return your response as JSON: {"narrative": "your summary here"}',
              },
              {
                role: "user",
                content: `Restaurant: ${restaurantName}
Week: ${weekStartStr} to ${weekEndStr}
Metrics: ${JSON.stringify(metricsJson)}
Variances: ${JSON.stringify(variancesJson)}
Open issues: ${openCount ?? 0} open items (${criticalCount ?? 0} critical)`,
              },
            ],
            temperature: 0.3,
            max_tokens: 300,
          },
          openRouterApiKey,
          "generate-weekly-brief-worker",
          restaurantId
        );

        if (aiResult?.data?.narrative) {
          narrativeText = aiResult.data.narrative;
        }
      } catch (aiError) {
        console.error(`LLM error for ${restaurantId}:`, aiError);
        // Continue without narrative
      }
    }

    // Upsert weekly_brief row
    const { error: insertError } = await supabase.from("weekly_brief").upsert(
      {
        restaurant_id: restaurantId,
        brief_week_end: weekEndStr,
        metrics_json: metricsJson,
        comparisons_json: {},
        variances_json: variancesJson,
        inbox_summary_json: {
          open_count: openCount ?? 0,
          critical_count: criticalCount ?? 0,
        },
        recommendations_json: recommendations,
        narrative: narrativeText || null,
        computed_at: new Date().toISOString(),
      },
      { onConflict: "restaurant_id,brief_week_end" }
    );

    if (insertError) {
      throw new Error(`Insert error: ${insertError.message}`);
    }

    console.log(`Brief generated for ${restaurantName} (${restaurantId})`);

    // Delete queue message on success
    if (msgId) {
      await supabase.rpc("pgmq_delete_message", {
        p_queue_name: "weekly_brief_jobs",
        p_msg_id: msgId,
      });
    }

    // Log: completed
    await logCompleted(supabase, restaurantId, briefWeekEnd, attempt, msgId, Date.now() - startTime);

    // Trigger email (fire-and-forget)
    fetch(`${supabaseUrl}/functions/v1/send-weekly-brief-email`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${serviceRoleKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ restaurant_id: restaurantId, brief_week_end: weekEndStr }),
    }).catch((emailErr) => {
      console.error(`Email trigger failed for ${restaurantId}:`, emailErr);
    });

    return jsonResponse({ success: true, restaurant_id: restaurantId, duration_ms: Date.now() - startTime });

  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(`Worker failed for ${restaurantId}:`, message);

    // Log: failed (message stays in queue for retry via visibility timeout)
    if (restaurantId && briefWeekEnd) {
      await supabase.from("weekly_brief_job_log").insert({
        restaurant_id: restaurantId,
        brief_week_end: briefWeekEnd,
        status: "failed",
        attempt: attempt ?? 1,
        msg_id: msgId,
        error_message: message,
        duration_ms: Date.now() - startTime,
      }).then(null, () => {}); // Don't fail on log write error
    }

    return jsonResponse({ success: false, error: message }, 500);
  }
});

async function logCompleted(
  supabase: any,
  restaurantId: string,
  briefWeekEnd: string,
  attempt: number | undefined,
  msgId: number | undefined,
  durationMs: number
): Promise<void> {
  await supabase.from("weekly_brief_job_log").insert({
    restaurant_id: restaurantId,
    brief_week_end: briefWeekEnd,
    status: "completed",
    attempt: attempt ?? 1,
    msg_id: msgId,
    duration_ms: durationMs,
  }).then(null, () => {}); // Don't fail on log write error
}

// ---------------------------------------------------------------------------
// Helpers (copied from generate-weekly-brief)
// ---------------------------------------------------------------------------

function buildRecommendations(variances: VarianceItem[]): Recommendation[] {
  if (!Array.isArray(variances) || variances.length === 0) {
    return [];
  }

  const flagOrder: Record<string, number> = { critical: 0, warning: 1 };

  const flagged = variances
    .filter((v) => v.flag != null && v.flag !== "null")
    .sort((a, b) => {
      const aOrder = flagOrder[a.flag!] ?? 99;
      const bOrder = flagOrder[b.flag!] ?? 99;
      return aOrder - bOrder;
    })
    .slice(0, 3);

  return flagged.map((v) => {
    const direction = v.direction === "up" ? "increased" : "decreased";
    const metric = formatMetricName(v.metric);
    const pctChange = v.delta_pct_vs_avg != null ? ` (${v.delta_pct_vs_avg > 0 ? "+" : ""}${v.delta_pct_vs_avg}% vs 4-week avg)` : "";
    return {
      title: `Review ${metric}`,
      body: `${metric} ${direction} to ${v.value}${v.metric.endsWith("_pct") ? "%" : ""}${pctChange}`,
      impact: v.flag === "critical" ? "High" : "Medium",
      effort: "Low",
    };
  });
}

function formatMetricName(metric: string): string {
  const names: Record<string, string> = {
    net_revenue: "net revenue",
    food_cost_pct: "food cost %",
    labor_cost_pct: "labor cost %",
    prime_cost_pct: "prime cost %",
    gross_profit: "gross profit",
  };
  return names[metric] || metric;
}
```

**Step 2: Add the pgmq_delete_message wrapper to the migration**

The Supabase client can't call `pgmq.delete()` directly via `.rpc()` since it's in the `pgmq` schema. Add a thin wrapper to the migration file `20260216200000_weekly_brief_queue.sql`:

```sql
-- Wrapper so edge functions can delete pgmq messages via supabase.rpc()
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
```

**Step 3: Run TypeScript check**

Run: `npx tsc --noEmit`
Expected: Clean (no errors)

**Step 4: Commit**

```bash
git add supabase/functions/generate-weekly-brief-worker/index.ts
git add supabase/migrations/20260216200000_weekly_brief_queue.sql
git commit -m "feat: add generate-weekly-brief-worker edge function"
```

---

### Task 3: Modify send-weekly-brief-email for Resend batch API

**Files:**
- Modify: `supabase/functions/send-weekly-brief-email/index.ts` (lines 121-153)

**Context:**
- Currently sends one email per user in a sequential for-loop (lines 125-153)
- Resend batch API: `POST https://api.resend.com/emails/batch` accepts an array of up to 100 email objects
- Each email object has same shape as individual sends: `{ from, to, subject, html }`
- We need to group profiles into batches of 100

**Step 1: Replace the sequential send loop with batch sends**

In `supabase/functions/send-weekly-brief-email/index.ts`, replace lines 121-153 (the `// Send to each user` block) with:

```typescript
    // Build email payloads
    const appUrl = Deno.env.get("APP_URL") || "https://app.easyshifthq.com";
    const viewBriefUrl = `${appUrl}/weekly-brief?date=${typedBrief.brief_week_end}`;
    const finalHtml = emailHtml.replace("{{VIEW_BRIEF_URL}}", viewBriefUrl);
    const subject = `Weekly Brief — ${restaurantName} — ${formatWeekRange(typedBrief.brief_week_end)}`;

    const emailPayloads = profiles
      .filter((p: { email?: string }) => p.email)
      .map((profile: { email: string; user_id: string }) => ({
        from: "EasyShiftHQ <briefs@easyshifthq.com>",
        to: [profile.email],
        subject,
        html: finalHtml,
      }));

    if (emailPayloads.length === 0) {
      return jsonResponse({ success: true, message: "No valid email addresses" });
    }

    // Send in batches of 100 (Resend batch API limit)
    let sentCount = 0;
    const BATCH_SIZE = 100;

    for (let i = 0; i < emailPayloads.length; i += BATCH_SIZE) {
      const batch = emailPayloads.slice(i, i + BATCH_SIZE);
      try {
        const res = await fetch("https://api.resend.com/emails/batch", {
          method: "POST",
          headers: {
            Authorization: `Bearer ${resendApiKey}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify(batch),
        });

        if (res.ok) {
          sentCount += batch.length;
          console.log(`Batch sent: ${batch.length} emails (batch ${Math.floor(i / BATCH_SIZE) + 1})`);
        } else {
          const errText = await res.text();
          console.error(`Batch send failed:`, errText);
        }
      } catch (sendErr) {
        console.error(`Batch send error:`, sendErr);
      }
    }
```

**Step 2: Run TypeScript check**

Run: `npx tsc --noEmit`
Expected: Clean

**Step 3: Commit**

```bash
git add supabase/functions/send-weekly-brief-email/index.ts
git commit -m "feat: use Resend batch API for weekly brief emails"
```

---

### Task 4: Update generate-weekly-brief as manual fallback

**Files:**
- Modify: `supabase/functions/generate-weekly-brief/index.ts`

**Context:**
- The old monolithic function should be kept as a manual trigger/fallback
- It can optionally accept `{ restaurant_id }` in the body to generate a brief for a single restaurant
- If no restaurant_id provided, it enqueues all restaurants via the queue (calls `enqueue_weekly_brief_jobs`)
- This preserves backward compatibility while routing through the queue

**Step 1: Simplify generate-weekly-brief to be a dispatcher**

Replace the entire contents of `supabase/functions/generate-weekly-brief/index.ts` with:

```typescript
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { corsHeaders } from "../_shared/cors.ts";

const jsonHeaders = { ...corsHeaders, "Content-Type": "application/json" };

function jsonResponse(body: Record<string, unknown>, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: jsonHeaders });
}

/**
 * Weekly brief dispatcher.
 *
 * - No body or empty body: enqueue all restaurants via pgmq queue
 * - Body with { restaurant_id }: directly invoke worker for that restaurant
 *
 * Kept as a thin wrapper for backward compatibility and manual triggers.
 */
serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const authHeader = req.headers.get("Authorization");
    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
    if (authHeader !== `Bearer ${serviceRoleKey}`) {
      return jsonResponse({ success: false, error: "Unauthorized" }, 401);
    }

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL") ?? "",
      serviceRoleKey
    );

    let body: Record<string, unknown> = {};
    try {
      body = await req.json();
    } catch {
      // Empty body is fine — means "enqueue all"
    }

    // Single restaurant: call worker directly
    if (body.restaurant_id) {
      const supabaseUrl = Deno.env.get("SUPABASE_URL") ?? "";

      // Compute week end
      const now = new Date();
      const dayOfWeek = now.getDay();
      const weekEnd = new Date(now);
      weekEnd.setDate(now.getDate() - (dayOfWeek === 0 ? 7 : dayOfWeek));
      const weekEndStr = body.brief_week_end || weekEnd.toISOString().split("T")[0];

      const workerRes = await fetch(`${supabaseUrl}/functions/v1/generate-weekly-brief-worker`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${serviceRoleKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          restaurant_id: body.restaurant_id,
          brief_week_end: weekEndStr,
        }),
      });

      const result = await workerRes.json();
      return jsonResponse(result, workerRes.status);
    }

    // No restaurant_id: enqueue all via SQL function
    const { data, error } = await supabase.rpc("enqueue_weekly_brief_jobs");
    if (error) {
      throw new Error(`Failed to enqueue: ${error.message}`);
    }

    return jsonResponse({ success: true, ...data });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("Fatal error in generate-weekly-brief:", message);
    return jsonResponse({ success: false, error: "Internal server error" }, 500);
  }
});
```

**Step 2: Run TypeScript check**

Run: `npx tsc --noEmit`
Expected: Clean

**Step 3: Commit**

```bash
git add supabase/functions/generate-weekly-brief/index.ts
git commit -m "refactor: convert generate-weekly-brief to thin queue dispatcher"
```

---

### Task 5: Add pgTAP tests for queue SQL functions

**Files:**
- Create: `supabase/tests/weekly_brief_queue.test.sql`

**Context:**
- Test framework: pgTAP (already installed). Tests use `BEGIN; SELECT plan(N); ... SELECT * FROM finish(); ROLLBACK;`
- Test `enqueue_weekly_brief_jobs()`: creates a restaurant, verifies messages are enqueued
- Test `process_weekly_brief_queue()`: verifies dead-letter behavior after max attempts
- Test `pgmq_delete_message()`: verifies wrapper works

**Step 1: Write the pgTAP test file**

Create file `supabase/tests/weekly_brief_queue.test.sql`:

```sql
BEGIN;
SELECT plan(7);

-- Setup: create a test restaurant
INSERT INTO public.restaurants (id, name, created_at, updated_at)
VALUES ('00000000-0000-0000-0000-000000000099', 'Test Queue Restaurant', now(), now());

-- Test 1: enqueue_weekly_brief_jobs creates messages
SELECT lives_ok(
  $$SELECT enqueue_weekly_brief_jobs()$$,
  'enqueue_weekly_brief_jobs executes without error'
);

-- Test 2: Check that a message was enqueued
SELECT ok(
  (SELECT queue_length > 0 FROM pgmq.metrics('weekly_brief_jobs')),
  'weekly_brief_jobs queue has messages after enqueue'
);

-- Test 3: Check job_log has a queued entry
SELECT ok(
  (SELECT COUNT(*) > 0 FROM weekly_brief_job_log
   WHERE restaurant_id = '00000000-0000-0000-0000-000000000099'
     AND status = 'queued'),
  'job_log has queued entry for the test restaurant'
);

-- Test 4: pgmq_delete_message wrapper works
SELECT ok(
  (SELECT pgmq_delete_message('weekly_brief_jobs',
    (SELECT msg_id FROM pgmq.read('weekly_brief_jobs', 0, 1) LIMIT 1))),
  'pgmq_delete_message wrapper returns true'
);

-- Test 5: Re-enqueue for dead letter test
SELECT enqueue_weekly_brief_jobs();

-- Simulate 4 reads (exceeding max_attempts of 3) by reading the same message 4 times
DO $$
DECLARE
  v_msg RECORD;
BEGIN
  FOR i IN 1..4 LOOP
    SELECT * INTO v_msg FROM pgmq.read('weekly_brief_jobs', 0, 1) LIMIT 1;
  END LOOP;
END $$;

-- Test 6: process_weekly_brief_queue handles dead letter
-- Note: This will try pg_net which won't work in test, but dead letter path should work
-- since read_ct > 3
SELECT lives_ok(
  $$SELECT process_weekly_brief_queue()$$,
  'process_weekly_brief_queue executes without error'
);

-- Test 7: Check dead letter queue has a message
SELECT ok(
  (SELECT queue_length > 0 FROM pgmq.metrics('weekly_brief_dead_letter')),
  'dead letter queue has messages after exceeding max attempts'
);

SELECT * FROM finish();
ROLLBACK;
```

**Step 2: Run the tests**

Run: `npm run test:db`
Expected: All 7 tests pass

Note: `process_weekly_brief_queue` may partially fail on the pg_net dispatch in test (no edge function running), but the dead-letter path (read_ct > max_attempts) is pure SQL and should work. If the pg_net call fails silently in test, the dead-letter tests still validate the core retry logic.

**Step 3: Commit**

```bash
git add supabase/tests/weekly_brief_queue.test.sql
git commit -m "test: add pgTAP tests for weekly brief queue pipeline"
```

---

### Task 6: Document Grafana dashboard queries

**Files:**
- Create: `docs/grafana/weekly-brief-pipeline.md`

**Context:**
- Grafana has a Postgres data source connected to the Supabase database
- All queries target `weekly_brief_job_log` and `pgmq.metrics()`
- Include ready-to-paste SQL for each panel

**Step 1: Write the Grafana queries doc**

Create file `docs/grafana/weekly-brief-pipeline.md`:

```markdown
# Weekly Brief Pipeline — Grafana Dashboard Queries

Connect these queries to your Supabase Postgres data source in Grafana at
https://easyshifthq.grafana.net/

## Panel 1: Queue Depth (Stat or Gauge)

```sql
SELECT queue_length AS "Pending Jobs",
       total_messages AS "Total Processed"
FROM pgmq.metrics('weekly_brief_jobs');
```

## Panel 2: Dead Letter Queue Depth (Stat — alert if > 0)

```sql
SELECT queue_length AS "Dead Lettered"
FROM pgmq.metrics('weekly_brief_dead_letter');
```

## Panel 3: Completion Rate — Last Run (Pie Chart)

```sql
SELECT status, COUNT(*) AS count
FROM weekly_brief_job_log
WHERE created_at >= (
  SELECT MAX(created_at) - INTERVAL '2 hours'
  FROM weekly_brief_job_log WHERE status = 'queued'
)
GROUP BY status;
```

## Panel 4: Processing Duration — p50/p95/p99 (Time Series)

```sql
SELECT
  date_trunc('hour', created_at) AS time,
  percentile_cont(0.50) WITHIN GROUP (ORDER BY duration_ms) AS p50_ms,
  percentile_cont(0.95) WITHIN GROUP (ORDER BY duration_ms) AS p95_ms,
  percentile_cont(0.99) WITHIN GROUP (ORDER BY duration_ms) AS p99_ms
FROM weekly_brief_job_log
WHERE status = 'completed'
  AND created_at >= NOW() - INTERVAL '7 days'
GROUP BY 1
ORDER BY 1;
```

## Panel 5: Failures by Restaurant (Table)

```sql
SELECT
  r.name AS restaurant,
  COUNT(*) FILTER (WHERE jl.status = 'failed') AS failures,
  COUNT(*) FILTER (WHERE jl.status = 'dead_lettered') AS dead_lettered,
  MAX(jl.error_message) AS last_error
FROM weekly_brief_job_log jl
JOIN restaurants r ON r.id = jl.restaurant_id
WHERE jl.created_at >= NOW() - INTERVAL '30 days'
  AND jl.status IN ('failed', 'dead_lettered')
GROUP BY r.name
ORDER BY failures DESC
LIMIT 20;
```

## Panel 6: Weekly Throughput (Bar Chart)

```sql
SELECT
  date_trunc('week', created_at) AS week,
  COUNT(*) FILTER (WHERE status = 'completed') AS completed,
  COUNT(*) FILTER (WHERE status = 'failed') AS failed,
  COUNT(*) FILTER (WHERE status = 'dead_lettered') AS dead_lettered
FROM weekly_brief_job_log
WHERE created_at >= NOW() - INTERVAL '12 weeks'
GROUP BY 1
ORDER BY 1;
```

## Panel 7: Email Delivery Gap (Table — alert if any rows)

Briefs generated but not emailed after 1 hour:

```sql
SELECT
  r.name AS restaurant,
  wb.brief_week_end,
  wb.computed_at,
  NOW() - wb.computed_at AS age
FROM weekly_brief wb
JOIN restaurants r ON r.id = wb.restaurant_id
WHERE wb.email_sent_at IS NULL
  AND wb.computed_at < NOW() - INTERVAL '1 hour'
ORDER BY wb.computed_at DESC
LIMIT 20;
```

## Alerts

| Alert | Condition | Severity |
|---|---|---|
| Queue stalled | `queue_length > 0` AND last `queued` entry > 2 hours old | Warning |
| Dead letter | `queue_length > 0` on `weekly_brief_dead_letter` | Critical |
| Slow processing | p95 `duration_ms > 60000` | Warning |
| Email gap | Any row from Panel 7 | Warning |
```

**Step 2: Commit**

```bash
git add docs/grafana/weekly-brief-pipeline.md
git commit -m "docs: add Grafana dashboard queries for weekly brief pipeline"
```

---

### Task 7: Run full test suite and push

**Step 1: Run unit tests**

Run: `npm run test`
Expected: All 2400+ tests pass

**Step 2: Run TypeScript check**

Run: `npx tsc --noEmit`
Expected: Clean

**Step 3: Push to PR**

```bash
git push origin feature/ai-operator
```
