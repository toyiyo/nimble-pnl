import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { corsHeaders } from "../_shared/cors.ts";
import {
  buildNotifyResponse,
  claimNotifications,
  deliverClaimed,
  NOTHING_TO_SEND,
  summarizeOutcomes,
  type RpcClient,
} from "../_shared/scheduleNotificationDelivery.ts";
import { makeDeliverDeps } from "../_shared/scheduleNotificationSenders.ts";
import { resolveChannels, type SupabaseLike } from "../_shared/resolveChannels.ts";
import { safeTz } from "../_shared/timezone.ts";

const RESEND_API_KEY = Deno.env.get("RESEND_API_KEY");

interface NotificationPayload {
  publicationId: string;
  restaurantId: string;
  weekStart: string;
  weekEnd: string;
}

serve(async (req) => {
  // Handle CORS
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    // Authenticate user
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) {
      throw new Error("Missing authorization header");
    }

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL") ?? "",
      Deno.env.get("SUPABASE_ANON_KEY") ?? "",
      {
        global: {
          headers: { Authorization: authHeader },
        },
      }
    );

    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser();

    if (authError || !user) {
      throw new Error("Unauthorized");
    }

    // Parse request body
    const payload: NotificationPayload = await req.json();
    const { publicationId, restaurantId, weekStart, weekEnd } = payload;

    // Verify user has permission for this restaurant
    const { data: userRestaurant, error: permError } = await supabase
      .from("user_restaurants")
      .select("role")
      .eq("user_id", user.id)
      .eq("restaurant_id", restaurantId)
      .single();

    if (permError || !userRestaurant || !["owner", "manager"].includes(userRestaurant.role)) {
      throw new Error("Access denied");
    }

    // Get restaurant details
    const { data: restaurant, error: restError } = await supabase
      .from("restaurants")
      .select("name, timezone")
      .eq("id", restaurantId)
      .single();

    if (restError || !restaurant) {
      throw new Error("Restaurant not found");
    }

    // Service-role client: the claim, the ledger reads, and the sends need it.
    const serviceClient = createClient(
      Deno.env.get("SUPABASE_URL") ?? "",
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? ""
    );
    const ch = await resolveChannels(
      serviceClient as unknown as SupabaseLike,
      restaurantId,
      "schedule_published"
    );

    const tz = safeTz(restaurant.timezone);
    if (tz !== restaurant.timezone) {
      console.warn(`Invalid timezone "${restaurant.timezone}" for restaurant ${restaurantId}; falling back to ${tz}`);
    }

    // Claim before the send (TLA+ UniqueClaim). Only employees with a change
    // that has no sent notification get a row, so a republish with no change
    // claims nothing and sends nothing (TLA+ NoEmptyNotification).
    // Design: docs/superpowers/specs/2026-11-28-mcp-publish-notifications-design.md
    const claims = await claimNotifications(serviceClient as unknown as RpcClient, {
      restaurantId,
      from: weekStart,
      to: weekEnd,
      source: "publish",
      publicationId,
    });

    if (claims.length === 0) {
      return new Response(JSON.stringify(NOTHING_TO_SEND), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
        status: 200,
      });
    }

    let pushSentCount = 0;
    const outcomes = await deliverClaimed(
      claims,
      makeDeliverDeps({
        serviceClient,
        restaurantId,
        restaurantName: restaurant.name,
        timeZone: tz,
        resendApiKey: RESEND_API_KEY,
        channels: { email: ch.email, push: ch.push },
        onPushSent: (count) => {
          pushSentCount += count;
        },
      }),
    );

    const summary = summarizeOutcomes(outcomes);

    if (summary.sent > 0) {
      const { error: markError } = await serviceClient
        .from("schedule_publications")
        .update({ notification_sent: true })
        .eq("id", publicationId)
        .eq("restaurant_id", restaurantId)
        .eq("week_start_date", weekStart);
      if (markError) {
        console.error(`Failed to mark publication ${publicationId} as notified:`, markError);
      }
    }

    console.log(
      `publication ${publicationId}: ${summary.sent} sent, ${summary.skipped} skipped, ${summary.failed} failed, ${summary.deferred} deferred, ${pushSentCount} pushes`,
    );

    return new Response(JSON.stringify(buildNotifyResponse(outcomes, pushSentCount)), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
      status: summary.httpStatus,
    });
  } catch (error: unknown) {
    console.error("Error in notify-schedule-published:", error);
    return new Response(
      JSON.stringify({
        error: error instanceof Error ? error.message : "An error occurred",
      }),
      {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
        status: 500,
      }
    );
  }
});