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

interface BriefResult {
  restaurantId: string;
  restaurantName: string;
  status: "generated" | "skipped" | "error";
  reason?: string;
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabase = createClient(
      Deno.env.get("SUPABASE_URL") ?? "",
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? ""
    );

    const openRouterApiKey = Deno.env.get("OPENROUTER_API_KEY");
    if (!openRouterApiKey) {
      throw new Error("OPENROUTER_API_KEY is not configured");
    }

    // Yesterday's date in YYYY-MM-DD format
    const now = new Date();
    now.setDate(now.getDate() - 1);
    const yesterday = now.toISOString().split("T")[0];

    console.log(`Generating daily briefs for ${yesterday}`);

    // Get distinct restaurant IDs (limit 10 per run to avoid timeouts)
    const { data: restaurants, error: restError } = await supabase
      .from("user_restaurants")
      .select("restaurant_id")
      .limit(1000);

    if (restError) {
      throw new Error(`Failed to fetch restaurants: ${restError.message}`);
    }

    // Deduplicate restaurant IDs
    const restaurantIds = [
      ...new Set((restaurants || []).map((r: { restaurant_id: string }) => r.restaurant_id)),
    ].slice(0, 10);

    console.log(`Found ${restaurantIds.length} restaurants to process`);

    const results: BriefResult[] = [];

    for (const restaurantId of restaurantIds) {
      try {
        // Check if brief already exists for this date
        const { data: existing } = await supabase
          .from("daily_brief")
          .select("id")
          .eq("restaurant_id", restaurantId)
          .eq("brief_date", yesterday)
          .maybeSingle();

        if (existing) {
          results.push({
            restaurantId,
            restaurantName: "",
            status: "skipped",
            reason: "Brief already exists",
          });
          continue;
        }

        // Run variance engine
        const { data: variances, error: varError } = await supabase.rpc(
          "compute_daily_variances",
          { p_restaurant_id: restaurantId, p_date: yesterday }
        );
        if (varError) {
          console.error(`Variance error for ${restaurantId}:`, varError.message);
        }

        // Run anomaly detectors
        const { error: backlogError } = await supabase.rpc(
          "detect_uncategorized_backlog",
          { p_restaurant_id: restaurantId }
        );
        if (backlogError) {
          console.error(`Backlog error for ${restaurantId}:`, backlogError.message);
        }

        const { error: anomalyError } = await supabase.rpc(
          "detect_metric_anomalies",
          { p_restaurant_id: restaurantId, p_date: yesterday }
        );
        if (anomalyError) {
          console.error(`Anomaly error for ${restaurantId}:`, anomalyError.message);
        }

        const { error: reconError } = await supabase.rpc(
          "detect_reconciliation_gaps",
          { p_restaurant_id: restaurantId, p_date: yesterday }
        );
        if (reconError) {
          console.error(`Reconciliation error for ${restaurantId}:`, reconError.message);
        }

        // Query open ops_inbox_item count
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
        const { data: pnl } = await supabase
          .from("daily_pnl")
          .select(
            "net_revenue, food_cost, labor_cost, prime_cost, gross_profit, food_cost_percentage, labor_cost_percentage, prime_cost_percentage"
          )
          .eq("restaurant_id", restaurantId)
          .eq("date", yesterday)
          .maybeSingle();

        const metricsJson = pnl || {};
        const variancesJson = variances || [];

        // Generate top 3 recommendations from variances
        const recommendations = buildRecommendations(variancesJson);

        // Generate narrative via LLM
        let narrativeText = "";
        try {
          const aiResult = await callAIWithFallback<{ narrative: string }>(
            {
              messages: [
                {
                  role: "system",
                  content:
                    'You are a restaurant financial analyst. Summarize yesterday\'s performance in 3-4 sentences. ONLY reference the numbers provided below. Do not invent or estimate any figures. Write in a direct, professional tone. Lead with the most important change. Return your response as JSON: {"narrative": "your summary here"}',
                },
                {
                  role: "user",
                  content: `Restaurant: ${restaurantName}
Date: ${yesterday}
Metrics: ${JSON.stringify(metricsJson)}
Variances: ${JSON.stringify(variancesJson)}
Open issues: ${openCount ?? 0} open items (${criticalCount ?? 0} critical)`,
                },
              ],
              temperature: 0.3,
              max_tokens: 300,
            },
            openRouterApiKey,
            "generate-daily-brief",
            restaurantId
          );

          if (aiResult?.data?.narrative) {
            narrativeText = aiResult.data.narrative;
          }
        } catch (aiError) {
          console.error(`LLM error for ${restaurantId}:`, aiError);
          // Continue without narrative -- the brief is still useful without it
        }

        // Insert daily_brief row
        const { error: insertError } = await supabase.from("daily_brief").upsert(
          {
            restaurant_id: restaurantId,
            brief_date: yesterday,
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
          { onConflict: "restaurant_id,brief_date" }
        );

        if (insertError) {
          throw new Error(`Insert error: ${insertError.message}`);
        }

        results.push({ restaurantId, restaurantName, status: "generated" });
        console.log(`Brief generated for ${restaurantName} (${restaurantId})`);
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        console.error(`Failed to generate brief for ${restaurantId}:`, message);
        results.push({
          restaurantId,
          restaurantName: "",
          status: "error",
          reason: message,
        });
      }
    }

    const generated = results.filter((r) => r.status === "generated").length;
    const skipped = results.filter((r) => r.status === "skipped").length;
    const errors = results.filter((r) => r.status === "error").length;

    console.log(
      `Daily brief run complete: ${generated} generated, ${skipped} skipped, ${errors} errors`
    );

    return new Response(
      JSON.stringify({
        success: true,
        date: yesterday,
        summary: { generated, skipped, errors },
        results,
      }),
      {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      }
    );
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("Fatal error in generate-daily-brief:", message);
    return new Response(JSON.stringify({ success: false, error: message }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});

/**
 * Build top 3 recommendations from variance data.
 * Takes items with a non-null flag, sorted by severity (critical first).
 */
interface Recommendation {
  title: string;
  body: string;
  impact: string;
  effort: string;
}

function buildRecommendations(variances: VarianceItem[]): Recommendation[] {
  if (!Array.isArray(variances) || variances.length === 0) {
    return [];
  }

  const flagOrder: Record<string, number> = { critical: 0, warning: 1 };

  const flagged = variances
    .filter((v) => v.flag && v.flag !== "null")
    .sort((a, b) => {
      const aOrder = flagOrder[a.flag!] ?? 99;
      const bOrder = flagOrder[b.flag!] ?? 99;
      return aOrder - bOrder;
    })
    .slice(0, 3);

  return flagged.map((v) => {
    const direction = v.direction === "up" ? "increased" : "decreased";
    const metric = formatMetricName(v.metric);
    const pctChange = v.delta_pct_vs_avg != null ? ` (${v.delta_pct_vs_avg > 0 ? "+" : ""}${v.delta_pct_vs_avg}% vs 7-day avg)` : "";
    return {
      title: `Review ${metric}`,
      body: `${metric} ${direction} to ${v.value}${isPercentMetric(v.metric) ? "%" : ""}${pctChange}`,
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

function isPercentMetric(metric: string): boolean {
  return metric.endsWith("_pct");
}
