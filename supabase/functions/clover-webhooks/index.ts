import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.57.4";
import { corsHeaders } from "../_shared/cors.ts";

interface CloverWebhookPayload {
  appId: string;
  merchants: {
    mId: string;
    update?: Array<{
      objectId: string;
      type: "CREATE" | "UPDATE" | "DELETE";
      ts: number;
    }>;
  }[];
  verificationCode?: string;
}

serve(async (req) => {
  // Handle CORS preflight
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabase = createClient(
      Deno.env.get("SUPABASE_URL") ?? "",
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? ""
    );

    const payload: CloverWebhookPayload = await req.json();
    console.log("Clover webhook received:", JSON.stringify(payload, null, 2));

    // Step 1: Handle verification code during webhook setup
    if (payload.verificationCode) {
      console.log("Webhook verification requested, code:", payload.verificationCode);
      
      return new Response(
        JSON.stringify({ verificationCode: payload.verificationCode }),
        {
          status: 200,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        }
      );
    }

    // Step 2: Log Clover Auth Code header (if present)
    const cloverAuthCode = req.headers.get("Clover-Auth-Code");
    if (cloverAuthCode) {
      console.log("Clover-Auth-Code header present:", cloverAuthCode.substring(0, 10) + "...");
    } else {
      console.warn("Clover-Auth-Code header not present - webhook may not be fully verified yet");
    }

    // Step 3: Process webhook events
    if (!payload.merchants || payload.merchants.length === 0) {
      console.log("No merchant data in webhook");
      return new Response(
        JSON.stringify({ message: "No merchant data" }),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    for (const merchant of payload.merchants) {
      const merchantId = merchant.mId;
      console.log(`Processing webhook for merchant: ${merchantId}`);

      // Find the restaurant associated with this Clover merchant
      const { data: connection, error: connectionError } = await supabase
        .from("clover_connections")
        .select("restaurant_id")
        .eq("merchant_id", merchantId)
        .maybeSingle();

      if (connectionError || !connection) {
        console.error(`No connection found for merchant ${merchantId}:`, connectionError);
        continue;
      }

      const restaurantId = connection.restaurant_id;

      if (!merchant.update || merchant.update.length === 0) {
        console.log("No updates in merchant data");
        continue;
      }

      // Process each update event
      for (const update of merchant.update) {
        console.log(`Processing ${update.type} event for ${update.objectId}`);

        // Parse objectId to get event type and ID
        // Format: "O:ORDER_ID" for orders, "P:PAYMENT_ID" for payments, etc.
        const [eventKey, objectId] = update.objectId.split(":");

        // Handle different event types
        switch (eventKey) {
          case "O": // Orders
            console.log(`Order ${update.type}: ${objectId}`);
            // Trigger order sync for this specific order
            if (update.type === "CREATE" || update.type === "UPDATE") {
              try {
                await supabase.functions.invoke("clover-sync-data", {
                  body: {
                    restaurantId,
                    action: "daily",
                    // Use timestamp to sync recent data
                    dateRange: {
                      start: new Date(update.ts - 86400000).toISOString().split('T')[0], // 1 day before
                      end: new Date(update.ts).toISOString().split('T')[0]
                    }
                  }
                });
                console.log(`Triggered sync for order ${objectId}`);
              } catch (syncError) {
                console.error(`Failed to trigger sync for order ${objectId}:`, syncError);
              }
            }
            break;

          case "P": // Payments
            console.log(`Payment ${update.type}: ${objectId}`);
            // Payments are part of orders, so trigger order sync
            if (update.type === "CREATE" || update.type === "UPDATE") {
              try {
                await supabase.functions.invoke("clover-sync-data", {
                  body: {
                    restaurantId,
                    action: "daily",
                    dateRange: {
                      start: new Date(update.ts - 86400000).toISOString().split('T')[0],
                      end: new Date(update.ts).toISOString().split('T')[0]
                    }
                  }
                });
                console.log(`Triggered sync for payment ${objectId}`);
              } catch (syncError) {
                console.error(`Failed to trigger sync for payment ${objectId}:`, syncError);
              }
            }
            break;

          case "I": // Inventory items
            console.log(`Inventory item ${update.type}: ${objectId}`);
            // Future: Handle inventory updates
            break;

          case "IC": // Inventory categories
            console.log(`Inventory category ${update.type}: ${objectId}`);
            break;

          case "C": // Customers
            console.log(`Customer ${update.type}: ${objectId}`);
            break;

          case "E": // Employees
            console.log(`Employee ${update.type}: ${objectId}`);
            break;

          default:
            console.log(`Unhandled event type ${eventKey}: ${objectId}`);
        }
      }
    }

    // Always return 200 OK to acknowledge receipt
    return new Response(
      JSON.stringify({ message: "Webhook processed successfully" }),
      {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      }
    );

  } catch (error) {
    console.error("Error processing Clover webhook:", error);
    
    // Still return 200 to prevent Clover from retrying
    return new Response(
      JSON.stringify({ 
        message: "Webhook received but processing failed",
        error: error.message 
      }),
      {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      }
    );
  }
});
