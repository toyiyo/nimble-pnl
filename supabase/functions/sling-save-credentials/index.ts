import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { getEncryptionService } from "../_shared/encryption.ts";
import { logSecurityEvent } from "../_shared/securityEvents.ts";
import { corsHeaders } from "../_shared/cors.ts";

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) {
      return new Response(
        JSON.stringify({ error: "Missing authorization" }),
        {
          status: 401,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        }
      );
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL") ?? "";
    const supabaseAnonKey = Deno.env.get("SUPABASE_ANON_KEY") ?? "";
    const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";

    // User client for auth verification (anon key + user JWT)
    const userSupabase = createClient(supabaseUrl, supabaseAnonKey, {
      global: { headers: { Authorization: authHeader } },
    });

    // Service client for privileged data operations (bypasses RLS)
    const serviceSupabase = createClient(supabaseUrl, supabaseServiceKey);

    const {
      data: { user },
    } = await userSupabase.auth.getUser();
    if (!user) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const { restaurantId, email, password, authToken } = await req.json();

    // Either email+password or authToken is required
    if (!restaurantId || (!authToken && (!email || !password))) {
      return new Response(
        JSON.stringify({ error: "Missing required fields: restaurantId and either (email + password) or authToken" }),
        {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        }
      );
    }

    // Verify user has permission (owner/manager only)
    const { data: userRestaurant } = await userSupabase
      .from("user_restaurants")
      .select("role")
      .eq("user_id", user.id)
      .eq("restaurant_id", restaurantId)
      .single();

    if (
      !userRestaurant ||
      !["owner", "manager"].includes(userRestaurant.role)
    ) {
      return new Response(JSON.stringify({ error: "Access denied" }), {
        status: 403,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const encryption = await getEncryptionService();

    // Build upsert payload based on auth method
    const upsertPayload: Record<string, unknown> = {
      restaurant_id: restaurantId,
      is_active: true,
      connection_status: "pending",
      updated_at: new Date().toISOString(),
    };

    if (authToken) {
      // Direct token auth — encrypt and store the token directly
      upsertPayload.auth_token = await encryption.encrypt(authToken);
      upsertPayload.token_fetched_at = new Date().toISOString();
      upsertPayload.email = email || "token-auth";
      upsertPayload.password_encrypted = "";
    } else {
      // Email+password auth — encrypt password, clear stale token
      upsertPayload.email = email;
      upsertPayload.password_encrypted = await encryption.encrypt(password);
      upsertPayload.auth_token = null;
      upsertPayload.token_fetched_at = null;
    }

    // Upsert connection (using service role for privileged write)
    const { data: connection, error: upsertError } = await serviceSupabase
      .from("sling_connections")
      .upsert(upsertPayload, {
        onConflict: "restaurant_id",
      })
      .select()
      .single();

    if (upsertError) {
      throw new Error(
        `Failed to save credentials: ${upsertError.message}`
      );
    }

    await logSecurityEvent(
      serviceSupabase,
      "SLING_CREDENTIALS_SAVED",
      user.id,
      restaurantId,
      { email }
    );

    return new Response(
      JSON.stringify({
        success: true,
        connection: {
          id: connection.id,
          restaurant_id: connection.restaurant_id,
          email: connection.email,
          is_active: connection.is_active,
          connection_status: connection.connection_status,
        },
      }),
      {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      }
    );
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    console.error("Error saving Sling credentials:", message);
    return new Response(JSON.stringify({ error: "Failed to save Sling credentials" }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
