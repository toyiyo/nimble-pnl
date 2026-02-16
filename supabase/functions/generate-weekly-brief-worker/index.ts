import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { corsHeaders } from "../_shared/cors.ts";
import { callAIWithFallback } from "../_shared/ai-caller.ts";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

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

// ---------------------------------------------------------------------------
// Response helpers
// ---------------------------------------------------------------------------

const jsonHeaders = { ...corsHeaders, "Content-Type": "application/json" };

function jsonResponse(body: Record<string, unknown>, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: jsonHeaders });
}

// ---------------------------------------------------------------------------
// Main handler
// ---------------------------------------------------------------------------

serve(async (req) => {
  // Handle CORS preflight
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  const startTime = Date.now();
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
  const supabaseUrl = Deno.env.get("SUPABASE_URL") ?? "";

  // Step 1: Auth guard
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
    // Step 2: Parse body
    const body = await req.json();
    restaurantId = body.restaurant_id;
    briefWeekEnd = body.brief_week_end;
    msgId = body.msg_id;
    attempt = body.attempt ?? 1;

    if (!restaurantId || !briefWeekEnd) {
      return jsonResponse(
        { success: false, error: "restaurant_id and brief_week_end required" },
        400
      );
    }

    // Step 3: Log processing
    await supabase.from("weekly_brief_job_log").insert({
      restaurant_id: restaurantId,
      brief_week_end: briefWeekEnd,
      status: "processing",
      attempt,
      msg_id: msgId,
    });

    // Step 4: Compute week range
    const [year, month, day] = briefWeekEnd.split("-").map(Number);
    const weekEnd = new Date(year, month - 1, day);
    const weekStart = new Date(weekEnd);
    weekStart.setDate(weekEnd.getDate() - 6);
    const weekEndStr = briefWeekEnd;
    const weekStartStr = weekStart.toISOString().split("T")[0];

    // Step 5: Idempotency check
    const { data: existing } = await supabase
      .from("weekly_brief")
      .select("id")
      .eq("restaurant_id", restaurantId)
      .eq("brief_week_end", weekEndStr)
      .maybeSingle();

    if (existing) {
      // Already generated -- delete queue message and log success
      if (msgId) {
        await supabase.rpc("pgmq_delete_message", {
          p_queue_name: "weekly_brief_jobs",
          p_msg_id: msgId,
        });
      }
      await logCompleted(
        supabase,
        restaurantId,
        briefWeekEnd,
        attempt,
        msgId,
        Date.now() - startTime
      );
      return jsonResponse({ success: true, status: "already_exists" });
    }

    // Step 6: Run variance engine
    const { data: variances, error: varError } = await supabase.rpc(
      "compute_weekly_variances",
      { p_restaurant_id: restaurantId, p_week_end: weekEndStr }
    );
    if (varError) {
      console.error(`Variance error for ${restaurantId}:`, varError.message);
    }

    // Step 7: Run anomaly detectors (all non-fatal)
    const detectors = [
      {
        name: "detect_uncategorized_backlog",
        params: { p_restaurant_id: restaurantId },
      },
      {
        name: "detect_metric_anomalies",
        params: { p_restaurant_id: restaurantId, p_date: weekEndStr },
      },
      {
        name: "detect_reconciliation_gaps",
        params: { p_restaurant_id: restaurantId, p_date: weekEndStr },
      },
    ];

    for (const det of detectors) {
      const { error } = await supabase.rpc(det.name, det.params);
      if (error) {
        console.error(
          `${det.name} error for ${restaurantId}:`,
          error.message
        );
      }
    }

    // Step 8: Query ops_inbox counts
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

    // Step 9: Fetch restaurant name
    const { data: restaurant } = await supabase
      .from("restaurants")
      .select("name")
      .eq("id", restaurantId)
      .single();

    const restaurantName = restaurant?.name || "Unknown Restaurant";

    // Step 10: Build metrics_json from daily_pnl (aggregate the full week)
    const { data: pnlRows } = await supabase
      .from("daily_pnl")
      .select("net_revenue, food_cost, labor_cost, prime_cost, gross_profit")
      .eq("restaurant_id", restaurantId)
      .gte("date", weekStartStr)
      .lte("date", weekEndStr);

    const metricsJson: Record<string, number> = {};
    if (pnlRows && pnlRows.length > 0) {
      metricsJson.net_revenue = pnlRows.reduce(
        (s: number, r: any) => s + (r.net_revenue || 0),
        0
      );
      metricsJson.food_cost = pnlRows.reduce(
        (s: number, r: any) => s + (r.food_cost || 0),
        0
      );
      metricsJson.labor_cost = pnlRows.reduce(
        (s: number, r: any) => s + (r.labor_cost || 0),
        0
      );
      metricsJson.prime_cost = pnlRows.reduce(
        (s: number, r: any) => s + (r.prime_cost || 0),
        0
      );
      metricsJson.gross_profit = pnlRows.reduce(
        (s: number, r: any) => s + (r.gross_profit || 0),
        0
      );
      if (metricsJson.net_revenue > 0) {
        metricsJson.food_cost_pct =
          Math.round(
            (metricsJson.food_cost / metricsJson.net_revenue) * 1000
          ) / 10;
        metricsJson.labor_cost_pct =
          Math.round(
            (metricsJson.labor_cost / metricsJson.net_revenue) * 1000
          ) / 10;
        metricsJson.prime_cost_pct =
          Math.round(
            (metricsJson.prime_cost / metricsJson.net_revenue) * 1000
          ) / 10;
      }
    }

    const variancesJson = variances || [];

    // Step 11: Build recommendations from flagged variances
    const recommendations = buildRecommendations(variancesJson);

    // Step 12: Generate AI narrative (non-fatal)
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
        // Continue without narrative -- the brief is still useful without it
      }
    } else {
      console.log(
        `OPENROUTER_API_KEY not set, skipping narrative for ${restaurantId}`
      );
    }

    // Step 13: Upsert weekly_brief row
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

    // Step 14: Delete queue message on success
    if (msgId) {
      await supabase.rpc("pgmq_delete_message", {
        p_queue_name: "weekly_brief_jobs",
        p_msg_id: msgId,
      });
    }

    // Step 15: Log completed
    await logCompleted(
      supabase,
      restaurantId,
      briefWeekEnd,
      attempt,
      msgId,
      Date.now() - startTime
    );

    // Step 16: Fire-and-forget email
    fetch(`${supabaseUrl}/functions/v1/send-weekly-brief-email`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${serviceRoleKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        restaurant_id: restaurantId,
        brief_week_end: weekEndStr,
      }),
    }).catch((emailErr) => {
      console.error(`Email trigger failed for ${restaurantId}:`, emailErr);
    });

    return jsonResponse({
      success: true,
      restaurant_id: restaurantId,
      duration_ms: Date.now() - startTime,
    });
  } catch (err) {
    // Step 17: On error -- log failed, do NOT delete queue message
    const message = err instanceof Error ? err.message : String(err);
    console.error(`Worker failed for ${restaurantId}:`, message);

    if (restaurantId && briefWeekEnd) {
      await supabase
        .from("weekly_brief_job_log")
        .insert({
          restaurant_id: restaurantId,
          brief_week_end: briefWeekEnd,
          status: "failed",
          attempt: attempt ?? 1,
          msg_id: msgId,
          error_message: message,
          duration_ms: Date.now() - startTime,
        })
        .then(null, () => {}); // Never fail on a log write error
    }

    return jsonResponse({ success: false, error: message }, 500);
  }
});

// ---------------------------------------------------------------------------
// Logging helper
// ---------------------------------------------------------------------------

async function logCompleted(
  supabase: any,
  restaurantId: string,
  briefWeekEnd: string,
  attempt: number | undefined,
  msgId: number | undefined,
  durationMs: number
): Promise<void> {
  await supabase
    .from("weekly_brief_job_log")
    .insert({
      restaurant_id: restaurantId,
      brief_week_end: briefWeekEnd,
      status: "completed",
      attempt: attempt ?? 1,
      msg_id: msgId,
      duration_ms: durationMs,
    })
    .then(null, () => {}); // Never fail on a log write error
}

// ---------------------------------------------------------------------------
// Helpers (copied from generate-weekly-brief)
// ---------------------------------------------------------------------------

/**
 * Build top 3 recommendations from variance data.
 * Takes items with a non-null flag, sorted by severity (critical first).
 */
function buildRecommendations(variances: VarianceItem[]): Recommendation[] {
  if (!Array.isArray(variances) || variances.length === 0) {
    return [];
  }

  const flagOrder: Record<string, number> = { critical: 0, warning: 1 };

  // Guard against SQL returning the string "null" instead of a real null
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
    const pctChange =
      v.delta_pct_vs_avg != null
        ? ` (${v.delta_pct_vs_avg > 0 ? "+" : ""}${v.delta_pct_vs_avg}% vs 4-week avg)`
        : "";
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
