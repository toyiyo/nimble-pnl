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

      // Compute week end if not provided
      const now = new Date();
      const dayOfWeek = now.getDay();
      const weekEnd = new Date(now);
      weekEnd.setDate(now.getDate() - (dayOfWeek === 0 ? 7 : dayOfWeek));
      const weekEndStr = (body.brief_week_end as string) || weekEnd.toISOString().split("T")[0];

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

    return jsonResponse({ success: true, ...(data as Record<string, unknown>) });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("Fatal error in generate-weekly-brief:", message);
    return jsonResponse({ success: false, error: "Internal server error" }, 500);
  }
});
